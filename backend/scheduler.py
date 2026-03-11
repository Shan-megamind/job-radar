import hashlib
import json
import logging
import os
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session

from database import SessionLocal
from models import Job, Website
from scraper import scrape_website
from email_service import send_new_jobs_email

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None
_job_id = "check_all_websites"


def _make_job_hash(title: str, url: str) -> str:
    return hashlib.sha256(f"{title.lower().strip()}|{url.strip()}".encode()).hexdigest()[:32]


def check_all_websites() -> dict:
    """Scrape every active website, persist new jobs, email if new ones found."""
    db: Session = SessionLocal()
    try:
        websites = db.query(Website).all()
        total_new = 0
        all_new_jobs: list[dict] = []

        for site in websites:
            keywords: list[str] | None = None
            if site.keywords:
                try:
                    keywords = json.loads(site.keywords)
                except Exception:
                    pass

            jobs_found, error = scrape_website(
                site.url,
                job_selector=site.job_selector,
                title_selector=site.title_selector,
                link_selector=site.link_selector,
                keywords=keywords,
            )

            now = datetime.now(timezone.utc).replace(tzinfo=None)
            site.last_checked = now

            if error:
                site.last_status = "error"
                site.last_error = error
                logger.warning("Error scraping %s: %s", site.url, error)
                db.commit()
                continue

            site.last_status = "ok"
            site.last_error = None

            new_this_site: list[dict] = []
            for j in jobs_found:
                job_hash = _make_job_hash(j["title"], j["url"])
                existing = db.query(Job).filter(Job.url == j["url"]).first()
                if existing:
                    existing.last_seen = now
                    existing.is_active = True
                else:
                    new_job = Job(
                        website_id=site.id,
                        title=j["title"],
                        url=j["url"],
                        company=j.get("company") or site.name,
                        location=j.get("location"),
                        posted_at=j.get("posted_at"),
                        first_seen=now,
                        last_seen=now,
                        is_new=True,
                        is_active=True,
                    )
                    db.add(new_job)
                    new_this_site.append(j)

            site.job_count = len(jobs_found)
            total_new += len(new_this_site)
            all_new_jobs.extend(new_this_site)
            db.commit()

        if all_new_jobs:
            email_error = send_new_jobs_email(all_new_jobs)
            if email_error:
                logger.warning("Email send failed: %s", email_error)

        logger.info("Check complete — %d new jobs across %d sites", total_new, len(websites))
        return {"checked": len(websites), "new_jobs": total_new}

    finally:
        db.close()


def start_scheduler(interval_hours: float | None = None) -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        return

    hours = interval_hours or float(os.getenv("CHECK_INTERVAL_HOURS", "6"))
    _scheduler = BackgroundScheduler()
    _scheduler.add_job(
        check_all_websites,
        trigger="interval",
        hours=hours,
        id=_job_id,
        replace_existing=True,
        next_run_time=None,  # don't run immediately on startup
    )
    _scheduler.start()
    logger.info("Scheduler started — checking every %.1f hours", hours)


def update_schedule(interval_hours: float) -> None:
    """Reschedule the job with a new interval."""
    global _scheduler
    if not _scheduler or not _scheduler.running:
        start_scheduler(interval_hours)
        return
    _scheduler.reschedule_job(
        _job_id,
        trigger="interval",
        hours=interval_hours,
    )
    logger.info("Scheduler updated — now checking every %.1f hours", interval_hours)


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
