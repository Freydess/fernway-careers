"""Cookie-authenticated marketplace API; v1 remains available independently."""
import hashlib
import json
import secrets
from datetime import timedelta
from typing import Annotated

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import String, case, cast, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import begin_write
from app.marketplace_schemas import (ActiveInput, ApplyInput, Area, CompanyInput, DecisionInput,
                                    JobInput, Level, LoginInput, ProfileInput, ReadInput,
                                    RegisterInput, StageInput, WithdrawInput)
from app.models import (Application, Candidate, Employer, IntakeReceipt, Job, LoginSession,
                        Notification, RateLimitBucket, SeekerProfile, StatusEvent, User, new_id, utcnow)
from app.schemas import Status
from app.service import TRANSITIONS, enqueue, serial

router = APIRouter(prefix="/api/v2", tags=["marketplace"])
hasher = PasswordHasher()
dummy_hash = hasher.hash(secrets.token_urlsafe(32))
COOKIE = "fw_session"
SESSION_SECONDS = 30 * 24 * 60 * 60


class MarketplaceError(HTTPException):
    def __init__(self, status, detail, code):
        super().__init__(status, detail)
        self.code = code


class MarketplaceMiddleware:
    def __init__(self, app, allowed_origins):
        self.app, self.origins = app, set(allowed_origins)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not (scope["path"] == "/api/v2" or scope["path"].startswith("/api/v2/")):
            return await self.app(scope, receive, send)

        async def no_store(message):
            if message["type"] == "http.response.start":
                message["headers"] = [(k, v) for k, v in message.get("headers", []) if k.lower() != b"cache-control"] + [(b"cache-control", b"no-store")]
            await send(message)

        if scope["method"] in {"POST", "PUT", "PATCH", "DELETE"}:
            headers = dict(scope["headers"])
            content_type = headers.get(b"content-type", b"").decode().split(";", 1)[0].strip().lower()
            origin = headers.get(b"origin")
            if content_type != "application/json":
                return await JSONResponse({"detail": "Content-Type must be application/json."}, status_code=415)(scope, receive, no_store)
            if origin is not None and origin.decode("latin-1") not in self.origins:
                return await JSONResponse({"detail": "Origin is not allowed."}, status_code=403)(scope, receive, no_store)
        await self.app(scope, receive, no_store)


def db(request: Request):
    with request.app.state.session_factory.begin() as session:
        yield session


DB = Annotated[Session, Depends(db, scope="function")]


def token_digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def current_user(request: Request, session: DB):
    token = request.cookies.get(COOKIE)
    user = None
    if token and len(token) <= 200:
        user = session.scalar(select(User).join(LoginSession).where(
            LoginSession.token_hash == token_digest(token), LoginSession.revoked_at.is_(None),
            LoginSession.expires_at > utcnow(), User.is_active.is_(True)))
    if not user:
        raise HTTPException(401, "Please sign in first.")
    return user


def seeker(user: Annotated[User, Depends(current_user)]):
    if user.role != "seeker":
        raise HTTPException(403, "Only job seeker accounts can do that.")
    return user


def employer(user: Annotated[User, Depends(current_user)], session: DB):
    if user.role != "employer":
        raise HTTPException(403, "Only employer accounts can do that.")
    return user, session.scalar(select(Employer).where(Employer.owner_user_id == user.id))


Seeker = Annotated[User, Depends(seeker)]
EmployerAccount = Annotated[tuple, Depends(employer)]
Account = Annotated[User, Depends(current_user)]


def columns(row, exclude=()):
    return {c.name: serial(getattr(row, c.name)) for c in row.__table__.columns if c.name not in exclude}


def user_out(session, user):
    company = session.scalar(select(Employer).where(Employer.owner_user_id == user.id)) if user.role == "employer" else None
    return {"id": user.id, "email": user.email, "role": user.role, "full_name": user.full_name,
            "company": {"id": company.id, "name": company.name} if company else None}


