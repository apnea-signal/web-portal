#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

DEFAULT_SOURCE = Path("public")
DEFAULT_DESTINATION = Path("site")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build static site output by copying public/ to site/.")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="Source directory.")
    parser.add_argument("--destination", type=Path, default=DEFAULT_DESTINATION, help="Output directory.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source = args.source
    destination = args.destination

    if not source.exists() or not source.is_dir():
        raise FileNotFoundError(f"Source directory not found: {source}")

    if destination.exists():
        shutil.rmtree(destination)

    shutil.copytree(source, destination)
    (destination / ".nojekyll").write_text("\n", encoding="utf-8")

    print(f"Built site at {destination} from {source}")


if __name__ == "__main__":
    main()
