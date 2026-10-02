import json
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import select

from app.integrations import IntegrationError, Integrations
from app.models import Application, Candidate, SyncJob, utcnow
from app.worker import claim, run_once


def create_submission(client, payload, headers):
    response = client.post("/api/v1/intake", json=payload, headers=headers)
    assert response.status_code == 201
    return response.json()["application_id"]


def test_direct_sync_maps_contact_and_notion(client, settings, payload, intake_headers):
    application_id = create_submission(client, payload, intake_headers)
    calls = []

    def handle(request):
        calls.append(request)
        body = json.loads(request.content) if request.content else {}
        if request.url.host == "api.hubapi.com":
            assert request.headers["Authorization"] == "Bearer hubspot-test-secret"
            if request.method == "GET":
                return httpx.Response(404)
            assert body["properties"]["lifecyclestage"] == "lead"
            assert body["properties"]["candidate_resume_url"] == payload["resume_url"]
            assert "notes_last_contact" not in body["properties"]
            return httpx.Response(201, json={"id": "contact-id"})
        assert request.headers["Notion-Version"] == "2025-09-03"
        if request.url.path.endswith("/query"):
            assert body["filter"]["rich_text"]["equals"] == application_id
            return httpx.Response(200, json={"results": [], "has_more": False})
        assert body["parent"]["data_source_id"] == "source-test"
        assert body["properties"]["Status"]["status"]["name"] == "New Applicants"
        assert body["properties"]["Salary Expectation"]["rich_text"][0]["text"]["content"] == "35000.00 THB / month"
        return httpx.Response(201, json={"id": "page-id"})

    with httpx.Client(transport=httpx.MockTransport(handle)) as http:
        integrations = Integrations(settings, http)
        factory = client.app.state.session_factory
        assert run_once(factory, integrations)
        assert run_once(factory, integrations)
        assert not run_once(factory, integrations)
    with factory() as session:
        assert all(job.state == "succeeded" for job in session.scalars(select(SyncJob)))
        assert session.get(Application, application_id).notion_page_id == "page-id"
        assert session.scalar(select(Candidate)).hubspot_contact_id == "contact-id"
    assert len(calls) == 4


def test_update_preserves_hubspot_lifecycle_and_recovers_notion_page(settings, payload):
    data = {**payload, "id": "application-id", "status": "screening"}

    def handle(request):
        body = json.loads(request.content) if request.content else {}
        if request.url.host == "api.hubapi.com":
            if request.method == "GET":
                return httpx.Response(200, json={"id": "existing-contact", "properties": {"lifecyclestage": "customer"}})
            assert request.method == "PATCH" and "lifecyclestage" not in body["properties"]
            return httpx.Response(200, json={"id": "existing-contact"})
        if request.url.path.endswith("/query"):
            return httpx.Response(200, json={"results": [{"id": "existing-page"}], "has_more": False})
        assert request.method == "PATCH" and request.url.path.endswith("existing-page")
        return httpx.Response(200, json={"id": "existing-page"})

    with httpx.Client(transport=httpx.MockTransport(handle)) as http:
        integrations = Integrations(settings, http)
        assert integrations.hubspot(data, "job") == "existing-contact"
        assert integrations.notion(data, "job") == "existing-page"


def test_retry_backoff_and_ordering(client, settings, payload, intake_headers, admin_headers):
    application_id = create_submission(client, payload, intake_headers)

    class Failing:
        def send(self, target, data, job_id):
            if target == "hubspot":
                raise IntegrationError("hubspot: HTTP 429", retry_after=120)
            return "page-id"

    factory = client.app.state.session_factory
    assert run_once(factory, Failing())
    assert run_once(factory, Failing())
    with factory() as session:
        failed = session.scalar(select(SyncJob).where(SyncJob.target == "hubspot"))
        assert failed.state == "retry" and failed.attempts == 1
        assert failed.next_attempt_at > utcnow() + timedelta(seconds=100)
        failed_id = failed.id
    client.patch(f"/api/v1/applications/{application_id}/status", json={"status": "screening", "expected_version": 1}, headers=admin_headers).raise_for_status()
    assert run_once(factory, Failing())  # Notion's newer revision can proceed.
    assert not run_once(factory, Failing())  # Newer HubSpot revision waits for the earlier retry.
    assert client.post(f"/api/v1/sync-jobs/{failed_id}/retry", headers=admin_headers).status_code == 409


def test_permanent_failure_manual_retry_and_resync(client, payload, intake_headers, admin_headers):
    application_id = create_submission(client, payload, intake_headers)

    class InvalidCredentials:
        def send(self, target, data, job_id):
            raise IntegrationError(f"{target}: HTTP 401", retryable=False)

    factory = client.app.state.session_factory
    run_once(factory, InvalidCredentials())
    run_once(factory, InvalidCredentials())
    with factory() as session:
        failed = session.scalar(select(SyncJob).where(SyncJob.target == "hubspot"))
        assert failed.state == "dead"
        failed_id = failed.id
    response = client.post(f"/api/v1/sync-jobs/{failed_id}/retry", headers=admin_headers)
    assert response.status_code == 202
    assert client.post(f"/api/v1/applications/{application_id}/sync", headers=admin_headers).status_code == 202
    listed = client.get("/api/v1/sync-jobs?limit=2", headers=admin_headers).json()
    assert listed["total"] == 4
    assert all("payload" not in row and "lease_token" not in row for row in listed["items"])


def test_expired_lease_is_recovered(client, payload, intake_headers):
    create_submission(client, payload, intake_headers)
    factory = client.app.state.session_factory
    first = claim(factory, 8)
    with factory.begin() as session:
        job = session.get(SyncJob, first["id"])
        job.lease_until = utcnow() - timedelta(seconds=1)
    second = claim(factory, 8)
    assert second["id"] == first["id"]
    assert second["lease_token"] != first["lease_token"] and second["attempts"] == 2


def test_sync_mode_filters_existing_queued_jobs(client, payload, intake_headers):
    create_submission(client, payload, intake_headers)
    factory = client.app.state.session_factory
    assert not run_once(factory, None, targets=[])
    assert not run_once(factory, None, targets=["zapier"])
    with factory() as session:
        assert all(job.state == "pending" and job.attempts == 0 for job in session.scalars(select(SyncJob)))


def test_sync_errors_do_not_store_remote_bodies(settings, payload):
    data = {**payload, "id": "application-id", "status": "new_applicants"}
    with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(401, json={"message": "secret token and candidate PII"}))) as http:
        with pytest.raises(IntegrationError) as captured:
            Integrations(settings, http).hubspot(data, "job")
    assert str(captured.value) == "hubspot: HTTP 401" and not captured.value.retryable


def test_zapier_contract_and_url_validation(settings, payload):
    settings.zapier_webhook_url = __import__("pydantic").SecretStr("https://hooks.zapier.com/hooks/catch/example/secret/")
    data = {**payload, "id": "application-id", "status": "new_applicants"}

    def handle(request):
        body = json.loads(request.content)
        assert body["event_id"] == request.headers["Idempotency-Key"] == "job-id"
        assert body["application"]["resume_url"] == payload["resume_url"]
        return httpx.Response(200, text="accepted")

    with httpx.Client(transport=httpx.MockTransport(handle)) as http:
        assert Integrations(settings, http).zapier(data, "job-id") == "job-id"
        settings.zapier_webhook_url = __import__("pydantic").SecretStr("http://127.0.0.1/hooks/catch/example/")
        with pytest.raises(IntegrationError):
            Integrations(settings, http).zapier(data, "job-id")
