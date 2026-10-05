import io
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import MetaData, func, select, text
from sqlalchemy.exc import IntegrityError

from app.db import make_engine, session_factory
from app.integrations import hubspot_properties, notion_properties
from app.marketplace import token_digest
from app.models import (Application, Candidate, Employer, IntakeReceipt, Job, LoginSession,
                        Notification, SeekerProfile, StatusEvent, SyncJob, User, utcnow)
from app.schemas import Intake
from app.service import application_data
from scripts.seed_demo import seed

PASSWORD = "test-only-password"
JOB_INPUT = {"title": "Python Engineer", "area": "engineering", "levels": ["junior", "mid"],
             "employment_type": "full_time", "work_mode": "remote", "location": "Thailand",
             "summary": "Build APIs", "description": "Build dependable APIs.", "skills": ["Python", " SQL "]}


@pytest.fixture
def market(client):
    with TestClient(client.app, base_url="https://testserver") as browser:
        yield browser


def register(market, email, role="seeker", full_name="Test Person", ip=None):
    response = market.post("/api/v2/auth/register", json={"email": email, "password": PASSWORD,
        "role": role, "full_name": full_name, **({"company_name": "Test Company"} if role == "employer" else {})},
        headers={"X-Forwarded-For": ip} if ip else {})
    assert response.status_code == 201, response.text
    auth = {"Cookie": "fw_session=" + response.cookies["fw_session"]}
    market.cookies.clear()
    return response.json()["user"], auth


@pytest.fixture
def parties(market):
    owner, owner_auth = register(market, "owner@example.com", "employer")
    other, other_auth = register(market, "other@example.com", "employer")
    seeker, seeker_auth = register(market, "seeker@example.com", full_name="Original Person")
    job = market.post("/api/v2/employer/jobs", json=JOB_INPUT, headers=owner_auth).json()
    profile = {"full_name": "Original Person", "skills": ["Python", " SQL ", "python"], "about": "Original summary",
               "phone": "+66 123", "target_role": "engineering", "timezone": "Asia/Bangkok", "experience_years": "3.1"}
    response = market.put("/api/v2/me/profile", json=profile, headers=seeker_auth)
    assert response.status_code == 200, response.text
    return {"owner": owner, "owner_auth": owner_auth, "other": other, "other_auth": other_auth,
            "seeker": seeker, "seeker_auth": seeker_auth, "job": job, "profile": profile}


def apply(market, parties, key="apply-one", job_id=None):
    return market.post(f"/api/v2/jobs/{job_id or parties['job']['id']}/apply",
        json={"consent_to_process": True, "cover_note": "Please consider me."},
        headers={**parties["seeker_auth"], "Idempotency-Key": key})


def test_cookie_password_login_logout_and_expiry(market):
    response = market.post("/api/v2/auth/register", json={"email": "  PERSON@example.com ", "password": PASSWORD,
                           "role": "seeker", "full_name": "Test Person"})
    assert response.status_code == 201
    assert response.json()["user"]["email"] == "person@example.com"
    cookie = response.headers["set-cookie"]
    for flag in ("HttpOnly", "Secure", "SameSite=lax", "Path=/", "Max-Age=2592000", "expires="):
        assert flag in cookie
    assert "Domain=" not in cookie
    raw_token = response.cookies["fw_session"]
    factory = market.app.state.session_factory
    with factory() as session:
        user = session.scalar(select(User))
        assert user.password_hash.startswith("$argon2id$") and PASSWORD not in user.password_hash
        assert session.scalar(select(LoginSession)).token_hash == token_digest(raw_token)
    assert market.get("/api/v2/auth/me").status_code == 200
    assert market.post("/api/v2/auth/logout", json={}).status_code == 204
    assert market.get("/api/v2/auth/me", headers={"Cookie": "fw_session=" + raw_token}).status_code == 401
    with factory() as session:
        assert session.scalar(select(LoginSession)).revoked_at is not None
    failures = [market.post("/api/v2/auth/login", json={"email": email, "password": "incorrect-password"})
                for email in ("person@example.com", "unknown@example.com")]
    assert [r.status_code for r in failures] == [401, 401]
    assert failures[0].json() == failures[1].json() == {"detail": "Wrong email or password."}
    assert market.post("/api/v2/auth/login", json={"email": "person@example.com", "password": PASSWORD}).status_code == 200
    with factory.begin() as session:
        active = session.scalar(select(LoginSession).where(LoginSession.revoked_at.is_(None)))
        active.expires_at = utcnow() - timedelta(seconds=1)
    assert market.get("/api/v2/auth/me").status_code == 401


