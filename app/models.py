from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def new_id():
    return str(uuid4())


def utcnow():
    # Store UTC consistently in SQLite and PostgreSQL (naive UTC columns).
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class Candidate(Base):
    __tablename__ = "candidates"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(40))
    timezone: Mapped[str | None] = mapped_column(String(100))
    hubspot_contact_id: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Application(Base):
    __tablename__ = "applications"
    __table_args__ = (
        UniqueConstraint("candidate_id", "target_role", name="uq_candidate_role"),
        CheckConstraint("status IN ('new_applicants','screening','interview','offered','hired','rejected','withdrawn')", name="ck_application_status"),
        CheckConstraint("target_role IN ('engineering','design','marketing','operations','other')", name="ck_application_role"),
        CheckConstraint("experience_years IS NULL OR (experience_years >= 0 AND experience_years <= 80)", name="ck_experience_years"),
        CheckConstraint("compensation_amount IS NULL OR compensation_amount >= 0", name="ck_compensation"),
        CheckConstraint("version >= 1", name="ck_application_version"),
        Index("ix_applications_status_created", "status", "created_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidates.id", ondelete="CASCADE"), index=True)
    target_role: Mapped[str] = mapped_column(String(50))
    role_detail: Mapped[str | None] = mapped_column(String(200))
    experience_level: Mapped[str | None] = mapped_column(String(40))
    experience_years: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    portfolio_url: Mapped[str | None] = mapped_column(String(2048))
    resume_url: Mapped[str | None] = mapped_column(String(2048))
    compensation_expectations: Mapped[str | None] = mapped_column(String(500))
    compensation_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    compensation_currency: Mapped[str | None] = mapped_column(String(3))
    compensation_period: Mapped[str | None] = mapped_column(String(20))
    availability: Mapped[str | None] = mapped_column(String(500))
    fit_summary: Mapped[str | None] = mapped_column(Text)
    role_answers: Mapped[dict] = mapped_column(JSON, default=dict)
    consent_to_process: Mapped[bool] = mapped_column(Boolean, nullable=False)
    consent_at: Mapped[datetime] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String(30), default="new_applicants")
    version: Mapped[int] = mapped_column(Integer, default=1)
    notion_page_id: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class IntakeReceipt(Base):
    __tablename__ = "intake_receipts"
    __table_args__ = (UniqueConstraint("source", "event_key", name="uq_intake_event"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    source: Mapped[str] = mapped_column(String(30))
    event_key: Mapped[str] = mapped_column(String(200))
    payload_hash: Mapped[str] = mapped_column(String(64))
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class StatusEvent(Base):
    __tablename__ = "status_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    old_status: Mapped[str | None] = mapped_column(String(30))
    new_status: Mapped[str] = mapped_column(String(30))
    actor: Mapped[str] = mapped_column(String(40))
    reason: Mapped[str | None] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class SyncJob(Base):
    __tablename__ = "sync_jobs"
    __table_args__ = (
        UniqueConstraint("application_id", "target", "revision", name="uq_sync_revision"),
        CheckConstraint("target IN ('hubspot','notion','zapier')", name="ck_sync_target"),
        CheckConstraint("state IN ('pending','processing','retry','succeeded','dead')", name="ck_sync_state"),
        Index("ix_sync_due", "state", "next_attempt_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    target: Mapped[str] = mapped_column(String(20))
    revision: Mapped[int] = mapped_column(Integer)
    payload: Mapped[dict] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(20), default="pending")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime)
    lease_token: Mapped[str | None] = mapped_column(String(36))
    last_error: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
