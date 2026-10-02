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
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True, render_as_batch=engine.dialect.name == "sqlite")
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()
