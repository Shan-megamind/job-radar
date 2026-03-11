import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

load_dotenv()

from database import Base, engine, get_db
from models import Job, JobResponse, Website, WebsiteCreate, WebsiteResponse
from scheduler import check_all_websites, start_scheduler, stop_scheduler, update_schedule
from email_service import send_new_jobs_email

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

Base.metadata.create_all(bind=engine)


SEED_WEBSITES = [
    # Greenhouse
    ("https://boards.greenhouse.io/airbnb", "Airbnb"),
    ("https://boards.greenhouse.io/figma", "Figma"),
    ("https://boards.greenhouse.io/coinbase", "Coinbase"),
    ("https://boards.greenhouse.io/discord", "Discord"),
    ("https://boards.greenhouse.io/notion", "Notion"),
    ("https://boards.greenhouse.io/reddit", "Reddit"),
    ("https://boards.greenhouse.io/scaleai", "Scale AI"),
    ("https://boards.greenhouse.io/instacart", "Instacart"),
    ("https://boards.greenhouse.io/pinterest", "Pinterest"),
    ("https://boards.greenhouse.io/duolingo", "Duolingo"),
    ("https://boards.greenhouse.io/robinhood", "Robinhood"),
    ("https://boards.greenhouse.io/dropbox", "Dropbox"),
    ("https://boards.greenhouse.io/affirm", "Affirm"),
    ("https://boards.greenhouse.io/coursera", "Coursera"),
    ("https://boards.greenhouse.io/flexport", "Flexport"),
    ("https://boards.greenhouse.io/gusto", "Gusto"),
    ("https://boards.greenhouse.io/ramp", "Ramp"),
    ("https://boards.greenhouse.io/chime", "Chime"),
    ("https://boards.greenhouse.io/doordash", "DoorDash"),
    ("https://boards.greenhouse.io/square", "Square"),
    ("https://boards.greenhouse.io/benchling", "Benchling"),
    ("https://boards.greenhouse.io/checkr", "Checkr"),
    ("https://boards.greenhouse.io/strava", "Strava"),
    ("https://boards.greenhouse.io/carta", "Carta"),
    ("https://boards.greenhouse.io/box", "Box"),
    ("https://boards.greenhouse.io/elastic", "Elastic"),
    ("https://boards.greenhouse.io/mongodb", "MongoDB"),
    ("https://boards.greenhouse.io/datadog", "Datadog"),
    ("https://boards.greenhouse.io/samsara", "Samsara"),
    ("https://boards.greenhouse.io/stripe", "Stripe"),
    # Lever
    ("https://jobs.lever.co/netflix", "Netflix"),
    ("https://jobs.lever.co/airtable", "Airtable"),
    ("https://jobs.lever.co/postman", "Postman"),
    ("https://jobs.lever.co/atlassian", "Atlassian"),
    ("https://jobs.lever.co/rippling", "Rippling"),
    ("https://jobs.lever.co/gong", "Gong"),
    ("https://jobs.lever.co/plaid", "Plaid"),
    ("https://jobs.lever.co/mixpanel", "Mixpanel"),
    ("https://jobs.lever.co/sentry", "Sentry"),
    ("https://jobs.lever.co/algolia", "Algolia"),
    ("https://jobs.lever.co/udemy", "Udemy"),
    ("https://jobs.lever.co/segment", "Segment"),
    ("https://jobs.lever.co/loom", "Loom"),
    ("https://jobs.lever.co/branch", "Branch"),
    # Work at a Startup (YC)
    ("https://www.workatastartup.com/jobs?role=pm", "Work at a Startup (YC)"),
    # Ashby
    ("https://jobs.ashbyhq.com/openai", "OpenAI"),
    ("https://jobs.ashbyhq.com/anthropic", "Anthropic"),
    ("https://jobs.ashbyhq.com/perplexity", "Perplexity"),
    ("https://jobs.ashbyhq.com/replit", "Replit"),
    ("https://jobs.ashbyhq.com/runway", "Runway"),
    ("https://jobs.ashbyhq.com/mistral", "Mistral"),
    ("https://jobs.ashbyhq.com/character", "Character.AI"),
    ("https://jobs.ashbyhq.com/scale-ai", "Scale AI (Ashby)"),
]


def _seed_websites(db) -> None:
    if db.query(Website).count() > 0:
        return
    now = datetime.utcnow()
    for url, name in SEED_WEBSITES:
        db.add(Website(url=url, name=name, created_at=now))
    db.commit()
    logger.info("Seeded %d websites", len(SEED_WEBSITES))


@asynccontextmanager
async def lifespan(app: FastAPI):
    db = next(get_db())
    try:
        _seed_websites(db)
    finally:
        db.close()
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="Job Radar", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Websites ──────────────────────────────────────────────────────────────────

@app.get("/api/websites", response_model=list[WebsiteResponse])
def list_websites(db: Session = Depends(get_db)):
    return db.query(Website).order_by(Website.created_at.desc()).all()


