from __future__ import annotations

from playwright.async_api import Locator, Page

from ..models import Citation, EngineName
from .base import BaseEngineScraper


class PerplexityScraper(BaseEngineScraper):
    engine = EngineName.PERPLEXITY
    url = "https://www.perplexity.ai/"
    model_label = "perplexity-ui"
    browser_channel = "chrome"
    apply_stealth = False

    async def submit_prompt(self, page: Page, prompt: str) -> None:
        textbox = await self.first_visible(
            page,
            [
                'textarea[placeholder*="Ask" i]',
                'textarea[aria-label*="Ask" i]',
                'div[contenteditable="true"]',
                "textarea",
            ],
        )
        await textbox.click()
        try:
            await textbox.fill(prompt)
        except Exception:
            await page.keyboard.insert_text(prompt)
        await page.keyboard.press("Enter")

    async def answer_locator(self, page: Page) -> Locator:
        selectors = [
            '[data-testid="answer"]',
            ".prose",
            'div[class*="answer"]',
            "main",
        ]
        for selector in selectors:
            locator = page.locator(selector)
            count = await locator.count()
            if count:
                return locator.nth(count - 1)
        return page.locator("body")

    async def extract_citations(self, page: Page, locator: Locator) -> list[Citation]:
        citations = await super().extract_citations(page, locator)

        for selector in [
            'button:has-text("Sources")',
            'button:has-text("sources")',
            '[aria-label*="Sources" i]',
            'text=/Sources\\s*\\d*/i',
        ]:
            try:
                source_button = page.locator(selector).first
                if await source_button.count() and await source_button.is_visible(timeout=1000):
                    await source_button.click(timeout=3000)
                    await page.wait_for_timeout(1500)
                    break
            except Exception:
                continue

        links = page.locator("a[href]")
        for index in range(await links.count()):
            link = links.nth(index)
            href = await link.get_attribute("href")
            if not href or not href.startswith("http"):
                continue
            if self._is_perplexity_ui_link(href):
                continue
            text = (await link.inner_text(timeout=5000)).strip()
            if not any(item.url == href for item in citations):
                citations.append(Citation(text=text, url=href))

        return citations

    def _is_perplexity_ui_link(self, href: str) -> bool:
        blocked = [
            "perplexity.ai",
            "pplx.ai",
            "google.com/accounts",
            "accounts.google.com",
            "appleid.apple.com",
        ]
        return any(domain in href.lower() for domain in blocked)
