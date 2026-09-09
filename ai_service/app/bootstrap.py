from __future__ import annotations

from collections import deque
from typing import Any

import numpy as np
from PIL import Image


def _shift(mask: np.ndarray, dy: int, dx: int) -> np.ndarray:
    shifted = np.zeros_like(mask)
    source_y = slice(max(0, -dy), mask.shape[0] - max(0, dy))
    source_x = slice(max(0, -dx), mask.shape[1] - max(0, dx))
    target_y = slice(max(0, dy), mask.shape[0] - max(0, -dy))
    target_x = slice(max(0, dx), mask.shape[1] - max(0, -dx))
    shifted[target_y, target_x] = mask[source_y, source_x]
    return shifted


def _dilate(mask: np.ndarray, passes: int = 1) -> np.ndarray:
    result = mask
    for _ in range(passes):
        result = (
            result
            | _shift(result, -1, 0)
            | _shift(result, 1, 0)
            | _shift(result, 0, -1)
            | _shift(result, 0, 1)
        )
    return result


def _components(mask: np.ndarray) -> list[list[tuple[int, int]]]:
    height, width = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    components: list[list[tuple[int, int]]] = []
    for y in range(height):
        for x in range(width):
            if not mask[y, x] or visited[y, x]:
                continue
            queue = deque([(y, x)])
            visited[y, x] = True
            component: list[tuple[int, int]] = []
            while queue:
                current_y, current_x = queue.popleft()
                component.append((current_y, current_x))
                for next_y, next_x in (
                    (current_y - 1, current_x),
                    (current_y + 1, current_x),
                    (current_y, current_x - 1),
                    (current_y, current_x + 1),
                ):
                    if (
                        0 <= next_y < height
                        and 0 <= next_x < width
                        and mask[next_y, next_x]
                        and not visited[next_y, next_x]
                    ):
                        visited[next_y, next_x] = True
                        queue.append((next_y, next_x))
            components.append(component)
    return components


def detect_visual_anomalies(image: Image.Image, max_candidates: int = 12) -> list[dict[str, Any]]:
    """Find compact regions that differ from the surrounding marine scene.

    This deterministic cold-start detector is intentionally class-agnostic. Its
    score represents visual anomaly strength, not a calibrated probability.
    Human review of its candidates supplies safe labels for the learned model.
    """
    source = image.convert("RGB")
    scale = min(1.0, 320 / max(source.size))
    width = max(1, round(source.width * scale))
    height = max(1, round(source.height * scale))
    working = source.resize((width, height), Image.Resampling.BILINEAR)
    rgb = np.asarray(working, dtype=np.float32) / 255.0

    border_width = max(2, min(width, height) // 32)
    border = np.concatenate(
        [
            rgb[:border_width].reshape(-1, 3),
            rgb[-border_width:].reshape(-1, 3),
            rgb[:, :border_width].reshape(-1, 3),
            rgb[:, -border_width:].reshape(-1, 3),
        ],
        axis=0,
    )
    background = np.median(border, axis=0)
    color_distance = np.linalg.norm(rgb - background, axis=2) / np.sqrt(3.0)

    horizontal = np.zeros((height, width), dtype=np.float32)
    vertical = np.zeros((height, width), dtype=np.float32)
    horizontal[:, 1:] = np.mean(np.abs(rgb[:, 1:] - rgb[:, :-1]), axis=2)
    vertical[1:, :] = np.mean(np.abs(rgb[1:] - rgb[:-1]), axis=2)
    anomaly = color_distance * 0.8 + np.maximum(horizontal, vertical) * 0.2

    median = float(np.median(anomaly))
    deviation = float(np.median(np.abs(anomaly - median)))
    threshold = max(0.12, median + 4.0 * max(deviation, 0.01))
    mask = _dilate(anomaly >= threshold, passes=1)

    pixel_count = height * width
    minimum_area = max(14, round(pixel_count * 0.00035))
    maximum_area = round(pixel_count * 0.32)
    candidates = []
    for component in _components(mask):
        area = len(component)
        if area < minimum_area or area > maximum_area:
            continue
        points = np.asarray(component)
        y1, x1 = points.min(axis=0)
        y2, x2 = points.max(axis=0)
        box_width = int(x2 - x1 + 1)
        box_height = int(y2 - y1 + 1)
        if box_width < 3 or box_height < 3:
            continue
        component_strength = float(np.mean(anomaly[points[:, 0], points[:, 1]]))
        normalized_strength = (component_strength - threshold) / max(1.0 - threshold, 1e-6)
        area_signal = min(area / max(pixel_count * 0.025, 1), 1.0)
        anomaly_score = min(max(0.35 + 0.5 * normalized_strength + 0.1 * area_signal, 0.35), 0.95)
        padding = 2
        x1 = max(0, int(x1) - padding)
        y1 = max(0, int(y1) - padding)
        x2 = min(width - 1, int(x2) + padding)
        y2 = min(height - 1, int(y2) + padding)
        candidates.append(
            {
                "score": anomaly_score,
                "boundingBox": {
                    "x": x1 / width,
                    "y": y1 / height,
                    "width": (x2 - x1 + 1) / width,
                    "height": (y2 - y1 + 1) / height,
                },
            }
        )

    candidates.sort(key=lambda item: item["score"], reverse=True)
    return candidates[:max_candidates]
