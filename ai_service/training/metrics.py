from __future__ import annotations

import torch


def pairwise_iou(boxes_a: torch.Tensor, boxes_b: torch.Tensor) -> torch.Tensor:
    if boxes_a.numel() == 0 or boxes_b.numel() == 0:
        return torch.zeros((len(boxes_a), len(boxes_b)), device=boxes_a.device)
    top_left = torch.maximum(boxes_a[:, None, :2], boxes_b[None, :, :2])
    bottom_right = torch.minimum(boxes_a[:, None, 2:], boxes_b[None, :, 2:])
    intersection = (bottom_right - top_left).clamp(min=0).prod(dim=2)
    area_a = (boxes_a[:, 2:] - boxes_a[:, :2]).clamp(min=0).prod(dim=1)
    area_b = (boxes_b[:, 2:] - boxes_b[:, :2]).clamp(min=0).prod(dim=1)
    union = area_a[:, None] + area_b[None, :] - intersection
    return intersection / union.clamp(min=1e-8)


def match_predictions(prediction: dict, target: dict, score_threshold: float, iou_threshold: float):
    keep = prediction["scores"] >= score_threshold
    predicted_boxes = prediction["boxes"][keep]
    predicted_labels = prediction["labels"][keep]
    predicted_scores = prediction["scores"][keep]
    target_boxes = target["boxes"].to(predicted_boxes.device)
    target_labels = target["labels"].to(predicted_boxes.device)
    used_targets: set[int] = set()
    outcomes: list[tuple[float, bool]] = []

    for box, label, score in zip(predicted_boxes, predicted_labels, predicted_scores):
        candidates = torch.where(target_labels == label)[0]
        candidates = torch.tensor(
            [index.item() for index in candidates if index.item() not in used_targets],
            device=predicted_boxes.device,
            dtype=torch.long,
        )
        is_correct = False
        if candidates.numel():
            overlaps = pairwise_iou(box.unsqueeze(0), target_boxes[candidates]).squeeze(0)
            best_value, best_position = overlaps.max(dim=0)
            if float(best_value) >= iou_threshold:
                used_targets.add(int(candidates[best_position]))
                is_correct = True
        outcomes.append((float(score), is_correct))

    return outcomes, len(target_boxes) - len(used_targets)


def calibration_bins(outcomes: list[tuple[float, bool]], count: int = 10) -> list[dict]:
    result = []
    for index in range(count):
        lower = index / count
        upper = (index + 1) / count
        values = [correct for score, correct in outcomes if lower <= score <= upper]
        if not values:
            continue
        result.append(
            {
                "lower": round(lower, 2),
                "upper": round(upper, 2),
                "observedPrecision": round(sum(values) / len(values), 4),
                "samples": len(values),
            }
        )
    return result
