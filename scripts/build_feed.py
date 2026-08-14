#!/usr/bin/env python3
"""Turn the ConCafe podcast RSS feed into the compact JSON the site reads.

The published feed lives on Anchor/Spotify for Creators and is the single source
of truth for episodes. This script fetches it, flattens each <item> into a fixed
tuple, and writes docs/data/episodes.json. Nothing else in the repo touches the
network, so the site works offline and loads fast.

Usage:
    python3 scripts/build_feed.py                 # fetch and write
    python3 scripts/build_feed.py --rss local.xml # build from a saved copy

Standard library only, so CI needs no pip install.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from xml.etree import ElementTree as ET

RSS_URL = "https://anchor.fm/s/c44de80/podcast/rss"
REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "docs" / "data" / "episodes.json"

ITUNES = "http://www.itunes.com/dtds/podcast-1.0.dtd"

# Episodes are stored as arrays rather than objects: at 1,400+ items, repeating
# six JSON keys per episode costs more than the data itself. `fields` in the
# output documents the order for anyone reading the file directly.
FIELDS = ["title", "date", "seconds", "blurb", "audio", "link"]

TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")


def strip_html(raw: str | None) -> str:
    """Flatten an RSS description into a single line of plain text."""
    if not raw:
        return ""
    # <br> and </p> are the only structural breaks these show notes use.
    text = re.sub(r"<br\s*/?>|</p>", " ", raw, flags=re.I)
    text = TAG_RE.sub("", text)
    text = html.unescape(text)
    return WS_RE.sub(" ", text).strip()


def duration_seconds(raw: str | None) -> int:
    """Parse an itunes:duration, which may be HH:MM:SS, MM:SS, or bare seconds."""
    if not raw:
        return 0
    raw = raw.strip()
    if ":" not in raw:
        return int(raw) if raw.isdigit() else 0
    parts = [int(p) if p.isdigit() else 0 for p in raw.split(":")]
    total = 0
    for part in parts:
        total = total * 60 + part
    return total


def parse_date(raw: str | None) -> str:
    """Normalise an RFC 2822 pubDate to an ISO 8601 UTC string."""
    if not raw:
        return ""
    try:
        parsed = parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return ""
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def fetch(url: str) -> bytes:
    request = urllib.request.Request(
        url, headers={"User-Agent": "concafe-ministries-site/1.0 (+github pages build)"}
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def build(rss_bytes: bytes) -> dict:
    channel = ET.fromstring(rss_bytes).find("channel")
    if channel is None:
        raise SystemExit("feed has no <channel> element - refusing to write")

    image = channel.find(f"{{{ITUNES}}}image")

    episodes = []
    for item in channel.findall("item"):
        enclosure = item.find("enclosure")
        audio = enclosure.get("url") if enclosure is not None else ""
        if not audio:
            # No playable file means nothing for the site to render.
            continue
        episodes.append(
            [
                (item.findtext("title") or "Untitled").strip(),
                parse_date(item.findtext("pubDate")),
                duration_seconds(item.findtext(f"{{{ITUNES}}}duration")),
                strip_html(item.findtext("description")),
                audio,
                (item.findtext("link") or "").strip(),
            ]
        )

    if not episodes:
        raise SystemExit("feed parsed but yielded zero episodes - refusing to write")

    # Newest first, so the site can slice the front of the list without sorting.
    episodes.sort(key=lambda row: row[1], reverse=True)

    return {
        "show": (channel.findtext("title") or "").strip(),
        "author": (channel.findtext(f"{{{ITUNES}}}author") or "").strip(),
        "description": strip_html(channel.findtext("description")),
        "artwork": image.get("href") if image is not None else "",
        "rss": RSS_URL,
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "count": len(episodes),
        "fields": FIELDS,
        "episodes": episodes,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rss", help="path to a local RSS file instead of fetching")
    parser.add_argument("--out", type=Path, default=OUT_PATH, help="output JSON path")
    parser.add_argument(
        "--allow-shrink",
        action="store_true",
        help="accept a feed with fewer episodes than the current file (see below)",
    )
    args = parser.parse_args()

    if args.rss:
        rss_bytes = Path(args.rss).read_bytes()
    else:
        rss_bytes = fetch(RSS_URL)

    data = build(rss_bytes)

    # Leave the file alone when nothing about the show has actually changed.
    # `generated` moves on every run, so without this the daily CI job would
    # commit a new timestamp every day and bury real episode additions in
    # noise. Skipping the write also makes `generated` mean what it says: the
    # last time the episode list itself changed.
    if args.out.exists():
        try:
            previous = json.loads(args.out.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            previous = None
        if previous is not None and all(
            previous.get(key) == data[key]
            for key in ("episodes", "show", "author", "description", "artwork")
        ):
            print(f"unchanged: {data['count']} episodes, nothing to write")
            return 0

        # The host has been observed serving a briefly incomplete feed, which
        # would otherwise silently drop episodes from the archive. Losing
        # episodes is rare and deliberate; a short read is neither, so make the
        # shrinking case opt-in rather than letting the daily job apply it.
        was = len(previous.get("episodes", [])) if previous else 0
        if previous is not None and data["count"] < was and not args.allow_shrink:
            print(
                f"refusing to shrink the archive: feed returned {data['count']} episodes "
                f"but {args.out.name} has {was}. This is usually a short read from the "
                f"podcast host. Re-run with --allow-shrink if episodes were really removed."
            )
            return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    # separators trim the whitespace JSON would otherwise add to every row.
    args.out.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )

    size_kb = args.out.stat().st_size / 1024
    print(f"wrote {args.out.relative_to(REPO_ROOT)}: {data['count']} episodes, {size_kb:.0f} KB")
    print(f"newest: {data['episodes'][0][0]} ({data['episodes'][0][1][:10]})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
