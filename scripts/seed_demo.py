"""Load the frontend's shared fictional data without resetting existing records."""
import os
from datetime import timedelta
from pathlib import Path
import json

from sqlalchemy import select

from app.config import Settings
from app.db import begin_write, make_engine, session_factory
from app.marketplace import create_application, hasher, move, notify
from app.marketplace_schemas import ApplyInput, JobInput, ProfileInput
from app.models import Application, Candidate, Employer, Job, SeekerProfile, User, new_id, utcnow

DEMO_FILE = Path(__file__).resolve().parents[1] / "frontend" / "shared" / "demo-data.json"


def seed(factory, password, targets=(), demo_file=DEMO_FILE):
    if not password or not 8 <= len(password) <= 128:
        raise ValueError("Set DEMO_PASSWORD to a private password of 8–128 characters.")
    demo = json.loads(Path(demo_file).read_text(encoding="utf-8"))
    created = {"users": 0, "employers": 0, "jobs": 0, "profiles": 0, "applications": 0}
    now = utcnow()
    with factory.begin() as session:
        begin_write(session)

        def account(email, name, role):
            user = session.scalar(select(User).where(User.email == email.lower()))
            if user:
                if user.role != role:
                    raise ValueError("An existing demo account has a different role; seed was cancelled.")
                return user
            user = User(id=new_id(), email=email.lower(), full_name=name, role=role,
                        password_hash=hasher.hash(password), created_at=now)
            session.add(user)
            session.flush()
            created["users"] += 1
            return user

        for item in demo["employers"]:
            user = account(item["owner"]["email"], item["owner"]["full_name"], "employer")
            company = session.get(Employer, item["id"])
            existing = session.scalar(select(Employer).where(Employer.owner_user_id == user.id))
            if company and company.owner_user_id != user.id or existing and existing.id != item["id"]:
                raise ValueError("A demo company conflicts with an existing record; seed was cancelled.")
            if not company:
                session.add(Employer(id=item["id"], owner_user_id=user.id,
                                     **{key: item.get(key) for key in ("name", "website", "about", "location")}))
                created["employers"] += 1
        session.flush()
        for item in demo["jobs"]:
            job = session.get(Job, item["id"])
            if job and job.employer_id != item["employer_id"]:
                raise ValueError("A demo job conflicts with an existing record; seed was cancelled.")
            if not job:
                values = JobInput.model_validate({key: value for key, value in item.items() if key not in {"id", "employer_id", "posted_days_ago"}}).model_dump()
                session.add(Job(id=item["id"], employer_id=item["employer_id"],
                                created_at=now - timedelta(days=item["posted_days_ago"]), **values))
                created["jobs"] += 1
        for item in demo["seekers"]:
            user = account(item["email"], item["full_name"], "seeker")
            if not session.get(SeekerProfile, user.id):
                values = ProfileInput.model_validate(item["profile"]).model_dump(exclude={"full_name"})
                session.add(SeekerProfile(user_id=user.id, **values))
                created["profiles"] += 1
        session.flush()
        for item in demo["applications"]:
            user = session.scalar(select(User).where(User.email == item["seeker_email"]))
            existing = session.scalar(select(Application.id).join(Candidate).where(Candidate.email == user.email, Application.job_id == item["job_id"]))
            if existing:
                continue
            job = session.get(Job, item["job_id"])
            company = session.get(Employer, job.employer_id)
            application = create_application(session, user, job,
                ApplyInput(cover_note=item.get("cover_note"), consent_to_process=True), targets,
                created_at=now - timedelta(days=item["applied_days_ago"]))
            application.employer_message = item.get("employer_message")
            status = item["status"]
            path = {"new_applicants": [], "screening": ["screening"], "interview": ["screening", "interview"],
                    "offered": ["screening", "interview", "offered"], "hired": ["screening", "interview", "offered", "hired"],
                    "rejected": ["rejected"], "withdrawn": ["withdrawn"]}[status]
            for step in path:
                move(session, application, step, "employer:" + company.owner_user_id, targets,
                     application.employer_message or ("Not selected" if step == "rejected" else "Withdrawn by candidate" if step == "withdrawn" else None))
            if status == "interview":
                notify(session, user.id, "application_accepted", f"{company.name} accepted your application",
                       application.employer_message or f"For {job.title}. They’ll contact you about next steps.", application)
            created["applications"] += 1
    return created


def main():
    password = os.environ.get("DEMO_PASSWORD", "")
    if not password or not 8 <= len(password) <= 128:
        raise SystemExit("Set DEMO_PASSWORD to a private password of 8–128 characters.")
    settings = Settings()
    engine = make_engine(settings.database_url)
    try:
        created = seed(session_factory(engine), password, settings.sync_targets)
        print("Demo seed complete: " + ", ".join(f"{value} new {key}" for key, value in created.items()))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
