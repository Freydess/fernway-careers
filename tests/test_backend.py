import base64
import hashlib
import hmac
import io
import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from app.models import Application, Candidate, IntakeReceipt, SyncJob
from app.schemas import Intake
from app.service import submit


def count(client, model):
    with client.app.state.session_factory() as session:
        return session.scalar(select(func.count()).select_from(model))


def test_authentication_and_readiness(client, intake_headers, admin_headers, payload):
    assert client.get("/health").status_code == 200
    assert client.get("/ready").status_code == 200
    assert client.get("/api/v1/applications").status_code == 401
    assert client.get("/api/v1/applications", headers=intake_headers).status_code == 401
    assert client.post("/api/v1/intake", json=payload, headers=admin_headers).status_code == 401
    assert client.post("/api/v1/intake", json=payload, headers={"Authorization": intake_headers["Authorization"]}).status_code == 422
    assert client.get("/api/v1/applications?limit=101", headers=admin_headers).status_code == 422


def test_idempotency_and_multiple_roles(client, payload, intake_headers, admin_headers):
    first = client.post("/api/v1/intake", json=payload, headers=intake_headers)
    assert first.status_code == 201
    repeated = client.post("/api/v1/intake", json=payload, headers=intake_headers)
    assert repeated.json()["duplicate"]
    assert repeated.json()["application_id"] == first.json()["application_id"]
    assert count(client, Candidate) == count(client, Application) == count(client, IntakeReceipt) == 1
    assert count(client, SyncJob) == 2
    changed = {**payload, "full_name": "Different Name"}
    assert client.post("/api/v1/intake", json=changed, headers=intake_headers).status_code == 409
    another_role = {**payload, "email": payload["email"].upper(), "target_role": "Design"}
    assert client.post("/api/v1/intake", json=another_role, headers={**intake_headers, "Idempotency-Key": "second-role"}).status_code == 201
    assert count(client, Candidate) == 1
    assert count(client, Application) == 2
    listed = client.get("/api/v1/applications?target_role=design&limit=1", headers=admin_headers).json()
    assert listed["total"] == 1 and len(listed["items"]) == 1


@pytest.mark.parametrize("change", [
    {"email": "not-an-email"}, {"consent_to_process": False}, {"consent_to_process": "true"},
    {"experience_years": -1}, {"compensation_amount": -1}, {"compensation_currency": None},
    {"resume_url": "http://example.com/cv"}, {"resume_url": "https://127.0.0.1/cv"},
    {"portfolio_url": "https://user:secret@example.com/cv"}, {"target_role": "unmapped-role"},
    {"extra_field": "forbidden"}, {"fit_summary": "a" * 8001},
])
def test_invalid_data_does_not_write(client, payload, intake_headers, change):
    response = client.post("/api/v1/intake", json={**payload, **change}, headers=intake_headers)
    assert response.status_code == 422
    assert all("input" not in error for error in response.json()["detail"])
    assert count(client, Candidate) == count(client, Application) == count(client, SyncJob) == 0


def test_payload_size_limit(client, intake_headers):
    response = client.post("/api/v1/intake", content=b"x" * 65537, headers={**intake_headers, "Content-Type": "application/json"})
    assert response.status_code == 413


def test_status_rules_history_and_reapplication(client, payload, intake_headers, admin_headers):
    application_id = client.post("/api/v1/intake", json=payload, headers=intake_headers).json()["application_id"]
    path = f"/api/v1/applications/{application_id}"
    assert client.patch(path + "/status", json={"status": "offered", "expected_version": 1}, headers=admin_headers).status_code == 409
    screened = client.patch(path + "/status", json={"status": "screening", "expected_version": 1}, headers=admin_headers)
    assert screened.status_code == 200 and screened.json()["version"] == 2
    assert client.patch(path + "/status", json={"status": "interview", "expected_version": 1}, headers=admin_headers).status_code == 409
    new_payload = {**payload, "availability": "Immediately"}
    reapplied = client.post("/api/v1/intake", json=new_payload, headers={**intake_headers, "Idempotency-Key": "reapply"})
    assert reapplied.json()["application_id"] == application_id
    current = client.get(path, headers=admin_headers).json()
    assert current["status"] == "screening" and current["version"] == 3 and current["availability"] == "Immediately"
    assert len(client.get(path + "/history", headers=admin_headers).json()) == 2
    assert client.patch(path + "/status", json={"status": "rejected", "expected_version": 3}, headers=admin_headers).status_code == 422
    rejected = client.patch(path + "/status", json={"status": "rejected", "expected_version": 3, "reason": "Role closed"}, headers=admin_headers)
    assert rejected.status_code == 200
    assert client.patch(path + "/status", json={"status": "screening", "expected_version": 4}, headers=admin_headers).status_code == 409


