import logging
import os
import time

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase

load_dotenv()

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost/job_radar")

# create_engine is lazy — no connection is made here
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def init_db(retries: int = 3, delay: int = 5) -> None:
    """Connect to the database and create all tables.

    Retries up to `retries` times with `delay` seconds between attempts so
    Render doesn't crash when Supabase is slow to wake up.  Called explicitly
    from the FastAPI lifespan — never at import time.
    """
    last_err: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            Base.metadata.create_all(bind=engine)
            logger.info("Database ready.")
            return
        except Exception as e:
            last_err = e
            if attempt < retries:
                logger.warning(
                    "DB connection attempt %d/%d failed, retrying in %ds: %s",
                    attempt, retries, delay, e,
                )
                time.sleep(delay)
            else:
                logger.error("DB connection failed after %d attempts: %s", retries, e)
    raise RuntimeError(
        f"Could not connect to database after {retries} attempts"
    ) from last_err


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