def profile_out(user, profile):
    data = columns(profile, {"user_id"}) if profile else {key: [] if key == "skills" else None for key in ProfileInput.model_fields if key != "full_name"}
    data.update(full_name=user.full_name)
    data.setdefault("updated_at", None)
    return data


def job_out(session, job, full=False):
    company = session.get(Employer, job.employer_id)
    result = columns(job, {"employer_id", "updated_at"})
    result["employer"] = {key: getattr(company, key) for key in (("id", "name", "website", "about", "location") if full else ("id", "name"))}
    return result


def seeker_application(session, application):
    job = session.get(Job, application.job_id)
    company = session.get(Employer, job.employer_id)
    return {**{key: serial(getattr(application, key)) for key in ("id", "status", "version", "created_at", "updated_at", "cover_note", "employer_message")},
            "job": {"id": job.id, "title": job.title, "employer": {"id": company.id, "name": company.name}}}


def employer_application(session, application, full=False):
    snapshot = application.profile_snapshot or {}
    result = {key: serial(getattr(application, key)) for key in ("id", "status", "version", "created_at")}
    result["candidate"] = snapshot if full else {key: snapshot.get(key) for key in ("full_name", "headline", "target_role", "experience_level", "experience_years", "skills")}
    if full:
        result.update({key: serial(getattr(application, key)) for key in ("updated_at", "cover_note", "employer_message")})
        events = session.scalars(select(StatusEvent).where(StatusEvent.application_id == application.id).order_by(StatusEvent.created_at, StatusEvent.id)).all()
        result["history"] = [{"status": event.new_status, "at": serial(event.created_at), "actor": event.actor, "reason": event.reason} for event in events]
        result["job"] = job_out(session, session.get(Job, application.job_id))
    return result


def ip_address(request):
    forwarded = request.headers.get("x-forwarded-for")
    return forwarded.split(",", 1)[0].strip() if forwarded else request.client.host if request.client else "unknown"


def rate_limit(request, keys, limit, seconds):
    """Atomic, database-backed fixed windows shared by all API processes."""
    now = utcnow()
    allowed = True
    with request.app.state.session_factory.begin() as session:
        begin_write(session)
        session.execute(delete(RateLimitBucket).where(RateLimitBucket.started_at < now - timedelta(days=1)))
        insert = sqlite_insert if session.bind.dialect.name == "sqlite" else pg_insert
        for key in keys:
            expired = RateLimitBucket.started_at <= now - timedelta(seconds=seconds)
            statement = insert(RateLimitBucket).values(key=token_digest(key), started_at=now, count=1).on_conflict_do_update(
                index_elements=[RateLimitBucket.key],
                set_={"started_at": case((expired, now), else_=RateLimitBucket.started_at),
                      "count": case((expired, 1), else_=RateLimitBucket.count + 1)},
                where=or_(expired, RateLimitBucket.count < limit)).returning(RateLimitBucket.key)
            if session.scalar(statement) is None:
                allowed = False
    if not allowed:
        raise HTTPException(429, "Too many tries. Please try again later.", headers={"Retry-After": str(seconds)})


def new_session(session, user, response, settings):
    token = secrets.token_urlsafe(32)
    expires = utcnow() + timedelta(seconds=SESSION_SECONDS)
    session.add(LoginSession(user_id=user.id, token_hash=token_digest(token), expires_at=expires))
    response.set_cookie(COOKIE, token, max_age=SESSION_SECONDS, expires=SESSION_SECONDS, httponly=True,
                        secure=settings.session_cookie_secure, samesite="lax", path="/")
    user.last_login_at = utcnow()


def owned_job(session, company, job_id, lock=False):
    query = select(Job).where(Job.id == job_id, Job.employer_id == company.id)
    job = session.scalar(query.with_for_update() if lock else query)
    if not job:
        raise HTTPException(404, "Job not found.")
    return job


def owned_application(session, company, application_id):
    application = session.scalar(select(Application).join(Job).where(Application.id == application_id, Job.employer_id == company.id).with_for_update(of=Application))
    if not application:
        raise HTTPException(404, "Application not found.")
    return application


