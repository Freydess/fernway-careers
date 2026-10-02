import ipaddress
from decimal import Decimal
from enum import Enum
from typing import Annotated, Literal
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AliasChoices, BaseModel, ConfigDict, EmailStr, Field, HttpUrl, StrictBool, TypeAdapter, field_validator, model_validator


class Status(str, Enum):
    new_applicants = "new_applicants"
    screening = "screening"
    interview = "interview"
    offered = "offered"
    hired = "hired"
    rejected = "rejected"
    withdrawn = "withdrawn"


class Intake(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    full_name: str = Field(min_length=1, max_length=200, validation_alias=AliasChoices("full_name", "candidate_name"))
    email: EmailStr = Field(max_length=254, validation_alias=AliasChoices("email", "candidate_email"))
    phone: str | None = Field(default=None, max_length=40, validation_alias=AliasChoices("phone", "candidate_phone"))
    timezone: str | None = Field(default=None, max_length=100)
    target_role: Literal["engineering", "design", "marketing", "operations", "other"]
    role_detail: str | None = Field(default=None, max_length=200)
    experience_level: Literal["intern", "junior", "mid", "senior", "lead"] | None = None
    experience_years: Annotated[Decimal, Field(ge=0, le=80, max_digits=4, decimal_places=1)] | None = None
    portfolio_url: str | None = Field(default=None, max_length=2048)
    resume_url: str | None = Field(default=None, max_length=2048, validation_alias=AliasChoices("resume_url", "resume_file"))
    compensation_expectations: str | None = Field(default=None, max_length=500)
    compensation_amount: Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)] | None = None
    compensation_currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    compensation_period: Literal["hour", "day", "month", "year", "project"] | None = None
    availability: str | None = Field(default=None, max_length=500, validation_alias=AliasChoices("availability", "availability_window"))
    fit_summary: str | None = Field(default=None, max_length=8000, validation_alias=AliasChoices("fit_summary", "summary_of_fit"))
    role_answers: dict[str, str] = Field(default_factory=dict, max_length=15)
    consent_to_process: StrictBool

    @field_validator("email", mode="after")
    @classmethod
    def normalize_email(cls, value):
        return str(value).lower()

    @field_validator("experience_years", "compensation_amount")
    @classmethod
    def normalize_decimals(cls, value, info):
        if value is None:
            return None
        return value.quantize(Decimal("0.1") if info.field_name == "experience_years" else Decimal("0.01"))

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value):
        if value is not None:
            try:
                ZoneInfo(value)
            except (ZoneInfoNotFoundError, ValueError):
                raise ValueError("Use an IANA timezone such as Asia/Bangkok.") from None
        return value

    @field_validator("target_role", "experience_level", mode="before")
    @classmethod
    def normalize_choices(cls, value):
        return value.strip().lower() if isinstance(value, str) else value

    @field_validator("resume_url", "portfolio_url")
    @classmethod
    def external_url(cls, value):
        if value is None:
            return None
        validated = str(TypeAdapter(HttpUrl).validate_python(value))
        parsed = urlsplit(validated)
        hostname = parsed.hostname or ""
        if parsed.scheme != "https" or parsed.username or parsed.password:
            raise ValueError("Use an HTTPS URL without embedded credentials.")
        if hostname.lower() == "localhost" or "." not in hostname or hostname.lower().endswith((".localhost", ".local", ".internal")):
            raise ValueError("Use an external document or portfolio URL.")
        try:
            address = ipaddress.ip_address(hostname)
        except ValueError:
            pass
        else:
            if not address.is_global:
                raise ValueError("Private network URLs are not accepted.")
        return validated

    @field_validator("role_answers")
    @classmethod
    def limit_answers(cls, values):
        if any(len(key) > 100 or len(value) > 2000 for key, value in values.items()):
            raise ValueError("Role answer keys must be <=100 characters and values <=2000.")
        return values

    @model_validator(mode="after")
    def completeness(self):
        if not self.consent_to_process:
            raise ValueError("Consent to process this application is required.")
        if self.compensation_amount is not None and (not self.compensation_currency or not self.compensation_period):
            raise ValueError("A compensation amount requires currency and period.")
        if self.compensation_amount is None and (self.compensation_currency or self.compensation_period):
            raise ValueError("Currency and period require a compensation amount.")
        return self


class StatusChange(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    status: Status
    expected_version: int = Field(ge=1)
    reason: str | None = Field(default=None, max_length=1000)