def test_ownership_roles_and_public_privacy(market, parties):
    response = apply(market, parties)
    assert response.status_code == 201, response.text
    application = response.json()
    aid, jid = application["id"], parties["job"]["id"]
    other = parties["other_auth"]
    assert market.get(f"/api/v2/employer/jobs/{jid}/applications", headers=other).status_code == 404
    assert market.put(f"/api/v2/employer/jobs/{jid}", json=JOB_INPUT, headers=other).status_code == 404
    assert market.get(f"/api/v2/employer/applications/{aid}", headers=other).status_code == 404
    assert market.post(f"/api/v2/employer/applications/{aid}/decision", json={"decision": "reject", "expected_version": 1}, headers=other).status_code == 404
    assert market.post(f"/api/v2/employer/applications/{aid}/stage", json={"status": "offered", "expected_version": 1}, headers=other).status_code == 404
    _, second = register(market, "second@example.com")
    assert market.get("/api/v2/me/applications", headers=second).json() == []
    assert market.post(f"/api/v2/me/applications/{aid}/withdraw", json={}, headers=second).status_code == 404
    assert market.get("/api/v2/employer/jobs", headers=parties["seeker_auth"]).status_code == 403
    assert market.get("/api/v2/me/profile", headers=parties["owner_auth"]).status_code == 403
    assert market.get("/api/v2/me/applications").status_code == 401
    assert "email" not in json.dumps(market.get("/api/v2/jobs").json())
    assert "email" not in json.dumps(market.get(f"/api/v2/jobs/{jid}").json())
    with market.app.state.session_factory() as session:
        assert session.get(Application, aid).status == "new_applicants"


def test_apply_replay_snapshot_and_legacy_coexistence(market, parties, payload, intake_headers):
    first = apply(market, parties)
    assert first.status_code == 201, first.text
    aid = first.json()["id"]
    assert apply(market, parties).json()["id"] == aid
    duplicate = apply(market, parties, key="different-key")
    assert duplicate.status_code == 409 and duplicate.json()["code"] == "already_applied"
    mismatch = market.post(f"/api/v2/jobs/{parties['job']['id']}/apply", json={"consent_to_process": True},
                          headers={**parties["seeker_auth"], "Idempotency-Key": "apply-one"})
    assert mismatch.status_code == 409
    edited = {**parties["profile"], "full_name": "Changed Name", "phone": "changed", "skills": ["rust"], "about": "Changed summary"}
    assert market.put("/api/v2/me/profile", json=edited, headers=parties["seeker_auth"]).status_code == 200
    job2 = market.post("/api/v2/employer/jobs", json={**JOB_INPUT, "title": "Second Job"}, headers=parties["owner_auth"]).json()
    assert apply(market, parties, key="second-job", job_id=job2["id"]).status_code == 201
    # v1 keeps its own candidate/role application and does not edit either v2 one.
    assert market.post("/api/v1/intake", json={**payload, "email": parties["seeker"]["email"], "full_name": "Legacy Name", "target_role": "engineering"}, headers=intake_headers).status_code == 201
    details = market.get(f"/api/v2/employer/applications/{aid}", headers=parties["owner_auth"]).json()
    assert details["candidate"]["full_name"] == "Original Person"
    assert details["candidate"]["phone"] == "+66 123"
    assert details["candidate"]["skills"] == ["python", "sql"]
    assert details["candidate"]["about"] == "Original summary"
    with market.app.state.session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Application)) == 3
        data = application_data(session, session.get(Application, aid))
        assert data["full_name"] == "Original Person"
        assert data["job_title"] == "Python Engineer" and data["employer_email"] == "owner@example.com"
        assert hubspot_properties(data)["candidate_role_detail"] == "Python Engineer at Test Company"
        assert notion_properties(data)["Employer Email"]["rich_text"][0]["text"]["content"] == "owner@example.com"
        assert session.scalar(select(func.count()).select_from(Notification).where(Notification.type == "application_received")) == 2


