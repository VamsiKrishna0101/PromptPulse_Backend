from __future__ import annotations

import argparse
import asyncio
import json

from scraper.models import BatchRequest, EngineName
from scraper.runner import run_batch


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run India-only UI scraping demo batch.")
    parser.add_argument("--prompt", action="append", required=True, help="Prompt to run. Repeat for multiple prompts.")
    parser.add_argument(
        "--engine",
        action="append",
        choices=[engine.value for engine in EngineName],
        default=None,
        help="Engine to run. Repeat for multiple engines. Defaults to all MVP engines.",
    )
    parser.add_argument("--brand", default=None)
    parser.add_argument("--profile", default=None, help="Optional browser profile name to use for all jobs.")
    parser.add_argument("--max-retries", type=int, default=2)
    parser.add_argument("--min-delay", type=int, default=30)
    parser.add_argument("--max-delay", type=int, default=90)
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    engines = [EngineName(value) for value in args.engine] if args.engine else list(EngineName)
    request = BatchRequest(
        prompts=args.prompt,
        engines=engines,
        brand=args.brand,
        profile=args.profile,
        max_retries=args.max_retries,
    )
    results = await run_batch(request, min_delay_seconds=args.min_delay, max_delay_seconds=args.max_delay)
    print(json.dumps([result.model_dump(mode="json") for result in results], indent=2))


if __name__ == "__main__":
    asyncio.run(main())