def test_concurrent_duplicate_delivery(client, payload, intake_headers):
    def deliver(_):
        return client.post("/api/v1/intake", json=payload, headers=intake_headers)
    with ThreadPoolExecutor(max_workers=6) as pool:
        responses = list(pool.map(deliver, range(6)))
    assert all(response.status_code == 201 for response in responses)
    assert sum(not response.json()["duplicate"] for response in responses) == 1
    assert count(client, Candidate) == count(client, Application) == count(client, IntakeReceipt) == 1
    assert count(client, SyncJob) == 2


def test_intake_and_outbox_are_atomic(client, payload):
    with pytest.raises(IntegrityError):
        submit(client.app.state.session_factory, Intake.model_validate(payload), "api", "rollback", ["invalid_target"])
    assert count(client, Candidate) == count(client, Application) == count(client, IntakeReceipt) == count(client, SyncJob) == 0


def typeform_payload():
    return {"event_type": "form_response", "form_response": {
        "form_id": "form-test", "token": "response-test", "submitted_at": "2026-10-02T00:00:00Z",
        "answers": [
            {"field": {"id": "name-id", "ref": "candidate_name"}, "type": "text", "text": "Sample Candidate"},
            {"field": {"ref": "candidate_email"}, "type": "email", "email": "sample@example.com"},
            {"field": {"ref": "target_role"}, "type": "choice", "choice": {"label": "Engineering"}},
            {"field": {"ref": "consent_to_process"}, "type": "boolean", "boolean": True},
            {"field": {"ref": "resume_file"}, "type": "file_url", "file_url": "https://example.com/resume.pdf"},
            {"field": {"ref": "tech_stack"}, "type": "text", "text": "Python"},
        ]}}


def signed_typeform(client, settings, payload):
    raw = json.dumps(payload).encode()
    signature = "sha256=" + base64.b64encode(hmac.new(settings.typeform_webhook_secret.get_secret_value().encode(), raw, hashlib.sha256).digest()).decode()
    return client.post("/api/v1/webhooks/typeform", content=raw, headers={"Typeform-Signature": signature, "Content-Type": "application/json"})


def test_signed_typeform_and_replay(client, settings, admin_headers):
    response = signed_typeform(client, settings, typeform_payload())
    assert response.status_code == 201
    assert signed_typeform(client, settings, typeform_payload()).json()["duplicate"]
    application_id = response.json()["application_id"]
    data = client.get(f"/api/v1/applications/{application_id}", headers=admin_headers).json()
    assert data["resume_url"] == "https://example.com/resume.pdf"
    assert data["role_answers"]["tech_stack"] == "Python"
    assert client.post("/api/v1/webhooks/typeform", json=typeform_payload(), headers={"Typeform-Signature": "sha256=wrong"}).status_code == 401
    assert count(client, Application) == 1


@pytest.mark.parametrize("change", [{"event_type": "form_response_partial"}, {"form_response": {"form_id": "wrong"}}, {"form_response": None}])
def test_typeform_rejects_incomplete_or_unexpected_form(client, settings, change):
    assert signed_typeform(client, settings, {**typeform_payload(), **change}).status_code == 422
    assert count(client, Application) == 0


def test_typeform_field_id_mapping(client, settings, admin_headers):
    settings.__dict__["typeform_field_map"] = {"name-id": "full_name"}
    payload = typeform_payload()
    payload["form_response"]["answers"][0]["field"].pop("ref")
    assert signed_typeform(client, settings, payload).status_code == 201


def test_database_constraints_and_migration_consistency(client):
    factory = client.app.state.session_factory
    with factory.begin() as session, pytest.raises(IntegrityError):
        session.add(Application(candidate_id="missing", target_role="engineering", consent_to_process=True, consent_at=__import__("datetime").datetime.now()))
        session.flush()
    command.check(Config("alembic.ini"))
    with factory() as session:
        assert session.execute(text("PRAGMA foreign_keys")).scalar() == 1


def test_postgresql_migration_generates_sql(client, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://test:test@localhost/employment")
    stream = io.StringIO()
    config = Config("alembic.ini", output_buffer=stream)
    command.upgrade(config, "head", sql=True)
    sql = stream.getvalue()
    assert "CREATE TABLE candidates" in sql and "CREATE TABLE sync_jobs" in sql
    assert "uq_intake_event" in sql and "FOREIGN KEY" in sql
