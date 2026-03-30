#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import shutil
import signal
import subprocess
import sys
from pathlib import Path
from types import FrameType
from typing import Dict, List, Optional

DEFAULT_BUCKET = "apnea-signal-videos"
DEFAULT_CACHE_ROOT = Path("cache")
DEFAULT_CONFIG_PATH = Path("config.yaml")
FOLDER_NAME = "athlete_videos"

# Per-athlete artifacts that power profile and comparison views.
ATHLETE_INCLUDE_PATTERNS = (
    "*.annotations.json",
    "*.propulsion.json",
    "*.propulsion.refined.json",
    "*.propulsion.stats.json",
)

# Stream-level derived artifacts used for cohort benchmark and distribution views.
STREAM_INCLUDE_PATTERNS = (
    "propulsion-summary-{category}.csv",
    "summaries/*-{category}.json",
    "distributions/*/{category}/*",
    "distributions/*/functions.json",
)


def parse_config_path(argv: Optional[List[str]] = None) -> Path:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument(
        "--config",
        type=Path,
        default=DEFAULT_CONFIG_PATH,
        help="Path to config file with defaults for stream/category/bucket.",
    )
    known, _ = parser.parse_known_args(argv)
    return known.config


def load_flat_yaml_config(path: Path) -> Dict[str, str]:
    """
    Parse a minimal flat key:value YAML file.

    This loader intentionally supports only the simple config shape used here,
    which keeps the script dependency-free.
    """
    if not path.exists():
        return {}

    data: Dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line or ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            data[key] = value
    return data


def parse_args() -> argparse.Namespace:
    config_path = parse_config_path()
    config = load_flat_yaml_config(config_path)

    parser = argparse.ArgumentParser(
        description=(
            "Synchronise source data from S3 into the local cache "
            "(athlete artifacts + summaries/distributions)."
        )
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=config_path,
        help="Path to config file with defaults for stream/category/bucket.",
    )
    parser.add_argument(
        "stream",
        nargs="?",
        default=config.get("stream"),
        help="Stream name, e.g. athens-2025-day1",
    )
    parser.add_argument(
        "category",
        nargs="?",
        default=config.get("category"),
        help="Category inside athlete_videos, e.g. seniors-male",
    )
    parser.add_argument(
        "--bucket",
        default=config.get("bucket") or os.environ.get("VIDEO_WORKBENCH_BUCKET", DEFAULT_BUCKET),
        help=f"S3 bucket to sync from (default: env VIDEO_WORKBENCH_BUCKET or {DEFAULT_BUCKET})",
    )
    parser.add_argument(
        "--cache-root",
        type=Path,
        default=Path(config.get("cache_root") or DEFAULT_CACHE_ROOT),
        help="Local cache root directory",
    )
    parser.add_argument(
        "--profile",
        default=config.get("aws_profile") or os.environ.get("AWS_PROFILE"),
        help="AWS CLI profile to use",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run aws s3 sync with --dryrun for verification",
    )
    args = parser.parse_args()

    if args.stream is None:
        parser.error("stream is required (set in config.yaml or pass it positionally).")
    if args.category is None:
        parser.error("category is required (set in config.yaml or pass it positionally).")

    return args


def build_sync_command(
    source: str,
    destination: Path,
    include_patterns: List[str],
    profile: Optional[str],
    dry_run: bool,
) -> List[str]:
    command = ["aws", "s3", "sync", source, str(destination), "--exclude", "*"]
    for pattern in include_patterns:
        command.extend(["--include", pattern])
    if profile:
        command.extend(["--profile", profile])
    if dry_run:
        command.append("--dryrun")
    return command


def _normalize_exit_code(returncode: int) -> int:
    return 128 + abs(returncode) if returncode < 0 else returncode


def run_command_with_sigterm_forwarding(command: List[str], *, description: str) -> int:
    process = subprocess.Popen(command)

    def _handle_sigterm(signum: int, frame: Optional[FrameType]) -> None:
        print(f"Received SIGTERM, stopping {description}...")
        process.terminate()

    previous_handler = signal.signal(signal.SIGTERM, _handle_sigterm)
    try:
        return _normalize_exit_code(process.wait())
    except KeyboardInterrupt:
        process.terminate()
        return 130
    finally:
        signal.signal(signal.SIGTERM, previous_handler)
        if process.poll() is None:
            process.kill()
            process.wait()


def main() -> None:
    args = parse_args()

    if shutil.which("aws") is None:
        sys.exit("aws CLI not found on PATH. Install it and retry.")

    cache_root = Path(args.cache_root)
    stream_root = cache_root / args.stream
    athlete_destination = stream_root / FOLDER_NAME / args.category

    athlete_destination.mkdir(parents=True, exist_ok=True)
    stream_root.mkdir(parents=True, exist_ok=True)

    athlete_s3_prefix = f"s3://{args.bucket}/{args.stream}/{FOLDER_NAME}/{args.category}/"
    stream_s3_prefix = f"s3://{args.bucket}/{args.stream}/"

    athlete_command = build_sync_command(
        source=athlete_s3_prefix,
        destination=athlete_destination,
        include_patterns=list(ATHLETE_INCLUDE_PATTERNS),
        profile=args.profile,
        dry_run=args.dry_run,
    )

    print(f"Syncing athlete artifacts {athlete_s3_prefix} -> {athlete_destination}")
    exit_code = run_command_with_sigterm_forwarding(
        athlete_command,
        description="aws s3 sync (download athlete artifacts)",
    )
    if exit_code != 0:
        sys.exit(exit_code)

    stream_patterns = [pattern.format(category=args.category) for pattern in STREAM_INCLUDE_PATTERNS]
    stream_command = build_sync_command(
        source=stream_s3_prefix,
        destination=stream_root,
        include_patterns=stream_patterns,
        profile=args.profile,
        dry_run=args.dry_run,
    )

    print(f"Syncing summaries/distributions {stream_s3_prefix} -> {stream_root}")
    exit_code = run_command_with_sigterm_forwarding(
        stream_command,
        description="aws s3 sync (download summaries/distributions)",
    )
    if exit_code != 0:
        sys.exit(exit_code)


if __name__ == "__main__":
    main()
