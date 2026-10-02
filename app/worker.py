import argparse
import logging
import time
from datetime import timedelta

from sqlalchemy import and_, exists, or_, select, update
from sqlalchemy.orm import aliased

from app.config import Settings
from app.db import begin_write, make_engine, session_factory
from app.integrations import IntegrationError, Integrations
from app.models import Application, Candidate, SyncJob, new_id, utcnow
from app.service import application_data

logger = logging.getLogger(__name__)


def claim(factory, max_attempts, targets=None):
    with factory.begin() as session:
        begin_write(session)
        now = utcnow()
        older = aliased(SyncJob)
        blocker = exists(select(older.id).where(older.application_id == SyncJob.application_id, older.target == SyncJob.target, older.revision < SyncJob.revision, older.state.in_(["pending", "retry", "processing"])))
        query = select(SyncJob).where(
            or_(and_(SyncJob.state.in_(["pending", "retry"]), SyncJob.next_attempt_at <= now), and_(SyncJob.state == "processing", SyncJob.lease_until <= now)),
            ~blocker,
        ).order_by(SyncJob.created_at, SyncJob.revision, SyncJob.id).limit(1).with_for_update(skip_locked=True)
        if targets is not None:
            query = query.where(SyncJob.target.in_(targets))
        while job := session.scalar(query):
            if job.attempts >= max_attempts:
                job.state, job.last_error = "dead", "Worker lease expired after maximum attempts."
                job.lease_token, job.lease_until = None, None
                session.flush()
                continue
            job.state, job.lease_token = "processing", new_id()
            job.lease_until = now + timedelta(minutes=5)
            job.attempts += 1
            job.updated_at = now
            session.flush()
            return {"id": job.id, "target": job.target, "application_id": job.application_id, "lease_token": job.lease_token, "attempts": job.attempts, "payload": dict(job.payload)}
    return None


def run_once(factory, integrations, max_attempts=8, targets=None):
    job = claim(factory, max_attempts, targets)
    if not job:
        return False
    data = job["payload"]
    with factory() as session:
        application = session.get(Application, job["application_id"])
        candidate = session.get(Candidate, application.candidate_id)
        if job["target"] == "hubspot":
            # A CRM contact represents a person. Reflect their most recent role application.
            latest = session.scalar(select(Application).where(Application.candidate_id == candidate.id).order_by(Application.updated_at.desc(), Application.id).limit(1))
            data = application_data(session, latest)
        elif job["target"] == "notion":
            data["notion_page_id"] = application.notion_page_id
    error, remote_id = None, None
    try:
        remote_id = integrations.send(job["target"], data, job["id"])
    except IntegrationError as caught:
        error = caught
    except Exception:
        logger.error("Sync adapter failed for job %s (details withheld).", job["id"])
        error = IntegrationError(f"{job['target']}: unexpected adapter error")
    with factory.begin() as session:
        begin_write(session)
        current = session.scalar(select(SyncJob).where(SyncJob.id == job["id"]).with_for_update())
        if current.lease_token != job["lease_token"]:
            return True
        current.lease_until, current.lease_token = None, None
        current.updated_at = utcnow()
        if error:
            current.last_error = str(error)[:200]
            current.state = "retry" if error.retryable and current.attempts < max_attempts else "dead"
            delay = max(min(5 * 2 ** (current.attempts - 1), 3600), error.retry_after)
            current.next_attempt_at = utcnow() + timedelta(seconds=delay)
        else:
            current.state, current.last_error = "succeeded", None
            if current.target == "notion":
                session.execute(update(Application).where(Application.id == current.application_id).values(notion_page_id=remote_id))
            elif current.target == "hubspot":
                candidate_id = session.get(Application, current.application_id).candidate_id
                session.execute(update(Candidate).where(Candidate.id == candidate_id).values(hubspot_contact_id=remote_id))
    logger.info("Sync job %s: %s", job["id"], "failed" if error else "succeeded")
    return True


def main():
    parser = argparse.ArgumentParser(description="Run the durable employment sync worker.")
    parser.add_argument("--once", action="store_true", help="Drain up to 100 currently ready jobs, then exit.")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    settings = Settings()
    if not settings.sync_targets:
        logger.info("External sync is disabled; no jobs processed.")
        return
    engine = make_engine(settings.database_url)
    factory = session_factory(engine)
    integrations = Integrations(settings)
    try:
        count = 0
        while True:
            processed = run_once(factory, integrations, settings.max_sync_attempts, settings.sync_targets)
            count += int(processed)
            if args.once and (not processed or count >= 100):
                break
            if not processed:
                time.sleep(5)
    except KeyboardInterrupt:
        pass
    finally:
        integrations.close()
        engine.dispose()


if __name__ == "__main__":
    main()
