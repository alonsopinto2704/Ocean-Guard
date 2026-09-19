"""Download a reproducible, scene-grouped TACO pilot dataset (public images only)."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import random
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

SOURCE = "https://raw.githubusercontent.com/pedropro/TACO/master/data/annotations.json"


def prepare(output: Path, limit: int = 300) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    annotation_path = output / "annotations.json"
    if not annotation_path.exists():
        annotation_path.write_bytes(urllib.request.urlopen(SOURCE, timeout=60).read())
    raw = annotation_path.read_bytes()
    data = json.loads(raw)
    categories = {c["id"]: c["name"] for c in data["categories"]}
    # All annotated litter is retained. Material-specific classes are not inferred.
    by_image = {}
    for annotation in data["annotations"]:
        by_image.setdefault(annotation["image_id"], []).append(annotation)
    images = list(data["images"])
    random.Random(42).shuffle(images)
    groups = sorted({i["file_name"].split("/")[0] for i in images})
    random.Random(42).shuffle(groups)
    validation_groups = set(groups[:max(1, len(groups) // 5)])
    for split in ("train", "val"):
        for folder in ("images", "labels"):
            (output / folder / split).mkdir(parents=True, exist_ok=True)

    def download(item):
        split = "val" if item["file_name"].split("/")[0] in validation_groups else "train"
        stem = str(item["id"])
        path = output / "images" / split / f"{stem}.jpg"
        try:
            if not path.exists():
                request = urllib.request.Request(item["flickr_640_url"], headers={"User-Agent": "Espada-research/1.0"})
                with urllib.request.urlopen(request, timeout=25) as response:
                    image = Image.open(io.BytesIO(response.read())).convert("RGB")
                image.thumbnail((640, 640))
                image.save(path, quality=90)
            rows = []
            for a in by_image.get(item["id"], []):
                x, y, w, h = a["bbox"]
                x1, y1 = max(0, x / item["width"]), max(0, y / item["height"])
                x2, y2 = min(1, (x + w) / item["width"]), min(1, (y + h) / item["height"])
                if x2 > x1 and y2 > y1:
                    rows.append(f"0 {(x1+x2)/2:.7f} {(y1+y2)/2:.7f} {x2-x1:.7f} {y2-y1:.7f}")
            (output / "labels" / split / f"{stem}.txt").write_text("\n".join(rows))
            return {"id": item["id"], "split": split, "source": item["flickr_640_url"], "group": item["file_name"].split("/")[0], "objects": len(rows)}
        except Exception as exc:
            return {"id": item["id"], "error": str(exc)}

    with ThreadPoolExecutor(max_workers=8) as pool:
        records = []
        for record in pool.map(download, images[:limit]):
            records.append(record)
            if len(records) % 25 == 0:
                print(f"Downloaded {len(records)}/{limit}, failures {sum('error' in r for r in records)}", flush=True)
    (output / "classes.json").write_text(json.dumps(["Mixed Waste"]))
    manifest = {"source": "https://github.com/pedropro/TACO", "annotationSha256": hashlib.sha256(raw).hexdigest(), "seed": 42, "splitMethod": "held-out TACO capture batches", "validationGroups": sorted(validation_groups), "classMapping": {name: "Mixed Waste" for name in categories.values()}, "scope": "General litter pilot; not marine validated", "records": records}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps({split: sum(r.get("split") == split for r in records) for split in ("train", "val")}), flush=True)
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("datasets/taco"))
    parser.add_argument("--limit", type=int, default=300)
    args = parser.parse_args()
    prepare(args.output, args.limit)
