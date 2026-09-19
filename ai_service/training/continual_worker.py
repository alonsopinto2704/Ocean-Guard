from __future__ import annotations

import hashlib
import json
import math
import os
import shutil
import sqlite3
import subprocess
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Sequence


SERVICE_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.getenv("OCEANGUARD_DATA_DIR", str(SERVICE_ROOT / "data")))
DATABASE_PATH = DATA_DIR / "learning.db"
BASE_DATASET = Path(os.getenv("OCEANGUARD_BASE_DATASET", str(SERVICE_ROOT.parent / "datasets" / "taco")))
MODEL_DIR = Path(os.getenv("OCEANGUARD_MODEL_DIR", str(SERVICE_ROOT / "models")))
MIN_NEW_REVIEWS = int(os.getenv("OCEANGUARD_MIN_NEW_REVIEWS", "50"))
POLL_SECONDS = int(os.getenv("OCEANGUARD_RETRAIN_POLL_SECONDS", "300"))
MIN_F1_IMPROVEMENT = float(os.getenv("OCEANGUARD_MIN_F1_IMPROVEMENT", "0.005"))
EPOCHS = int(os.getenv("OCEANGUARD_RETRAIN_EPOCHS", "12"))
STATE_PATH = DATA_DIR / "continual-state.json"
PROMOTED_FILES = ("checkpoint.pt", "classes.json", "model-metadata.json", "espada-v1.onnx")
HEARTBEAT_SECONDS = int(os.getenv("OCEANGUARD_TRAINING_HEARTBEAT_SECONDS", "30"))


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
        if connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'frame_reviews'"
        ).fetchone() is None:
            return []
        return connection.execute(
            """
            SELECT a.id AS analysis_id, a.image_path, a.result_json,
                   fr.id AS frame_review_id, fr.revision AS frame_revision,
                   fr.content_hash AS frame_content_hash,
                   fr.updated_at AS frame_review_updated_at,
                   f.id AS feedback_id, f.detection_id, f.verdict,
                   f.annotation_id, f.source_detection_id,
                   f.corrected_class, f.corrected_box_json
            FROM analyses a
            JOIN frame_reviews fr ON fr.analysis_id = a.id
            LEFT JOIN feedback f ON f.analysis_id = a.id
            ORDER BY fr.id, f.id
            """
        ).fetchall()
    finally:
        connection.close()


def feedback_revision(rows: list[sqlite3.Row], through_id: int | None = None) -> str:
    """Fingerprint committed whole-frame reviews through a stable review id."""
    fields = (
        "frame_review_id",
        "analysis_id",
        "image_path",
        "result_json",
        "frame_revision",
        "frame_content_hash",
        "frame_review_updated_at",
    )
    unique = {}
    for row in rows:
        review_id = int(row["frame_review_id"])
        if through_id is None or review_id <= through_id:
            unique[review_id] = [row[field] for field in fields]
    payload = [unique[key] for key in sorted(unique)]
    return hashlib.sha256(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()


def reviews_require_training(rows: list[sqlite3.Row], state: dict) -> tuple[int, bool]:
    cursor = int(state.get("lastProcessedFrameReviewId", 0))
    new_reviews = len({
        int(row["frame_review_id"])
        for row in rows
        if int(row["frame_review_id"]) > cursor
    })
    processed_reviews_changed = feedback_revision(rows, cursor) != state.get("lastProcessedRevision")
    return new_reviews, processed_reviews_changed


def write_state(state: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    temporary = STATE_PATH.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, indent=2), encoding="utf-8")
    os.replace(temporary, STATE_PATH)


def touch_training_heartbeat() -> None:
    state = read_json(STATE_PATH, {})
    state.update({"state": "TRAINING", "lastHeartbeat": datetime.now(timezone.utc).isoformat()})
    write_state(state)


