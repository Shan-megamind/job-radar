from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from pydantic import BaseModel, ConfigDict
from typing import Optional

from database import Base


# SQLAlchemy ORM Models

class Website(Base):
    __tablename__ = "websites"

    id = Column(Integer, primary_key=True, index=True)
    url = Column(String, unique=True, nullable=False)
    name = Column(String)
    job_selector = Column(String)    # CSS selector for job container elements
    title_selector = Column(String)  # CSS selector for title within each job element
    link_selector = Column(String)   # CSS selector for link within each job element
    keywords = Column(Text)          # JSON-encoded list of filter keywords
    last_checked = Column(DateTime)
    last_status = Column(String, default="pending")  # pending | ok | error
    last_error = Column(Text)
    job_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    jobs = relationship("Job", back_populates="website", cascade="all, delete-orphan")


class Job(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, index=True)
    website_id = Column(Integer, ForeignKey("websites.id"))
    title = Column(String, nullable=False)
    url = Column(String, unique=True, nullable=False)
    company = Column(String)
    location = Column(String)
    posted_at = Column(DateTime, nullable=True)   # actual posting date from the job board API
    first_seen = Column(DateTime, default=datetime.utcnow)
    last_seen = Column(DateTime, default=datetime.utcnow)
    is_active = Column(Boolean, default=True)
    is_new = Column(Boolean, default=True)

    website = relationship("Website", back_populates="jobs")


# Pydantic Schemas

class WebsiteCreate(BaseModel):
    url: str
    name: Optional[str] = None
    job_selector: Optional[str] = None
    title_selector: Optional[str] = None
    link_selector: Optional[str] = None
    keywords: Optional[list[str]] = None


class WebsiteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    url: str
    name: Optional[str]
    last_checked: Optional[datetime]
    last_status: str
    last_error: Optional[str]
    job_count: int
    created_at: datetime


class JobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    website_id: int
    title: str
    url: str
    company: Optional[str]
    location: Optional[str]
    posted_at: Optional[datetime]
    first_seen: datetime
    last_seen: datetime
    is_active: bool
    is_new: bool
    website_name: Optional[str] = None
    website_url: Optional[str] = None