def notify(session, user_id, type_, title, body, application):
    session.add(Notification(user_id=user_id, type=type_, title=title, body=body,
                             application_id=application.id, job_id=application.job_id))


def move(session, application, status, actor, targets, reason=None):
    if status not in TRANSITIONS[application.status]:
        raise HTTPException(409, "Invalid hiring-stage transition.")
    now = utcnow()
    # Ordered timestamps are preserved even for the two steps of acceptance.
    previous = session.scalar(select(func.max(StatusEvent.created_at)).where(StatusEvent.application_id == application.id))
    if previous and now <= previous:
        now = previous + timedelta(microseconds=1)
    session.add(StatusEvent(application_id=application.id, old_status=application.status,
                            new_status=status, actor=actor, reason=reason, created_at=now))
    application.status, application.updated_at = status, now
    application.version += 1
    session.flush()
    enqueue(session, application, targets)


def check_version(application, version):
    if application.version != version:
        raise HTTPException(409, "Application changed; reload before updating its status.")


@router.post("/auth/register", status_code=201)
def register(data: RegisterInput, request: Request, response: Response, session: DB):
    rate_limit(request, ["register:" + ip_address(request)], 5, 3600)
    begin_write(session)
    if session.scalar(select(User.id).where(User.email == data.email)):
        raise HTTPException(409, "This email is already registered.")
    user = User(id=new_id(), email=data.email, password_hash=hasher.hash(data.password), role=data.role, full_name=data.full_name)
    try:
        # SAVEPOINT lets concurrent registrations fail cleanly without aborting
        # the surrounding request transaction.
        with session.begin_nested():
            session.add(user)
            session.flush()
    except IntegrityError:
        raise HTTPException(409, "This email is already registered.") from None
    if user.role == "employer":
        session.add(Employer(owner_user_id=user.id, name=data.company_name))
    else:
        session.add(SeekerProfile(user_id=user.id))
    session.flush()
    new_session(session, user, response, request.app.state.settings)
    return {"user": user_out(session, user)}


@router.post("/auth/login")
def login(data: LoginInput, request: Request, response: Response, session: DB):
    rate_limit(request, ["login-ip:" + ip_address(request), "login-email:" + data.email], 10, 900)
    begin_write(session)
    user = session.scalar(select(User).where(User.email == data.email))
    try:
        hasher.verify(user.password_hash if user else dummy_hash, data.password)
    except (VerificationError, InvalidHashError):
        raise HTTPException(401, "Wrong email or password.") from None
    if not user or not user.is_active:
        raise HTTPException(401, "Wrong email or password.")
    if hasher.check_needs_rehash(user.password_hash):
        user.password_hash = hasher.hash(data.password)
    new_session(session, user, response, request.app.state.settings)
    return {"user": user_out(session, user)}


@router.get("/auth/me")
def me(user: Account, session: DB):
    return {"user": user_out(session, user)}


@router.post("/auth/logout", status_code=204)
def logout(request: Request, response: Response, user: Account, session: DB):
    begin_write(session)
    session.execute(update(LoginSession).where(LoginSession.token_hash == token_digest(request.cookies[COOKIE]), LoginSession.user_id == user.id).values(revoked_at=utcnow()))
    response.delete_cookie(COOKIE, path="/", httponly=True, secure=request.app.state.settings.session_cookie_secure, samesite="lax")


@router.get("/me/profile")
def get_profile(user: Seeker, session: DB):
    return profile_out(user, session.get(SeekerProfile, user.id))


@router.put("/me/profile")
def save_profile(data: ProfileInput, user: Seeker, session: DB):
    begin_write(session)
    # Serialize edits and applications for this seeker in PostgreSQL.
    session.scalar(select(User).where(User.id == user.id).with_for_update())
    profile = session.get(SeekerProfile, user.id)
    if not profile:
        profile = SeekerProfile(user_id=user.id)
        session.add(profile)
    for key, value in data.model_dump(exclude={"full_name"}).items():
        setattr(profile, key, value)
    if data.full_name is not None:
        user.full_name = data.full_name
    profile.updated_at = utcnow()
    session.flush()
    return profile_out(user, profile)