def test_accept_versions_stages_history_and_notifications(market, parties):
    application = apply(market, parties).json()
    aid = application["id"]
    path = f"/api/v2/employer/applications/{aid}"
    accepted = market.post(path + "/decision", json={"decision": "accept", "message": "Let's interview.", "expected_version": 1}, headers=parties["owner_auth"])
    assert accepted.status_code == 200, accepted.text
    result = accepted.json()
    assert result["status"] == "interview" and result["version"] == 3
    assert [event["status"] for event in result["history"]] == ["new_applicants", "screening", "interview"]
    assert result["history"][1]["at"] < result["history"][2]["at"]
    assert result["employer_message"] == "Let's interview."
    assert market.post(path + "/decision", json={"decision": "reject", "expected_version": 1}, headers=parties["owner_auth"]).status_code == 409
    assert market.get(path, headers=parties["owner_auth"]).json()["version"] == 3
    for status, version in (("offered", 3), ("hired", 4)):
        result = market.post(path + "/stage", json={"status": status, "expected_version": version}, headers=parties["owner_auth"])
        assert result.status_code == 200 and result.json()["status"] == status
    assert market.post(f"/api/v2/me/applications/{aid}/withdraw", json={}, headers=parties["seeker_auth"]).status_code == 409
    notifications = market.get("/api/v2/notifications?limit=1", headers=parties["seeker_auth"]).json()
    assert notifications["unread"] == 3 and len(notifications["items"]) == 1
    assert notifications["items"][0]["type"] == "application_hired"
    assert market.post("/api/v2/notifications/read", json={"ids": [notifications["items"][0]["id"]]}, headers=parties["other_auth"]).status_code == 204
    assert market.get("/api/v2/notifications", headers=parties["seeker_auth"]).json()["unread"] == 3
    assert market.post("/api/v2/notifications/read", json={"all": True}, headers=parties["seeker_auth"]).status_code == 204
    assert market.get("/api/v2/notifications", headers=parties["seeker_auth"]).json()["unread"] == 0
    with market.app.state.session_factory() as session:
        assert session.scalar(select(func.count()).select_from(SyncJob).where(SyncJob.application_id == aid)) == 10
        assert {n.user_id for n in session.scalars(select(Notification).where(Notification.type == "application_received"))} == {parties["owner"]["id"]}
        assert {n.user_id for n in session.scalars(select(Notification).where(Notification.type != "application_received"))} == {parties["seeker"]["id"]}


