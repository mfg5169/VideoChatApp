"""Pydantic request/response models for API routes."""

from pydantic import BaseModel


class StartIn(BaseModel):
    role_title: str | None = None


class NextQIn(BaseModel):
    session_id: str


class ChatIn(BaseModel):
    message: str


class SetPanelIn(BaseModel):
    session_id: str
    panel_type: str  # e.g. "hm_only", "hm_plus_1", "hm_plus_2", "recruiter_hm"


class AnswerIn(BaseModel):
    session_id: str
    answer: str


class NextTurnIn(BaseModel):
    session_id: str


class SetJDIn(BaseModel):
    session_id: str
    job_description: str


class MemorySearchIn(BaseModel):
    query: str
    top_k: int = 8


class SetResumeIn(BaseModel):
    session_id: str
    resume_text: str
