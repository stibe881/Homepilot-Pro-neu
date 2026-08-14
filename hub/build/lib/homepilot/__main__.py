"""Startpunkt: python -m homepilot -c config.yaml"""

from __future__ import annotations

import argparse
import logging

import uvicorn

from .api import create_app
from .core.config import load_config
from .core.hub import Hub


def main() -> None:
    parser = argparse.ArgumentParser(prog="homepilot")
    parser.add_argument("-c", "--config", default="config.yaml", help="Pfad zur config.yaml")
    parser.add_argument("-v", "--verbose", action="store_true", help="Debug-Logging")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )

    config = load_config(args.config)
    hub = Hub(config)
    app = create_app(hub)
    uvicorn.run(app, host=config.api.host, port=config.api.port, log_level="warning")


if __name__ == "__main__":
    main()
