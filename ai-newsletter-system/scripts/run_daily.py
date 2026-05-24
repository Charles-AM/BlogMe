import argparse
import asyncio
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent.parent))

from app import database
from app.config import get_settings
from app.services.pipeline import build_and_send_daily


async def main() -> None:
    parser = argparse.ArgumentParser(description="Run the daily AI newsletter pipeline.")
    parser.add_argument("--send", action="store_true", help="Actually send email through Gmail API.")
    args = parser.parse_args()

    database.init_db()
    result = await build_and_send_daily(get_settings(), dry_run=not args.send)
    print(result)


if __name__ == "__main__":
    asyncio.run(main())