@app.post("/api/websites", response_model=WebsiteResponse, status_code=201)
def add_website(payload: WebsiteCreate, db: Session = Depends(get_db)):
    existing = db.query(Website).filter(Website.url == payload.url).first()
    if existing:
        raise HTTPException(status_code=409, detail="URL already monitored")

    site = Website(
        url=payload.url,
        name=payload.name or _name_from_url(payload.url),
        job_selector=payload.job_selector,
        title_selector=payload.title_selector,
        link_selector=payload.link_selector,
        keywords=json.dumps(payload.keywords) if payload.keywords else None,
        created_at=datetime.utcnow(),
    )
    db.add(site)
    db.commit()
    db.refresh(site)
    return site


@app.delete("/api/websites/erroring", status_code=200)
def remove_erroring_websites(db: Session = Depends(get_db)):
    """Bulk-delete all websites whose last scrape returned an error."""
    sites = db.query(Website).filter(Website.last_status == "error").all()
    count = len(sites)
    for site in sites:
        db.delete(site)
    db.commit()
    return {"removed": count}


@app.delete("/api/websites/{website_id}", status_code=204)
def remove_website(website_id: int, db: Session = Depends(get_db)):
    site = db.query(Website).filter(Website.id == website_id).first()
    if not site:
        raise HTTPException(status_code=404, detail="Website not found")
    db.delete(site)
    db.commit()


# ── Jobs ──────────────────────────────────────────────────────────────────────

@app.get("/api/jobs", response_model=list[JobResponse])
def list_jobs(
    website_id: Optional[int] = None,
    is_new: Optional[bool] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Job)
    if website_id is not None:
        q = q.filter(Job.website_id == website_id)
    if is_new is not None:
        q = q.filter(Job.is_new == is_new)
    jobs = q.order_by(Job.first_seen.desc()).all()

    result = []
    for job in jobs:
        jr = JobResponse.model_validate(job)
        if job.website:
            jr.website_name = job.website.name
            jr.website_url = job.website.url
        result.append(jr)
    return result


@app.post("/api/jobs/{job_id}/mark-seen", status_code=204)
def mark_job_seen(job_id: int, db: Session = Depends(get_db)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job.is_new = False
    db.commit()


@app.post("/api/jobs/mark-all-seen", status_code=204)
def mark_all_seen(db: Session = Depends(get_db)):
    db.query(Job).filter(Job.is_new == True).update({"is_new": False})
    db.commit()


# ── Actions ───────────────────────────────────────────────────────────────────

@app.post("/api/check-now")
def check_now():
    """Manually trigger a scrape of all websites."""
    result = check_all_websites()
    return result


@app.post("/api/test-email")
def test_email():
    """Send a test email using current SMTP settings."""
    notify = os.getenv("NOTIFY_EMAIL", os.getenv("SMTP_USER", ""))
    if not os.getenv("SMTP_USER") or not os.getenv("SMTP_PASSWORD"):
        raise HTTPException(status_code=400, detail="SMTP_USER and SMTP_PASSWORD must be set in .env")

    sample_jobs = [{"title": "Senior Product Manager", "url": "https://example.com/jobs/1", "company": "Acme Corp", "location": "Remote"}]
    error = send_new_jobs_email(sample_jobs)
    if error:
        raise HTTPException(status_code=500, detail=f"Email failed: {error}")
    return {"ok": True, "sent_to": notify}


# ── Settings ──────────────────────────────────────────────────────────────────

class SettingsPayload(BaseModel):
    check_interval_hours: float
    notify_email: Optional[str] = None


@app.get("/api/settings")
def get_settings():
    return {
        "check_interval_hours": float(os.getenv("CHECK_INTERVAL_HOURS", "6")),
        "notify_email": os.getenv("NOTIFY_EMAIL", os.getenv("SMTP_USER", "")),
        "smtp_configured": bool(os.getenv("SMTP_USER") and os.getenv("SMTP_PASSWORD")),
    }


@app.put("/api/settings")
def update_settings(payload: SettingsPayload):
    os.environ["CHECK_INTERVAL_HOURS"] = str(payload.check_interval_hours)
    if payload.notify_email:
        os.environ["NOTIFY_EMAIL"] = payload.notify_email
    update_schedule(payload.check_interval_hours)
    return {"ok": True}


# ── Stats ─────────────────────────────────────────────────────────────────────

@app.get("/api/stats")
def get_stats(db: Session = Depends(get_db)):
    total_jobs = db.query(Job).count()
    new_jobs = db.query(Job).filter(Job.is_new == True).count()
    total_sites = db.query(Website).count()
    return {
        "total_jobs": total_jobs,
        "new_jobs": new_jobs,
        "total_sites": total_sites,
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _name_from_url(url: str) -> str:
    from urllib.parse import urlparse
    netloc = urlparse(url).netloc.replace("www.", "")
    parts = netloc.split(".")
    return parts[0].capitalize() if parts else netloc