def test_screening_rejection_and_withdrawal(market, parties):
    aid = apply(market, parties).json()["id"]
    path = f"/api/v2/employer/applications/{aid}"
    assert market.get(path, headers=parties["owner_auth"]).json()["version"] == 2
    assert market.get(path, headers=parties["owner_auth"]).json()["version"] == 2
    assert market.get("/api/v2/notifications", headers=parties["seeker_auth"]).json()["unread"] == 0
    result = market.post(path + "/decision", json={"decision": "reject", "expected_version": 2}, headers=parties["owner_auth"]).json()
    assert result["status"] == "rejected" and result["history"][-1]["reason"] == "Not selected"
    assert market.get("/api/v2/notifications", headers=parties["seeker_auth"]).json()["items"][0]["type"] == "application_rejected"
    job2 = market.post("/api/v2/employer/jobs", json=JOB_INPUT, headers=parties["owner_auth"]).json()
    second = apply(market, parties, key="second", job_id=job2["id"]).json()["id"]
    result = market.post(f"/api/v2/me/applications/{second}/withdraw", json={}, headers=parties["seeker_auth"])
    assert result.status_code == 200 and result.json()["status"] == "withdrawn"
    with market.app.state.session_factory() as session:
        event = session.scalar(select(StatusEvent).where(StatusEvent.application_id == second, StatusEvent.new_status == "withdrawn"))
        assert event.reason == "Withdrawn by candidate"
        notification = session.scalar(select(Notification).where(Notification.type == "application_withdrawn"))
        assert notification.user_id == parties["owner"]["id"]


def test_closed_incomplete_deactivated_and_job_filters(market, parties, admin_headers):
    job_id = parties["job"]["id"]
    for params in ({"q": "test company"}, {"q": "sql"}, {"level": "mid"}, {"area": "engineering", "work_mode": "remote", "employment_type": "full_time"}):
        assert market.get("/api/v2/jobs", params=params).json()["total"] == 1
    assert market.get("/api/v2/jobs?q=%").json()["total"] == 0
    assert market.get("/api/v2/jobs?level=lead").json()["total"] == 0
    _, empty_auth = register(market, "empty@example.com")
    response = market.post(f"/api/v2/jobs/{job_id}/apply", json={"consent_to_process": True}, headers={**empty_auth, "Idempotency-Key": "empty"})
    assert response.status_code == 422 and response.json()["code"] == "profile_incomplete"
    assert market.put(f"/api/v2/employer/jobs/{job_id}", json={**JOB_INPUT, "status": "closed"}, headers=parties["owner_auth"]).status_code == 200
    assert market.get(f"/api/v2/jobs/{job_id}").status_code == 404
    assert market.get(f"/api/v2/jobs/{job_id}", headers=parties["other_auth"]).status_code == 404
    assert market.get(f"/api/v2/jobs/{job_id}", headers=parties["owner_auth"]).status_code == 200
    assert market.get("/api/v2/jobs").json()["total"] == 0
    assert apply(market, parties).json()["code"] == "job_closed"
    assert market.put(f"/api/v2/employer/jobs/{job_id}", json=JOB_INPUT, headers=parties["owner_auth"]).status_code == 200
    response = market.post(f"/api/v2/admin/users/{parties['owner']['id']}/active", json={"is_active": False}, headers=admin_headers)
    assert response.status_code == 200
    assert market.get("/api/v2/jobs").json()["total"] == 0
    assert market.get(f"/api/v2/jobs/{job_id}").status_code == 404
    assert market.get("/api/v2/auth/me", headers=parties["owner_auth"]).status_code == 401
    assert market.post("/api/v2/auth/login", json={"email": "owner@example.com", "password": PASSWORD}).status_code == 401


@pytest.mark.parametrize("change", [{"timezone": "invalid/zone"}, {"resume_url": "http://example.com/a"},
    {"portfolio_url": "https://127.0.0.1/a"}, {"compensation_amount": 5}, {"experience_years": "2.11"},
    {"skills": ["x" * 41]}, {"skills": [f"skill{i}" for i in range(31)]}])
def test_profile_validation_is_safe(market, change):
    _, auth = register(market, "person@example.com")
    response = market.put("/api/v2/me/profile", json={"about": "Private summary", **change}, headers=auth)
    assert response.status_code == 422
    assert "Private summary" not in response.text and '"input"' not in response.text


