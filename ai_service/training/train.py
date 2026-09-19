from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import torch
from torch.utils.data import DataLoader

try:
    from .dataset import YoloBoxDataset, collate_detection_batch, load_classes
    from .detector import build_detector
    from .metrics import calibration_bins, match_predictions
except ImportError:
    from dataset import YoloBoxDataset, collate_detection_batch, load_classes
    from detector import build_detector
    from metrics import calibration_bins, match_predictions


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train Espada version 1")
    parser.add_argument("--dataset", type=Path, required=True, help="YOLO-format dataset root")
    parser.add_argument(
        "--classes",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "models" / "classes.json",
    )
    parser.add_argument("--output", type=Path, default=Path("training_runs/marine_detector"))
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--learning-rate", type=float, default=0.003)
    parser.add_argument("--score-threshold", type=float, default=0.35)
    parser.add_argument("--device", default="auto", help="auto, cpu, cuda, or mps")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--architecture", default="SSDLite320 MobileNetV3")
    parser.add_argument("--input-size", type=int, default=320)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--resume", type=Path)
    parser.add_argument("--freeze-backbone", action="store_true")
    return parser.parse_args()


def resolve_device(requested: str) -> torch.device:
    if requested != "auto":
        return torch.device(requested)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def train_epoch(model, loader, optimizer, device: torch.device) -> float:
    model.train()
    if not any(p.requires_grad for p in model.backbone.parameters()):
        model.backbone.eval()
    running_loss = 0.0
    for images, targets in loader:
        images = [image.to(device) for image in images]
        targets = [{key: value.to(device) for key, value in target.items()} for target in targets]
        losses = model(images, targets)
        total_loss = sum(loss for loss in losses.values())
        optimizer.zero_grad(set_to_none=True)
        total_loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=10.0)
        optimizer.step()
        running_loss += float(total_loss.detach())
    return running_loss / max(len(loader), 1)


@torch.inference_mode()
def evaluate(model, loader, device: torch.device, score_threshold: float) -> dict:
    model.eval()
    outcomes: list[tuple[float, bool]] = []
    false_negatives = 0
    for images, targets in loader:
        images_on_device = [image.to(device) for image in images]
        predictions = model(images_on_device)
        for prediction, target in zip(predictions, targets):
            matched, missed = match_predictions(prediction, target, score_threshold, 0.5)
            outcomes.extend(matched)
            false_negatives += missed

    true_positives = sum(correct for _, correct in outcomes)
    false_positives = len(outcomes) - true_positives
    precision = true_positives / max(true_positives + false_positives, 1)
    recall = true_positives / max(true_positives + false_negatives, 1)
    f1 = 2 * precision * recall / max(precision + recall, 1e-8)
    return {
        "iou50Precision": round(precision, 4),
        "iou50Recall": round(recall, 4),
        "iou50F1": round(f1, 4),
        "truePositives": true_positives,
        "falsePositives": false_positives,
        "falseNegatives": false_negatives,
        "calibrationBins": calibration_bins(outcomes),
    }


def main() -> None:
    args = parse_args()
    random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.set_num_threads(args.threads)
    device = resolve_device(args.device)
    classes = load_classes(args.classes)
    train_dataset = YoloBoxDataset(args.dataset, "train", args.classes, training=True)
    val_dataset = YoloBoxDataset(args.dataset, "val", args.classes, training=False)
    train_loader = DataLoader(
        train_dataset,
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.workers,
        collate_fn=collate_detection_batch,
    )
    val_loader = DataLoader(
        val_dataset,
        batch_size=1,
        shuffle=False,
        num_workers=args.workers,
        collate_fn=collate_detection_batch,
    )

    model = build_detector(len(classes), pretrained=not bool(args.resume), architecture=args.architecture, input_size=args.input_size).to(device)
    if args.resume:
        checkpoint = torch.load(args.resume, map_location=device, weights_only=True)
        if checkpoint['classes'] != classes:
            raise ValueError('Resume checkpoint class schema differs from dataset.')
        model.load_state_dict(checkpoint['model_state_dict'])
    if args.freeze_backbone:
        for parameter in model.backbone.parameters():
            parameter.requires_grad = False
    optimizer = torch.optim.SGD(
        [parameter for parameter in model.parameters() if parameter.requires_grad],
        lr=args.learning_rate,
        momentum=0.9,
        weight_decay=0.0005,
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    args.output.mkdir(parents=True, exist_ok=True)
    best_f1 = -1.0

    for epoch in range(1, args.epochs + 1):
        loss = train_epoch(model, train_loader, optimizer, device)
        metrics = evaluate(model, val_loader, device, args.score_threshold)
        scheduler.step()
        print(json.dumps({"epoch": epoch, "trainLoss": round(loss, 5), **metrics}), flush=True)

        checkpoint = {
            "epoch": epoch,
            "model_state_dict": model.state_dict(),
            "optimizer_state_dict": optimizer.state_dict(),
            "classes": classes,
            "metrics": metrics,
            "architecture": args.architecture,
            "inputSize": args.input_size,
            "scoreThreshold": args.score_threshold,
            "dataset": str(args.dataset),
            "trainingImages": len(train_dataset),
            "validationImages": len(val_dataset),
        }
        torch.save(checkpoint, args.output / "last.pt")
        if metrics["iou50F1"] > best_f1:
            best_f1 = metrics["iou50F1"]
            torch.save(checkpoint, args.output / "best.pt")

    (args.output / "metrics.json").write_text(
        json.dumps({"bestIoU50F1": best_f1, "last": metrics}, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
