from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

try:
    from .detector import build_detector
except ImportError:
    from detector import build_detector


class SingleImageDetector(torch.nn.Module):
    def __init__(self, detector: torch.nn.Module) -> None:
        super().__init__()
        self.detector = detector

    def forward(self, image_batch: torch.Tensor):
        result = self.detector([image_batch[0]])[0]
        return result["boxes"], result["scores"], result["labels"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export Espada version 1 to portable ONNX")
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "models",
    )
    parser.add_argument("--input-size", type=int, default=640)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    classes = checkpoint["classes"]
    model = build_detector(len(classes), pretrained=False)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()
    wrapper = SingleImageDetector(model).eval()
    dummy = torch.rand(1, 3, args.input_size, args.input_size)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    output_path = args.output_dir / "espada-v1.onnx"
    torch.onnx.export(
        wrapper,
        dummy,
        output_path,
        input_names=["images"],
        output_names=["boxes", "scores", "labels"],
        dynamic_axes={
            "boxes": {0: "detections"},
            "scores": {0: "detections"},
            "labels": {0: "detections"},
        },
        opset_version=17,
        do_constant_folding=True,
    )

    (args.output_dir / "classes.json").write_text(json.dumps(classes, indent=2), encoding="utf-8")
    metrics = checkpoint.get("metrics", {})
    metadata = {
        "name": "Espada",
        "version": "1",
        "architecture": checkpoint.get("architecture", "Faster R-CNN MobileNetV3 FPN"),
        "trainingStatus": "TRAINED",
        "metrics": {key: value for key, value in metrics.items() if key != "calibrationBins"},
        "calibrationBins": metrics.get("calibrationBins", []),
    }
    (args.output_dir / "model-metadata.json").write_text(
        json.dumps(metadata, indent=2), encoding="utf-8"
    )
    print(f"Exported portable model to {output_path}")


if __name__ == "__main__":
    main()
