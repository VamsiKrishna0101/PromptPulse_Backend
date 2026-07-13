from __future__ import annotations

from playwright.async_api import Locator, Page

from ..models import EngineName
from .base import BaseEngineScraper


class GeminiScraper(BaseEngineScraper):
    engine = EngineName.GEMINI
    url = "https://gemini.google.com/app"
    model_label = "gemini-ui"
    browser_channel = "chrome"
    apply_stealth = False

    async def submit_prompt(self, page: Page, prompt: str) -> None:
        textbox = await self.first_visible(
            page,
            [
                'rich-textarea div[contenteditable="true"]',
                'div[contenteditable="true"][role="textbox"]',
                'textarea[aria-label*="prompt" i]',
                'textarea',
            ],
        )
        await textbox.click()
        await page.keyboard.insert_text(prompt)
        await page.keyboard.press("Enter")

    async def answer_locator(self, page: Page) -> Locator:
        selectors = [
            "message-content",
            ".model-response-text",
            'div[data-response-index]',
            "response-container",
        ]
        for selector in selectors:
            locator = page.locator(selector)
            count = await locator.count()
            if count:
                return locator.nth(count - 1)
        return page.locator("body")