def run_with_heartbeat(command: Sequence[str], heartbeat: Callable[[], None] = touch_training_heartbeat) -> None:
    """Run a child process while keeping the externally visible trainer lease alive."""
    heartbeat()
    process = subprocess.Popen(list(command))
    while True:
        try:
            return_code = process.wait(timeout=HEARTBEAT_SECONDS)
            break
        except subprocess.TimeoutExpired:
            heartbeat()
    if return_code:
        raise subprocess.CalledProcessError(return_code, list(command))


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
    # Never learn from re-uploaded validation images, even if the file name changes.
    from PIL import Image, ImageOps
    def image_digest(path: Path) -> str:
        with Image.open(path) as image:
            normalized = ImageOps.exif_transpose(image).convert('RGB')
            return hashlib.sha256(str(normalized.size).encode() + normalized.tobytes()).hexdigest()
    validation_digests = {image_digest(p) for p in (snapshot / 'images' / 'val').glob('*') if p.suffix.lower() in ('.jpg', '.jpeg', '.png', '.webp')}
    class_lookup = {name: index for index, name in enumerate(classes)}
    for position, (analysis_id, feedback_rows) in enumerate(by_analysis.items()):
        source = Path(feedback_rows[0]["image_path"])
        if not source.exists():
            raise FileNotFoundError(f"Committed frame {analysis_id} is missing its source image: {source}")
        try:
            with Image.open(source) as img:
                img.verify()
        except Exception as exc:
            raise ValueError(f"Committed frame {analysis_id} contains an unreadable or corrupt image {source}: {exc}") from exc

        if image_digest(source) in validation_digests:
            continue

        try:
            result = json.loads(feedback_rows[0]["result_json"])
            if not isinstance(result, dict) or "detections" not in result:
                raise ValueError("result_json must be an object containing a 'detections' list.")
            detections = {item["id"]: item for item in result.get("detections", []) if isinstance(item, dict) and "id" in item}
            raw_annotations = []
            for row in feedback_rows:
                if row["feedback_id"] is None:
                    continue
                if not row["annotation_id"]:
                    raise ValueError(f"Committed frame {analysis_id} contains an unversioned feedback row.")
                box = None
                if row["corrected_box_json"]:
                    box = json.loads(row["corrected_box_json"])
                raw_annotations.append({
                    "annotationId": row["annotation_id"],
                    "sourceDetectionId": row["source_detection_id"],
                    "verdict": row["verdict"],
                    "correctedClass": row["corrected_class"],
                    "correctedBoundingBox": box,
                })
            from ai_service.app.learning import LearningStore
            annotations, _, calculated_hash = LearningStore._canonical_review(
                result, raw_annotations, None, set(classes)
            )
            if "frame_content_hash" in feedback_rows[0].keys():
                stored_hashes = {row["frame_content_hash"] for row in feedback_rows}
                if stored_hashes != {calculated_hash}:
                    raise ValueError(
                        f"Committed frame {analysis_id} annotations do not match its content hash."
                    )
        except (TypeError, ValueError, KeyError, json.JSONDecodeError) as exc:
            raise ValueError(f"Committed frame {analysis_id} is malformed: {exc}") from exc

        label_rows = []
        for annotation in annotations:
            if annotation["verdict"] == "FALSE_POSITIVE":
                continue
            source_detection_id = annotation["sourceDetectionId"]
            detection = detections.get(source_detection_id) if source_detection_id else None
            class_name = annotation["correctedClass"] or (detection["className"] if detection else None)
            if not class_name or class_name not in class_lookup:
                raise ValueError(
                    f"Committed frame {analysis_id} uses class {class_name!r}, which is absent from training classes."
                )
            if annotation["correctedBoundingBox"] is not None:
                box = annotation["correctedBoundingBox"]
            elif detection and "boundingBox" in detection:
                box = LearningStore._normalize_box(detection["boundingBox"])
            else:
                raise ValueError(
                    f"Committed frame {analysis_id} is missing bounding box for annotation {annotation['annotationId']}."
                )
            x_center = box["x"] + box["width"] / 2
            y_center = box["y"] + box["height"] / 2
            label_rows.append(
                f"{class_lookup[class_name]} {x_center:.6f} {y_center:.6f} "
                f"{box['width']:.6f} {box['height']:.6f}"
            )

        # Keep verified all-false-positive frames as empty-ocean negatives.
        # The original capture-batch holdout stays fixed. Adjacent camera frames
        # must never get randomly split across training and validation.
        split = "train"
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
    if not math.isfinite(candidate_f1) or not 0 < candidate_f1 <= 1:
        return False
    if model_exists and not math.isfinite(baseline_f1):
        return False
    return not model_exists or candidate_f1 >= baseline_f1 + minimum_improvement


