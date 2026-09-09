from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable


CATEGORY_BY_CLASS = {
    "plastic bottle": "Plastic",
    "plastic bag": "Plastic",
    "plastic fragment": "Plastic",
    "foam": "Plastic",
    "fishing net": "Fishing Gear",
    "rope": "Fishing Gear",
    "fishing line": "Fishing Gear",
    "metal": "Metal/Glass",
    "glass": "Metal/Glass",
    "wood": "Organic",
    "mixed waste": "Unknown",
}

CLASS_RISK_WEIGHT = {
    "fishing net": 18.0,
    "fishing line": 16.0,
    "rope": 12.0,
    "glass": 10.0,
    "metal": 8.0,
    "mixed waste": 8.0,
    "plastic bag": 6.0,
    "plastic bottle": 4.0,
    "plastic fragment": 3.0,
    "foam": 2.0,
    "wood": 0.0,
}


@dataclass(frozen=True)
class CalibrationBin:
    lower: float
    upper: float
    observed_precision: float
    samples: int


def category_for(class_name: str) -> str:
    return CATEGORY_BY_CLASS.get(class_name.casefold(), "Unknown")


def calibrate_confidence(raw_confidence: float, bins: Iterable[CalibrationBin]) -> float:
    """Calibrate a model score with held-out validation reliability bins.

    A small prior toward the raw score prevents tiny validation bins from
    creating extreme confidence values. If no bin is available, the raw model
    score is returned and the API marks it as uncalibrated.
    """
    raw = min(max(float(raw_confidence), 0.0), 1.0)
    for calibration_bin in bins:
        if calibration_bin.lower <= raw <= calibration_bin.upper:
            prior_samples = 20
            weighted = (
                calibration_bin.observed_precision * calibration_bin.samples
                + raw * prior_samples
            ) / (calibration_bin.samples + prior_samples)
            return min(max(weighted, 0.0), 1.0)
    return raw


def normalized_box(box: Iterable[float], width: int, height: int) -> dict[str, float]:
    x1, y1, x2, y2 = [float(value) for value in box]
    safe_width = max(width, 1)
    safe_height = max(height, 1)
    x1 = min(max(x1, 0.0), safe_width)
    x2 = min(max(x2, x1), safe_width)
    y1 = min(max(y1, 0.0), safe_height)
    y2 = min(max(y2, y1), safe_height)
    return {
        "x": x1 / safe_width,
        "y": y1 / safe_height,
        "width": (x2 - x1) / safe_width,
        "height": (y2 - y1) / safe_height,
    }


def risk_score(class_name: str, confidence: float, box: dict[str, float]) -> int:
    area = max(box["width"] * box["height"], 0.0)
    class_weight = CLASS_RISK_WEIGHT.get(class_name.casefold(), 4.0)
    score = confidence * 55.0 + math.sqrt(area) * 80.0 + class_weight
    return round(min(max(score, 0.0), 100.0))


def risk_level(score: int) -> str:
    if score >= 80:
        return "CRITICAL"
    if score >= 60:
        return "HIGH"
    if score >= 30:
        return "MEDIUM"
    return "LOW"


def summarize(detections: list[dict]) -> dict:
    if not detections:
        return {
            "totalDetections": 0,
            "meanConfidence": 0.0,
            "highRiskDetections": 0,
            "dominantCategory": None,
            "categoryCounts": {},
        }

    category_counts: dict[str, int] = {}
    for detection in detections:
        category = detection["parentCategory"]
        category_counts[category] = category_counts.get(category, 0) + 1

    return {
        "totalDetections": len(detections),
        "meanConfidence": round(
            sum(item["confidence"] for item in detections) / len(detections), 2
        ),
        "highRiskDetections": sum(
            item["riskLevel"] in {"HIGH", "CRITICAL"} for item in detections
        ),
        "dominantCategory": max(category_counts, key=category_counts.get),
        "categoryCounts": category_counts,
    }