@router.get("/jobs")
def list_jobs(session: DB, q: str | None = Query(None, max_length=200), area: Area | None = None,
              level: Level | None = None, work_mode: str | None = None, employment_type: str | None = None,
              limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0)):
    query = select(Job).join(Employer).join(User, Employer.owner_user_id == User.id).where(Job.status == "open", User.is_active.is_(True))
    for field, value in ((Job.area, area), (Job.work_mode, work_mode), (Job.employment_type, employment_type)):
        if value:
            query = query.where(field == value)
    if level:
        # JSON list membership compiled on both SQLite and PostgreSQL.
        query = query.where(cast(Job.levels, String).contains('"' + level + '"'))
    if q and q.strip():
        term = q.strip().lower()
        query = query.where(or_(*(func.lower(field).contains(term, autoescape=True) for field in (Job.title, Job.summary, cast(Job.skills, String), Employer.name))))
    total = session.scalar(select(func.count()).select_from(query.subquery()))
    rows = session.scalars(query.order_by(Job.created_at.desc(), Job.id).offset(offset).limit(limit)).all()
    return {"items": [job_out(session, job) for job in rows], "total": total}


@router.get("/jobs/{job_id}")
def get_job(job_id: str, request: Request, session: DB):
    job = session.get(Job, job_id)
    company = session.get(Employer, job.employer_id) if job else None
    owner = session.get(User, company.owner_user_id) if company else None
    if not owner or not owner.is_active:
        raise HTTPException(404, "Job not found.")
    if job.status == "closed":
        try:
            user = current_user(request, session)
        except HTTPException:
            user = None
        if not user or user.id != owner.id:
            raise HTTPException(404, "Job not found.")
    return job_out(session, job, full=True)


def create_application(session, user, job, data, targets, created_at=None):
    profile = session.get(SeekerProfile, user.id)
    if not profile or not user.full_name or not (profile.skills or profile.about):
        raise MarketplaceError(422, "Add your skills or a short summary to your profile before applying.", "profile_incomplete")
    now = created_at or utcnow()
    candidate = session.scalar(select(Candidate).where(Candidate.email == user.email).with_for_update())
    if not candidate:
        candidate = Candidate(id=new_id(), email=user.email, full_name=user.full_name)
        session.add(candidate)
    candidate.user_id, candidate.full_name, candidate.phone, candidate.timezone = user.id, user.full_name, profile.phone, profile.timezone
    candidate.updated_at = now
    session.flush()
    snapshot = {"email": user.email, **profile_out(user, profile)}
    values = {key: getattr(profile, key) for key in ("role_detail", "experience_level", "experience_years", "portfolio_url", "resume_url", "compensation_amount", "compensation_currency", "compensation_period", "compensation_expectations", "availability")}
    application = Application(id=new_id(), candidate_id=candidate.id, job_id=job.id, target_role=job.area,
                              profile_snapshot=snapshot, cover_note=data.cover_note, fit_summary=profile.about,
                              consent_to_process=True, consent_at=now, status="new_applicants", version=1,
                              created_at=now, updated_at=now, **values)
    session.add(application)
    session.flush()
    session.add(StatusEvent(application_id=application.id, old_status=None, new_status="new_applicants", actor="seeker:" + user.id, created_at=now))
    enqueue(session, application, targets)
    company = session.get(Employer, job.employer_id)
    notify(session, company.owner_user_id, "application_received", f"New application for {job.title}", f"{user.full_name} applied.", application)
    return application


