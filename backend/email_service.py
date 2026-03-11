import smtplib
import os
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

logger = logging.getLogger(__name__)


def send_new_jobs_email(jobs: list[dict]) -> Optional[str]:
    """
    Send an email notification for new job postings.
    Returns an error string on failure, None on success.
    """
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_password = os.getenv("SMTP_PASSWORD", "")
    notify_email = os.getenv("NOTIFY_EMAIL", smtp_user)

    if not smtp_user or not smtp_password:
        return "Email not configured (SMTP_USER / SMTP_PASSWORD missing)"

    subject = f"Job Radar: {len(jobs)} new role{'s' if len(jobs) != 1 else ''} found"

    html_rows = ""
    for job in jobs:
        company = job.get("company") or "Unknown"
        location = job.get("location") or "—"
        html_rows += f"""
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">
            <a href="{job['url']}" style="color:#2563eb;text-decoration:none;font-weight:500;">
              {job['title']}
            </a>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#555;">{company}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#555;">{location}</td>
        </tr>"""

    html_body = f"""
    <html><body style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:20px;">
      <h2 style="color:#1e293b;">Job Radar — New Openings</h2>
      <p style="color:#475569;">{len(jobs)} new product/PM role{'s' if len(jobs) != 1 else ''} detected:</p>
      <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:10px 12px;text-align:left;color:#64748b;font-size:13px;">Title</th>
            <th style="padding:10px 12px;text-align:left;color:#64748b;font-size:13px;">Company</th>
            <th style="padding:10px 12px;text-align:left;color:#64748b;font-size:13px;">Location</th>
          </tr>
        </thead>
        <tbody>{html_rows}</tbody>
      </table>
      <p style="color:#94a3b8;font-size:12px;margin-top:24px;">Sent by Job Radar</p>
    </body></html>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = smtp_user
    msg["To"] = notify_email
    msg.attach(MIMEText(html_body, "html"))

    try:
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.ehlo()
            server.starttls()
            server.login(smtp_user, smtp_password)
            server.sendmail(smtp_user, notify_email, msg.as_string())
        logger.info("Sent job notification email to %s (%d jobs)", notify_email, len(jobs))
        return None
    except Exception as exc:
        logger.error("Failed to send email: %s", exc)
        return str(exc)
