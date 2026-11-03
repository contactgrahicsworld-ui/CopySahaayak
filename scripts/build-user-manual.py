#!/usr/bin/env python3
"""Regenerate the Hindi user-manual PDF from docs/manual/*.html via Playwright
chromium print-to-PDF (same pipeline as the original build)."""
import asyncio
import pathlib

HTML = pathlib.Path('/home/z/my-project/docs/manual/copysahaayak-user-manual-hi.html').resolve()
OUT = pathlib.Path('/home/z/my-project/docs/manual/copysahaayak-user-manual-hi.pdf')
PUBLIC = pathlib.Path('/home/z/my-project/public/manual/copysahaayak-user-manual-hi.pdf')

from playwright.async_api import async_playwright


async def main() -> None:
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page()
        await page.goto(HTML.as_uri(), wait_until='networkidle')
        await page.pdf(
            path=str(OUT),
            format='A4',
            print_background=True,
            margin={'top': '14mm', 'bottom': '14mm', 'left': '12mm', 'right': '12mm'},
        )
        await browser.close()
    PUBLIC.write_bytes(OUT.read_bytes())
    print('PDF written:', OUT, OUT.stat().st_size, 'bytes; copied to', PUBLIC)


asyncio.run(main())