@router.post("/jobs/{job_id}/apply", status_code=201)
def apply(job_id: str, data: ApplyInput, request: Request, user: Seeker, session: DB,
          idempotency_key: Annotated[str, Header(min_length=1, max_length=200)]):
    rate_limit(request, ["apply:" + user.id], 30, 3600)
    begin_write(session)
    session.scalar(select(User).where(User.id == user.id).with_for_update())
    event_key = token_digest(user.id + ":" + idempotency_key)
    digest = token_digest(json.dumps({"job_id": job_id, **data.model_dump()}, sort_keys=True))
    receipt = session.scalar(select(IntakeReceipt).where(IntakeReceipt.source == "marketplace", IntakeReceipt.event_key == event_key))
    if receipt:
        if receipt.payload_hash != digest:
            raise HTTPException(409, "This idempotency key was already used for a different payload.")
        return seeker_application(session, session.get(Application, receipt.application_id))
    job = session.scalar(select(Job).where(Job.id == job_id).with_for_update())
    company = session.get(Employer, job.employer_id) if job else None
    if not company or not session.get(User, company.owner_user_id).is_active:
        raise HTTPException(404, "Job not found.")
    if job.status != "open":
        raise MarketplaceError(409, "This job is closed.", "job_closed")
    existing = session.scalar(select(Application.id).join(Candidate).where(Candidate.email == user.email, Application.job_id == job.id))
    if existing:
        raise MarketplaceError(409, "You’ve already applied to this job.", "already_applied")
    application = create_application(session, user, job, data, request.app.state.settings.sync_targets)
    session.add(IntakeReceipt(source="marketplace", event_key=event_key, payload_hash=digest, application_id=application.id))
    return seeker_application(session, application)


@router.get("/me/applications")
def my_applications(user: Seeker, session: DB):
    rows = session.scalars(select(Application).join(Candidate).where(Candidate.user_id == user.id, Application.job_id.is_not(None)).order_by(Application.created_at.desc(), Application.id)).all()
    return [seeker_application(session, application) for application in rows]


@router.post("/me/applications/{application_id}/withdraw")
def withdraw(application_id: str, data: WithdrawInput, request: Request, user: Seeker, session: DB):
    begin_write(session)
    application = session.scalar(select(Application).join(Candidate).where(Application.id == application_id, Candidate.user_id == user.id, Application.job_id.is_not(None)).with_for_update(of=Application))
    if not application:
        raise HTTPException(404, "Application not found.")
    move(session, application, "withdrawn", "seeker:" + user.id, request.app.state.settings.sync_targets, data.reason or "Withdrawn by candidate")
    job = session.get(Job, application.job_id)
    company = session.get(Employer, job.employer_id)
    name = application.profile_snapshot["full_name"]
    notify(session, company.owner_user_id, "application_withdrawn", f"{name} withdrew their application", f"For {job.title}.", application)
    return seeker_application(session, application)


@router.get("/employer/company")
def get_company(account: EmployerAccount):
    return columns(account[1], {"owner_user_id"})


@router.put("/employer/company")
def save_company(data: CompanyInput, account: EmployerAccount, session: DB):
    begin_write(session)
    company = session.scalar(select(Employer).where(Employer.id == account[1].id).with_for_update())
    for key, value in data.model_dump().items():
        setattr(company, key, value)
    company.updated_at = utcnow()
    return columns(company, {"owner_user_id"})


@router.get("/employer/jobs")
def employer_jobs(account: EmployerAccount, session: DB):
    rows = session.scalars(select(Job).where(Job.employer_id == account[1].id).order_by(Job.created_at.desc(), Job.id)).all()
    counts = {(job_id, status): count for job_id, status, count in session.execute(select(Application.job_id, Application.status, func.count()).join(Job).where(Job.employer_id == account[1].id).group_by(Application.job_id, Application.status))}
    return [{**job_out(session, job), "counts": {status: counts.get((job.id, status), 0) for status in TRANSITIONS}} for job in rows]


@router.post("/employer/jobs", status_code=201)
def post_job(data: JobInput, account: EmployerAccount, session: DB):
    begin_write(session)
    job = Job(employer_id=account[1].id, **data.model_dump())
    session.add(job)
    session.flush()
    return job_out(session, job)


@router.put("/employer/jobs/{job_id}")
def edit_job(job_id: str, data: JobInput, account: EmployerAccount, session: DB):
    begin_write(session)
    job = owned_job(session, account[1], job_id, lock=True)
    for key, value in data.model_dump().items():
        setattr(job, key, value)
    job.updated_at = utcnow()
    return job_out(session, job)


