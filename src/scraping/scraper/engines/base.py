from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from datetime import datetime
from pathlib import Path

from playwright.async_api import Locator, Page, TimeoutError as PlaywrightTimeoutError

from ..config import ANSWER_IDLE_MS, DEFAULT_TIMEOUT_MS, RESULTS_DIR, ensure_dirs
from ..models import Citation, EngineName, RunStatus, ScrapeResult, as_posix, safe_filename
from ..safety import ManualActionNeeded, RateLimitDetected


class BaseEngineScraper(ABC):
    engine: EngineName
    url: str
    profile_name: str
    model_label: str
    browser_channel: str | None = None
    apply_stealth: bool = True

    def __init__(self, profile_name: str | None = None) -> None:
        self.profile_name = profile_name or f"{self.engine.value}_default"

    @abstractmethod
    async def submit_prompt(self, page: Page, prompt: str) -> None:
        ...

    @abstractmethod
    async def answer_locator(self, page: Page) -> Locator:
        ...

    async def scrape(self, page: Page, prompt: str) -> ScrapeResult:
        screenshot_path: Path | None = None
        try:
            await page.goto(self.url, wait_until="domcontentloaded", timeout=60000)
            await self.detect_manual_needed(page)
            await self.submit_prompt(page, prompt)
            await self.wait_for_answer(page)

            locator = await self.answer_locator(page)
            answer_text = (await locator.inner_text(timeout=30000)).strip()
            citations = await self.extract_citations(page, locator)
            screenshot_path = await self.save_screenshot(page, prompt)

            if not answer_text:
                return self.result(
                    prompt,
                    RunStatus.FAILED,
                    screenshot_path=screenshot_path,
                    error_reason="Answer finished but no answer text was found.",
                )

            return self.result(
                prompt,
                RunStatus.SUCCESS,
                answer_text=answer_text,
                citations=citations,
                screenshot_path=screenshot_path,
                raw_text=await page.locator("body").inner_text(timeout=10000),
            )
        except PlaywrightTimeoutError as exc:
            screenshot_path = await self.try_screenshot(page, prompt)
            return self.result(
                prompt,
                RunStatus.MANUAL_NEEDED,
                screenshot_path=screenshot_path,
                error_reason=f"Timeout waiting for UI element: {exc}",
            )
        except Exception as exc:
            screenshot_path = await self.try_screenshot(page, prompt)
            status = RunStatus.FAILED
            if isinstance(exc, ManualActionNeeded):
                status = RunStatus.MANUAL_NEEDED
            if isinstance(exc, RateLimitDetected):
                status = RunStatus.RATE_LIMITED
            return self.result(
                prompt,
                status,
                screenshot_path=screenshot_path,
                error_reason=f"{type(exc).__name__}: {exc}",
            )

    async def detect_manual_needed(self, page: Page) -> None:
        body_text = (await page.locator("body").inner_text(timeout=30000)).lower()
        rate_limit_blockers = [
            "too many requests",
            "rate limit",
            "temporarily unavailable",
            "try again later",
        ]
        manual_blockers = [
            "verify you are human",
            "unusual activity",
            "sign in",
            "log in",
            "captcha",
            "couldn't sign you in",
            "sign up below",
            "continue with google",
        ]
        if any(blocker in body_text for blocker in rate_limit_blockers):
            raise RateLimitDetected("Platform rate limit or temporary block detected.")
        if any(blocker in body_text for blocker in manual_blockers):
            raise ManualActionNeeded("Login, captcha, verification, or signup wall detected.")

    async def wait_for_answer(self, page: Page) -> None:
        previous = ""
        stable_since = datetime.now()
        deadline = asyncio.get_event_loop().time() + DEFAULT_TIMEOUT_MS / 1000

        while asyncio.get_event_loop().time() < deadline:
            locator = await self.answer_locator(page)
            text = ""
            if await locator.count() > 0:
                text = (await locator.inner_text(timeout=5000)).strip()

            if len(text) >= 20 and text == previous:
                stable_ms = (datetime.now() - stable_since).total_seconds() * 1000
                if stable_ms >= ANSWER_IDLE_MS:
                    return
            else:
                previous = text
                stable_since = datetime.now()

            await page.wait_for_timeout(1000)

        raise PlaywrightTimeoutError("Timed out waiting for answer to become stable.")

    async def first_visible(self, page: Page, selectors: list[str], timeout_ms: int = 30000) -> Locator:
        deadline = asyncio.get_event_loop().time() + timeout_ms / 1000
        last_error: Exception | None = None
        while asyncio.get_event_loop().time() < deadline:
            for selector in selectors:
                locator = page.locator(selector).first
                try:
                    if await locator.count() and await locator.is_visible(timeout=1000):
                        return locator
                except Exception as exc:
                    last_error = exc
            await page.wait_for_timeout(500)
        raise PlaywrightTimeoutError(f"No visible selector matched {selectors}: {last_error}")

    async def extract_citations(self, page: Page, locator: Locator) -> list[Citation]:
        citations: list[Citation] = []
        links = locator.locator("a[href]")
        for index in range(await links.count()):
            link = links.nth(index)
            href = await link.get_attribute("href")
            if href and href.startswith("http"):
                text = (await link.inner_text(timeout=5000)).strip()
                if not any(item.url == href for item in citations):
                    citations.append(Citation(text=text, url=href))
        return citations

    async def save_screenshot(self, page: Page, prompt: str) -> Path:
        ensure_dirs()
        folder = RESULTS_DIR / "screenshots" / self.engine.value
        folder.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        path = folder / f"{stamp}-{safe_filename(prompt)}.png"
        await page.screenshot(path=str(path), full_page=True)
        return path

    async def try_screenshot(self, page: Page, prompt: str) -> Path | None:
        try:
            return await self.save_screenshot(page, prompt)
        except Exception:
            return None

    def result(
        self,
        prompt: str,
        status: RunStatus,
        *,
        answer_text: str = "",
        citations: list[Citation] | None = None,
        screenshot_path: Path | None = None,
        raw_text: str | None = None,
        error_reason: str | None = None,
        retry_count: int = 0,
    ) -> ScrapeResult:
        return ScrapeResult(
            engine=self.engine,
            prompt=prompt,
            status=status,
            answer_text=answer_text,
            citations=citations or [],
            screenshot_path=as_posix(screenshot_path) if screenshot_path else None,
            model_label=self.model_label,
            raw_text=raw_text,
            error_reason=error_reason,
            retry_count=retry_count,
        )