def publish_candidate(staging: Path, model_dir: Path) -> None:
    missing = [filename for filename in PROMOTED_FILES if not (staging / filename).exists()]
    if missing:
        raise FileNotFoundError(f"Candidate is incomplete: {', '.join(missing)}")
    validate_candidate_bundle(staging)
    model_dir.mkdir(parents=True, exist_ok=True)
    # A single atomic pointer switches an immutable, complete bundle. The
    # previous release remains available for rollback and in-flight inference.
    releases = model_dir / 'releases'
    releases.mkdir(exist_ok=True)
    release = releases / f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}-{time.time_ns()}"
    os.replace(staging, release)
    temporary = model_dir / '.current.tmp'
    temporary.write_text(json.dumps({'release': release.relative_to(model_dir).as_posix()}), encoding='utf-8')
    os.replace(temporary, model_dir / 'current.json')


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def validate_candidate_bundle(staging: Path) -> None:
    """Load and cross-check every artifact before the release pointer can move."""
    classes = read_json(staging / "classes.json", None)
    metadata = read_json(staging / "model-metadata.json", None)
    if not isinstance(classes, list) or not classes or len(set(classes)) != len(classes) or not all(isinstance(item, str) and item.strip() for item in classes):
        raise ValueError("Candidate classes are missing or invalid.")
    if not isinstance(metadata, dict):
        raise ValueError("Candidate metadata is missing or invalid.")
    verification = metadata.get("verification")
    if not isinstance(verification, dict) or verification.get("modelSha256") != _sha256(staging / "espada-v1.onnx"):
        raise ValueError("Candidate ONNX file does not match its verification metadata.")
    if verification.get("checkpointSha256") != _sha256(staging / "checkpoint.pt"):
        raise ValueError("Candidate checkpoint does not match its verification metadata.")
    metrics = metadata.get("metrics")
    candidate_f1 = float(metrics.get("iou50F1", float("nan"))) if isinstance(metrics, dict) else float("nan")
    if not math.isfinite(candidate_f1) or not 0 < candidate_f1 <= 1:
        raise ValueError("Candidate verification metrics are missing or invalid.")
    bins = metadata.get("calibrationBins")
    if not isinstance(bins, list):
        raise ValueError("Candidate calibration metadata is missing or invalid.")

    import numpy as np
    import onnxruntime as ort
    import torch

    checkpoint = torch.load(staging / "checkpoint.pt", map_location="cpu", weights_only=True)
    if checkpoint.get("classes") != classes:
        raise ValueError("Candidate checkpoint and classes.json disagree.")
    input_size = int(metadata.get("inputSize", 0))
    if checkpoint.get("architecture") != metadata.get("architecture") or int(checkpoint.get("inputSize", 0)) != input_size:
        raise ValueError("Candidate checkpoint and metadata disagree.")
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    session = ort.InferenceSession(str(staging / "espada-v1.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
    inputs = session.get_inputs()
    if len(inputs) != 1 or inputs[0].shape != [1, 3, input_size, input_size]:
        raise ValueError("Candidate ONNX input contract is invalid.")
    if [output.name for output in session.get_outputs()] != ["boxes", "scores", "labels"]:
        raise ValueError("Candidate ONNX output contract is invalid.")
    outputs = session.run(None, {inputs[0].name: np.zeros((1, 3, input_size, input_size), dtype=np.float32)})
    if len(outputs) != 3 or any(not np.all(np.isfinite(value)) for value in outputs):
        raise ValueError("Candidate ONNX smoke inference returned invalid outputs.")


def active_model_dir() -> Path:
    pointer = read_json(MODEL_DIR / 'current.json', {})
    directory = (MODEL_DIR / pointer.get('release', '.')).resolve()
    if not directory.is_relative_to(MODEL_DIR.resolve()):
        raise ValueError('Invalid release pointer.')
    return directory


def evaluate_incumbent(model_dir: Path, snapshot: Path, threshold: float, heartbeat: Callable[[], None] | None = None) -> float:
    """Evaluate the incumbent on exactly the same holdout as the candidate."""
    import torch
    import numpy as np
    import onnxruntime as ort
    from .dataset import YoloBoxDataset
    from .metrics import match_predictions
    from PIL import Image
    dataset = YoloBoxDataset(snapshot, 'val', model_dir / 'classes.json', training=False)
    options = ort.SessionOptions(); options.intra_op_num_threads = 4
    session = ort.InferenceSession(str(model_dir / 'espada-v1.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
    size = int(session.get_inputs()[0].shape[2])
    tp = fp = fn = 0
    for index, (image, target) in enumerate(dataset):
        if heartbeat:
            heartbeat()
        height, width = image.shape[-2:]
        with Image.open(dataset.images[index]) as source:
            resized = np.asarray(source.convert('RGB').resize((size, size)), dtype=np.float32).transpose(2,0,1)[None] / 255
        boxes, scores, labels = session.run(None, {session.get_inputs()[0].name: resized})
        boxes = np.asarray(boxes) * np.array([width / size, height / size, width / size, height / size])
        outcomes, missed = match_predictions({'boxes': torch.tensor(boxes), 'scores': torch.tensor(scores), 'labels': torch.tensor(labels)}, target, threshold, .5)
        tp += sum(correct for _, correct in outcomes); fp += sum(not correct for _, correct in outcomes); fn += missed
    return 2 * tp / max(2 * tp + fp + fn, 1)


def train_and_promote(rows: list[sqlite3.Row], review_count: int) -> dict:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_root = DATA_DIR / "training-runs" / timestamp
    snapshot = DATA_DIR / "dataset-snapshots" / timestamp
    staging = MODEL_DIR / f".candidate-{timestamp}"
    active = active_model_dir()
    classes_path = active / "classes.json"
    classes = read_json(classes_path, [])
    if not classes:
        raise RuntimeError("Model classes are missing.")

    samples = create_dataset_snapshot(rows, classes, snapshot)
    if samples < 2:
        raise RuntimeError("At least two reviewed images are required for train/validation splits.")
    if not list((snapshot / 'images' / 'val').glob('*')):
        raise RuntimeError('A fixed labeled base validation set is required before continual training.')
    checkpoint = active / 'checkpoint.pt'
    if not checkpoint.exists():
        raise RuntimeError('The current model needs a checkpoint.pt to resume owned weights.')
    metadata = read_json(active / 'model-metadata.json', {})
    threshold = float(metadata.get('confidenceThreshold', .25))
    baseline_f1 = evaluate_incumbent(active, snapshot, threshold, heartbeat=touch_training_heartbeat)

    try:
        run_with_heartbeat(
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
            '--resume', str(checkpoint),
            '--architecture', metadata.get('architecture', 'SSDLite320 MobileNetV3'),
            '--input-size', str(metadata.get('inputSize', 320)),
            '--score-threshold', str(threshold),
            '--learning-rate', '0.0005', '--workers', '0',
            ]
        )
        run_with_heartbeat(
            [
            sys.executable,
            "-m",
            "ai_service.training.export_onnx",
            "--checkpoint",
            str(run_root / "best.pt"),
            "--output-dir",
            str(staging),
            ]
        )

        shutil.copy2(run_root / 'best.pt', staging / 'checkpoint.pt')
        from .verify_export import verify
        report = verify(staging / 'checkpoint.pt', staging, snapshot, heartbeat=touch_training_heartbeat)
        candidate_f1 = float(report['iou50F1'])
        should_promote = candidate_should_promote(
            (active / "espada-v1.onnx").exists(),
            baseline_f1,
            candidate_f1,
        )
        if should_promote:
            publish_candidate(staging, MODEL_DIR)
        return {
            "reviewCount": review_count,
            "trainingSamples": samples,
            "baselineF1": baseline_f1,
            "candidateF1": candidate_f1,
            "promoted": should_promote,
            "completedAt": datetime.now(timezone.utc).isoformat(),
        }
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print("Espada continual-learning worker started", flush=True)
    while True:
        state = read_json(STATE_PATH, {"lastProcessedReviews": 0})
        state.update({'state': 'WAITING_FOR_REVIEWS', 'lastHeartbeat': datetime.now(timezone.utc).isoformat(), 'reviewThreshold': MIN_NEW_REVIEWS})
        rows = reviewed_rows()
        review_count = len({int(row["frame_review_id"]) for row in rows})
        if "lastProcessedFrameReviewId" not in state:
            state["lastProcessedFrameReviewId"] = 0
            state["lastProcessedRevision"] = feedback_revision(rows, 0)
        cursor = int(state.get("lastProcessedFrameReviewId", 0))
        new_reviews, changed_reviews = reviews_require_training(rows, state)
        write_state(state)
        if new_reviews >= MIN_NEW_REVIEWS or changed_reviews:
            try:
                state['state'] = 'TRAINING'
                write_state(state)
                outcome = train_and_promote(rows, review_count)
                cursor = max((int(row["frame_review_id"]) for row in rows), default=0)
                state = {**state, 'state': 'WAITING_FOR_REVIEWS', "lastProcessedReviews": review_count, "lastProcessedFrameReviewId": cursor, "lastProcessedRevision": feedback_revision(rows, cursor), "lastRun": outcome}
                state.pop('lastError', None)
                print(json.dumps(outcome), flush=True)
            except Exception as exc:
                state = {
                    **state,
                    'state': 'ERROR',
                    "lastAttemptReviews": review_count,
                    "lastError": str(exc),
                    "lastAttemptAt": datetime.now(timezone.utc).isoformat(),
                }
                print(f"Continual training failed: {exc}", flush=True)
            state['lastHeartbeat'] = datetime.now(timezone.utc).isoformat()
            write_state(state)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
