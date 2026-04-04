#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
from pathlib import Path
from types import FrameType
from typing import Dict, List, Optional, Tuple

DEFAULT_BUCKET = "apnea-signal-videos"
DEFAULT_CACHE_ROOT = Path("cache")
DEFAULT_CONFIG_PATH = Path("config.yaml")
FOLDER_NAME = "athlete_videos"
KNOWN_DISCIPLINE = "DNF"

# Per-athlete artifacts that power profile and comparison views.
ATHLETE_INCLUDE_PATTERNS = (
    "*.annotations.json",
    "*.propulsion.refined.json",
    "*.propulsion.refined.event-strip.png",
    "*.propulsion.stats.json",
)

# Cross-stream derived chart artifacts used for cohort benchmark views.
STREAM_INCLUDE_PATTERNS = (
    "analysis/{discipline}/{category}/charts/*",
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
            "(athlete artifacts + analysis charts)."
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
        help=(
            "Optional category inside athlete_videos, e.g. seniors-male. "
            "If omitted, sync all categories under athlete_videos for the stream."
        ),
    )
    parser.add_argument(
        "--targets-file",
        type=Path,
        default=Path(config["targets_file"]) if config.get("targets_file") else None,
        help=(
            "Optional path to batch target list. If not provided and positional "
            "stream/category are omitted, targets are auto-discovered from S3."
        ),
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

    return args


def parse_targets_file(path: Path) -> List[Tuple[str, Optional[str]]]:
    if not path.exists():
        return []

    targets: List[Tuple[str, Optional[str]]] = []
    for line_no, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue

        if "," in line:
            parts = [part.strip() for part in line.split(",")]
            if len(parts) not in (1, 2, 3):
                raise ValueError(
                    f"Invalid target at {path}:{line_no}. Expected 'stream[,category[,event_type]]'."
                )
        else:
            parts = line.split()
            if len(parts) not in (1, 2, 3):
                raise ValueError(
                    f"Invalid target at {path}:{line_no}. Expected 'stream [category [event_type]]'."
                )

        stream = parts[0]
        category = parts[1] if len(parts) >= 2 else None
        if category is not None:
            category = category.strip() or None
        if not stream:
            raise ValueError(
                f"Invalid target at {path}:{line_no}. Stream is required."
            )
        targets.append((stream, category))
    return targets


def run_aws_json_command(command: List[str], *, description: str) -> Dict[str, object]:
    completed = subprocess.run(command, capture_output=True, text=True)
    if completed.returncode != 0:
        stderr = (completed.stderr or "").strip()
        raise ValueError(f"{description} failed: {stderr or f'exit code {completed.returncode}'}")

    try:
        payload = json.loads(completed.stdout or "{}")
    except json.JSONDecodeError as error:
        raise ValueError(f"{description} returned invalid JSON: {error}") from error
    if not isinstance(payload, dict):
        raise ValueError(f"{description} returned unexpected payload shape.")
    return payload


def list_common_prefixes(
    *,
    bucket: str,
    prefix: str,
    profile: Optional[str],
) -> List[str]:
    prefixes: List[str] = []
    continuation_token: Optional[str] = None

    while True:
        command = [
            "aws",
            "s3api",
            "list-objects-v2",
            "--bucket",
            bucket,
            "--prefix",
            prefix,
            "--delimiter",
            "/",
            "--max-keys",
            "1000",
            "--output",
            "json",
        ]
        if continuation_token:
            command.extend(["--continuation-token", continuation_token])
        if profile:
            command.extend(["--profile", profile])

        payload = run_aws_json_command(
            command,
            description=f"Listing S3 prefixes for s3://{bucket}/{prefix}",
        )
        for item in payload.get("CommonPrefixes", []):
            if not isinstance(item, dict):
                continue
            value = item.get("Prefix")
            if isinstance(value, str) and value:
                prefixes.append(value)

        if not payload.get("IsTruncated"):
            break
        token = payload.get("NextContinuationToken")
        if not isinstance(token, str) or not token:
            break
        continuation_token = token

    return prefixes


def prefix_has_objects(
    *,
    bucket: str,
    prefix: str,
    profile: Optional[str],
) -> bool:
    command = [
        "aws",
        "s3api",
        "list-objects-v2",
        "--bucket",
        bucket,
        "--prefix",
        prefix,
        "--max-keys",
        "1",
        "--output",
        "json",
    ]
    if profile:
        command.extend(["--profile", profile])

    payload = run_aws_json_command(
        command,
        description=f"Checking S3 prefix for s3://{bucket}/{prefix}",
    )
    key_count = payload.get("KeyCount")
    return isinstance(key_count, int) and key_count > 0


def discover_targets(*, bucket: str, profile: Optional[str]) -> List[Tuple[str, Optional[str]]]:
    stream_prefixes = list_common_prefixes(bucket=bucket, prefix="", profile=profile)
    discovered: List[Tuple[str, Optional[str]]] = []

    for stream_prefix in stream_prefixes:
        stream = stream_prefix.strip("/")
        if not stream:
            continue

        athlete_root = f"{stream}/{FOLDER_NAME}/"
        if not prefix_has_objects(bucket=bucket, prefix=athlete_root, profile=profile):
            continue

        category_prefixes = list_common_prefixes(
            bucket=bucket,
            prefix=athlete_root,
            profile=profile,
        )
        categories: List[str] = []
        for category_prefix in category_prefixes:
            if not category_prefix.startswith(athlete_root):
                continue
            category = category_prefix[len(athlete_root):].strip("/")
            if category:
                categories.append(category)

        unique_categories = sorted(set(categories))
        if unique_categories:
            discovered.extend((stream, category) for category in unique_categories)
        else:
            discovered.append((stream, None))

    return discovered


def resolve_targets(args: argparse.Namespace) -> List[Tuple[str, Optional[str]]]:
    if args.stream and args.category:
        return [(args.stream, args.category)]
    if args.stream and not args.category:
        return [(args.stream, None)]

    if args.category:
        raise ValueError("Category can only be provided when stream is also provided.")

    if args.targets_file is not None:
        targets = parse_targets_file(args.targets_file)
        if not targets:
            raise ValueError(
                f"No sync targets found in {args.targets_file}. "
                "Pass stream/category positionally, provide a populated targets file, "
                "or omit --targets-file to auto-discover from S3."
            )
        return targets

    targets = discover_targets(bucket=args.bucket, profile=args.profile)
    if not targets:
        raise ValueError(
            f"No stream targets discovered in s3://{args.bucket}/. "
            "Provide stream/category explicitly or pass --targets-file."
        )
    return targets


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


def sync_target(
    *,
    bucket: str,
    cache_root: Path,
    profile: Optional[str],
    dry_run: bool,
    stream: str,
    category: Optional[str],
) -> int:
    stream_root = cache_root / stream
    athlete_destination = stream_root / FOLDER_NAME
    if category:
        athlete_destination = athlete_destination / category

    athlete_destination.mkdir(parents=True, exist_ok=True)
    stream_root.mkdir(parents=True, exist_ok=True)

    athlete_s3_prefix = f"s3://{bucket}/{stream}/{FOLDER_NAME}/"
    if category:
        athlete_s3_prefix = f"{athlete_s3_prefix}{category}/"
    analysis_s3_prefix = f"s3://{bucket}/"
    analysis_destination = cache_root
    athlete_patterns = list(ATHLETE_INCLUDE_PATTERNS)
    if category is None:
        # Training streams may be synced at athlete_videos root and fan out by category.
        athlete_patterns.extend([f"*/{pattern}" for pattern in ATHLETE_INCLUDE_PATTERNS])

    athlete_command = build_sync_command(
        source=athlete_s3_prefix,
        destination=athlete_destination,
        include_patterns=athlete_patterns,
        profile=profile,
        dry_run=dry_run,
    )

    print(f"Syncing athlete artifacts {athlete_s3_prefix} -> {athlete_destination}")
    exit_code = run_command_with_sigterm_forwarding(
        athlete_command,
        description="aws s3 sync (download athlete artifacts)",
    )
    if exit_code != 0:
        return exit_code

    if category is None:
        print("Skipping analysis chart sync because category was not specified.")
        return 0

    analysis_patterns = [
        pattern.format(discipline=KNOWN_DISCIPLINE, category=category)
        for pattern in STREAM_INCLUDE_PATTERNS
    ]
    analysis_command = build_sync_command(
        source=analysis_s3_prefix,
        destination=analysis_destination,
        include_patterns=analysis_patterns,
        profile=profile,
        dry_run=dry_run,
    )

    print(f"Syncing analysis charts {analysis_s3_prefix} -> {analysis_destination}")
    return run_command_with_sigterm_forwarding(
        analysis_command,
        description="aws s3 sync (download analysis charts)",
    )


def main() -> None:
    args = parse_args()

    if shutil.which("aws") is None:
        sys.exit("aws CLI not found on PATH. Install it and retry.")

    try:
        targets = resolve_targets(args)
    except ValueError as error:
        sys.exit(str(error))

    for index, (stream, category) in enumerate(targets, start=1):
        category_label = category if category is not None else "*"
        print(f"\n[{index}/{len(targets)}] Sync target stream='{stream}' category='{category_label}'")
        exit_code = sync_target(
            bucket=args.bucket,
            cache_root=Path(args.cache_root),
            profile=args.profile,
            dry_run=args.dry_run,
            stream=stream,
            category=category,
        )
        if exit_code != 0:
            sys.exit(exit_code)


if __name__ == "__main__":
    main()
