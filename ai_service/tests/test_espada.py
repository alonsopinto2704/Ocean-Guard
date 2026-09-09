from __future__ import annotations

import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw

from ai_service.app.bootstrap import detect_visual_anomalies
from ai_service.app.core import CalibrationBin, calibrate_confidence, normalized_box
from ai_service.app.learning import LearningStore
from ai_service.training.continual_worker import candidate_should_promote, publish_candidate
from ai_service.training import continual_worker
from ai_service.training.prepare_voc import convert, inspect_labels


class EspadaCoreTests(unittest.TestCase):
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

    def test_feedback_is_persisted_for_continual_learning(self) -> None:
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
            self.assertTrue(saved["queuedForLearning"])
            self.assertEqual(store.stats()["approvedTrainingExamples"], 1)
            self.assertTrue(Path(temp_dir, "learning.db").exists())

    def test_candidate_requires_a_real_validation_improvement(self) -> None:
        self.assertFalse(candidate_should_promote(True, 0.70, 0.704, 0.005))
        self.assertTrue(candidate_should_promote(True, 0.70, 0.705, 0.005))
        self.assertTrue(candidate_should_promote(False, -1.0, 0.10, 0.005))
        self.assertFalse(candidate_should_promote(False, -1.0, -1.0, 0.005))

    def test_candidate_publication_is_complete_and_model_is_last(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            staging = root / "candidate"
            deployed = root / "deployed"
            staging.mkdir()
            for filename in ("classes.json", "model-metadata.json", "espada-v1.onnx"):
                (staging / filename).write_text(filename, encoding="utf-8")
            publish_candidate(staging, deployed)
            self.assertEqual(
                sorted(path.name for path in deployed.iterdir()),
                ["classes.json", "espada-v1.onnx", "model-metadata.json"],
            )
            self.assertFalse(staging.joinpath("espada-v1.onnx").exists())

    def test_snapshot_skips_partially_reviewed_frames_and_keeps_hard_negatives(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            partial_image = root / "partial.jpg"
            negative_image = root / "negative.jpg"
            Image.new("RGB", (64, 64), (0, 80, 130)).save(partial_image)
            Image.new("RGB", (64, 64), (0, 90, 140)).save(negative_image)
            partial_result = {
                "detections": [
                    {"id": "AI-001", "className": "Mixed Waste", "boundingBox": {"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.2}},
                    {"id": "AI-002", "className": "Mixed Waste", "boundingBox": {"x": 0.5, "y": 0.5, "width": 0.2, "height": 0.2}},
                ]
            }
            negative_result = {"detections": [partial_result["detections"][0]]}
            rows = [
                {"analysis_id": "partial", "image_path": str(partial_image), "result_json": __import__("json").dumps(partial_result), "detection_id": "AI-001", "verdict": "CONFIRMED", "corrected_class": None, "corrected_box_json": None},
                {"analysis_id": "negative", "image_path": str(negative_image), "result_json": __import__("json").dumps(negative_result), "detection_id": "AI-001", "verdict": "FALSE_POSITIVE", "corrected_class": None, "corrected_box_json": None},
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


if __name__ == "__main__":
    unittest.main()