def test_csrf_cache_headers_and_consent(market, parties):
    for method in ("POST", "PUT", "DELETE", "PATCH"):
        response = market.request(method, "/api/v2/does-not-exist", content="{}")
        assert response.status_code == 415 and response.headers["cache-control"] == "no-store"
        response = market.request(method, "/api/v2/does-not-exist", json={}, headers={"Origin": "https://evil.example"})
        assert response.status_code == 403 and response.headers["cache-control"] == "no-store"
    for path in ("/api/v2/jobs", "/api/v2/auth/me", "/api/v2/no-such-route", "/api/v2/jobs?limit=0"):
        assert market.get(path).headers["cache-control"] == "no-store"
    for consent in (False, 1, "true"):
        response = market.post(f"/api/v2/jobs/{parties['job']['id']}/apply", json={"consent_to_process": consent},
                              headers={**parties["seeker_auth"], "Idempotency-Key": "consent"})
        assert response.status_code == 422
    assert market.post("/api/v2/auth/logout", json={}, headers={**parties["owner_auth"], "Origin": "https://fernway-careers.vercel.app"}).status_code == 204


def test_login_and_register_limits_use_first_forwarded_address(market):
    statuses = [market.post("/api/v2/auth/login", json={"email": f"person{i}@example.com", "password": PASSWORD},
                           headers={"X-Forwarded-For": "192.0.2.1, 198.51.100.1"}).status_code for i in range(11)]
    assert statuses == [401] * 10 + [429]
    statuses = [market.post("/api/v2/auth/login", json={"email": "shared@example.com", "password": PASSWORD},
                           headers={"X-Forwarded-For": f"192.0.2.{i + 2}"}).status_code for i in range(11)]
    assert statuses == [401] * 10 + [429]
    statuses = [market.post("/api/v2/auth/register", json={"email": f"new{i}@example.com", "password": PASSWORD, "role": "seeker", "full_name": "Test"},
                           headers={"X-Forwarded-For": "203.0.113.1"}).status_code for i in range(6)]
    assert statuses == [201] * 5 + [429]


def test_apply_limit_and_parallel_idempotency(market, parties):
    def send(_):
        return apply(market, parties)
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(send, range(4)))
    assert all(response.status_code == 201 for response in responses)
    assert len({response.json()["id"] for response in responses}) == 1
    for _ in range(26):
        assert apply(market, parties).status_code == 201
    assert apply(market, parties).status_code == 429
    with market.app.state.session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Application)) == 1
        assert session.scalar(select(func.count()).select_from(Notification)) == 1


def test_seed_is_repeatable_and_demo_accounts_can_login(market):
    factory = market.app.state.session_factory
    created = seed(factory, PASSWORD)
    assert created == {"users": 8, "employers": 5, "jobs": 11, "profiles": 3, "applications": 4}
    assert all(count == 0 for count in seed(factory, "different-private-password").values())
    assert market.get("/api/v2/jobs").json()["total"] == 11
    for email in ("jobs@banrai-coffee.example", "nok.wongsa@example.com"):
        response = market.post("/api/v2/auth/login", json={"email": email, "password": PASSWORD})
        assert response.status_code == 200, response.text
    applications = market.get("/api/v2/me/applications").json()
    assert len(applications) == 2 and {a["status"] for a in applications} == {"interview", "new_applicants"}


def test_hubspot_exactly_ten_properties(payload):
    data = {**payload, "id": "test", "status": "new_applicants"}
    properties = hubspot_properties(data)
    spec = json.loads(__import__("pathlib").Path("docs/hubspot-properties.json").read_text())
    names = {item["name"] for item in spec["properties"]}
    assert len(names) == 10
    assert {key for key in properties if key.startswith("candidate_")} == names
    assert "candidate_full_name" not in properties and "candidate_timezone" not in properties
    assert hubspot_properties({**data, "full_name": "Mali"})["lastname"] == ""
    assert hubspot_properties({**data, "full_name": "Mali Van Srisuk"})["firstname"] == "Mali Van"
    assert hubspot_properties({**data, "full_name": "Mali Van Srisuk"})["lastname"] == "Srisuk"


