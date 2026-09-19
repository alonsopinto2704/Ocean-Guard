from __future__ import annotations

import io
import json
import os
import sqlite3
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

from PIL import Image, ImageDraw

from ai_service.app.bootstrap import detect_visual_anomalies
from ai_service.app.core import CalibrationBin, calibrate_confidence, normalized_box
from ai_service.app.learning import LearningStore, MAX_FRAME_ANNOTATIONS, RevisionConflictError
from ai_service.app.model import MarineDebrisDetector
from ai_service.training.continual_worker import (
    candidate_should_promote,
    feedback_revision,
    publish_candidate,
    reviews_require_training,
    run_with_heartbeat,
)
from ai_service.training import continual_worker
from ai_service.training.prepare_voc import convert, inspect_labels
from ai_service.training.verify_export import record_verification_metadata


class EspadaCoreTests(unittest.TestCase):
    def test_bad_candidate_metadata_preserves_the_loaded_session(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {'OCEANGUARD_MODEL_PATH': str(Path(temporary) / 'model.onnx'), 'OCEANGUARD_CLASSES_PATH': str(Path(temporary) / 'classes.json'), 'OCEANGUARD_METADATA_PATH': str(Path(temporary) / 'metadata.json')}):
            root = Path(temporary)
            (root / 'classes.json').write_text('["Mixed Waste"]')
            detector = MarineDebrisDetector()
            previous = object(); detector.session = previous; detector.input_name = 'images'
            (root / 'model.onnx').write_bytes(b'test')
            (root / 'metadata.json').write_text('{"confidenceThreshold": "invalid"}')
            candidate = SimpleNamespace(get_inputs=lambda: [SimpleNamespace(name='images', shape=[1,3,320,320])], get_outputs=lambda: [SimpleNamespace(name=n) for n in ('boxes','scores','labels')])
            with patch('onnxruntime.InferenceSession', return_value=candidate):
                detector._load_model()
            self.assertIs(detector.session, previous)
            self.assertEqual(detector.classes, ['Mixed Waste'])
            self.assertIn('Unable to load', detector.load_error)

    def test_voc_converter_requires_explicit_mapping_and_writes_normalized_boxes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            Image.new("RGB", (100, 50), "blue").save(source / "sample.jpg")
            (source / "sample.xml").write_text(
                "<annotation><filename>sample.jpg</filename><size><width>100</width><height>50</height></size>"
                "<object><name>floating_plastic</name><bndbox><xmin>10</xmin><ymin>5</ymin>"
                "<xmax>50</xmax><ymax>25</ymax></bndbox></object></annotation>",
                encoding="utf-8",
            )
            classes = root / "classes.json"
            classes.write_text('["Plastic Fragment"]', encoding="utf-8")
            mapping = root / "mapping.json"
            mapping.write_text('{"floating_plastic": "Plastic Fragment"}', encoding="utf-8")

            self.assertEqual(inspect_labels(source)["floating_plastic"], 1)
            manifest = convert(source, root / "converted", classes, mapping, 0.2, 41)
            label = next((root / "converted" / "labels" / "train").glob("*.txt")).read_text(encoding="utf-8")
            self.assertEqual(label.strip(), "0 0.300000 0.300000 0.400000 0.400000")
            self.assertEqual(manifest["counts"]["train_boxes"], 1)

    def test_normalized_box_is_clamped(self) -> None:
        self.assertEqual(
            normalized_box((-10, 5, 120, 80), 100, 100),
            {"x": 0.0, "y": 0.05, "width": 1.0, "height": 0.75},
        )

    def test_confidence_uses_validation_bin(self) -> None:
        calibrated = calibrate_confidence(
            0.8,
            [CalibrationBin(lower=0.7, upper=0.9, observed_precision=0.6, samples=80)],
        )
        self.assertAlmostEqual(calibrated, 0.64)

    def test_bootstrap_finds_a_contrasting_debris_candidate(self) -> None:
        image = Image.new("RGB", (320, 220), (28, 116, 158))
        draw = ImageDraw.Draw(image)
        draw.rectangle((125, 90, 175, 125), fill=(235, 224, 198))
        candidates = detect_visual_anomalies(image)
        self.assertGreaterEqual(len(candidates), 1)
        box = candidates[0]["boundingBox"]
        self.assertLess(box["x"], 0.55)
        self.assertGreater(box["x"] + box["width"], 0.4)

    def test_legacy_feedback_is_persisted_but_not_committed_for_learning(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, patch.dict(
            os.environ, {"OCEANGUARD_DATA_DIR": temp_dir}
        ):
            store = LearningStore()
            image = Image.new("RGB", (32, 32), (0, 80, 130))
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG")
            result = {
                "detections": [
                    {
                        "id": "AI-001",
                        "className": "Mixed Waste",
                        "boundingBox": {"x": 0.2, "y": 0.2, "width": 0.3, "height": 0.3},
                    }
                ]
            }
            analysis_id = store.record_analysis(buffer.getvalue(), "frame.jpg", result)
            saved = store.save_feedback(
                analysis_id,
                "AI-001",
                "CORRECTED",
                "Plastic Bottle",
                None,
                "test-reviewer",
            )
            self.assertFalse(saved["queuedForLearning"])
            self.assertFalse(saved["frameReviewCommitted"])
            self.assertEqual(store.stats()["framesReviewed"], 0)
            self.assertEqual(store.stats()["approvedTrainingExamples"], 0)
            self.assertTrue(Path(temp_dir, "learning.db").exists())

    def test_candidate_requires_a_real_validation_improvement(self) -> None:
        self.assertFalse(candidate_should_promote(True, 0.70, 0.704, 0.005))
        self.assertTrue(candidate_should_promote(True, 0.70, 0.705, 0.005))
        self.assertTrue(candidate_should_promote(False, -1.0, 0.10, 0.005))
        self.assertFalse(candidate_should_promote(False, -1.0, -1.0, 0.005))

    def test_candidate_publication_switches_complete_bundle_and_retains_previous(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, patch.object(
            continual_worker, "validate_candidate_bundle"
        ):
            root = Path(temp_dir)
            staging = root / "candidate"
            deployed = root / "deployed"
            staging.mkdir()
            for filename in continual_worker.PROMOTED_FILES:
                (staging / filename).write_text(filename, encoding="utf-8")
            publish_candidate(staging, deployed)
            release = deployed / json.loads((deployed / 'current.json').read_text())['release']
            self.assertTrue((release / 'espada-v1.onnx').exists())
            self.assertFalse(staging.exists())
            incomplete = root / 'incomplete'; incomplete.mkdir()
            with self.assertRaises(FileNotFoundError):
                publish_candidate(incomplete, deployed)
            self.assertEqual(deployed / json.loads((deployed / 'current.json').read_text())['release'], release)
            second = root / 'second'; second.mkdir()
            for filename in continual_worker.PROMOTED_FILES:
                (second / filename).write_text('second')
            publish_candidate(second, deployed)
            self.assertNotEqual(deployed / json.loads((deployed / 'current.json').read_text())['release'], release)
            self.assertTrue((release / 'espada-v1.onnx').exists())

    def test_candidate_rejects_nonfinite_and_empty_metrics(self):
        for value in (float('nan'), float('inf'), -1, 0, 1.1):
            self.assertFalse(candidate_should_promote(False, -1, value))

    def test_publication_rejects_unverified_bundle_without_moving_pointer(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            deployed = root / 'deployed'
            deployed.mkdir()
            (deployed / 'current.json').write_text('{"release":"releases/incumbent"}', encoding='utf-8')
            candidate = root / 'candidate'
            candidate.mkdir()
            (candidate / 'classes.json').write_text('["Mixed Waste"]', encoding='utf-8')
            (candidate / 'checkpoint.pt').write_bytes(b'checkpoint')
            (candidate / 'espada-v1.onnx').write_bytes(b'onnx')
            (candidate / 'model-metadata.json').write_text(json.dumps({
                'inputSize': 320,
                'architecture': 'SSDLite320 MobileNetV3',
                'metrics': {'iou50F1': .5},
                'calibrationBins': [],
                'verification': {'modelSha256': 'wrong', 'checkpointSha256': 'wrong'},
            }), encoding='utf-8')

            with self.assertRaisesRegex(ValueError, 'does not match'):
                publish_candidate(candidate, deployed)

            self.assertEqual(json.loads((deployed / 'current.json').read_text())['release'], 'releases/incumbent')
            self.assertTrue(candidate.exists())

    def test_onnx_verification_replaces_export_metrics_and_binds_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            checkpoint = root / 'checkpoint.pt'
            checkpoint.write_bytes(b'checkpoint-v2')
            (root / 'espada-v1.onnx').write_bytes(b'onnx-v2')
            (root / 'model-metadata.json').write_text(json.dumps({
                'metrics': {'iou50F1': .99},
                'calibrationBins': [{'lower': 0, 'upper': 1, 'observedPrecision': .99, 'samples': 99}],
            }), encoding='utf-8')
            report = {
                'parityImages': 2,
                'validationImages': 3,
                'iou50Precision': .5,
                'iou50Recall': .25,
                'iou50F1': 1 / 3,
                'truePositives': 1,
                'falsePositives': 1,
                'falseNegatives': 3,
                'preprocessing': 'deployed path',
            }

            record_verification_metadata(checkpoint, root, report, [(.8, True), (.7, False)])

            metadata = json.loads((root / 'model-metadata.json').read_text())
            self.assertAlmostEqual(metadata['metrics']['iou50F1'], 1 / 3)
            self.assertEqual(metadata['validationImages'], 3)
            self.assertNotEqual(metadata['calibrationBins'][0]['observedPrecision'], .99)
            self.assertEqual(len(metadata['verification']['modelSha256']), 64)
            self.assertEqual(len(metadata['verification']['checkpointSha256']), 64)

    def test_committed_frame_revision_changes_when_existing_review_changes(self) -> None:
        row = {
            'frame_review_id': 7,
            'analysis_id': 'ANL-1',
            'image_path': 'frame.jpg',
            'result_json': '{}',
            'frame_revision': 1,
            'frame_content_hash': 'first',
            'frame_review_updated_at': '2026-01-01T00:00:00+00:00',
        }
        before = feedback_revision([row], through_id=7)
        state = {'lastProcessedFrameReviewId': 7, 'lastProcessedRevision': before}
        row['frame_revision'] = 2
        row['frame_content_hash'] = 'second'
        row['frame_review_updated_at'] = '2026-01-02T00:00:00+00:00'
        self.assertNotEqual(before, feedback_revision([row], through_id=7))
        self.assertEqual(reviews_require_training([row], state), (0, True))

    def test_training_subprocess_refreshes_heartbeat_while_running(self) -> None:
        process = SimpleNamespace()
        process.wait = unittest.mock.Mock(side_effect=[subprocess.TimeoutExpired('train', 30), 0])
        pulses = []
        with patch.object(continual_worker.subprocess, 'Popen', return_value=process):
            run_with_heartbeat(['train'], heartbeat=lambda: pulses.append('pulse'))
        self.assertEqual(pulses, ['pulse', 'pulse'])

    def test_stale_training_heartbeat_expires(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, patch.dict(os.environ, {
            'OCEANGUARD_DATA_DIR': temp_dir,
            'OCEANGUARD_TRAINER_STALE_SECONDS': '60',
        }):
            store = LearningStore()
            stale = datetime.now(timezone.utc) - timedelta(seconds=61)
            Path(temp_dir, 'continual-state.json').write_text(json.dumps({
                'state': 'TRAINING',
                'lastHeartbeat': stale.isoformat(),
            }), encoding='utf-8')
            trainer = store.stats()['trainer']
            self.assertEqual(trainer['state'], 'NOT_RUNNING')
            self.assertEqual(trainer['staleState'], 'TRAINING')

    def test_frame_review_is_atomic_idempotent_and_revision_checked(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, patch.dict(os.environ, {"OCEANGUARD_DATA_DIR": temp_dir}):
            store = LearningStore()
            image = io.BytesIO()
            Image.new("RGB", (64, 64), "blue").save(image, format="JPEG")
            result = {"detections": [
                {"id": "AI-001", "className": "Mixed Waste", "boundingBox": {"x": .1, "y": .1, "width": .2, "height": .2}},
                {"id": "AI-002", "className": "Mixed Waste", "boundingBox": {"x": .5, "y": .5, "width": .2, "height": .2}},
            ]}
            analysis_id = store.record_analysis(image.getvalue(), "frame.jpg", result)
            initial = [
                {"annotationId": "ann-2", "sourceDetectionId": "AI-002", "verdict": "FALSE_POSITIVE", "correctedClass": None, "correctedBoundingBox": None},
                {"annotationId": "ann-1", "sourceDetectionId": "AI-001", "verdict": "CONFIRMED", "correctedClass": None, "correctedBoundingBox": None},
            ]
            saved = store.save_frame_review(analysis_id, 0, initial, "reviewer", {"Mixed Waste"})
            retried = store.save_frame_review(analysis_id, 0, list(reversed(initial)), "reviewer", {"Mixed Waste"})
            self.assertEqual((saved["revision"], retried["revision"]), (1, 1))
            self.assertEqual(saved["reviewId"], retried["reviewId"])
            self.assertEqual(saved["updatedAt"], retried["updatedAt"])
            self.assertTrue(retried["idempotent"])

            changed = [initial[0], {**initial[1], "verdict": "CORRECTED", "correctedBoundingBox": {"x": .2, "y": .2, "width": .3, "height": .3}}]
            with self.assertRaises(RevisionConflictError):
                store.save_frame_review(analysis_id, 0, changed, "reviewer", {"Mixed Waste"})

            def fail_after_delete(connection, current_analysis_id, *_args):
                connection.execute("DELETE FROM feedback WHERE analysis_id = ?", (current_analysis_id,))
                raise RuntimeError("injected failure")

            with patch.object(store, "_replace_feedback", side_effect=fail_after_delete):
                with self.assertRaisesRegex(RuntimeError, "injected failure"):
                    store.save_frame_review(analysis_id, 1, changed, "reviewer", {"Mixed Waste"})
            connection = sqlite3.connect(store.database_path)
            try:
                revision = connection.execute("SELECT revision FROM frame_reviews WHERE analysis_id = ?", (analysis_id,)).fetchone()[0]
                verdicts = connection.execute("SELECT verdict FROM feedback WHERE analysis_id = ? ORDER BY annotation_id", (analysis_id,)).fetchall()
            finally:
                connection.close()
            self.assertEqual(revision, 1)
            self.assertEqual(verdicts, [("CONFIRMED",), ("FALSE_POSITIVE",)])
            self.assertEqual(store.save_frame_review(analysis_id, 1, changed, "reviewer", {"Mixed Waste"})["revision"], 2)

    def test_frame_review_validation_is_complete_and_bounded(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, patch.dict(os.environ, {"OCEANGUARD_DATA_DIR": temp_dir}):
            store = LearningStore()
            image = io.BytesIO()
            Image.new("RGB", (32, 32), "blue").save(image, format="JPEG")
            analysis_id = store.record_analysis(image.getvalue(), "frame.jpg", {"detections": [
                {"id": "AI-001", "className": "Mixed Waste", "boundingBox": {"x": .1, "y": .1, "width": .2, "height": .2}},
            ]})
            valid = {"annotationId": "one", "sourceDetectionId": "AI-001", "verdict": "CONFIRMED", "correctedClass": None, "correctedBoundingBox": None}
            invalid_reviews = [
                [],
                [valid, {**valid}],
                [{**valid, "sourceDetectionId": "AI-404"}],
                [{**valid, "verdict": "CORRECTED"}],
                [{"annotationId": "missed", "sourceDetectionId": None, "verdict": "MISSED", "correctedClass": "Mixed Waste", "correctedBoundingBox": None}, valid],
                [{**valid, "verdict": "CORRECTED", "correctedClass": "Unknown"}],
                [{**valid, "verdict": "CORRECTED", "correctedBoundingBox": {"x": .8, "y": .2, "width": .3, "height": .2}}],
                [{**valid, "verdict": "CORRECTED", "correctedBoundingBox": {"x": float("nan"), "y": .2, "width": .3, "height": .2}}],
                [valid] + [{"annotationId": f"missed-{index}", "sourceDetectionId": None, "verdict": "MISSED", "correctedClass": "Mixed Waste", "correctedBoundingBox": {"x": 0, "y": 0, "width": .1, "height": .1}} for index in range(MAX_FRAME_ANNOTATIONS)],
            ]
            for annotations in invalid_reviews:
                with self.subTest(annotation_count=len(annotations)):
                    with self.assertRaises(ValueError):
                        store.save_frame_review(analysis_id, 0, annotations, None, {"Mixed Waste"})
            self.assertEqual(store.stats()["framesReviewed"], 0)

    def test_snapshot_keeps_committed_hard_negatives(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            negative_image = root / "negative.jpg"
            Image.new("RGB", (64, 64), (0, 90, 140)).save(negative_image)
            negative_result = {"detections": [{"id": "AI-001", "className": "Mixed Waste", "boundingBox": {"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.2}}]}
            rows = [
                {
                    "analysis_id": "negative", "image_path": str(negative_image),
                    "result_json": __import__("json").dumps(negative_result),
                    "feedback_id": 1, "annotation_id": "AI-001",
                    "source_detection_id": "AI-001", "verdict": "FALSE_POSITIVE",
                    "corrected_class": None, "corrected_box_json": None,
                },
            ]
            snapshot = root / "snapshot"
            with patch.object(continual_worker, "BASE_DATASET", root / "missing-base"):
                added = continual_worker.create_dataset_snapshot(rows, ["Mixed Waste"], snapshot)
            self.assertEqual(added, 1)
            snapshot_images = list(snapshot.glob("images/*/*.jpg"))
            snapshot_labels = list(snapshot.glob("labels/*/*.txt"))
            self.assertEqual(len(snapshot_images), 1)
            self.assertEqual(len(snapshot_labels), 1)
            self.assertEqual(snapshot_labels[0].read_text(encoding="utf-8"), "")

    def test_snapshot_includes_empty_missed_and_geometry_corrected_frames(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, patch.dict(os.environ, {"OCEANGUARD_DATA_DIR": temp_dir}):
            root = Path(temp_dir)
            store = LearningStore()
            image = io.BytesIO()
            Image.new("RGB", (64, 64), "blue").save(image, format="JPEG")
            empty_id = store.record_analysis(image.getvalue(), "empty.jpg", {"detections": []})
            store.save_frame_review(empty_id, 0, [], None, {"Mixed Waste"})
            result = {"detections": [
                {"id": "AI-001", "className": "Mixed Waste", "boundingBox": {"x": .1, "y": .1, "width": .2, "height": .2}},
                {"id": "AI-002", "className": "Mixed Waste", "boundingBox": {"x": .5, "y": .5, "width": .2, "height": .2}},
            ]}
            reviewed_id = store.record_analysis(image.getvalue(), "reviewed.jpg", result)
            store.save_frame_review(reviewed_id, 0, [
                {"annotationId": "corrected", "sourceDetectionId": "AI-001", "verdict": "CORRECTED", "correctedClass": None, "correctedBoundingBox": {"x": .1, "y": .1, "width": .4, "height": .4}},
                {"annotationId": "false", "sourceDetectionId": "AI-002", "verdict": "FALSE_POSITIVE", "correctedClass": None, "correctedBoundingBox": None},
                {"annotationId": "missed", "sourceDetectionId": None, "verdict": "MISSED", "correctedClass": "Mixed Waste", "correctedBoundingBox": {"x": .6, "y": .2, "width": .2, "height": .2}},
            ], None, {"Mixed Waste"})
            with patch.object(continual_worker, "DATABASE_PATH", store.database_path):
                rows = continual_worker.reviewed_rows()
            snapshot = root / "snapshot"
            with patch.object(continual_worker, "BASE_DATASET", root / "missing-base"):
                self.assertEqual(continual_worker.create_dataset_snapshot(rows, ["Mixed Waste"], snapshot), 2)
            self.assertEqual((snapshot / "labels" / "train" / f"feedback_{empty_id.casefold()}.txt").read_text(), "")
            self.assertEqual(
                (snapshot / "labels" / "train" / f"feedback_{reviewed_id.casefold()}.txt").read_text().splitlines(),
                ["0 0.300000 0.300000 0.400000 0.400000", "0 0.700000 0.300000 0.200000 0.200000"],
            )

    def test_pruning_preserves_committed_and_legacy_feedback_analyses(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, patch.dict(os.environ, {
            "OCEANGUARD_DATA_DIR": temp_dir, "OCEANGUARD_MAX_UNREVIEWED_ANALYSES": "1",
        }):
            store = LearningStore()
            image = io.BytesIO(); Image.new("RGB", (16, 16), "blue").save(image, format="JPEG")
            result = {"detections": [{"id": "AI-001", "className": "Mixed Waste", "boundingBox": {"x": .1, "y": .1, "width": .2, "height": .2}}]}
            committed = store.record_analysis(image.getvalue(), "committed.jpg", result)
            store.save_frame_review(committed, 0, [{"annotationId": "one", "sourceDetectionId": "AI-001", "verdict": "CONFIRMED", "correctedClass": None, "correctedBoundingBox": None}], None, {"Mixed Waste"})
            legacy = store.record_analysis(image.getvalue(), "legacy.jpg", result)
            store.save_feedback(legacy, "AI-001", "CONFIRMED", None, None, None)
            stale = store.record_analysis(image.getvalue(), "stale.jpg", result)
            newest = store.record_analysis(image.getvalue(), "newest.jpg", result)
            connection = sqlite3.connect(store.database_path)
            try:
                retained = {row[0] for row in connection.execute("SELECT id FROM analyses")}
            finally:
                connection.close()
            self.assertTrue({committed, legacy}.issubset(retained))
            self.assertEqual(len({stale, newest} & retained), 1)

    def test_worker_fails_closed_on_malformed_committed_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            image_path = root / "frame.jpg"
            Image.new("RGB", (32, 32), "blue").save(image_path)
            malformed = [{
                "analysis_id": "ANL-BAD", "image_path": str(image_path),
                "result_json": json.dumps({"detections": []}), "feedback_id": 1,
                "annotation_id": None, "source_detection_id": None, "verdict": "MISSED",
                "corrected_class": "Mixed Waste",
                "corrected_box_json": json.dumps({"x": .1, "y": .1, "width": .2, "height": .2}),
            }]
            with patch.object(continual_worker, "BASE_DATASET", root / "missing-base"):
                with self.assertRaisesRegex(ValueError, "unversioned feedback row"):
                    continual_worker.create_dataset_snapshot(malformed, ["Mixed Waste"], root / "snapshot")


    def test_legacy_feedback_endpoint_returns_410_gone(self) -> None:
        from fastapi import HTTPException
        from ai_service.app.main import feedback
        with self.assertRaises(HTTPException) as ctx:
            feedback()
        self.assertEqual(ctx.exception.status_code, 410)
        self.assertIn("retired", str(ctx.exception.detail))

    def test_frame_review_concurrency_race_condition(self) -> None:
        from concurrent.futures import ThreadPoolExecutor
        with tempfile.TemporaryDirectory() as temp_dir, patch.dict(os.environ, {"OCEANGUARD_DATA_DIR": temp_dir}):
            store = LearningStore()
            image = io.BytesIO()
            Image.new("RGB", (16, 16), "blue").save(image, format="JPEG")
            result = {"detections": [{"id": "AI-001", "className": "Mixed Waste", "boundingBox": {"x": .1, "y": .1, "width": .2, "height": .2}}]}
            analysis_id = store.record_analysis(image.getvalue(), "race.jpg", result)

            results = []
            errors = []
            def submit(ann_id: str, verdict: str):
                try:
                    res = store.save_frame_review(
                        analysis_id,
                        0,
                        [{"annotationId": ann_id, "sourceDetectionId": "AI-001", "verdict": verdict, "correctedClass": None, "correctedBoundingBox": None}],
                        "reviewer",
                        {"Mixed Waste"},
                    )
                    results.append(res)
                except Exception as exc:
                    errors.append(exc)

            with ThreadPoolExecutor(max_workers=2) as executor:
                f1 = executor.submit(submit, "ann-1", "CONFIRMED")
                f2 = executor.submit(submit, "ann-2", "FALSE_POSITIVE")
                f1.result()
                f2.result()

            self.assertEqual(len(results), 1)
            self.assertEqual(results[0]["revision"], 1)
            self.assertEqual(len(errors), 1)
            self.assertIsInstance(errors[0], RevisionConflictError)

    def test_worker_fails_closed_on_corrupt_and_missing_data(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            snapshot = root / "snapshot"
            with patch.object(continual_worker, "BASE_DATASET", root / "missing-base"):
                # Case 1: Missing image file
                rows_missing_img = [{
                    "analysis_id": "ANL-MISSING-IMG", "image_path": str(root / "nonexistent.jpg"),
                    "result_json": json.dumps({"detections": []}), "feedback_id": 1,
                    "annotation_id": "ann-1", "source_detection_id": None, "verdict": "MISSED",
                    "corrected_class": "Mixed Waste",
                    "corrected_box_json": json.dumps({"x": .1, "y": .1, "width": .2, "height": .2}),
                    "frame_content_hash": "dummy",
                }]
                with self.assertRaises(FileNotFoundError):
                    continual_worker.create_dataset_snapshot(rows_missing_img, ["Mixed Waste"], snapshot)

                # Case 2: Corrupt image file
                bad_img = root / "corrupt.jpg"
                bad_img.write_bytes(b"not an image file")
                rows_corrupt_img = [{
                    "analysis_id": "ANL-CORRUPT-IMG", "image_path": str(bad_img),
                    "result_json": json.dumps({"detections": []}), "feedback_id": 1,
                    "annotation_id": "ann-1", "source_detection_id": None, "verdict": "MISSED",
                    "corrected_class": "Mixed Waste",
                    "corrected_box_json": json.dumps({"x": .1, "y": .1, "width": .2, "height": .2}),
                    "frame_content_hash": "dummy",
                }]
                with self.assertRaisesRegex(ValueError, "unreadable or corrupt image"):
                    continual_worker.create_dataset_snapshot(rows_corrupt_img, ["Mixed Waste"], snapshot)

                # Case 3: Corrupt result_json
                valid_img = root / "valid.jpg"
                Image.new("RGB", (16, 16), "green").save(valid_img)
                rows_corrupt_json = [{
                    "analysis_id": "ANL-CORRUPT-JSON", "image_path": str(valid_img),
                    "result_json": "{not valid json}", "feedback_id": 1,
                    "annotation_id": "ann-1", "source_detection_id": None, "verdict": "MISSED",
                    "corrected_class": "Mixed Waste",
                    "corrected_box_json": json.dumps({"x": .1, "y": .1, "width": .2, "height": .2}),
                    "frame_content_hash": "dummy",
                }]
                with self.assertRaisesRegex(ValueError, "malformed"):
                    continual_worker.create_dataset_snapshot(rows_corrupt_json, ["Mixed Waste"], snapshot)

                # Case 4: Unknown class name in review
                rows_unknown_class = [{
                    "analysis_id": "ANL-UNKNOWN-CLASS", "image_path": str(valid_img),
                    "result_json": json.dumps({"detections": []}), "feedback_id": 1,
                    "annotation_id": "ann-1", "source_detection_id": None, "verdict": "MISSED",
                    "corrected_class": "Radioactive Nuclear Fuel",
                    "corrected_box_json": json.dumps({"x": .1, "y": .1, "width": .2, "height": .2}),
                    "frame_content_hash": "dummy",
                }]
                with self.assertRaisesRegex(ValueError, "malformed"):
                    continual_worker.create_dataset_snapshot(rows_unknown_class, ["Mixed Waste"], snapshot)


if __name__ == "__main__":
    unittest.main()
