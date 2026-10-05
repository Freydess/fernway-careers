import json
from functools import cached_property
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "sqlite:///./data/employment.db"
    admin_api_token: SecretStr
    intake_api_token: SecretStr
    sync_mode: Literal["disabled", "direct", "zapier"] = "disabled"
    typeform_webhook_secret: SecretStr = SecretStr("")
    typeform_form_id: str = ""
    typeform_field_map_json: str = "{}"
    hubspot_access_token: SecretStr = SecretStr("")
    notion_token: SecretStr = SecretStr("")
    notion_data_source_id: str = ""
    notion_api_version: str = "2025-09-03"
    zapier_webhook_url: SecretStr = SecretStr("")
    cors_origins: list[str] = Field(default_factory=list)
    max_body_bytes: int = Field(default=65536, ge=1024, le=1048576)
    max_sync_attempts: int = Field(default=8, ge=1, le=20)
    session_cookie_secure: bool = True
    allowed_origins: list[str] = Field(default_factory=lambda: ["https://fernway-careers.vercel.app", "http://localhost:5173"])

    @model_validator(mode="after")
    def validate_config(self):
        admin = self.admin_api_token.get_secret_value()
        intake = self.intake_api_token.get_secret_value()
        if any(len(value) < 32 or value.startswith("replace-") for value in (admin, intake)):
            raise ValueError("Generate independent ADMIN_API_TOKEN and INTAKE_API_TOKEN secrets (32+ characters).")
        if admin == intake:
            raise ValueError("Admin and intake tokens must be different.")
        mapping = json.loads(self.typeform_field_map_json)
        if not isinstance(mapping, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in mapping.items()):
            raise ValueError("TYPEFORM_FIELD_MAP_JSON must be a JSON object of string mappings.")
        return self

    @cached_property
    def typeform_field_map(self):
        return json.loads(self.typeform_field_map_json)

    @property
    def sync_targets(self):
        return {"disabled": [], "direct": ["hubspot", "notion"], "zapier": ["zapier"]}[self.sync_mode]
