from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path


MAX_FRAME_ANNOTATIONS = 500


class RevisionConflictError(ValueError):
    pass


class LearningStore:
    def __init__(self) -> None:
        default_data_dir = Path(__file__).resolve().parents[1] / "data"
        self.data_dir = Path(os.getenv("OCEANGUARD_DATA_DIR", str(default_data_dir)))
        self.image_dir = self.data_dir / "inference-images"
        self.database_path = self.data_dir / "learning.db"
        self.max_unreviewed = int(os.getenv("OCEANGUARD_MAX_UNREVIEWED_ANALYSES", "500"))
        self.trainer_stale_seconds = int(os.getenv("OCEANGUARD_TRAINER_STALE_SECONDS", "660"))
        self.image_dir.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def _initialize(self) -> None:
        connection = self._connect()
        try:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS analyses (
                    id TEXT PRIMARY KEY,
                    filename TEXT NOT NULL,
                    image_path TEXT NOT NULL,
                    result_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS feedback (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    analysis_id TEXT NOT NULL,
                    detection_id TEXT NOT NULL,
                    verdict TEXT NOT NULL,
                    corrected_class TEXT,
                    corrected_box_json TEXT,
                    reviewer TEXT,
                    created_at TEXT NOT NULL,
                    UNIQUE(analysis_id, detection_id),
                    FOREIGN KEY(analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at);

                CREATE TABLE IF NOT EXISTS frame_reviews (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    analysis_id TEXT NOT NULL UNIQUE,
                    revision INTEGER NOT NULL,
                    content_hash TEXT NOT NULL,
                    reviewer TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_frame_reviews_updated_at
                ON frame_reviews(updated_at);
                """
            )
            feedback_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(feedback)")
            }
            if "annotation_id" not in feedback_columns:
                connection.execute("ALTER TABLE feedback ADD COLUMN annotation_id TEXT")
            if "source_detection_id" not in feedback_columns:
                connection.execute("ALTER TABLE feedback ADD COLUMN source_detection_id TEXT")
            connection.commit()
        finally:
            connection.close()

    @staticmethod
    def _safe_suffix(filename: str) -> str:
        suffix = Path(filename).suffix.casefold()
        return suffix if suffix in {".jpg", ".jpeg", ".png", ".webp"} else ".jpg"

    def record_analysis(self, image_bytes: bytes, filename: str, result: dict) -> str:
        analysis_id = f"ANL-{uuid.uuid4().hex[:16].upper()}"
        safe_stem = re.sub(r"[^A-Za-z0-9_-]+", "-", Path(filename).stem).strip("-")[:48] or "image"
        image_path = self.image_dir / f"{analysis_id}_{safe_stem}{self._safe_suffix(filename)}"
        image_path.write_bytes(image_bytes)
        created_at = datetime.now(timezone.utc).isoformat()
        connection = self._connect()
        try:
            with connection:
                connection.execute(
                    "INSERT INTO analyses(id, filename, image_path, result_json, created_at) VALUES(?,?,?,?,?)",
                    (analysis_id, filename, str(image_path), json.dumps(result), created_at),
                )
        finally:
            connection.close()
        self._prune_unreviewed()
        return analysis_id

    def _prune_unreviewed(self) -> None:
        if self.max_unreviewed <= 0:
            return
        connection = self._connect()
        stale_paths: list[str] = []
        try:
            stale = connection.execute(
                """
                SELECT a.id, a.image_path
                FROM analyses a
                LEFT JOIN frame_reviews fr ON fr.analysis_id = a.id
                LEFT JOIN feedback f ON f.analysis_id = a.id
                WHERE fr.id IS NULL AND f.id IS NULL
                ORDER BY a.created_at DESC
                LIMIT -1 OFFSET ?
                """,
                (self.max_unreviewed,),
            ).fetchall()
            if not stale:
                return
            stale_paths = [row["image_path"] for row in stale]
            with connection:
                connection.executemany(
                    "DELETE FROM analyses WHERE id = ?", ((row["id"],) for row in stale)
                )
        finally:
            connection.close()
        for raw_path in stale_paths:
            Path(raw_path).unlink(missing_ok=True)

    def save_feedback(
        self,
        analysis_id: str,
        detection_id: str,
        verdict: str,
        corrected_class: str | None,
        corrected_box: dict | None,
        reviewer: str | None,
    ) -> dict:
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            analysis = connection.execute(
                "SELECT result_json FROM analyses WHERE id = ?", (analysis_id,)
            ).fetchone()
            if analysis is None:
                raise KeyError("Analysis was not found or has expired.")

            result = json.loads(analysis["result_json"])
            detection = next(
                (item for item in result.get("detections", []) if item.get("id") == detection_id),
                None,
            )
            if detection is None:
                raise KeyError("Detection was not found in this analysis.")

            if verdict == "CORRECTED" and not corrected_class:
                raise ValueError("A corrected class is required for corrected detections.")

            created_at = datetime.now(timezone.utc).isoformat()
            with connection:
                if connection.execute(
                    "SELECT 1 FROM frame_reviews WHERE analysis_id = ?", (analysis_id,)
                ).fetchone():
                    raise RevisionConflictError(
                        "This analysis has a committed frame review; update it through the whole-frame review endpoint."
                    )
                connection.execute(
                    """
                    INSERT INTO feedback(
                        analysis_id, detection_id, verdict, corrected_class,
                        corrected_box_json, reviewer, created_at
                    ) VALUES(?,?,?,?,?,?,?)
                    ON CONFLICT(analysis_id, detection_id) DO UPDATE SET
                        verdict=excluded.verdict,
                        corrected_class=excluded.corrected_class,
                        corrected_box_json=excluded.corrected_box_json,
                        reviewer=excluded.reviewer,
                        created_at=excluded.created_at
                    """,
                    (
                        analysis_id,
                        detection_id,
                        verdict,
                        corrected_class,
                        json.dumps(corrected_box) if corrected_box else None,
                        reviewer,
                        created_at,
                    ),
                )
        finally:
            connection.close()
        return {
            "analysisId": analysis_id,
            "detectionId": detection_id,
            "verdict": verdict,
            "queuedForLearning": False,
            "frameReviewCommitted": False,
            "updatedAt": created_at,
        }

    @staticmethod
    def _normalize_box(box: dict | None) -> dict | None:
        if box is None:
            return None
        keys = ("x", "y", "width", "height")
        if set(box) != set(keys):
            raise ValueError("Bounding boxes require exactly x, y, width, and height.")
        values = {}
        for key in keys:
            value = box[key]
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError("Bounding box values must be finite numbers.")
            value = float(value)
            if not math.isfinite(value):
                raise ValueError("Bounding box values must be finite numbers.")
            values[key] = value
        if not 0 <= values["x"] <= 1 or not 0 <= values["y"] <= 1:
            raise ValueError("Bounding box coordinates must be within the image.")
        if not 0 < values["width"] <= 1 or not 0 < values["height"] <= 1:
            raise ValueError("Bounding box dimensions must be greater than zero and at most one.")
        if values["x"] + values["width"] > 1 or values["y"] + values["height"] > 1:
            raise ValueError("Bounding boxes must fit entirely within the image.")
        return values

    @classmethod
    def _canonical_review(
        cls,
        result: dict,
        annotations: list[dict],
        reviewer: str | None,
        allowed_classes: set[str],
    ) -> tuple[list[dict], str | None, str]:
        if len(annotations) > MAX_FRAME_ANNOTATIONS:
            raise ValueError(f"A frame review cannot exceed {MAX_FRAME_ANNOTATIONS} annotations.")
        if reviewer is not None and (not isinstance(reviewer, str) or len(reviewer) > 200):
            raise ValueError("reviewer must be a string of at most 200 characters.")

        detections = result.get("detections", [])
        original_ids = [item.get("id") for item in detections]
        if any(not isinstance(item, str) or not item for item in original_ids):
            raise ValueError("The stored analysis contains an invalid prediction identifier.")
        if len(set(original_ids)) != len(original_ids):
            raise ValueError("The stored analysis contains duplicate prediction identifiers.")

        normalized: list[dict] = []
        annotation_ids: set[str] = set()
        source_ids: set[str] = set()
        for raw in annotations:
            annotation_id = raw.get("annotationId")
            source_id = raw.get("sourceDetectionId")
            verdict = raw.get("verdict")
            corrected_class = raw.get("correctedClass")
            corrected_box = cls._normalize_box(raw.get("correctedBoundingBox"))

            if not isinstance(annotation_id, str) or not annotation_id.strip() or len(annotation_id) > 128:
                raise ValueError("Each annotation requires an annotationId of at most 128 characters.")
            annotation_id = annotation_id.strip()
            if annotation_id in annotation_ids:
                raise ValueError("annotationId values must be unique within a frame review.")
            annotation_ids.add(annotation_id)

            if source_id is not None:
                if not isinstance(source_id, str) or not source_id.strip() or len(source_id) > 128:
                    raise ValueError("sourceDetectionId must be a non-empty identifier when provided.")
                source_id = source_id.strip()
                if source_id in source_ids:
                    raise ValueError("Each original prediction must have exactly one disposition.")
                source_ids.add(source_id)

            if corrected_class is not None:
                if not isinstance(corrected_class, str) or not corrected_class.strip():
                    raise ValueError("correctedClass must be a non-empty class name when provided.")
                corrected_class = corrected_class.strip()
                if corrected_class not in allowed_classes:
                    raise ValueError("Corrected class is not in the model class list.")

            if verdict in {"CONFIRMED", "FALSE_POSITIVE"}:
                if source_id is None:
                    raise ValueError(f"{verdict} annotations require sourceDetectionId.")
                if corrected_class is not None or corrected_box is not None:
                    raise ValueError(f"{verdict} annotations cannot include corrections.")
            elif verdict == "CORRECTED":
                if source_id is None:
                    raise ValueError("CORRECTED annotations require sourceDetectionId.")
                if corrected_class is None and corrected_box is None:
                    raise ValueError("CORRECTED annotations require a corrected class or bounding box.")
            elif verdict == "MISSED":
                if source_id is not None:
                    raise ValueError("MISSED annotations cannot reference an original prediction.")
                if corrected_class is None or corrected_box is None:
                    raise ValueError("MISSED annotations require a known class and bounding box.")
            else:
                raise ValueError("Unsupported frame-review verdict.")

            normalized.append(
                {
                    "annotationId": annotation_id,
                    "sourceDetectionId": source_id,
                    "verdict": verdict,
                    "correctedClass": corrected_class,
                    "correctedBoundingBox": corrected_box,
                }
            )

        if source_ids != set(original_ids):
            missing = sorted(set(original_ids) - source_ids)
            unknown = sorted(source_ids - set(original_ids))
            details = []
            if missing:
                details.append(f"missing dispositions for: {', '.join(missing)}")
            if unknown:
                details.append(f"unknown source detections: {', '.join(unknown)}")
            raise ValueError("Whole-frame review is incomplete (" + "; ".join(details) + ").")

        normalized.sort(key=lambda item: item["annotationId"])
        normalized_reviewer = reviewer.strip() if isinstance(reviewer, str) and reviewer.strip() else None
        canonical = {"annotations": normalized}
        content_hash = hashlib.sha256(
            json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        ).hexdigest()
        return normalized, normalized_reviewer, content_hash

    def _replace_feedback(
        self,
        connection: sqlite3.Connection,
        analysis_id: str,
        annotations: list[dict],
        reviewer: str | None,
        updated_at: str,
    ) -> None:
        connection.execute("DELETE FROM feedback WHERE analysis_id = ?", (analysis_id,))
        for annotation in annotations:
            storage_detection_id = annotation["annotationId"]
            connection.execute(
                """
                INSERT INTO feedback(
                    analysis_id, detection_id, verdict, corrected_class,
                    corrected_box_json, reviewer, created_at,
                    annotation_id, source_detection_id
                ) VALUES(?,?,?,?,?,?,?,?,?)
                """,
                (
                    analysis_id,
                    storage_detection_id,
                    annotation["verdict"],
                    annotation["correctedClass"],
                    json.dumps(annotation["correctedBoundingBox"], separators=(",", ":"))
                    if annotation["correctedBoundingBox"] is not None
                    else None,
                    reviewer,
                    updated_at,
                    annotation["annotationId"],
                    annotation["sourceDetectionId"],
                ),
            )

    def save_frame_review(
        self,
        analysis_id: str,
        expected_revision: int,
        annotations: list[dict],
        reviewer: str | None,
        allowed_classes: set[str],
    ) -> dict:
        if isinstance(expected_revision, bool) or not isinstance(expected_revision, int) or expected_revision < 0:
            raise ValueError("expectedRevision must be a non-negative integer.")

        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            analysis = connection.execute(
                "SELECT result_json FROM analyses WHERE id = ?", (analysis_id,)
            ).fetchone()
            if analysis is None:
                raise KeyError("Analysis was not found or has expired.")

            normalized, normalized_reviewer, content_hash = self._canonical_review(
                json.loads(analysis["result_json"]), annotations, reviewer, allowed_classes
            )
            current = connection.execute(
                "SELECT id, revision, content_hash, updated_at FROM frame_reviews WHERE analysis_id = ?",
                (analysis_id,),
            ).fetchone()
            current_revision = int(current["revision"]) if current else 0
            if current and current["content_hash"] == content_hash:
                connection.rollback()
                return {
                    "analysisId": analysis_id,
                    "reviewId": int(current["id"]),
                    "revision": current_revision,
                    "contentHash": content_hash,
                    "annotationCount": len(normalized),
                    "queuedForLearning": True,
                    "idempotent": True,
                    "updatedAt": current["updated_at"],
                }
            if expected_revision != current_revision:
                raise RevisionConflictError(
                    f"Frame review revision conflict: expected {expected_revision}, current revision is {current_revision}."
                )

            updated_at = datetime.now(timezone.utc).isoformat()
            next_revision = current_revision + 1
            self._replace_feedback(
                connection, analysis_id, normalized, normalized_reviewer, updated_at
            )
            if current:
                review_id = int(current["id"])
                connection.execute(
                    """
                    UPDATE frame_reviews
                    SET revision = ?, content_hash = ?, reviewer = ?, updated_at = ?
                    WHERE analysis_id = ?
                    """,
                    (next_revision, content_hash, normalized_reviewer, updated_at, analysis_id),
                )
            else:
                cursor = connection.execute(
                    """
                    INSERT INTO frame_reviews(
                        analysis_id, revision, content_hash, reviewer, created_at, updated_at
                    ) VALUES(?,?,?,?,?,?)
                    """,
                    (
                        analysis_id,
                        next_revision,
                        content_hash,
                        normalized_reviewer,
                        updated_at,
                        updated_at,
                    ),
                )
                review_id = int(cursor.lastrowid)
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

        return {
            "analysisId": analysis_id,
            "reviewId": review_id,
            "revision": next_revision,
            "contentHash": content_hash,
            "annotationCount": len(normalized),
            "queuedForLearning": True,
            "idempotent": False,
            "updatedAt": updated_at,
        }

    def stats(self) -> dict:
        state_path = self.data_dir / 'continual-state.json'
        trainer = {'state': 'NOT_RUNNING'}
        if state_path.exists():
            try:
                trainer = json.loads(state_path.read_text(encoding='utf-8'))
                heartbeat = datetime.fromisoformat(trainer.get('lastHeartbeat', ''))
                if (datetime.now(timezone.utc) - heartbeat).total_seconds() > self.trainer_stale_seconds:
                    trainer['staleState'] = trainer.get('state')
                    trainer['state'] = 'NOT_RUNNING'
            except (TypeError, ValueError, OSError):
                trainer = {'state': 'NOT_RUNNING'}
        connection = self._connect()
        try:
            analyses = connection.execute("SELECT COUNT(*) FROM analyses").fetchone()[0]
            frames_reviewed = connection.execute("SELECT COUNT(*) FROM frame_reviews").fetchone()[0]
            reviewed = connection.execute(
                "SELECT COUNT(*) FROM feedback f JOIN frame_reviews fr ON fr.analysis_id = f.analysis_id"
            ).fetchone()[0]
            confirmed = connection.execute(
                """SELECT COUNT(*) FROM feedback f
                   JOIN frame_reviews fr ON fr.analysis_id = f.analysis_id
                   WHERE f.verdict IN ('CONFIRMED','CORRECTED','MISSED')"""
            ).fetchone()[0]
            false_positives = connection.execute(
                """SELECT COUNT(*) FROM feedback f
                   JOIN frame_reviews fr ON fr.analysis_id = f.analysis_id
                   WHERE f.verdict = 'FALSE_POSITIVE'"""
            ).fetchone()[0]
        finally:
            connection.close()
        return {
            "analysesStored": analyses,
            "framesReviewed": frames_reviewed,
            "detectionsReviewed": reviewed,
            "approvedTrainingExamples": confirmed,
            "falsePositivesReviewed": false_positives,
            "learningMode": "human_reviewed_asynchronous",
            'trainer': trainer,
        }
