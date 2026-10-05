from decimal import Decimal
from typing import Annotated, Literal

from email_validator import EmailNotValidError, validate_email
from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator, model_validator

from app.schemas import Intake

Area = Literal["engineering", "design", "marketing", "operations", "other"]
Level = Literal["intern", "junior", "mid", "senior", "lead"]
PayPeriod = Literal["hour", "day", "month", "year", "project"]
Money = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)]
Skills = Annotated[list[Annotated[str, Field(min_length=1, max_length=40)]], Field(max_length=30)]


def clean_skills(value):
    if not isinstance(value, list):
        return value
    return list(dict.fromkeys(item.strip().lower() for item in value if isinstance(item, str) and item.strip())) if all(isinstance(item, str) for item in value) else value


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @field_validator("*", mode="before")
    @classmethod
    def blank_to_null(cls, value, info):
        if value == "" and not cls.model_fields[info.field_name].is_required():
            return None
        return value


class LoginInput(BaseModel):
    # Passwords are never trimmed or normalized.
    model_config = ConfigDict(extra="forbid")
    email: str = Field(max_length=254)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def email_address(cls, value):
        try:
            return validate_email(value.strip(), check_deliverability=False, test_environment=True).normalized.lower()
        except EmailNotValidError:
            raise ValueError("Use a valid email address.") from None


class RegisterInput(LoginInput):
    role: Literal["seeker", "employer"]
    full_name: str = Field(min_length=1, max_length=200)
    company_name: str | None = Field(default=None, max_length=200)

    @field_validator("full_name", "company_name", mode="before")
    @classmethod
    def trim_name(cls, value):
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def company_required(self):
        if self.role == "employer" and not self.company_name:
            raise ValueError("Company name is required for employers.")
        return self


class ProfileInput(Input):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=40)
    location: str | None = Field(default=None, max_length=120)
    timezone: str | None = Field(default=None, max_length=100)
    headline: str | None = Field(default=None, max_length=120)
    about: str | None = Field(default=None, max_length=4000)
    skills: Skills = Field(default_factory=list)
    target_role: Area | None = None
    role_detail: str | None = Field(default=None, max_length=200)
    experience_level: Level | None = None
    experience_years: Annotated[Decimal, Field(ge=0, le=80, max_digits=4, decimal_places=1)] | None = None
    portfolio_url: str | None = Field(default=None, max_length=2048)
    resume_url: str | None = Field(default=None, max_length=2048)
    availability: str | None = Field(default=None, max_length=500)
    compensation_amount: Money | None = None
    compensation_currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    compensation_period: PayPeriod | None = None
    compensation_expectations: str | None = Field(default=None, max_length=500)

    @field_validator("skills", mode="before")
    @classmethod
    def normalize_skills(cls, value):
        return clean_skills(value)

    @field_validator("timezone")
    @classmethod
    def timezone_valid(cls, value):
        return Intake.validate_timezone(value)

    @field_validator("portfolio_url", "resume_url")
    @classmethod
    def url_valid(cls, value):
        return Intake.external_url(value)

    @model_validator(mode="after")
    def compensation_valid(self):
        if self.compensation_amount is not None and (not self.compensation_currency or not self.compensation_period):
            raise ValueError("A compensation amount requires currency and period.")
        if self.compensation_amount is None and (self.compensation_currency or self.compensation_period):
            raise ValueError("Currency and period require a compensation amount.")
        return self


class CompanyInput(Input):
    name: str = Field(min_length=1, max_length=200)
    website: str | None = Field(default=None, max_length=2048)
    about: str | None = Field(default=None, max_length=4000)
    location: str | None = Field(default=None, max_length=120)

    @field_validator("website")
    @classmethod
    def url_valid(cls, value):
        return Intake.external_url(value)


class JobInput(Input):
    title: str = Field(min_length=3, max_length=120)
    area: Area
    levels: list[Level] = Field(min_length=1, max_length=5)
    employment_type: Literal["full_time", "part_time", "contract", "internship", "freelance"]
    work_mode: Literal["remote", "hybrid", "onsite"]
    location: str | None = Field(default=None, max_length=120)
    summary: str | None = Field(default=None, max_length=300)
    description: str | None = Field(default=None, max_length=8000)
    skills: Skills = Field(default_factory=list)
    status: Literal["open", "closed"] = "open"
    salary_min: Money | None = None
    salary_max: Money | None = None
    salary_currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    salary_period: PayPeriod | None = None

    @field_validator("skills", mode="before")
    @classmethod
    def normalize_skills(cls, value):
        return clean_skills(value)

    @model_validator(mode="after")
    def salary_valid(self):
        values = (self.salary_min, self.salary_max, self.salary_currency, self.salary_period)
        if any(value is not None for value in values):
            if any(value is None for value in values):
                raise ValueError("A salary requires minimum, maximum, currency and period.")
            if self.salary_min > self.salary_max:
                raise ValueError("Salary maximum must not be lower than minimum.")
        self.levels = list(dict.fromkeys(self.levels))
        return self


class ApplyInput(Input):
    cover_note: str | None = Field(default=None, max_length=4000)
    consent_to_process: Literal[True]

    @field_validator("consent_to_process", mode="before")
    @classmethod
    def explicit_consent(cls, value):
        if value is not True:
            raise ValueError("Consent to process this application is required.")
        return value


class WithdrawInput(Input):
    reason: str | None = Field(default=None, max_length=1000)


class DecisionInput(Input):
    decision: Literal["accept", "reject"]
    message: str | None = Field(default=None, max_length=1000)
    expected_version: int = Field(ge=1)


class StageInput(Input):
    status: Literal["offered", "hired"]
    expected_version: int = Field(ge=1)


class ReadInput(Input):
    ids: list[Annotated[str, Field(min_length=1, max_length=36)]] | None = Field(default=None, max_length=100)
    all: StrictBool = False

    @model_validator(mode="after")
    def selection_valid(self):
        if (self.ids is None and not self.all) or (self.ids is not None and self.all):
            raise ValueError("Choose either ids or all: true.")
        return self


class ActiveInput(Input):
    is_active: StrictBool
