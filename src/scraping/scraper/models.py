from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field


class EngineName(StrEnum):
    CHATGPT = "chatgpt"
    GEMINI = "gemini"
    PERPLEXITY = "perplexity"


class RunStatus(StrEnum):
    SUCCESS = "success"
    FAILED = "failed"
    MANUAL_NEEDED = "manual_needed"
    RATE_LIMITED = "rate_limited"


class ScrapeJob(BaseModel):
    prompt: str
    engine: EngineName
    brand: str | None = None
    competitors: list[str] = Field(default_factory=list)
    profile: str | None = None
    max_retries: int = 2


class Citation(BaseModel):
    text: str = ""
    url: str


class ScrapeResult(BaseModel):
    engine: EngineName
    prompt: str
    status: RunStatus
    answer_text: str = ""
    citations: list[Citation] = Field(default_factory=list)
    screenshot_path: str | None = None
    model_label: str | None = None
    error_reason: str | None = None
    raw_text: str | None = None
    retry_count: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    def to_legacy_response(self) -> dict[str, Any]:
        return {
            "raw_response": self.answer_text,
            "sources": [citation.model_dump() for citation in self.citations],
            "ai_model": self.model_label or self.engine.value,
            "status": self.status.value,
            "screenshot_path": self.screenshot_path,
            "error_reason": self.error_reason,
            "retry_count": self.retry_count,
        }


class BatchRequest(BaseModel):
    prompts: list[str]
    engines: list[EngineName] = Field(
        default_factory=lambda: [
            EngineName.CHATGPT,
            EngineName.GEMINI,
            EngineName.PERPLEXITY,
        ]
    )
    brand: str | None = None
    competitors: list[str] = Field(default_factory=list)
    profile: str | None = None
    max_retries: int = 2


def safe_filename(value: str, max_len: int = 80) -> str:
    cleaned = "".join(ch if ch.isalnum() else "-" for ch in value.lower())
    cleaned = "-".join(part for part in cleaned.split("-") if part)
    return (cleaned[:max_len] or "run").strip("-")


def as_posix(path: Path) -> str:
    return path.resolve().as_posix()