@router.get("/employer/jobs/{job_id}/applications")
def applicants(job_id: str, account: EmployerAccount, session: DB, status: Status | None = None):
    owned_job(session, account[1], job_id)
    query = select(Application).where(Application.job_id == job_id)
    if status:
        query = query.where(Application.status == status.value)
    return [employer_application(session, application) for application in session.scalars(query.order_by(Application.created_at.desc(), Application.id))]


@router.get("/employer/applications/{application_id}")
def review_application(application_id: str, request: Request, account: EmployerAccount, session: DB):
    begin_write(session)
    application = owned_application(session, account[1], application_id)
    if application.status == "new_applicants":
        move(session, application, "screening", "employer:" + account[0].id, request.app.state.settings.sync_targets)
    return employer_application(session, application, full=True)


@router.post("/employer/applications/{application_id}/decision")
def decision(application_id: str, data: DecisionInput, request: Request, account: EmployerAccount, session: DB):
    begin_write(session)
    user, company = account
    application = owned_application(session, company, application_id)
    check_version(application, data.expected_version)
    application.employer_message = data.message
    actor, targets = "employer:" + user.id, request.app.state.settings.sync_targets
    job = session.get(Job, application.job_id)
    if data.decision == "accept":
        if application.status == "new_applicants":
            move(session, application, "screening", actor, targets)
        move(session, application, "interview", actor, targets, data.message)
        type_, title, body = "application_accepted", f"{company.name} accepted your application", data.message or f"For {job.title}. They’ll contact you about next steps."
    else:
        move(session, application, "rejected", actor, targets, data.message or "Not selected")
        type_, title, body = "application_rejected", f"Update on your application for {job.title}", data.message or f"{company.name} decided not to move forward this time."
    seeker_id = session.get(Candidate, application.candidate_id).user_id
    notify(session, seeker_id, type_, title, body, application)
    session.flush()
    return employer_application(session, application, full=True)


@router.post("/employer/applications/{application_id}/stage")
def stage(application_id: str, data: StageInput, request: Request, account: EmployerAccount, session: DB):
    begin_write(session)
    user, company = account
    application = owned_application(session, company, application_id)
    check_version(application, data.expected_version)
    move(session, application, data.status, "employer:" + user.id, request.app.state.settings.sync_targets)
    job = session.get(Job, application.job_id)
    title = f"{company.name} made you an offer" if data.status == "offered" else f"You’re hired at {company.name}"
    notify(session, session.get(Candidate, application.candidate_id).user_id, "application_" + data.status, title, f"For {job.title}.", application)
    return employer_application(session, application, full=True)


@router.get("/notifications")
def notifications(user: Account, session: DB, limit: int = Query(20, ge=1, le=100)):
    unread = session.scalar(select(func.count()).select_from(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None)))
    rows = session.scalars(select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc(), Notification.id).limit(limit))
    return {"unread": unread, "items": [columns(row, {"user_id"}) for row in rows]}


@router.post("/notifications/read", status_code=204)
def read_notifications(data: ReadInput, user: Account, session: DB):
    begin_write(session)
    query = update(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
    if not data.all:
        query = query.where(Notification.id.in_(data.ids))
    session.execute(query.values(read_at=utcnow()))


def install(app, admin):
    app.include_router(router)

    @app.exception_handler(MarketplaceError)
    async def marketplace_error(_request, error):
        return JSONResponse({"detail": error.detail, "code": error.code}, status_code=error.status_code)

    @app.post("/api/v2/admin/users/{user_id}/active", dependencies=[Depends(admin)], tags=["marketplace admin"])
    def account_active(user_id: str, data: ActiveInput, session: DB):
        begin_write(session)
        user = session.scalar(select(User).where(User.id == user_id).with_for_update())
        if not user:
            raise HTTPException(404, "User not found.")
        user.is_active = data.is_active
        if not user.is_active:
            session.execute(update(LoginSession).where(LoginSession.user_id == user.id, LoginSession.revoked_at.is_(None)).values(revoked_at=utcnow()))
        return {"id": user.id, "is_active": user.is_active}
