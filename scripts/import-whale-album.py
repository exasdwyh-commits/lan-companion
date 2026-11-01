#!/usr/bin/env python3
"""Import the generated wallpaper collection without changing original PNGs."""
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
COLLECTION = ROOT / "assets/whale-album-2026-10-29"
RUNTIME = ROOT / "assets/whale-video-test"
manifest = json.loads((COLLECTION / "generation.json").read_text())
items = manifest["items"]
missing = [item["original"] for item in items if not (COLLECTION / item["original"]).is_file()]
if missing:
    raise SystemExit("Missing generated originals: " + ", ".join(missing))

album = []
for item in items:
    destination = (COLLECTION / item["runtime"]).resolve()
    if destination.parent != RUNTIME.resolve():
        raise SystemExit("Unexpected runtime destination")
    subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "92",
                    str(COLLECTION / item["original"]), "--out", str(destination)],
                   check=True, stdout=subprocess.DEVNULL)
    album.append({"id": item["id"], "file": destination.name,
                  "unlockAt": item["unlockAt"], "zh": item["caption"],
                  "where": item["title"] + " · " + item["place"],
                  "date": manifest["created"]})

pack_path = RUNTIME / "pack.json"
pack = json.loads(pack_path.read_text())
our_ids = {item["id"] for item in album}
other_items = [item for item in pack.get("album", []) if item["id"] not in our_ids]
pack["album"] = other_items + album
temporary = pack_path.with_suffix(".json.tmp")
temporary.write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n")
temporary.replace(pack_path)
print(f"Imported {len(album)} wallpapers; preserved {len(other_items)} other album entries")
