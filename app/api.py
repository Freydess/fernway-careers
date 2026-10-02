import base64
import hashlib
import hmac
import json
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import ValidationError
from sqlalchemy import func, select, text

from app.config import Settings
from app.db import begin_write, make_engine, session_factory
from app.models import Application, Candidate, StatusEvent, SyncJob, utcnow
from app.schemas import Intake, Status, StatusChange
from app.service import application_data, change_status, enqueue, submit
from app.typeform import parse_typeform


class BodyLimitMiddleware:
    def __init__(self, app, limit):
        self.app, self.limit = app, limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        chunks, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body = message.get("body", b"")
            size += len(body)
            if size > self.limit:
                return await JSONResponse({"detail": "Request body is too large."}, status_code=413)(scope, receive, send)
            chunks.append(body)
            if not message.get("more_body", False):
                break
        sent = False

        async def replay():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


def safe_validation_errors(errors):
    # Validation errors otherwise echo candidate data back into logs or clients.
    return [{"loc": error["loc"], "msg": error["msg"], "type": error["type"]} for error in errors]


def create_app(settings=None, engine=None):
    settings = settings or Settings()
    owns_engine = engine is None
    engine = engine or make_engine(settings.database_url)
    factory = session_factory(engine)

    @asynccontextmanager
    async def lifespan(_app):
        yield
        if owns_engine:
            engine.dispose()

    app = FastAPI(title="Personalized Employment API", version="1.0.0", lifespan=lifespan)
    app.state.settings, app.state.engine, app.state.session_factory = settings, engine, factory
    app.add_middleware(BodyLimitMiddleware, limit=settings.max_body_bytes)
    if settings.cors_origins:
        app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET", "POST", "PATCH"], allow_headers=["Authorization", "Content-Type", "Idempotency-Key"])
    security = HTTPBearer(auto_error=False)

    def authenticate(credentials, expected):
        if not credentials or not hmac.compare_digest(credentials.credentials.encode(), expected.get_secret_value().encode()):
            raise HTTPException(401, "Invalid API token.", headers={"WWW-Authenticate": "Bearer"})

    def admin(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)]):
        authenticate(credentials, settings.admin_api_token)

    def intake_auth(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)]):
        authenticate(credentials, settings.intake_api_token)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request, error):
        return JSONResponse({"detail": safe_validation_errors(error.errors())}, status_code=422)

    @app.get("/health", tags=["health"])
    def health():
        return {"status": "ok"}

    @app.get("/ready", tags=["health"])
    def ready():
        try:
            with factory() as session:
                revision = session.execute(text("SELECT version_num FROM alembic_version")).scalar()
                session.execute(select(Application.id).limit(1))
                if revision != "0001_initial":
                    raise ValueError("Migration required")
        except Exception:
            raise HTTPException(503, "Database is not ready; run Alembic migrations.") from None
        return {"status": "ready"}

    @app.post("/api/v1/intake", status_code=201, dependencies=[Depends(intake_auth)], tags=["intake"])
    def intake(data: Intake, idempotency_key: Annotated[str, Header(min_length=1, max_length=200)]):
        return submit(factory, data, "api", idempotency_key, settings.sync_targets)

    @app.post("/api/v1/webhooks/typeform", status_code=201, tags=["intake"])
    async def typeform(request: Request, typeform_signature: Annotated[str | None, Header()] = None):
        secret = settings.typeform_webhook_secret.get_secret_value()
        if not secret or not settings.typeform_form_id:
            raise HTTPException(503, "Typeform webhook is not configured.")
        raw = await request.body()
        expected = "sha256=" + base64.b64encode(hmac.new(secret.encode(), raw, hashlib.sha256).digest()).decode()
        if not typeform_signature or not hmac.compare_digest(expected.encode(), typeform_signature.encode()):
            raise HTTPException(401, "Invalid Typeform signature.")
        try:
            data, event_key = parse_typeform(json.loads(raw), settings)
        except ValidationError as error:
            raise HTTPException(422, detail=safe_validation_errors(error.errors())) from None
        except (ValueError, TypeError, AttributeError, KeyError):
            raise HTTPException(422, "Malformed or unsupported Typeform response.") from None
        return submit(factory, data, "typeform", event_key, settings.sync_targets)

    @app.get("/api/v1/applications", dependencies=[Depends(admin)], tags=["review"])
    def applications(status: Status | None = None, target_role: str | None = None, limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0)):
        with factory() as session:
            query = select(Application)
            if status:
                query = query.where(Application.status == status.value)
            if target_role:
                query = query.where(Application.target_role == target_role.lower())
            total = session.scalar(select(func.count()).select_from(query.subquery()))
            rows = session.scalars(query.order_by(Application.created_at.desc(), Application.id).offset(offset).limit(limit)).all()
            return {"items": [application_data(session, row) for row in rows], "total": total, "limit": limit, "offset": offset}

    @app.get("/api/v1/applications/{application_id}", dependencies=[Depends(admin)], tags=["review"])
    def application(application_id: str):
        with factory() as session:
            row = session.get(Application, application_id)
            if not row:
                raise HTTPException(404, "Application not found.")
            return application_data(session, row)

    @app.patch("/api/v1/applications/{application_id}/status", dependencies=[Depends(admin)], tags=["review"])
    def update_status(application_id: str, data: StatusChange):
        return change_status(factory, application_id, data, settings.sync_targets)

    @app.get("/api/v1/applications/{application_id}/history", dependencies=[Depends(admin)], tags=["review"])
    def history(application_id: str):
        with factory() as session:
            if not session.get(Application, application_id):
                raise HTTPException(404, "Application not found.")
            return session.scalars(select(StatusEvent).where(StatusEvent.application_id == application_id).order_by(StatusEvent.created_at, StatusEvent.id)).all()

    @app.post("/api/v1/applications/{application_id}/sync", status_code=202, dependencies=[Depends(admin)], tags=["sync"])
    def resync(application_id: str):
        if not settings.sync_targets:
            raise HTTPException(409, "Enable a sync mode before queueing a sync.")
        with factory.begin() as session:
            begin_write(session)
            row = session.scalar(select(Application).where(Application.id == application_id).with_for_update())
            if not row:
                raise HTTPException(404, "Application not found.")
            row.version += 1
            row.updated_at = utcnow()
            session.flush()
            enqueue(session, row, settings.sync_targets)
            return {"application_id": row.id, "version": row.version, "targets": settings.sync_targets}

    @app.get("/api/v1/sync-jobs", dependencies=[Depends(admin)], tags=["sync"])
    def jobs(state: str | None = None, limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0)):
        with factory() as session:
            query = select(SyncJob)
            if state:
                query = query.where(SyncJob.state == state)
            total = session.scalar(select(func.count()).select_from(query.subquery()))
            rows = session.scalars(query.order_by(SyncJob.created_at.desc(), SyncJob.id).offset(offset).limit(limit)).all()
            columns = [column.name for column in SyncJob.__table__.columns if column.name not in {"payload", "lease_token"}]
            return {"items": [{key: getattr(row, key) for key in columns} for row in rows], "total": total}

    @app.post("/api/v1/sync-jobs/{job_id}/retry", status_code=202, dependencies=[Depends(admin)], tags=["sync"])
    def retry(job_id: str):
        with factory.begin() as session:
            begin_write(session)
            job = session.scalar(select(SyncJob).where(SyncJob.id == job_id).with_for_update())
            if not job:
                raise HTTPException(404, "Sync job not found.")
            if job.state not in {"dead", "retry"}:
                raise HTTPException(409, "Only failed jobs can be retried.")
            if session.scalar(select(SyncJob.id).where(SyncJob.application_id == job.application_id, SyncJob.target == job.target, SyncJob.revision > job.revision).limit(1)):
                raise HTTPException(409, "A newer revision exists; queue a fresh application sync instead.")
            job.state, job.attempts, job.last_error = "pending", 0, None
            job.next_attempt_at, job.lease_until, job.lease_token = utcnow(), None, None
            job.updated_at = utcnow()
            return {"job_id": job.id, "state": job.state}

    return app
