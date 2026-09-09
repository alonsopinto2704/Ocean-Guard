from __future__ import annotations

import json
import os
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path


class LearningStore:
    def __init__(self) -> None:
        default_data_dir = Path(__file__).resolve().parents[1] / "data"
        self.data_dir = Path(os.getenv("OCEANGUARD_DATA_DIR", str(default_data_dir)))
        self.image_dir = self.data_dir / "inference-images"
        self.database_path = self.data_dir / "learning.db"
        self.max_unreviewed = int(os.getenv("OCEANGUARD_MAX_UNREVIEWED_ANALYSES", "500"))
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
                """
            )
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
                LEFT JOIN feedback f ON f.analysis_id = a.id
                WHERE f.id IS NULL
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
            "queuedForLearning": True,
            "updatedAt": created_at,
        }

    def stats(self) -> dict:
        connection = self._connect()
        try:
            analyses = connection.execute("SELECT COUNT(*) FROM analyses").fetchone()[0]
            reviewed = connection.execute("SELECT COUNT(*) FROM feedback").fetchone()[0]
            confirmed = connection.execute(
                "SELECT COUNT(*) FROM feedback WHERE verdict IN ('CONFIRMED','CORRECTED')"
            ).fetchone()[0]
            false_positives = connection.execute(
                "SELECT COUNT(*) FROM feedback WHERE verdict = 'FALSE_POSITIVE'"
            ).fetchone()[0]
        finally:
            connection.close()
        return {
            "analysesStored": analyses,
            "detectionsReviewed": reviewed,
            "approvedTrainingExamples": confirmed,
            "falsePositivesReviewed": false_positives,
            "learningMode": "human_reviewed_asynchronous",
        }
