#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

DEFAULT_CACHE_ROOT = Path("cache")
DEFAULT_PUBLIC_DATA_ROOT = Path("public/data")
DEFAULT_TARGETS_FILE = Path("sync-targets.txt")
KNOWN_DISCIPLINE = "DNF"
DEFAULT_EVENT_TYPE = "competition"


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


def parse_targets_file(path: Path) -> List[Tuple[str, str, str]]:
    if not path.exists():
        raise FileNotFoundError(f"Targets file not found: {path}")

    targets: List[Tuple[str, str, str]] = []
    for line_no, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue

        if "," in line:
            parts = [part.strip() for part in line.split(",")]
        else:
            parts = line.split()

        if len(parts) not in (2, 3) or not parts[0] or not parts[1]:
            raise ValueError(
                f"Invalid target at {path}:{line_no}. Use 'stream,category[,event_type]' or whitespace-separated equivalent."
            )
        event_type = parts[2].strip().lower() if len(parts) == 3 else DEFAULT_EVENT_TYPE
        if not event_type:
            event_type = DEFAULT_EVENT_TYPE
        targets.append((parts[0], parts[1], event_type))

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


def to_float(value: object) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None


def parse_speed_profile_stats(
    stats_payload: Dict,
) -> Tuple[List[Dict[str, float]], Optional[float], Optional[float], Optional[float], Optional[float]]:
    checkpoints = stats_payload.get("checkpoints")
    if not isinstance(checkpoints, list):
        return [], None, None, None, None

    points: List[Dict[str, float]] = []
    speed_mps: Optional[float] = None
    time_25m_s: Optional[float] = None
    time_50m_s: Optional[float] = None
    time_100m_s: Optional[float] = None
    for checkpoint in checkpoints:
        if not isinstance(checkpoint, dict):
            continue

        distance_m = to_float(checkpoint.get("distance_m"))
        time_s = to_float(checkpoint.get("time_s"))
        if distance_m is not None and time_s is not None and time_s > 0:
            points.append({"distance_m": distance_m, "time_s": time_s})

        tags = checkpoint.get("tags")
        tag_values = [str(tag).strip().lower() for tag in tags] if isinstance(tags, list) else []
        if time_s is not None and time_s > 0:
            if "25m" in tag_values and time_25m_s is None:
                time_25m_s = time_s
            if "50m" in tag_values and time_50m_s is None:
                time_50m_s = time_s
            if "100m" in tag_values and time_100m_s is None:
                time_100m_s = time_s
        if "total" in tag_values and distance_m is not None and time_s is not None and time_s > 0:
            speed_mps = distance_m / time_s

    points.sort(key=lambda row: (row["distance_m"], row["time_s"]))
    if time_25m_s is None:
        for point in points:
            if abs(point["distance_m"] - 25.0) <= 0.5:
                time_25m_s = point["time_s"]
                break
    if time_50m_s is None:
        for point in points:
            if abs(point["distance_m"] - 50.0) <= 0.5:
                time_50m_s = point["time_s"]
                break
    if time_100m_s is None:
        for point in points:
            if abs(point["distance_m"] - 100.0) <= 0.5:
                time_100m_s = point["time_s"]
                break
    return points, speed_mps, time_25m_s, time_50m_s, time_100m_s


def load_stats_for_slug(
    athlete_videos_dir: Path,
    slug: str,
) -> Tuple[List[Dict[str, float]], Optional[float], Optional[float], Optional[float], Optional[float]]:
    for suffix in (".refined.propulsion.stats.json", ".propulsion.stats.json"):
        stats_path = athlete_videos_dir / f"{slug}{suffix}"
        if not stats_path.exists():
            continue
        try:
            payload = read_json(stats_path)
        except (json.JSONDecodeError, OSError):
            continue
        return parse_speed_profile_stats(payload)
    return [], None, None, None, None


