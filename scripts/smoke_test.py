"""Exercise the real HTTP API with synthetic data only."""
import json
from pathlib import Path
from uuid import uuid4

import httpx

from app.config import Settings


def main():
    settings = Settings()
    payload = json.loads(Path("examples/application.json").read_text())
    payload["email"] = f"smoke-{uuid4().hex[:12]}@example.com"
    key = str(uuid4())
    with httpx.Client(base_url="http://127.0.0.1:8000", timeout=10) as client:
        client.get("/ready").raise_for_status()
        headers = {"Authorization": f"Bearer {settings.intake_api_token.get_secret_value()}", "Idempotency-Key": key}
        response = client.post("/api/v1/intake", json=payload, headers=headers)
        response.raise_for_status()
        submitted = response.json()
        duplicate = client.post("/api/v1/intake", json=payload, headers=headers)
        duplicate.raise_for_status()
        assert duplicate.json()["duplicate"] is True
        admin = {"Authorization": f"Bearer {settings.admin_api_token.get_secret_value()}"}
        path = f"/api/v1/applications/{submitted['application_id']}"
        current = client.get(path, headers=admin)
        current.raise_for_status()
        updated = client.patch(path + "/status", json={"status": "screening", "expected_version": current.json()["version"]}, headers=admin)
        updated.raise_for_status()
        assert updated.json()["status"] == "screening"
    print("Smoke test passed: readiness, intake, duplicate delivery, admin read, stage update.")
    print("A synthetic smoke-test application was retained in the local database.")


if __name__ == "__main__":
    main()
