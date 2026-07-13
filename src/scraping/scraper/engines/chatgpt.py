from __future__ import annotations

from playwright.async_api import Locator, Page

from ..models import EngineName
from .base import BaseEngineScraper


class ChatGPTScraper(BaseEngineScraper):
    engine = EngineName.CHATGPT
    url = "https://chatgpt.com/"
    model_label = "chatgpt-ui"

    async def submit_prompt(self, page: Page, prompt: str) -> None:
        textbox = await self.first_visible(
            page,
            [
                "#prompt-textarea",
                '[contenteditable="true"]',
                'textarea[placeholder*="Message"]',
                'textarea[data-testid="prompt-textarea"]',
            ],
        )
        await textbox.click()
        await textbox.fill(prompt)
        await page.keyboard.press("Enter")

    async def answer_locator(self, page: Page) -> Locator:
        blocks = page.locator('[data-message-author-role="assistant"]')
        count = await blocks.count()
        if count:
            return blocks.nth(count - 1)
        articles = page.locator("article")
        count = await articles.count()
        return articles.nth(count - 1) if count else page.locator("body")

