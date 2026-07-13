"""
Open a persistent browser profile and log in manually.

Usage:
    src\\scraping\\venv\\Scripts\\python src\\scraping\\login.py --engine chatgpt
    src\\scraping\\venv\\Scripts\\python src\\scraping\\login.py --engine gemini
    src\\scraping\\venv\\Scripts\\python src\\scraping\\login.py --engine perplexity

The browser profile is saved under src/scraping/browser_profiles/<engine>_default.
Future scraper runs reuse that logged-in session.
"""
from __future__ import annotations

import argparse
import asyncio
import subprocess
from pathlib import Path

from scraper.browser import new_stealth_page, persistent_context, profile_path
from scraper.engines import ChatGPTScraper, GeminiScraper, PerplexityScraper
from scraper.models import EngineName


URLS = {
    EngineName.CHATGPT: ChatGPTScraper.url,
    EngineName.GEMINI: GeminiScraper.url,
    EngineName.PERPLEXITY: PerplexityScraper.url,
}

CHROME_PATHS = [
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Log in to an AI engine and persist the browser profile.")
    parser.add_argument("--engine", choices=[engine.value for engine in EngineName], required=True)
    parser.add_argument("--profile", default=None, help="Optional custom profile name.")
    return parser.parse_args()


async def save_login() -> None:
    args = parse_args()
    engine = EngineName(args.engine)
    profile_name = args.profile or f"{engine.value}_default"

    print(f"Opening {engine.value} with profile: {profile_name}")
    print("Log in manually in the browser. When the chat page is usable, come back here and press ENTER.")

    if engine in {EngineName.GEMINI, EngineName.PERPLEXITY}:
        chrome_path = next((path for path in CHROME_PATHS if path.exists()), None)
        if not chrome_path:
            raise RuntimeError("Google Chrome was not found. Install Chrome or use ChatGPT login first.")

        user_data_dir = profile_path(profile_name)
        user_data_dir.mkdir(parents=True, exist_ok=True)
        process = subprocess.Popen(
            [
                str(chrome_path),
                f"--user-data-dir={user_data_dir}",
                "--no-first-run",
                "--no-default-browser-check",
                URLS[engine],
            ]
        )
        input(f">>> Close the {engine.value} Chrome window after login is complete, then press ENTER here... ")
        if process.poll() is None:
            print("Chrome is still open. Please close it manually so the profile is flushed to disk.")
            input(">>> Press ENTER after closing Chrome... ")
        print(f"Profile saved: src/scraping/browser_profiles/{profile_name}")
        return

    scraper = ChatGPTScraper()

    async with persistent_context(profile_name, headless=False, browser_channel=scraper.browser_channel) as context:
        page = await new_stealth_page(context, apply_stealth=scraper.apply_stealth)
        await page.goto(URLS[engine], wait_until="domcontentloaded", timeout=60000)
        input(">>> Press ENTER after login is complete... ")
        print(f"Profile saved: src/scraping/browser_profiles/{profile_name}")


if __name__ == "__main__":
    asyncio.run(save_login())