def test_populated_v1_migration_preserves_audit(settings, payload):
    config = Config("alembic.ini")
    command.upgrade(config, "0001_initial")
    engine = make_engine(settings.database_url)
    metadata = MetaData()
    metadata.reflect(engine)
    now = utcnow()
    intake = Intake.model_validate(payload)
    values = intake.model_dump()
    with engine.begin() as connection:
        connection.execute(metadata.tables["candidates"].insert().values(id="old-candidate", **{key: values[key] for key in ("email", "full_name", "phone", "timezone")}, created_at=now, updated_at=now))
        connection.execute(metadata.tables["applications"].insert().values(id="old-application", candidate_id="old-candidate", **{key: value for key, value in values.items() if key not in {"email", "full_name", "phone", "timezone"}}, consent_at=now, status="new_applicants", version=1, created_at=now, updated_at=now))
        connection.execute(metadata.tables["intake_receipts"].insert().values(id="receipt", source="api", event_key="old", payload_hash="a" * 64, application_id="old-application", created_at=now))
        connection.execute(metadata.tables["status_events"].insert().values(id="event", application_id="old-application", new_status="new_applicants", actor="intake", created_at=now))
        connection.execute(metadata.tables["sync_jobs"].insert().values(id="sync", application_id="old-application", target="notion", revision=1, payload={}, state="pending", attempts=0, next_attempt_at=now, created_at=now, updated_at=now))
    command.upgrade(config, "head")
    with session_factory(engine)() as session:
        for model in (Candidate, Application, IntakeReceipt, StatusEvent, SyncJob):
            assert session.scalar(select(func.count()).select_from(model)) == 1
        assert session.get(Application, "old-application").job_id is None
        assert session.execute(text("PRAGMA foreign_key_check")).all() == []
    command.downgrade(config, "0001_initial")
    command.upgrade(config, "head")
    engine.dispose()


def test_postgresql_partial_index_sql(settings, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://test:test@localhost/test")
    stream = io.StringIO()
    config = Config("alembic.ini", output_buffer=stream)
    command.upgrade(config, "head", sql=True)
    sql = stream.getvalue()
    assert "CREATE UNIQUE INDEX uq_candidate_job ON applications (candidate_id, job_id) WHERE job_id IS NOT NULL" in sql
    assert "CREATE UNIQUE INDEX uq_candidate_legacy_role ON applications (candidate_id, target_role) WHERE job_id IS NULL" in sql
    assert "DROP CONSTRAINT uq_candidate_role" in sql


def test_partial_uniqueness_is_enforced_in_sqlite(market, parties):
    aid = apply(market, parties).json()["id"]
    factory = market.app.state.session_factory
    with factory() as session:
        original = session.get(Application, aid)
        values = {column.name: getattr(original, column.name) for column in Application.__table__.columns if column.name != "id"}
    with pytest.raises(IntegrityError), factory.begin() as session:
        session.add(Application(**values))
        session.flush()
    legacy = {**values, "job_id": None}
    with factory.begin() as session:
        session.add(Application(**legacy))
    with pytest.raises(IntegrityError), factory.begin() as session:
        session.add(Application(**legacy))
        session.flush()


def test_local_http_cookie_and_server_error_cache_control(client, monkeypatch):
    client.app.state.settings.session_cookie_secure = False
    response = client.post("/api/v2/auth/register", json={"role": "seeker", "email": "local@example.com", "password": PASSWORD, "full_name": "Local"})
    assert response.status_code == 201 and "Secure" not in response.headers["set-cookie"]
    assert client.get("/api/v2/auth/me").status_code == 200
    def broken_factory():
        raise RuntimeError("Internal sensitive details")
    monkeypatch.setattr(client.app.state, "session_factory", broken_factory)
    with TestClient(client.app, raise_server_exceptions=False) as browser:
        response = browser.get("/api/v2/jobs")
    assert response.status_code == 500 and response.headers["cache-control"] == "no-store"
    assert "sensitive" not in response.text