def detect_athlete_slugs(cache_root: Path, stream: str, category: str) -> Set[str]:
    source_dir = cache_root / stream / "athlete_videos" / category
    if not source_dir.exists():
        return set()

    suffixes = (
        ".annotations.json",
        ".propulsion.refined.json",
        ".refined.propulsion.stats.json",
        ".propulsion.stats.json",
    )
    slugs: Set[str] = set()
    for path in sorted(source_dir.iterdir()):
        if not path.is_file():
            continue
        for suffix in suffixes:
            if path.name.endswith(suffix):
                slug = path.name[: -len(suffix)].strip()
                if slug:
                    slugs.add(slug)
                break
    return slugs


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
    event_type: str,
) -> Dict:
    source_stream_root = cache_root / stream
    if not source_stream_root.exists():
        raise FileNotFoundError(f"Stream not found in cache: {source_stream_root}")

    destination_stream_root = public_data_root / stream
    source_summaries = source_stream_root / "summaries"
    destination_summaries = destination_stream_root / "summaries"

    summary_files: Dict[str, str] = {}
    athletes_by_checkpoint: Dict[str, Set[str]] = defaultdict(set)

    if source_summaries.exists():
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
    athlete_union = {slug for values in athletes_by_checkpoint.values() for slug in values}
    athlete_union.update(detect_athlete_slugs(cache_root, stream, category))

    return {
        "stream": stream,
        "category": category,
        "event_type": event_type,
        "disciplines": disciplines,
        "checkpoints": sorted(summary_files.keys()),
        "summary_files": summary_files,
        "distribution_images": {key: values for key, values in sorted(distribution_images.items())},
        "athletes": sorted(athlete_union),
    }


def curate_analysis(
    *,
    cache_root: Path,
    public_data_root: Path,
    targets: Iterable[Tuple[str, str, str]],
    discipline: str = KNOWN_DISCIPLINE,
) -> Dict[str, Dict[str, List[Dict[str, object]]]]:
    targets_by_category: Dict[str, Set[str]] = defaultdict(set)
    for stream, category, _event_type in targets:
        targets_by_category[category].add(stream)

    rows: List[Dict[str, object]] = []
    for category in sorted(targets_by_category.keys()):
        source_dir = cache_root / "analysis" / discipline / category / "charts"
        destination_dir = public_data_root / "analysis" / discipline / category / "charts"
        destination_category_root = public_data_root / "analysis" / discipline / category

        speed_profile_chart = ""
        speed_profile_overlay_path = ""
        if source_dir.exists():
            for source_artifact in sorted(path for path in source_dir.iterdir() if path.is_file()):
                destination_artifact = destination_dir / source_artifact.name
                copy_if_exists(source_artifact, destination_artifact)
                if source_artifact.name == "speed-profile-top-athletes.png":
                    speed_profile_chart = to_public_relative(destination_artifact, public_data_root)
                elif source_artifact.name == "speed-profile-top-athletes.overlay.json":
                    speed_profile_overlay_path = to_public_relative(destination_artifact, public_data_root)

        athlete_rows: List[Dict[str, object]] = []
        for stream in sorted(targets_by_category[category]):
            performance_by_slug: Dict[str, Optional[float]] = {}
            total_summary_path = cache_root / stream / "summaries" / f"total-{category}.json"
            if total_summary_path.exists():
                try:
                    total_payload = read_json(total_summary_path)
                    for athlete_row in total_payload.get("athletes", []):
                        slug = athlete_row.get("athlete")
                        if isinstance(slug, str) and slug.strip():
                            performance_by_slug[slug.strip()] = to_float(athlete_row.get("distance_m"))
                except (json.JSONDecodeError, OSError):
                    pass

            athlete_videos_dir = cache_root / stream / "athlete_videos" / category
            annotation_by_slug: Dict[str, Dict[str, object]] = {}
            if athlete_videos_dir.exists():
                for annotation_path in sorted(athlete_videos_dir.glob("*.annotations.json")):
                    slug = annotation_path.name[: -len(".annotations.json")]
                    try:
                        annotation_payload = read_json(annotation_path)
                    except (json.JSONDecodeError, OSError):
                        continue
                    metadata = annotation_payload.get("metadata") or {}
                    annotation_by_slug[slug] = {
                        "athlete_name": str(metadata.get("athlete_name") or slug_to_name(slug)),
                        "video_url": str(metadata.get("online_url") or ""),
                        "performance_m": to_float(metadata.get("total_distance_m")),
                    }

            for slug in sorted(set(performance_by_slug.keys()) | set(annotation_by_slug.keys())):
                annotation = annotation_by_slug.get(slug, {})
                speed_profile_points, speed_mps, time_25m_s, time_50m_s, time_100m_s = load_stats_for_slug(
                    athlete_videos_dir, slug
                )
                summary_performance = performance_by_slug.get(slug)
                annotation_performance = to_float(annotation.get("performance_m"))
                athlete_rows.append(
                    {
                        "athlete_slug": slug,
                        "athlete_name": annotation.get("athlete_name") or slug_to_name(slug),
                        "event": stream,
                        "category": category,
                        "performance_m": summary_performance if summary_performance is not None else annotation_performance,
                        "speed_mps": speed_mps,
                        "time_25m_s": time_25m_s,
                        "time_50m_s": time_50m_s,
                        "time_100m_s": time_100m_s,
                        "speed_profile_points": speed_profile_points,
                        "video_url": annotation.get("video_url") or "",
                    }
                )

        athlete_rows.sort(
            key=lambda row: (
                -(row.get("performance_m") if isinstance(row.get("performance_m"), float) else float("-inf")),
                str(row.get("athlete_name", "")),
                str(row.get("event", "")),
            )
        )
        athlete_rows_path = destination_category_root / "athletes.json"
        athlete_rows_path.parent.mkdir(parents=True, exist_ok=True)
        athlete_rows_path.write_text(
            json.dumps(athlete_rows, indent=2, sort_keys=False) + "\n",
            encoding="utf-8",
        )

        rows.append(
            {
                "id": category,
                "speed_profile_chart": speed_profile_chart,
                "speed_profile_overlay_path": speed_profile_overlay_path,
                "athlete_rows_path": to_public_relative(athlete_rows_path, public_data_root),
            }
        )

    return {
        discipline: {
            "categories": rows,
        }
    }


