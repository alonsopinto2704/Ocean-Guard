from __future__ import annotations

import json
from pathlib import Path

import torch
from PIL import Image
from torch.utils.data import Dataset
from torchvision import tv_tensors
from torchvision.transforms import v2 as transforms


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def load_classes(path: Path) -> list[str]:
    classes = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(classes, list) or not classes or not all(isinstance(item, str) for item in classes):
        raise ValueError(f"Expected a non-empty JSON string array in {path}")
    return classes


def detection_transforms(training: bool) -> transforms.Compose:
    operations = []
    if training:
        operations.extend(
            [
                transforms.RandomHorizontalFlip(p=0.5),
                transforms.ColorJitter(brightness=0.18, contrast=0.18, saturation=0.12),
            ]
        )
    operations.extend(
        [
            transforms.ToImage(),
            transforms.ToDtype(torch.float32, scale=True),
            transforms.ToPureTensor(),
        ]
    )
    return transforms.Compose(operations)


class YoloBoxDataset(Dataset):
    """Read a standard YOLO detection dataset without Ultralytics dependencies.

    Directory layout:
      dataset/images/train/*.jpg
      dataset/images/val/*.jpg
      dataset/labels/train/*.txt
      dataset/labels/val/*.txt

    Each label row is: class_id x_center y_center width height, normalized 0..1.
    """

    def __init__(self, root: Path, split: str, classes_path: Path, training: bool) -> None:
        self.root = root
        self.split = split
        self.image_dir = root / "images" / split
        self.label_dir = root / "labels" / split
        self.classes = load_classes(classes_path)
        self.transforms = detection_transforms(training)

        if not self.image_dir.exists():
            raise FileNotFoundError(f"Missing image directory: {self.image_dir}")

        self.images = sorted(
            path for path in self.image_dir.iterdir() if path.suffix.casefold() in IMAGE_EXTENSIONS
        )
        if not self.images:
            raise ValueError(f"No supported images found in {self.image_dir}")

    def __len__(self) -> int:
        return len(self.images)

    def __getitem__(self, index: int):
        image_path = self.images[index]
        label_path = self.label_dir / f"{image_path.stem}.txt"
        image = Image.open(image_path).convert("RGB")
        width, height = image.size

        boxes: list[list[float]] = []
        labels: list[int] = []
        if label_path.exists():
            for line_number, raw_line in enumerate(label_path.read_text(encoding="utf-8").splitlines(), 1):
                line = raw_line.strip()
                if not line:
                    continue
                values = line.split()
                if len(values) != 5:
                    raise ValueError(f"{label_path}:{line_number} must contain 5 values")
                class_id = int(values[0])
                x_center, y_center, box_width, box_height = map(float, values[1:])
                if class_id < 0 or class_id >= len(self.classes):
                    raise ValueError(f"{label_path}:{line_number} has unknown class {class_id}")
                if not all(0.0 <= value <= 1.0 for value in (x_center, y_center, box_width, box_height)):
                    raise ValueError(f"{label_path}:{line_number} coordinates must be normalized 0..1")

                x1 = max(0.0, (x_center - box_width / 2) * width)
                y1 = max(0.0, (y_center - box_height / 2) * height)
                x2 = min(float(width), (x_center + box_width / 2) * width)
                y2 = min(float(height), (y_center + box_height / 2) * height)
                if x2 <= x1 or y2 <= y1:
                    continue
                boxes.append([x1, y1, x2, y2])
                labels.append(class_id + 1)  # TorchVision reserves label 0 for background.

        box_tensor = torch.tensor(boxes, dtype=torch.float32).reshape(-1, 4)
        label_tensor = torch.tensor(labels, dtype=torch.int64)
        area = (
            (box_tensor[:, 2] - box_tensor[:, 0]) * (box_tensor[:, 3] - box_tensor[:, 1])
            if len(box_tensor)
            else torch.zeros((0,), dtype=torch.float32)
        )

        target = {
            "boxes": tv_tensors.BoundingBoxes(box_tensor, format="XYXY", canvas_size=(height, width)),
            "labels": label_tensor,
            "image_id": torch.tensor(index),
            "area": area,
            "iscrowd": torch.zeros((len(labels),), dtype=torch.int64),
        }
        image, target = self.transforms(image, target)
        return image, target


def collate_detection_batch(batch):
    return tuple(zip(*batch))
