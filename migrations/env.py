from alembic import context

from app.config import Settings
from app.db import make_engine
from app.models import Base

config = context.config
target_metadata = Base.metadata
database_url = Settings().database_url

if context.is_offline_mode():
    context.configure(url=database_url, target_metadata=target_metadata, literal_binds=True, dialect_opts={"paramstyle": "named"}, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    engine = make_engine(database_url)
    with engine.connect() as connection:
        # Batch migrations rebuild referenced tables. Disable FK actions before
        # the transaction so SQLite cannot cascade-delete the existing v1 audit.
        if engine.dialect.name == "sqlite":
            connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
            connection.commit()
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True, render_as_batch=engine.dialect.name == "sqlite")
        with context.begin_transaction():
            context.run_migrations()
            if engine.dialect.name == "sqlite" and connection.exec_driver_sql("PRAGMA foreign_key_check").first():
                raise RuntimeError("Migration left invalid foreign-key references.")
        if engine.dialect.name == "sqlite":
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")
    engine.dispose()
