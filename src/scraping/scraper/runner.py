from __future__ import annotations

import asyncio
import json
import random
from datetime import datetime
from pathlib import Path

from .browser import new_stealth_page, persistent_context
from .config import RESULTS_DIR, ensure_dirs
from .engines import ChatGPTScraper, GeminiScraper, PerplexityScraper
from .engines.base import BaseEngineScraper
from .models import BatchRequest, EngineName, RunStatus, ScrapeJob, ScrapeResult, as_posix, safe_filename
from .safety import DailyLimitReached, record_started, sleep_before_retry, sleep_between_jobs, wait_for_slot


SCRAPER_CLASSES: dict[EngineName, type[BaseEngineScraper]] = {
    EngineName.CHATGPT: ChatGPTScraper,
    EngineName.GEMINI: GeminiScraper,
    EngineName.PERPLEXITY: PerplexityScraper,
}


def build_scraper(engine: EngineName, profile: str | None = None) -> BaseEngineScraper:
    return SCRAPER_CLASSES[engine](profile_name=profile)


async def run_job(job: ScrapeJob) -> ScrapeResult:
    scraper = build_scraper(job.engine, job.profile)
    await wait_for_slot(job.engine, scraper.profile_name)

    last_result: ScrapeResult | None = None
    for attempt in range(job.max_retries + 1):
        record_started(job.engine, scraper.profile_name)
        async with persistent_context(scraper.profile_name, browser_channel=scraper.browser_channel) as context:
            page = await new_stealth_page(context, apply_stealth=scraper.apply_stealth)
            result = await scraper.scrape(page, job.prompt)
            result.retry_count = attempt
            last_result = result

        if result.status == RunStatus.SUCCESS:
            return result

        if result.status in {RunStatus.MANUAL_NEEDED, RunStatus.RATE_LIMITED}:
            return result

        if attempt < job.max_retries:
            await sleep_before_retry(job.engine, attempt + 1)

    return last_result if last_result else ScrapeResult(
        engine=job.engine,
        prompt=job.prompt,
        status=RunStatus.FAILED,
        error_reason="Job failed before scraper returned a result.",
    )


async def run_batch(
    request: BatchRequest,
    *,
    min_delay_seconds: int = 30,
    max_delay_seconds: int = 90,
) -> list[ScrapeResult]:
    results: list[ScrapeResult] = []
    jobs = [
        ScrapeJob(
            prompt=prompt,
            engine=engine,
            brand=request.brand,
            competitors=request.competitors,
            profile=request.profile,
            max_retries=request.max_retries,
        )
        for prompt in request.prompts
        for engine in request.engines
    ]

    for index, job in enumerate(jobs):
        try:
            results.append(await run_job(job))
        except DailyLimitReached as exc:
            results.append(ScrapeResult(
                engine=job.engine,
                prompt=job.prompt,
                status=RunStatus.RATE_LIMITED,
                error_reason=str(exc),
            ))
        if index < len(jobs) - 1:
            await asyncio.sleep(random.randint(min_delay_seconds, max_delay_seconds))
            await sleep_between_jobs(job.engine)

    save_results(results)
    return results


def save_results(results: list[ScrapeResult]) -> Path:
    ensure_dirs()
    folder = RESULTS_DIR / "runs"
    folder.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    label = safe_filename(results[0].prompt if results else "empty")
    path = folder / f"{stamp}-{label}.json"
    payload = [result.model_dump(mode="json") for result in results]
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path


def result_path_for_display(path: Path) -> str:
    return as_posix(path)
