# Job Radar 📡

Automatically monitors career pages for product/PM job openings and sends email alerts when new roles appear.

## Features

- Scrapes any career page URL for product/PM roles (Greenhouse, Lever, Ashby, and generic pages)
- Runs on a configurable schedule (default: every 6 hours)
- Detects new postings by comparing against previously seen jobs
- Sends HTML email notifications via Gmail SMTP
- React dashboard to browse jobs, manage sites, and trigger manual checks

## Project structure

```
job-radar/
├── backend/
│   ├── main.py           # FastAPI app + REST API
│   ├── database.py       # SQLAlchemy engine + session
│   ├── models.py         # ORM models + Pydantic schemas
│   ├── scraper.py        # BeautifulSoup scraping logic
│   ├── scheduler.py      # APScheduler + job-check logic
│   ├── email_service.py  # Gmail SMTP notifications
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── api.js
│   │   └── components/
│   │       ├── Dashboard.jsx
│   │       ├── WebsiteManager.jsx
│   │       └── Settings.jsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── .env.example
└── README.md
```

## Setup

### 1. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Copy and fill in credentials:

```bash
cp ../.env.example .env
# edit .env — add SMTP_USER and SMTP_PASSWORD
```

> **Gmail App Password**: Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), generate a 16-character app password, and paste it as `SMTP_PASSWORD`. 2-Step Verification must be enabled on the account.

Start the API server:

```bash
uvicorn main:app --reload --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

---

## Usage

1. **Add websites** — Go to the *Websites* tab and paste any career page URL (e.g. `https://boards.greenhouse.io/acmecorp`).
2. **Check now** — Click the *Check now* button on the Dashboard to immediately scrape all sites.
3. **Automatic checks** — The scheduler runs every 6 hours (configurable in *Settings*).
4. **Email alerts** — When new roles are detected you'll receive an HTML email listing them.
5. **Custom selectors** — If auto-detection misses jobs, expand *Advanced* when adding a site and provide CSS selectors for the job containers.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/jobs` | List all jobs (`?is_new=true` to filter) |
| GET | `/api/websites` | List monitored websites |
| POST | `/api/websites` | Add a website |
| DELETE | `/api/websites/{id}` | Remove a website |
| POST | `/api/check-now` | Trigger immediate scrape |
| GET | `/api/settings` | Get current settings |
| PUT | `/api/settings` | Update interval / notify email |
| GET | `/api/stats` | Job + site counts |

## Supported job boards (auto-detected)

- **Greenhouse** (`boards.greenhouse.io`)
- **Lever** (`jobs.lever.co`)
- **Workday** (`myworkdayjobs.com`)
- **BambooHR** career pages
- **Generic** pages — falls back to scanning all links for PM/product keywords

## Default keywords

The scraper looks for titles containing (case-insensitive):

`product manager`, `product management`, `program manager`, `product lead`, `head of product`, `vp of product`, `director of product`, `product owner`, `chief product`, `associate pm`, `senior pm`, `principal pm`, `staff pm`, `group pm`, `technical pm`, `product marketing manager`

You can override keywords per-site via the *Advanced* panel or the API.
