import hashlib
import json
from decimal import Decimal
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError

from app.db import begin_write
from app.models import Application, Candidate, IntakeReceipt, StatusEvent, SyncJob, new_id, utcnow


TRANSITIONS = {
    "new_applicants": {"screening", "rejected", "withdrawn"},
    "screening": {"interview", "rejected", "withdrawn"},
    "interview": {"offered", "rejected", "withdrawn"},
    "offered": {"hired", "rejected", "withdrawn"},
    "hired": set(), "rejected": set(), "withdrawn": set(),
}


def serial(value):
    if isinstance(value, datetime):
        return value.isoformat() + "Z"
    if isinstance(value, Decimal):
        return str(value)
    return value


def application_data(session, application):
    candidate = session.get(Candidate, application.candidate_id)
    result = {column.name: serial(getattr(application, column.name)) for column in Application.__table__.columns}
    result.update({key: getattr(candidate, key) for key in ("email", "full_name", "phone", "timezone", "hubspot_contact_id")})
    return result


def enqueue(session, application, targets):
    payload = application_data(session, application)
    for target in targets:
        session.add(SyncJob(application_id=application.id, target=target, revision=application.version, payload=payload))


def submission_result(receipt, duplicate):
    return {"application_id": receipt.application_id, "submission_id": receipt.id, "duplicate": duplicate}


def check_replay(receipt, digest):
    if receipt.payload_hash != digest:
        raise HTTPException(409, "This idempotency key was already used for a different payload.")
    return submission_result(receipt, True)


def submit(factory, intake, source, event_key, targets):
    data = intake.model_dump(mode="json")
    digest = hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    try:
        with factory.begin() as session:
            begin_write(session)
            receipt = session.scalar(select(IntakeReceipt).where(IntakeReceipt.source == source, IntakeReceipt.event_key == event_key))
            if receipt:
                return check_replay(receipt, digest)
            now = utcnow()
            insert = sqlite_insert if session.bind.dialect.name == "sqlite" else pg_insert
            candidate_values = {key: data[key] for key in ("email", "full_name", "phone", "timezone")}
            candidate_id = session.scalar(insert(Candidate).values(id=new_id(), **candidate_values, created_at=now, updated_at=now).on_conflict_do_update(
                index_elements=[Candidate.email], set_={**candidate_values, "updated_at": now}
            ).returning(Candidate.id))
            app_values = {key: getattr(intake, key) for key in type(intake).model_fields if key not in candidate_values}
            application = session.scalar(select(Application).where(Application.candidate_id == candidate_id, Application.target_role == intake.target_role).with_for_update())
            if application:
                for key, value in app_values.items():
                    setattr(application, key, value)
                application.consent_at = now
                application.updated_at = now
                application.version += 1
            else:
                application = Application(id=new_id(), candidate_id=candidate_id, **app_values, consent_at=now, created_at=now, updated_at=now, status="new_applicants", version=1)
                session.add(application)
                session.flush()
                session.add(StatusEvent(application_id=application.id, old_status=None, new_status="new_applicants", actor="intake"))
            session.flush()
            receipt = IntakeReceipt(id=new_id(), source=source, event_key=event_key, payload_hash=digest, application_id=application.id)
            session.add(receipt)
            enqueue(session, application, targets)
            session.flush()
            return submission_result(receipt, False)
    except IntegrityError:
        # Concurrent delivery of the same event may win the unique constraint.
        with factory() as session:
            receipt = session.scalar(select(IntakeReceipt).where(IntakeReceipt.source == source, IntakeReceipt.event_key == event_key))
            if receipt:
                return check_replay(receipt, digest)
        raise


def change_status(factory, application_id, change, targets):
    with factory.begin() as session:
        begin_write(session)
        application = session.scalar(select(Application).where(Application.id == application_id).with_for_update())
        if not application:
            raise HTTPException(404, "Application not found.")
        if application.version != change.expected_version:
            raise HTTPException(409, "Application changed; reload before updating its status.")
        new_status = change.status.value
        if new_status not in TRANSITIONS[application.status]:
            raise HTTPException(409, "Invalid hiring-stage transition.")
        if new_status in {"rejected", "withdrawn"} and not change.reason:
            raise HTTPException(422, "A reason is required for rejection or withdrawal.")
        session.add(StatusEvent(application_id=application.id, old_status=application.status, new_status=new_status, actor="admin", reason=change.reason))
        application.status = new_status
        application.version += 1
        application.updated_at = utcnow()
        session.flush()
        enqueue(session, application, targets)
        return application_data(session, application)
