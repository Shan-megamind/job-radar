import logging
import re
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timezone
from urllib.parse import urlparse, urljoin, parse_qs
from typing import Optional

logger = logging.getLogger(__name__)

# Intern / early-career keywords — checked first so they're easy to identify
INTERN_KEYWORDS = [
    "product manager intern",
    "pm intern",
    "product intern",
    "associate product manager",
    "apm intern",
    "apm program",
    "rotational product manager",
    "rpm program",
    "rpm intern",
    # standalone abbreviations — \b boundaries prevent false positives
    "apm",
    "rpm",
]

DEFAULT_KEYWORDS = [
    # Intern / early-career (must come before generic "product manager" so
    # INTERN_KEYWORDS matches remain a strict subset of DEFAULT_KEYWORDS)
    *INTERN_KEYWORDS,
    # Mid / senior IC
    "product manager",
    "product management",
    "program manager",
    "product lead",
    "head of product",
    "vp of product",
    "vp product",
    "director of product",
    "product owner",
    "chief product",
    "associate pm",
    "senior pm",
    "principal pm",
    "staff pm",
    "group pm",
    "technical pm",
    "product marketing manager",
]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}


# ── Date helpers ─────────────────────────────────────────────────────────────

def _parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def _parse_ms_epoch(ms: int | None) -> datetime | None:
    if not ms:
        return None
    try:
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).replace(tzinfo=None)
    except Exception:
        return None


# ── Keyword helpers ───────────────────────────────────────────────────────────

def _matches_keywords(text: str, keywords: list[str]) -> bool:
    low = text.lower()
    return any(re.search(r'\b' + re.escape(kw) + r'\b', low) for kw in keywords)


def _absolute_url(href: str, base_url: str) -> str:
    return urljoin(base_url, href)


def _company_from_url(url: str) -> str:
    netloc = urlparse(url).netloc.replace("www.", "")
    parts = netloc.split(".")
    return parts[0].capitalize() if parts else netloc


# ── Board detection ───────────────────────────────────────────────────────────

def _greenhouse_slug(url: str) -> str | None:
    parsed = urlparse(url)
    # Must be boards.greenhouse.io, not www.greenhouse.io (marketing site)
    if parsed.netloc not in ("boards.greenhouse.io", "boards.eu.greenhouse.io"):
        return None
    path = parsed.path.strip("/")
    # boards.greenhouse.io/COMPANY  or  .../embed/job_board?for=COMPANY
    if path and path not in ("embed/job_board",):
        return path.split("/")[0]
    params = parse_qs(parsed.query)
    if "for" in params:
        return params["for"][0]
    return None


def _ashby_slug(url: str) -> str | None:
    parsed = urlparse(url)
    if "ashbyhq.com" not in parsed.netloc:
        return None
    path = parsed.path.strip("/")
    return path.split("/")[0] if path else None


def _lever_slug(url: str) -> str | None:
    parsed = urlparse(url)
    if parsed.netloc != "jobs.lever.co":
        return None
    path = parsed.path.strip("/")
    return path.split("/")[0] if path else None


# ── Greenhouse API ────────────────────────────────────────────────────────────

def _scrape_greenhouse(slug: str, keywords: list[str]) -> tuple[list[dict], Optional[str]]:
    api_url = f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs"
    logger.info("[greenhouse] slug=%r  GET %s", slug, api_url)
    try:
        resp = requests.get(api_url, timeout=30)
        logger.info("[greenhouse] HTTP %s", resp.status_code)
        resp.raise_for_status()
        data = resp.json()
    except requests.HTTPError as exc:
        body = exc.response.text[:300] if exc.response is not None else ""
        err = f"Greenhouse API HTTP {exc.response.status_code}: {body}"
        logger.error("[greenhouse] %s", err)
        return [], err
    except Exception as exc:
        logger.error("[greenhouse] request failed: %s", exc)
        return [], f"Greenhouse API error: {exc}"

    total = len(data.get("jobs", []))
    jobs = []
    for job in data.get("jobs", []):
        title = job.get("title", "")
        if not _matches_keywords(title, keywords):
            continue
        jobs.append({
            "title": title,
            "url": job.get("absolute_url", ""),
            "company": slug.capitalize(),
            "location": (job.get("location") or {}).get("name"),
            "posted_at": _parse_iso(job.get("updated_at")),
        })
    logger.info("[greenhouse] %d total jobs, %d matched keywords", total, len(jobs))
    return jobs, None


# ── Lever API ────────────────────────────────────────────────────────────────

