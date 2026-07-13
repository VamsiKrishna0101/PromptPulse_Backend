from __future__ import annotations

import asyncio
import json
import random
from datetime import datetime, timezone
from pathlib import Path

from .config import RESULTS_DIR, ensure_dirs
from .models import EngineName


class ScraperSafetyError(Exception):
    pass


class DailyLimitReached(ScraperSafetyError):
    pass


class ManualActionNeeded(ScraperSafetyError):
    pass


class RateLimitDetected(ScraperSafetyError):
    pass


ENGINE_POLICY = {
    EngineName.CHATGPT: {
        "daily_limit": 25,
        "min_gap_seconds": 180,
        "batch_delay": (180, 360),
        "retry_delay": (300, 900),
    },
    EngineName.GEMINI: {
        "daily_limit": 40,
        "min_gap_seconds": 120,
        "batch_delay": (120, 300),
        "retry_delay": (240, 720),
    },
    EngineName.PERPLEXITY: {
        "daily_limit": 30,
        "min_gap_seconds": 180,
        "batch_delay": (180, 360),
        "retry_delay": (300, 900),
    },
}


def policy_for(engine: EngineName) -> dict[str, int | tuple[int, int]]:
    return ENGINE_POLICY[engine]


def state_path() -> Path:
    ensure_dirs()
    folder = RESULTS_DIR / "safety"
    folder.mkdir(parents=True, exist_ok=True)
    return folder / "usage_state.json"


def today_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def usage_key(engine: EngineName, profile: str) -> str:
    return f"{today_key()}::{engine.value}::{profile}"


def read_state() -> dict:
    path = state_path()
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_state(state: dict) -> None:
    state_path().write_text(json.dumps(state, indent=2), encoding="utf-8")


async def wait_for_slot(engine: EngineName, profile: str) -> None:
    state = read_state()
    key = usage_key(engine, profile)
    item = state.get(key, {"count": 0, "last_started_at": None})
    policy = policy_for(engine)

    if item["count"] >= policy["daily_limit"]:
        raise DailyLimitReached(f"{engine.value} daily limit reached for profile {profile}.")

    last_started_at = item.get("last_started_at")
    if last_started_at:
        elapsed = datetime.now(timezone.utc).timestamp() - float(last_started_at)
        wait_seconds = int(policy["min_gap_seconds"]) - elapsed
        if wait_seconds > 0:
            await asyncio.sleep(wait_seconds)


def record_started(engine: EngineName, profile: str) -> None:
    state = read_state()
    key = usage_key(engine, profile)
    item = state.get(key, {"count": 0, "last_started_at": None})
    item["count"] = int(item.get("count", 0)) + 1
    item["last_started_at"] = datetime.now(timezone.utc).timestamp()
    state[key] = item
    write_state(state)


async def sleep_between_jobs(engine: EngineName) -> None:
    low, high = policy_for(engine)["batch_delay"]
    await asyncio.sleep(random.randint(int(low), int(high)))


async def sleep_before_retry(engine: EngineName, attempt: int) -> None:
    low, high = policy_for(engine)["retry_delay"]
    base = random.randint(int(low), int(high))
    await asyncio.sleep(base * max(1, attempt))
