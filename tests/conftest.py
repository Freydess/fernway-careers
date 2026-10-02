import json
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

from app.api import create_app
from app.config import Settings
from app.db import make_engine


@pytest.fixture
def settings(tmp_path, monkeypatch):
    values = {
        "DATABASE_URL": "sqlite:///" + (tmp_path / "test.db").as_posix(),
        "ADMIN_API_TOKEN": "test-admin-token-" + "a" * 32,
        "INTAKE_API_TOKEN": "test-intake-token-" + "b" * 32,
        "SYNC_MODE": "direct",
        "TYPEFORM_WEBHOOK_SECRET": "typeform-test-secret",
        "TYPEFORM_FORM_ID": "form-test",
        "HUBSPOT_ACCESS_TOKEN": "hubspot-test-secret",
        "NOTION_TOKEN": "notion-test-secret",
        "NOTION_DATA_SOURCE_ID": "source-test",
    }
    for key, value in values.items():
        monkeypatch.setenv(key, value)
    return Settings(_env_file=None)


@pytest.fixture
def client(settings):
    command.upgrade(Config("alembic.ini"), "head")
    engine = make_engine(settings.database_url)
    with TestClient(create_app(settings, engine)) as client:
        yield client
    engine.dispose()


@pytest.fixture
def payload():
    return json.loads(Path("examples/application.json").read_text())


@pytest.fixture
def intake_headers(settings):
    return {"Authorization": "Bearer " + settings.intake_api_token.get_secret_value(), "Idempotency-Key": "event-test"}


@pytest.fixture
def admin_headers(settings):
    return {"Authorization": "Bearer " + settings.admin_api_token.get_secret_value()}
