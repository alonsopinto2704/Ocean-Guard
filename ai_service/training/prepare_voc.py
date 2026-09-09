from __future__ import annotations

import argparse
import hashlib
import json
import random
import shutil
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

from PIL import Image


IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp")


def read_mapping(path: Path) -> dict[str, str | None]:
    mapping = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(mapping, dict) or not all(
        isinstance(key, str) and (isinstance(value, str) or value is None)
        for key, value in mapping.items()
    ):
        raise ValueError("Mapping must be a JSON object of source labels to Espada labels or null")
    return mapping


def parse_voc(xml_path: Path) -> tuple[tuple[int, int] | None, list[tuple[str, float, float, float, float]]]:
    root = ET.parse(xml_path).getroot()
    size = root.find("size")
    dimensions = None
    if size is not None and size.findtext("width") and size.findtext("height"):
        dimensions = (int(float(size.findtext("width", "0"))), int(float(size.findtext("height", "0"))))

    objects = []
    for item in root.findall("object"):
        name = (item.findtext("name") or "").strip()
        box = item.find("bndbox")
        if not name or box is None:
            continue
        try:
            objects.append(
                (
                    name,
                    float(box.findtext("xmin", "0")),
                    float(box.findtext("ymin", "0")),
                    float(box.findtext("xmax", "0")),
                    float(box.findtext("ymax", "0")),
                )
            )
        except ValueError:
            continue
    return dimensions, objects


def find_image(xml_path: Path, source: Path) -> Path | None:
    root = ET.parse(xml_path).getroot()
    filename = (root.findtext("filename") or "").strip()
    candidates = []
    if filename:
        candidates.extend((xml_path.parent / filename, source / filename))
    candidates.extend(xml_path.with_suffix(extension) for extension in IMAGE_EXTENSIONS)
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    matches = [path for path in source.rglob(f"{xml_path.stem}.*") if path.suffix.lower() in IMAGE_EXTENSIONS]
    return matches[0] if matches else None


def inspect_labels(source: Path) -> Counter[str]:
    labels: Counter[str] = Counter()
    for xml_path in source.rglob("*.xml"):
        _, objects = parse_voc(xml_path)
        labels.update(name for name, *_ in objects)
    return labels


def convert(source: Path, output: Path, classes_path: Path, mapping_path: Path, val_ratio: float, seed: int) -> dict:
    classes = json.loads(classes_path.read_text(encoding="utf-8"))
    mapping = read_mapping(mapping_path)
    class_ids = {name: index for index, name in enumerate(classes)}
    unknown_targets = sorted({value for value in mapping.values() if value is not None and value not in class_ids})
    if unknown_targets:
        raise ValueError(f"Mapping targets absent from classes.json: {unknown_targets}")

    samples = []
    unmapped: Counter[str] = Counter()
    for xml_path in sorted(source.rglob("*.xml")):
        image_path = find_image(xml_path, source)
        if image_path is None:
            continue
        dimensions, objects = parse_voc(xml_path)
        if not dimensions or dimensions[0] <= 0 or dimensions[1] <= 0:
            with Image.open(image_path) as image:
                dimensions = image.size
        width, height = dimensions
        rows = []
        for source_label, xmin, ymin, xmax, ymax in objects:
            if source_label not in mapping:
                unmapped[source_label] += 1
                continue
            target = mapping[source_label]
            if target is None:
                continue
            xmin, xmax = sorted((max(0.0, min(xmin, width)), max(0.0, min(xmax, width))))
            ymin, ymax = sorted((max(0.0, min(ymin, height)), max(0.0, min(ymax, height))))
            if xmax <= xmin or ymax <= ymin:
                continue
            rows.append(
                f"{class_ids[target]} {(xmin + xmax) / (2 * width):.6f} {(ymin + ymax) / (2 * height):.6f} "
                f"{(xmax - xmin) / width:.6f} {(ymax - ymin) / height:.6f}"
            )
        samples.append((xml_path, image_path, rows))

    if unmapped:
        raise ValueError(f"Unmapped source labels: {dict(unmapped)}. Add each to the mapping (use null to exclude).")
    if not samples:
        raise ValueError(f"No paired Pascal VOC XML/image samples found below {source}")

    rng = random.Random(seed)
    rng.shuffle(samples)
    val_count = max(1, round(len(samples) * val_ratio)) if len(samples) > 1 else 0
    split_names = ["val" if index < val_count else "train" for index in range(len(samples))]
    counts = Counter()
    for split, (_, image_path, rows) in zip(split_names, samples):
        image_dir = output / "images" / split
        label_dir = output / "labels" / split
        image_dir.mkdir(parents=True, exist_ok=True)
        label_dir.mkdir(parents=True, exist_ok=True)
        identity = hashlib.sha256(str(image_path.resolve()).encode("utf-8")).hexdigest()[:8]
        destination_name = f"{image_path.stem}-{identity}{image_path.suffix.lower()}"
        shutil.copy2(image_path, image_dir / destination_name)
        (label_dir / f"{Path(destination_name).stem}.txt").write_text("\n".join(rows) + ("\n" if rows else ""), encoding="utf-8")
        counts[split] += 1
        counts[f"{split}_boxes"] += len(rows)

    manifest = {
        "format": "Espada normalized YOLO",
        "source": str(source.resolve()),
        "classes": classes,
        "seed": seed,
        "validation_ratio": val_ratio,
        "counts": dict(counts),
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect or convert a Pascal VOC detection dataset for Espada v1")
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("datasets/marine_debris"))
    parser.add_argument("--classes", type=Path, default=Path("ai_service/models/classes.json"))
    parser.add_argument("--mapping", type=Path)
    parser.add_argument("--inspect", action="store_true")
    parser.add_argument("--val-ratio", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=41)
    args = parser.parse_args()
    if args.inspect:
        print(json.dumps(inspect_labels(args.source), indent=2))
        return
    if args.mapping is None:
        parser.error("--mapping is required unless --inspect is used")
    if not 0 < args.val_ratio < 1:
        parser.error("--val-ratio must be between 0 and 1")
    print(json.dumps(convert(args.source, args.output, args.classes, args.mapping, args.val_ratio, args.seed), indent=2))


if __name__ == "__main__":
    main()