def _scrape_lever(slug: str, keywords: list[str]) -> tuple[list[dict], Optional[str]]:
    api_url = f"https://api.lever.co/v0/postings/{slug}?mode=json"
    logger.info("[lever] slug=%r  GET %s", slug, api_url)
    try:
        resp = requests.get(api_url, timeout=30)
        logger.info("[lever] HTTP %s", resp.status_code)
        resp.raise_for_status()
        data = resp.json()
    except requests.HTTPError as exc:
        body = exc.response.text[:300] if exc.response is not None else ""
        err = f"Lever API HTTP {exc.response.status_code}: {body}"
        logger.error("[lever] %s", err)
        return [], err
    except Exception as exc:
        logger.error("[lever] request failed: %s", exc)
        return [], f"Lever API error: {exc}"

    total = len(data)
    jobs = []
    for job in data:
        title = job.get("text", "")
        if not _matches_keywords(title, keywords):
            continue
        jobs.append({
            "title": title,
            "url": job.get("hostedUrl", ""),
            "company": slug.capitalize(),
            "location": (job.get("categories") or {}).get("location"),
            "posted_at": _parse_ms_epoch(job.get("createdAt")),
        })
    logger.info("[lever] %d total jobs, %d matched keywords", total, len(jobs))
    return jobs, None


# ── Ashby API ─────────────────────────────────────────────────────────────────

def _scrape_ashby(slug: str, keywords: list[str]) -> tuple[list[dict], Optional[str]]:
    api_url = f"https://api.ashbyhq.com/posting-api/job-board/{slug}"
    logger.info("[ashby] slug=%r  GET %s", slug, api_url)
    try:
        resp = requests.get(api_url, timeout=30)
        logger.info("[ashby] HTTP %s", resp.status_code)
        resp.raise_for_status()
        data = resp.json()
    except requests.HTTPError as exc:
        body = exc.response.text[:300] if exc.response is not None else ""
        err = f"Ashby API HTTP {exc.response.status_code}: {body}"
        logger.error("[ashby] %s", err)
        return [], err
    except Exception as exc:
        logger.error("[ashby] request failed: %s", exc)
        return [], f"Ashby API error: {exc}"

    total = len(data.get("jobPostings", []))
    jobs = []
    for job in data.get("jobPostings", []):
        title = job.get("title", "")
        if not _matches_keywords(title, keywords):
            continue
        jobs.append({
            "title": title,
            "url": job.get("jobUrl", ""),
            "company": slug.capitalize(),
            "location": job.get("location"),
            "posted_at": _parse_iso(job.get("publishedAt")),
        })
    logger.info("[ashby] %d total jobs, %d matched keywords", total, len(jobs))
    return jobs, None


# ── Work at a Startup (YC) ────────────────────────────────────────────────────

def _scrape_workatastartup(url: str, keywords: list[str]) -> tuple[list[dict], Optional[str]]:
    """Playwright scraper for workatastartup.com/jobs."""
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
    except ImportError:
        return [], "Playwright not installed. Run: pip install playwright && playwright install chromium"

    logger.info("[waas] Loading %s with Playwright", url)
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page = browser.new_page(user_agent=HEADERS["User-Agent"])
            page.goto(url, wait_until="networkidle", timeout=45_000)
            # Wait for at least one job link to appear
            try:
                page.wait_for_selector("a[href*='/jobs/']", timeout=15_000)
            except PWTimeout:
                logger.warning("[waas] Timed out waiting for job links — parsing whatever rendered")
            html = page.content()
            browser.close()
    except PWTimeout:
        return [], f"Playwright timed out loading {url}"
    except Exception as exc:
        return [], f"Playwright error: {exc}"

    soup = BeautifulSoup(html, "lxml")
    jobs: list[dict] = []
    seen_urls: set[str] = set()

    # Job links on WaaS follow the pattern /jobs/<id>
    job_link_re = re.compile(r'^/jobs/\d+')
    company_link_re = re.compile(r'/companies/')
    location_text_re = re.compile(
        r'Remote|New York|San Francisco|Los Angeles|Seattle|Austin|Boston|Chicago|London|NYC|SF',
        re.I,
    )

    for a in soup.find_all("a", href=job_link_re):
        title = a.get_text(strip=True)
        if not title or len(title) > 200:
            continue
        if not _matches_keywords(title, keywords):
            continue

        href = "https://www.workatastartup.com" + a["href"].split("?")[0]
        if href in seen_urls:
            continue
        seen_urls.add(href)

        # Walk up the DOM up to 8 levels to find the card container,
        # identified by the presence of a /companies/ link.
        company: str | None = None
        location: str | None = None
        card = a.parent
        for _ in range(8):
            if card is None:
                break
            company_a = card.find("a", href=company_link_re)
            if company_a:
                company = company_a.get_text(strip=True) or None
                # Search the same card for a location hint
                for el in card.find_all(["span", "div"]):
                    text = el.get_text(strip=True)
                    if text and location_text_re.search(text) and len(text) < 60:
                        location = text
                        break
                break
            card = card.parent

        jobs.append({
            "title": title,
            "url": href,
            "company": company,
            "location": location,
            "posted_at": None,
        })

    logger.info("[waas] %d matching jobs parsed", len(jobs))
    return jobs, None


# ── Playwright fallback ───────────────────────────────────────────────────────

def _scrape_playwright(url: str, keywords: list[str]) -> tuple[list[dict], Optional[str]]:
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
    except ImportError:
        return [], "Playwright not installed. Run: pip install playwright && playwright install chromium"

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page = browser.new_page(user_agent=HEADERS["User-Agent"])
            page.goto(url, wait_until="networkidle", timeout=30_000)
            html = page.content()
            browser.close()
    except PWTimeout:
        return [], f"Playwright timed out loading {url}"
    except Exception as exc:
        return [], f"Playwright error: {exc}"

    soup = BeautifulSoup(html, "lxml")
    jobs = _extract_auto(soup, url, keywords)
    logger.debug("Playwright (%s): %d matching jobs", url, len(jobs))
    return jobs, None


