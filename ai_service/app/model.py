from __future__ import annotations

import io
import json
import os
import time
from threading import RLock
from pathlib import Path
from typing import Any

from .core import (
    CalibrationBin,
    calibrate_confidence,
    category_for,
    normalized_box,
    risk_level,
    risk_score,
    summarize,
)
from .bootstrap import detect_visual_anomalies


class ModelNotReadyError(RuntimeError):
    pass


class MarineDebrisDetector:
    def __init__(self) -> None:
        self._lock = RLock()
        default_model_dir = Path(__file__).resolve().parents[1] / "models"
        model_path = Path(
            os.getenv("OCEANGUARD_MODEL_PATH", str(default_model_dir / "espada-v1.onnx"))
        )
        classes_path = Path(
            os.getenv("OCEANGUARD_CLASSES_PATH", str(default_model_dir / "classes.json"))
        )
        metadata_path = Path(
            os.getenv(
                "OCEANGUARD_METADATA_PATH", str(default_model_dir / "model-metadata.json")
            )
        )

        self.model_path = model_path
        self.model_root = model_path.parent
        self.classes_path = classes_path
        self.metadata_path = metadata_path
        self.input_size = int(os.getenv("OCEANGUARD_INPUT_SIZE", "640"))
        self.threshold = float(os.getenv("OCEANGUARD_CONFIDENCE_THRESHOLD", "0.35"))
        self.bootstrap_enabled = os.getenv("ESPADA_BOOTSTRAP_ENABLED", "true").casefold() == "true"
        self.classes = self._read_json(classes_path, default=[])
        self.metadata = self._read_json(metadata_path, default={})
        self.calibration_bins = self._load_calibration(self.metadata)
        self.session: Any | None = None
        self.input_name: str | None = None
        self.load_error: str | None = None
        self.model_mtime: float | None = None
        self._load_model()

    def _load_model(self) -> None:
        self.load_error = None
        if not self.model_path.exists():
            self.load_error = "No trained ONNX weights were found. Train and export the detector first."
            return

        try:
            import onnxruntime as ort

            available = ort.get_available_providers()
            providers = [
                provider
                for provider in ("CUDAExecutionProvider", "CoreMLExecutionProvider", "CPUExecutionProvider")
                if provider in available
            ]
            options = ort.SessionOptions()
            options.intra_op_num_threads = min(4, os.cpu_count() or 1)
            session = ort.InferenceSession(str(self.model_path), sess_options=options, providers=providers)
            input_info = session.get_inputs()[0]
            if len(input_info.shape) != 4 or input_info.shape[1] != 3:
                raise ValueError('Expected one NCHW RGB image tensor.')
            if [o.name for o in session.get_outputs()] != ['boxes', 'scores', 'labels']:
                raise ValueError('Expected boxes, scores and labels outputs.')
            metadata = self._read_json(self.metadata_path, default={})
            classes = self._read_json(self.classes_path, default=[])
            if not classes or not all(isinstance(c, str) for c in classes):
                raise ValueError('Model classes are missing or invalid.')
            input_size = int(input_info.shape[2]) if isinstance(input_info.shape[2], int) else int(metadata.get('inputSize', 640))
            threshold = float(os.getenv('OCEANGUARD_CONFIDENCE_THRESHOLD', str(metadata.get('confidenceThreshold', .35))))
            if input_info.shape[2] != input_info.shape[3] or not 32 <= input_size <= 2048:
                raise ValueError('Expected a square input between 32 and 2048 pixels.')
            if not 0 < threshold <= 1:
                raise ValueError('Confidence threshold must be in (0, 1].')
            bins = self._load_calibration(metadata)
            mtime = self.model_path.stat().st_mtime
            # Only commit after every part of the candidate is valid.
            self.session, self.input_name = session, input_info.name
            self.input_size, self.threshold = input_size, threshold
            self.metadata, self.classes = metadata, classes
            self.calibration_bins, self.model_mtime = bins, mtime
        except Exception as exc:  # Service must still start and report diagnostics.
            self.load_error = f"Unable to load ONNX model: {exc}"
            if self.model_path.exists():
                self.model_mtime = self.model_path.stat().st_mtime

    def _refresh_if_promoted(self) -> None:
        pointer = self._read_json(self.model_root / 'current.json', {})
        if pointer.get('release'):
            release = (self.model_root / pointer['release']).resolve()
            if not release.is_relative_to(self.model_root.resolve()):
                self.load_error = 'Invalid model release path.'
                return
            if release / 'espada-v1.onnx' != self.model_path:
                self.model_path = release / 'espada-v1.onnx'
                self.classes_path = release / 'classes.json'
                self.metadata_path = release / 'model-metadata.json'
                self.model_mtime = None
        if not self.model_path.exists():
            return
        current_mtime = self.model_path.stat().st_mtime
        if self.model_mtime == current_mtime:
            return
        self._load_model()

    @staticmethod
    def _read_json(path: Path, default: Any) -> Any:
        if not path.exists():
            return default
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return default

    @staticmethod
    def _load_calibration(metadata: dict) -> list[CalibrationBin]:
        bins = []
        for item in metadata.get("calibrationBins", []):
            try:
                bins.append(
                    CalibrationBin(
                        lower=float(item["lower"]),
                        upper=float(item["upper"]),
                        observed_precision=float(item["observedPrecision"]),
                        samples=int(item["samples"]),
                    )
                )
            except (KeyError, TypeError, ValueError):
                continue
        return bins

    @property
    def ready(self) -> bool:
        learned_ready = self.session is not None and self.input_name is not None
        return bool(self.classes) and (learned_ready or self.bootstrap_enabled)

    def status(self) -> dict:
        with self._lock:
            return self._status_locked()

    def _status_locked(self) -> dict:
        self._refresh_if_promoted()
        learned_ready = self.session is not None and self.input_name is not None
        state = (
            "READY"
            if learned_ready
            else "BOOTSTRAP"
            if self.ready
            else "NEEDS_TRAINING"
            if not self.model_path.exists()
            else "ERROR"
        )
        return {
            "state": state,
            "ready": self.ready,
            "service": "Espada Intelligence",
            "engine": "ONNX Runtime" if learned_ready else "Espada visual-anomaly bootstrap",
            "modelName": self.metadata.get("name", "Espada"),
            "version": self.metadata.get("version", "1"),
            "architecture": self.metadata.get(
                "architecture", "Faster R-CNN MobileNetV3 FPN"
            ),
            "classes": self.classes,
            "inputSize": self.input_size,
            "confidenceThreshold": self.threshold,
            "confidenceCalibration": (
                "validation_bins"
                if self.calibration_bins
                else "raw_model_score"
                if learned_ready
                else "visual_anomaly_score"
            ),
            "metrics": self.metadata.get("metrics"),
            "trainedAt": self.metadata.get('trainedAt'),
            "trainingImages": self.metadata.get('trainingImages'),
            "validationImages": self.metadata.get('validationImages'),
            "validationScope": self.metadata.get('validationScope'),
            "error": self.load_error if not self.ready else None,
            "notice": self.load_error or self.metadata.get('validationScope'),
        }

    def predict(self, image_bytes: bytes, filename: str) -> dict:
        with self._lock:
            return self._predict_locked(image_bytes, filename)

    def _predict_locked(self, image_bytes: bytes, filename: str) -> dict:
        self._refresh_if_promoted()
        if not self.ready:
            raise ModelNotReadyError(self.load_error or "The detector is not ready.")

        try:
            import numpy as np
            from PIL import Image, ImageOps
        except ImportError as exc:
            raise ModelNotReadyError(f"AI runtime dependency missing: {exc}") from exc

        image = Image.open(io.BytesIO(image_bytes))
        if image.width * image.height > 25_000_000:
            raise ValueError('Image exceeds the 25 megapixel limit. Resize it before uploading.')
        image = ImageOps.exif_transpose(image).convert("RGB")
        if self.session is None or self.input_name is None:
            return self._predict_bootstrap(image, filename)

        source_width, source_height = image.size
        resized = image.resize((self.input_size, self.input_size))
        tensor = np.asarray(resized, dtype=np.float32) / 255.0
        tensor = np.transpose(tensor, (2, 0, 1))[None, ...]

        started = time.perf_counter()
        boxes, scores, labels = self.session.run(None, {self.input_name: tensor})
        latency_ms = round((time.perf_counter() - started) * 1000, 2)

        boxes = np.asarray(boxes).reshape(-1, 4)
        scores = np.asarray(scores).reshape(-1)
        labels = np.asarray(labels).reshape(-1)
        detections = []

        for index, raw_score in enumerate(scores):
            raw_confidence = float(raw_score)
            if not np.isfinite(raw_confidence) or raw_confidence < self.threshold or not np.all(np.isfinite(boxes[index])):
                continue

            class_index = int(labels[index]) - 1  # TorchVision reserves 0 for background.
            if class_index < 0 or class_index >= len(self.classes):
                continue

            class_name = self.classes[class_index]
            calibrated = calibrate_confidence(raw_confidence, self.calibration_bins)
            bbox = normalized_box(boxes[index], self.input_size, self.input_size)
            if bbox['width'] <= 0 or bbox['height'] <= 0:
                continue
            score = risk_score(class_name, calibrated, bbox)
            detections.append(
                {
                    "id": f"AI-{index + 1:03d}",
                    "className": class_name,
                    "parentCategory": category_for(class_name),
                    "confidence": round(calibrated * 100, 2),
                    "rawConfidence": round(raw_confidence * 100, 2),
                    "confidenceCalibrated": any(b.lower <= raw_confidence <= b.upper for b in self.calibration_bins),
                    "boundingBox": bbox,
                    "riskScore": score,
                    "riskLevel": risk_level(score),
                }
            )

        detections.sort(key=lambda item: item["confidence"], reverse=True)
        return {
            "model": {
                "name": self.metadata.get("name", "Espada"),
                "version": self.metadata.get("version", "1"),
                "engine": "ONNX Runtime",
            },
            "source": {
                "filename": filename,
                "width": source_width,
                "height": source_height,
            },
            "latencyMs": latency_ms,
            "detections": detections,
            "summary": summarize(detections),
            "analysis": {
                "riskMethod": "rules_v1",
                "confidenceMethod": "validation_bins" if self.calibration_bins else "raw_model_score",
            },
        }

    def _predict_bootstrap(self, image: Any, filename: str) -> dict:
        started = time.perf_counter()
        candidates = detect_visual_anomalies(image)
        latency_ms = round((time.perf_counter() - started) * 1000, 2)
        detections = []
        for index, candidate in enumerate(candidates):
            confidence = float(candidate["score"])
            bbox = candidate["boundingBox"]
            score = risk_score("Mixed Waste", confidence, bbox)
            detections.append(
                {
                    "id": f"AI-{index + 1:03d}",
                    "className": "Mixed Waste",
                    "parentCategory": category_for("Mixed Waste"),
                    "confidence": round(confidence * 100, 2),
                    "rawConfidence": round(confidence * 100, 2),
                    "confidenceCalibrated": False,
                    "boundingBox": bbox,
                    "riskScore": score,
                    "riskLevel": risk_level(score),
                }
            )
        return {
            "model": {"name": "Espada", "version": "1", "engine": "visual-anomaly bootstrap"},
            "source": {
                "filename": filename,
                "width": image.width,
                "height": image.height,
            },
            "latencyMs": latency_ms,
            "detections": detections,
            "summary": summarize(detections),
            "analysis": {
                "riskMethod": "rules_v1",
                "confidenceMethod": "visual_anomaly_score",
            },
        }
