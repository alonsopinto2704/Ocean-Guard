from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


SERVICE_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.getenv("OCEANGUARD_DATA_DIR", str(SERVICE_ROOT / "data")))
DATABASE_PATH = DATA_DIR / "learning.db"
BASE_DATASET = Path(os.getenv("OCEANGUARD_BASE_DATASET", str(SERVICE_ROOT / "datasets" / "marine_debris")))
MODEL_DIR = Path(os.getenv("OCEANGUARD_MODEL_DIR", str(SERVICE_ROOT / "models")))
MIN_NEW_REVIEWS = int(os.getenv("OCEANGUARD_MIN_NEW_REVIEWS", "50"))
POLL_SECONDS = int(os.getenv("OCEANGUARD_RETRAIN_POLL_SECONDS", "300"))
MIN_F1_IMPROVEMENT = float(os.getenv("OCEANGUARD_MIN_F1_IMPROVEMENT", "0.005"))
EPOCHS = int(os.getenv("OCEANGUARD_RETRAIN_EPOCHS", "12"))
STATE_PATH = DATA_DIR / "continual-state.json"
PROMOTED_FILES = ("classes.json", "model-metadata.json", "espada-v1.onnx")


def read_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def reviewed_rows() -> list[sqlite3.Row]:
    if not DATABASE_PATH.exists():
        return []
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    try:
        return connection.execute(
            """
            SELECT a.id AS analysis_id, a.image_path, a.result_json,
                   f.detection_id, f.verdict, f.corrected_class, f.corrected_box_json
            FROM analyses a
            JOIN feedback f ON f.analysis_id = a.id
            ORDER BY a.created_at, f.id
            """
        ).fetchall()
    finally:
        connection.close()


def create_dataset_snapshot(rows: list[sqlite3.Row], classes: list[str], snapshot: Path) -> int:
    if snapshot.exists():
        shutil.rmtree(snapshot)
    if BASE_DATASET.exists():
        shutil.copytree(BASE_DATASET, snapshot)
    for split in ("train", "val"):
        (snapshot / "images" / split).mkdir(parents=True, exist_ok=True)
        (snapshot / "labels" / split).mkdir(parents=True, exist_ok=True)

    by_analysis: dict[str, list[sqlite3.Row]] = defaultdict(list)
    for row in rows:
        by_analysis[row["analysis_id"]].append(row)

    added = 0
    class_lookup = {name: index for index, name in enumerate(classes)}
    for position, (analysis_id, feedback_rows) in enumerate(by_analysis.items()):
        source = Path(feedback_rows[0]["image_path"])
        if not source.exists():
            continue
        result = json.loads(feedback_rows[0]["result_json"])
        detections = {item["id"]: item for item in result.get("detections", [])}
        reviewed_detection_ids = {row["detection_id"] for row in feedback_rows}
        if set(detections) - reviewed_detection_ids:
            # An unreviewed prediction is not evidence of background. Wait until
            # every proposed object in this frame has a human verdict.
            continue
        label_rows = []

        for row in feedback_rows:
            if row["verdict"] == "FALSE_POSITIVE":
                continue
            detection = detections.get(row["detection_id"])
            if not detection:
                continue
            class_name = row["corrected_class"] or detection["className"]
            if class_name not in class_lookup:
                continue
            box = (
                json.loads(row["corrected_box_json"])
                if row["corrected_box_json"]
                else detection["boundingBox"]
            )
            x_center = box["x"] + box["width"] / 2
            y_center = box["y"] + box["height"] / 2
            label_rows.append(
                f"{class_lookup[class_name]} {x_center:.6f} {y_center:.6f} "
                f"{box['width']:.6f} {box['height']:.6f}"
            )

        # Keep verified all-false-positive frames as empty-ocean negatives.
        digest = int(hashlib.sha1(analysis_id.encode("utf-8")).hexdigest(), 16)
        split = "val" if (digest % 5 == 0 or (len(by_analysis) > 1 and position == 1)) else "train"
        stem = f"feedback_{analysis_id.casefold()}"
        destination = snapshot / "images" / split / f"{stem}{source.suffix.casefold()}"
        shutil.copy2(source, destination)
        (snapshot / "labels" / split / f"{stem}.txt").write_text(
            "\n".join(label_rows), encoding="utf-8"
        )
        added += 1
    return added


