#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Set, Tuple

DEFAULT_CACHE_ROOT = Path("cache")
DEFAULT_PUBLIC_DATA_ROOT = Path("public/data")
DEFAULT_TARGETS_FILE = Path("sync-targets.txt")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Copy curated stream/category artifacts from cache into public/data "
            "and generate a frontend manifest."
        )
    )
    parser.add_argument(
        "--cache-root",
        type=Path,
        default=DEFAULT_CACHE_ROOT,
        help="Root of locally synced cache data.",
    )
    parser.add_argument(
        "--public-data-root",
        type=Path,
        default=DEFAULT_PUBLIC_DATA_ROOT,
        help="Output root under public/ that will be committed and served.",
    )
    parser.add_argument(
        "--targets-file",
        type=Path,
        default=DEFAULT_TARGETS_FILE,
        help="Targets list in stream,category format.",
    )
    parser.add_argument(
        "--clear",
        action="store_true",
        help="Remove existing public data output before writing curated files.",
    )
    return parser.parse_args()


def parse_targets_file(path: Path) -> List[Tuple[str, str]]:
    if not path.exists():
        raise FileNotFoundError(f"Targets file not found: {path}")

    targets: List[Tuple[str, str]] = []
    for line_no, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue

        if "," in line:
            parts = [part.strip() for part in line.split(",", 1)]
        else:
            parts = line.split()

        if len(parts) != 2 or not parts[0] or not parts[1]:
            raise ValueError(
                f"Invalid target at {path}:{line_no}. Use 'stream,category' or 'stream category'."
            )
        targets.append((parts[0], parts[1]))

    if not targets:
        raise ValueError(f"No sync targets found in {path}")
    return targets


def slug_to_name(slug: str) -> str:
    return " ".join(part.capitalize() for part in slug.replace("_", "-").split("-") if part)


def read_json(path: Path) -> Dict:
    return json.loads(path.read_text(encoding="utf-8"))


def to_public_relative(path: Path, public_data_root: Path) -> str:
    public_root = public_data_root.parent
    return path.relative_to(public_root).as_posix()


def copy_if_exists(source: Path, destination: Path) -> bool:
    if not source.exists():
        return False
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    return True


def detect_disciplines(cache_root: Path, stream: str, category: str) -> Set[str]:
    disciplines: Set[str] = set()
    source_dir = cache_root / stream / "athlete_videos" / category
    if not source_dir.exists():
        return disciplines

    for annotation_path in sorted(source_dir.glob("*.annotations.json")):
        try:
            payload = read_json(annotation_path)
            discipline = (payload.get("metadata") or {}).get("discipline")
            if isinstance(discipline, str) and discipline.strip():
                disciplines.add(discipline.strip())
        except (json.JSONDecodeError, OSError):
            continue

    return disciplines


def curate_target(
    *,
    cache_root: Path,
    public_data_root: Path,
    stream: str,
    category: str,
) -> Dict:
    source_stream_root = cache_root / stream
    if not source_stream_root.exists():
        raise FileNotFoundError(f"Stream not found in cache: {source_stream_root}")

    destination_stream_root = public_data_root / stream
    source_summaries = source_stream_root / "summaries"
    destination_summaries = destination_stream_root / "summaries"

    summary_files: Dict[str, str] = {}
    athletes_by_checkpoint: Dict[str, Set[str]] = defaultdict(set)

    for summary_source in sorted(source_summaries.glob(f"*-{category}.json")):
        checkpoint = summary_source.name[: -len(f"-{category}.json")]
        summary_destination = destination_summaries / summary_source.name
        copy_if_exists(summary_source, summary_destination)

        summary_files[checkpoint] = to_public_relative(summary_destination, public_data_root)

        payload = read_json(summary_source)
        for athlete in payload.get("athletes", []):
            slug = athlete.get("athlete")
            if isinstance(slug, str) and slug.strip():
                athletes_by_checkpoint[checkpoint].add(slug.strip())

    if not summary_files:
        raise ValueError(f"No summary files found for {stream}/{category}")

    distribution_images: Dict[str, List[str]] = defaultdict(list)
    source_distributions = source_stream_root / "distributions"
    destination_distributions = destination_stream_root / "distributions"

    if source_distributions.exists():
        for checkpoint_dir in sorted(path for path in source_distributions.iterdir() if path.is_dir()):
            checkpoint = checkpoint_dir.name
            source_functions = checkpoint_dir / "functions.json"
            destination_functions = destination_distributions / checkpoint / "functions.json"
            copy_if_exists(source_functions, destination_functions)

            source_category_dir = checkpoint_dir / category
            destination_category_dir = destination_distributions / checkpoint / category

            if source_category_dir.exists():
                for source_image in sorted(source_category_dir.glob("*.png")):
                    destination_image = destination_category_dir / source_image.name
                    copy_if_exists(source_image, destination_image)
                    distribution_images[checkpoint].append(
                        to_public_relative(destination_image, public_data_root)
                    )

    disciplines = sorted(detect_disciplines(cache_root, stream, category))
    athlete_union = sorted({slug for values in athletes_by_checkpoint.values() for slug in values})

    return {
        "stream": stream,
        "category": category,
        "disciplines": disciplines,
        "checkpoints": sorted(summary_files.keys()),
        "summary_files": summary_files,
        "distribution_images": {key: values for key, values in sorted(distribution_images.items())},
        "athletes": athlete_union,
    }


def build_manifest(curated_targets: Iterable[Dict]) -> Dict:
    stream_rows: Dict[str, List[Dict]] = defaultdict(list)
    athlete_index: Dict[str, Dict] = {}

    for target in curated_targets:
        stream = target["stream"]
        category = target["category"]
        checkpoints = target["checkpoints"]
        disciplines = target["disciplines"]

        stream_rows[stream].append(
            {
                "id": category,
                "disciplines": disciplines,
                "checkpoints": checkpoints,
                "summary_files": target["summary_files"],
                "distribution_images": target["distribution_images"],
            }
        )

        for slug in target["athletes"]:
            if slug not in athlete_index:
                athlete_index[slug] = {
                    "slug": slug,
                    "display_name": slug_to_name(slug),
                    "entries": [],
                }
            athlete_index[slug]["entries"].append(
                {
                    "stream": stream,
                    "category": category,
                    "disciplines": disciplines,
                    "checkpoints": checkpoints,
                }
            )

    streams = [
        {
            "id": stream,
            "categories": sorted(categories, key=lambda row: row["id"]),
        }
        for stream, categories in sorted(stream_rows.items(), key=lambda item: item[0])
    ]

    athletes = sorted(athlete_index.values(), key=lambda row: row["slug"])

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "streams": streams,
        "athletes": athletes,
    }


def write_manifest(manifest: Dict, public_data_root: Path) -> Path:
    path = public_data_root / "manifest.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2, sort_keys=False) + "\n", encoding="utf-8")
    return path


def main() -> None:
    args = parse_args()
    cache_root = args.cache_root
    public_data_root = args.public_data_root

    if args.clear and public_data_root.exists():
        shutil.rmtree(public_data_root)

    targets = parse_targets_file(args.targets_file)

    curated = [
        curate_target(
            cache_root=cache_root,
            public_data_root=public_data_root,
            stream=stream,
            category=category,
        )
        for stream, category in targets
    ]

    manifest = build_manifest(curated)
    manifest_path = write_manifest(manifest, public_data_root)

    print(f"Curated {len(curated)} target(s) into {public_data_root}")
    print(f"Manifest written to {manifest_path}")


if __name__ == "__main__":
    main()
