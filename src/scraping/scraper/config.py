from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv


ROOT_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = ROOT_DIR.parents[1]

load_dotenv(PROJECT_DIR / ".env")

PROFILE_DIR = Path(os.getenv("SCRAPER_PROFILE_DIR", ROOT_DIR / "browser_profiles"))
RESULTS_DIR = Path(os.getenv("SCRAPER_RESULTS_DIR", ROOT_DIR / "results"))

HEADLESS = os.getenv("SCRAPER_HEADLESS", "false").lower() == "true"
SLOW_MO_MS = int(os.getenv("SCRAPER_SLOW_MO_MS", "250"))
DEFAULT_TIMEOUT_MS = int(os.getenv("SCRAPER_TIMEOUT_MS", "120000"))
ANSWER_IDLE_MS = int(os.getenv("SCRAPER_ANSWER_IDLE_MS", "5000"))

LOCALE = os.getenv("SCRAPER_LOCALE", "en-IN")
TIMEZONE_ID = os.getenv("SCRAPER_TIMEZONE_ID", "Asia/Kolkata")
USER_AGENT = os.getenv(
    "SCRAPER_USER_AGENT",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36",
)


def ensure_dirs() -> None:
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