def build_manifest(curated_targets: Iterable[Dict], analysis: Dict) -> Dict:
    event_rows: Dict[str, List[Dict]] = defaultdict(list)
    event_types: Dict[str, str] = {}
    athlete_index: Dict[str, Dict] = {}

    for target in curated_targets:
        event_id = target["stream"]
        category = target["category"]
        event_type = str(target.get("event_type") or DEFAULT_EVENT_TYPE)
        checkpoints = target["checkpoints"]
        disciplines = target["disciplines"]
        existing_type = event_types.get(event_id)
        if existing_type is None:
            event_types[event_id] = event_type
        elif existing_type != "training" and event_type == "training":
            event_types[event_id] = "training"

        event_rows[event_id].append(
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
                    "event": event_id,
                    "stream": event_id,
                    "event_type": event_type,
                    "category": category,
                    "disciplines": disciplines,
                    "checkpoints": checkpoints,
                }
            )

    events = [
        {
            "id": event_id,
            "event_type": event_types.get(event_id, DEFAULT_EVENT_TYPE),
            "categories": sorted(categories, key=lambda row: row["id"]),
        }
        for event_id, categories in sorted(event_rows.items(), key=lambda item: item[0])
    ]

    athletes = sorted(athlete_index.values(), key=lambda row: row["slug"])

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "events": events,
        "streams": events,
        "cross_event_distributions": {
            "DNF": []
        },
        "analysis": analysis,
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
            event_type=event_type,
        )
        for stream, category, event_type in targets
    ]

    manifest = build_manifest(
        curated,
        analysis=curate_analysis(
            cache_root=cache_root,
            public_data_root=public_data_root,
            targets=targets,
            discipline=KNOWN_DISCIPLINE,
        ),
    )
    manifest_path = write_manifest(manifest, public_data_root)

    print(f"Curated {len(curated)} target(s) into {public_data_root}")
    print(f"Manifest written to {manifest_path}")


if __name__ == "__main__":
    main()