# ── Generic BS4 extraction (used after Playwright renders the page) ───────────

# (container_selector, title_selector, link_selector)
KNOWN_BOARD_SELECTORS = [
    (".opening", "a", None),
    (".posting-title", "h5", "a"),
    (".posting", "h5", "a"),
    ("[data-automation-id='compositeContainer']", None, "a"),
    (".ResumatorJobListing", "a", None),
    (".job-listing", "a", None),
    (".job-posting", "a", None),
    (".job-item", "a", None),
    (".careers-item", "a", None),
    (".position-listing", "a", None),
    ("li.open-position", "a", None),
    ("[class*='JobRow']", "a", None),
    ("[class*='job-row']", "a", None),
]


def _extract_with_selectors(
    soup: BeautifulSoup,
    base_url: str,
    job_sel: str,
    title_sel: Optional[str],
    link_sel: Optional[str],
    keywords: list[str],
) -> list[dict]:
    jobs = []
    for item in soup.select(job_sel):
        title_el = item.select_one(title_sel) if title_sel else item
        link_el = item.select_one(link_sel) if link_sel else (
            item if item.name == "a" else item.select_one("a")
        )
        title = title_el.get_text(strip=True) if title_el else ""
        href = link_el.get("href", "") if link_el else ""
        if not title or not href:
            continue
        if not _matches_keywords(title, keywords):
            continue
        jobs.append({
            "title": title[:300],
            "url": _absolute_url(href, base_url),
            "company": _company_from_url(base_url),
            "location": None,
        })
    return jobs


def _extract_auto(soup: BeautifulSoup, base_url: str, keywords: list[str]) -> list[dict]:
    for container_sel, title_sel, link_sel in KNOWN_BOARD_SELECTORS:
        if not soup.select(container_sel):
            continue
        candidates = _extract_with_selectors(soup, base_url, container_sel, title_sel, link_sel, keywords)
        if candidates:
            logger.debug("Matched selector '%s' at %s", container_sel, base_url)
            return candidates

    # Fallback: scan all anchor tags
    jobs = []
    for a in soup.find_all("a", href=True):
        text = a.get_text(strip=True)
        if len(text) < 4 or len(text) > 250:
            continue
        if not _matches_keywords(text, keywords):
            continue
        href = _absolute_url(a["href"], base_url)
        if not href.startswith("http"):
            continue
        jobs.append({
            "title": text,
            "url": href,
            "company": _company_from_url(base_url),
            "location": None,
        })
    return jobs


# ── Public entry point ────────────────────────────────────────────────────────

def scrape_website(
    url: str,
    job_selector: Optional[str] = None,
    title_selector: Optional[str] = None,
    link_selector: Optional[str] = None,
    keywords: Optional[list[str]] = None,
) -> tuple[list[dict], Optional[str]]:
    """
    Scrape *url* for PM/product job listings.

    Resolution order:
      1. Greenhouse public API      (boards.greenhouse.io/*)
      2. Lever public API           (jobs.lever.co/*)
      3. Ashby public API           (jobs.ashbyhq.com/*)
      4. Work at a Startup scraper  (workatastartup.com/*)
      5. Playwright headless browser (everything else)

    Returns (jobs, error_message). error_message is None on success.
    """
    kws = keywords if keywords else DEFAULT_KEYWORDS

    gh_slug = _greenhouse_slug(url)
    ashby_slug = _ashby_slug(url)
    lever_slug = _lever_slug(url)
    is_waas = "workatastartup.com" in urlparse(url).netloc
    logger.info("[scrape] url=%r  greenhouse=%r  lever=%r  ashby=%r  waas=%s",
                url, gh_slug, lever_slug, ashby_slug, is_waas)

    if gh_slug:
        jobs, err = _scrape_greenhouse(gh_slug, kws)
    elif lever_slug:
        jobs, err = _scrape_lever(lever_slug, kws)
    elif ashby_slug:
        jobs, err = _scrape_ashby(ashby_slug, kws)
    elif is_waas:
        jobs, err = _scrape_workatastartup(url, kws)
    else:
        logger.info("[scrape] falling back to Playwright for %s", url)
        if job_selector:
            # Playwright-render then apply custom selectors
            jobs_raw, err = _scrape_playwright(url, kws)
            if err:
                return [], err
            # Re-parse rendered HTML with custom selectors is handled inside
            # _scrape_playwright already; custom selectors are a bonus pass.
            jobs = jobs_raw
        else:
            jobs, err = _scrape_playwright(url, kws)

    if err:
        return [], err

    # Deduplicate by URL
    seen: set[str] = set()
    unique = []
    for job in jobs:
        if job["url"] and job["url"] not in seen:
            seen.add(job["url"])
            unique.append(job)

    return unique, None
