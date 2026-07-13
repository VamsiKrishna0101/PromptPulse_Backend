from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from playwright.async_api import BrowserContext, Page, async_playwright
from playwright_stealth import Stealth

from .config import (
    HEADLESS,
    LOCALE,
    PROFILE_DIR,
    SLOW_MO_MS,
    TIMEZONE_ID,
    USER_AGENT,
    ensure_dirs,
)


COMMON_ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars",
    "--disable-dev-shm-usage",
    "--no-sandbox",
]


def profile_path(profile_name: str) -> Path:
    ensure_dirs()
    return PROFILE_DIR / profile_name


@asynccontextmanager
async def persistent_context(
    profile_name: str,
    *,
    headless: bool | None = None,
    browser_channel: str | None = None,
) -> AsyncIterator[BrowserContext]:
    ensure_dirs()
    launch_options = {
        "user_data_dir": str(profile_path(profile_name)),
        "headless": HEADLESS if headless is None else headless,
        "slow_mo": SLOW_MO_MS,
        "args": COMMON_ARGS,
        "user_agent": USER_AGENT,
        "viewport": {"width": 1365, "height": 900},
        "locale": LOCALE,
        "timezone_id": TIMEZONE_ID,
    }
    if browser_channel:
        launch_options["channel"] = browser_channel

    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(**launch_options)
        try:
            yield context
        finally:
            await context.close()


async def new_stealth_page(context: BrowserContext, *, apply_stealth: bool = True) -> Page:
    page = await context.new_page()
    if apply_stealth:
        await Stealth().apply_stealth_async(page)
    page.set_default_timeout(30000)
    return page