def metric_from_metadata(path: Path) -> float:
    metadata = read_json(path, {})
    metrics = metadata.get("metrics") or {}
    return float(metrics.get("iou50F1", -1.0))


def candidate_should_promote(
    model_exists: bool,
    baseline_f1: float,
    candidate_f1: float,
    minimum_improvement: float = MIN_F1_IMPROVEMENT,
) -> bool:
    if candidate_f1 < 0:
        return False
    return not model_exists or candidate_f1 >= baseline_f1 + minimum_improvement


def publish_candidate(staging: Path, model_dir: Path) -> None:
    missing = [filename for filename in PROMOTED_FILES if not (staging / filename).exists()]
    if missing:
        raise FileNotFoundError(f"Candidate is incomplete: {', '.join(missing)}")
    model_dir.mkdir(parents=True, exist_ok=True)
    # Publish metadata first and the model last. The inference service watches
    # the ONNX mtime, so it can never reload a half-promoted candidate.
    for filename in PROMOTED_FILES:
        os.replace(staging / filename, model_dir / filename)


def train_and_promote(rows: list[sqlite3.Row], review_count: int) -> dict:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_root = DATA_DIR / "training-runs" / timestamp
    snapshot = DATA_DIR / "dataset-snapshots" / timestamp
    staging = MODEL_DIR / f".candidate-{timestamp}"
    classes_path = MODEL_DIR / "classes.json"
    classes = read_json(classes_path, [])
    if not classes:
        raise RuntimeError("Model classes are missing.")

    samples = create_dataset_snapshot(rows, classes, snapshot)
    if samples < 2:
        raise RuntimeError("At least two reviewed images are required for train/validation splits.")

    subprocess.run(
        [
            sys.executable,
            "-m",
            "ai_service.training.train",
            "--dataset",
            str(snapshot),
            "--classes",
            str(classes_path),
            "--output",
            str(run_root),
            "--epochs",
            str(EPOCHS),
        ],
        check=True,
    )
    subprocess.run(
        [
            sys.executable,
            "-m",
            "ai_service.training.export_onnx",
            "--checkpoint",
            str(run_root / "best.pt"),
            "--output-dir",
            str(staging),
        ],
        check=True,
    )

    baseline_f1 = metric_from_metadata(MODEL_DIR / "model-metadata.json")
    candidate_f1 = metric_from_metadata(staging / "model-metadata.json")
    should_promote = candidate_should_promote(
        (MODEL_DIR / "espada-v1.onnx").exists(),
        baseline_f1,
        candidate_f1,
    )
    if should_promote:
        publish_candidate(staging, MODEL_DIR)
    shutil.rmtree(staging, ignore_errors=True)
    return {
        "reviewCount": review_count,
        "trainingSamples": samples,
        "baselineF1": baseline_f1,
        "candidateF1": candidate_f1,
        "promoted": should_promote,
        "completedAt": datetime.now(timezone.utc).isoformat(),
    }


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print("Espada continual-learning worker started", flush=True)
    while True:
        state = read_json(STATE_PATH, {"lastProcessedReviews": 0})
        rows = reviewed_rows()
        review_count = len(rows)
        new_reviews = review_count - int(state.get("lastProcessedReviews", 0))
        if new_reviews >= MIN_NEW_REVIEWS:
            try:
                outcome = train_and_promote(rows, review_count)
                state = {"lastProcessedReviews": review_count, "lastRun": outcome}
                print(json.dumps(outcome), flush=True)
            except Exception as exc:
                state = {
                    **state,
                    "lastAttemptReviews": review_count,
                    "lastError": str(exc),
                    "lastAttemptAt": datetime.now(timezone.utc).isoformat(),
                }
                print(f"Continual training failed: {exc}", flush=True)
            STATE_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
