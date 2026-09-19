from __future__ import annotations

import hashlib
import io
import json
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
PYTHON = Path(sys.executable)
OPERATIONAL_DATA = ROOT / "ai_service" / "data"


def _free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def _request(
    url: str,
    *,
    method: str = "GET",
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 10,
) -> tuple[int, dict | str]:
    request = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
    try:
        response = urllib.request.urlopen(request, timeout=timeout)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read()
        content_type = response.headers.get_content_type()
        payload = json.loads(raw) if content_type == "application/json" else raw.decode(errors="replace")
        return response.status, payload


def _wait_for(url: str, process: subprocess.Popen, timeout: float = 20) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Service exited during startup with code {process.returncode}.")
        try:
            status, _ = _request(url, timeout=0.5)
            if status == 200:
                return
        except (OSError, TimeoutError):
            pass
        time.sleep(0.1)
    raise TimeoutError(f"Timed out waiting for {url}.")


def _stop_process(process: subprocess.Popen | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def _storage_snapshot(root: Path) -> dict[str, tuple[int, int, str]]:
    if not root.exists():
        return {}
    snapshot = {}
    for path in root.rglob("*"):
        if path.is_file():
            contents = path.read_bytes()
            snapshot[str(path.relative_to(root))] = (
                path.stat().st_mtime_ns,
                len(contents),
                hashlib.sha256(contents).hexdigest(),
            )
    return snapshot


def _test_png() -> bytes:
    image = Image.new("RGB", (160, 120), (28, 116, 158))
    ImageDraw.Draw(image).rectangle((62, 45, 98, 75), fill=(235, 224, 198))
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


class _DelayedEspadaHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
        time.sleep(5)

    def log_message(self, _format: str, *_args) -> None:
        pass


class GatewayIntegrationTests(unittest.TestCase):
    def test_binary_inference_feedback_persistence_and_failure_boundaries(self) -> None:
        operational_before = _storage_snapshot(OPERATIONAL_DATA)
        ai_process: subprocess.Popen | None = None
        gateway_process: subprocess.Popen | None = None
        delayed_server: ThreadingHTTPServer | None = None

        with tempfile.TemporaryDirectory(prefix="oceanguard-gateway-test-") as temporary:
            isolated_data = Path(temporary) / "data"
            model_dir = Path(temporary) / "model"
            model_dir.mkdir()
            classes_path = model_dir / "classes.json"
            metadata_path = model_dir / "model-metadata.json"
            classes_path.write_text('["Mixed Waste"]', encoding="utf-8")
            metadata_path.write_text('{}', encoding="utf-8")

            ai_port = _free_port()
            gateway_port = _free_port()
            ai_url = f"http://127.0.0.1:{ai_port}"
            gateway_url = f"http://127.0.0.1:{gateway_port}"

            ai_environment = {
                **os.environ,
                "OCEANGUARD_DATA_DIR": str(isolated_data),
                "OCEANGUARD_MODEL_PATH": str(model_dir / "missing.onnx"),
                "OCEANGUARD_CLASSES_PATH": str(classes_path),
                "OCEANGUARD_METADATA_PATH": str(metadata_path),
                "OCEANGUARD_MAX_IMAGE_BYTES": "4096",
                "ESPADA_BOOTSTRAP_ENABLED": "true",
            }
            gateway_environment = {
                **os.environ,
                "NODE_ENV": "production",
                "OCEANGUARD_WEB_DATA_DIR": str(Path(temporary) / "web-data"),
                "PORT": str(gateway_port),
                "AI_SERVICE_URL": ai_url,
                "AI_SERVICE_DETECT_TIMEOUT_MS": "1000",
                "AI_SERVICE_REQUEST_TIMEOUT_MS": "1000",
            }

            try:
                ai_process = subprocess.Popen(
                    [
                        str(PYTHON),
                        "-m",
                        "uvicorn",
                        "ai_service.app.main:app",
                        "--host",
                        "127.0.0.1",
                        "--port",
                        str(ai_port),
                        "--log-level",
                        "warning",
                    ],
                    cwd=ROOT,
                    env=ai_environment,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                _wait_for(f"{ai_url}/health", ai_process)

                gateway_process = subprocess.Popen(
                    ["node", "--import", "tsx", "server.ts"],
                    cwd=ROOT,
                    env=gateway_environment,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                _wait_for(f"{gateway_url}/api/health", gateway_process)

                def login(email):
                    code, result = _request(
                        f"{gateway_url}/api/auth/login", method="POST",
                        body=json.dumps({"email": email, "password": "demo1234"}).encode(),
                        headers={"Content-Type": "application/json"},
                    )
                    self.assertEqual(code, 200)
                    return {"Authorization": f"Bearer {result['token']}"}

                operator_auth = login("operator@oceanguard.ai")
                cleanup_auth = login("cleanup@oceanguard.ai")
                admin_auth = login("admin@oceanguard.ai")
                code, _ = _request(f"{gateway_url}/api/reports/example/download")
                self.assertEqual(code, 401)
                code, _ = _request(f"{gateway_url}/api/admin/users/USR-02", method="PATCH", body=b'{"passwordHash":"injected"}', headers={"Content-Type": "application/json", **admin_auth})
                self.assertEqual(code, 400)
                code, report = _request(f"{gateway_url}/api/reports/generate", method="POST", body=b'{"type":"DAILY","zoneId":"<img src=x onerror=alert(1)>"}', headers={"Content-Type": "application/json", **admin_auth})
                self.assertEqual(code, 201)
                code, report_html = _request(f"{gateway_url}/api/reports/{report['id']}/download?format=pdf", headers=admin_auth)
                self.assertEqual(code, 200)
                self.assertNotIn("<img src=x", report_html)
                self.assertIn("&lt;img", report_html)
                code, _ = _request(f"{gateway_url}/api/auth/me", headers={"Authorization": "Bearer jwt-token-USR-01-forged"})
                self.assertEqual(code, 401)
                code, recovery = _request(f"{gateway_url}/api/auth/recover", method="POST", body=b'{"email":"admin@oceanguard.ai"}', headers={"Content-Type": "application/json"})
                self.assertEqual(code, 503)
                self.assertNotIn("resetToken", recovery)

                image_bytes = _test_png()
                status, unauthenticated = _request(
                    f"{gateway_url}/api/ai/infer-image",
                    method="POST",
                    body=image_bytes,
                    headers={"Content-Type": "image/png"},
                )
                self.assertEqual(status, 401)
                self.assertIn("Authentication", unauthenticated["message"])

                status, inference = _request(
                    f"{gateway_url}/api/ai/infer-image",
                    method="POST",
                    body=image_bytes,
                    headers={
                        "Content-Type": "image/png",
                        "X-File-Name": "integration%20frame.png",
                        **operator_auth,
                    },
                )
                self.assertEqual(status, 200)
                self.assertEqual(inference["source"]["filename"], "integration frame.png")
                self.assertEqual((inference["source"]["width"], inference["source"]["height"]), (160, 120))
                self.assertTrue(inference["analysisId"].startswith("ANL-"))
                self.assertGreaterEqual(len(inference["detections"]), 1)

                detection_id = inference["detections"][0]["id"]
                feedback_body = json.dumps(
                    {
                        "expectedRevision": 0,
                        "reviewer": "gateway-integration-test",
                        "annotations": [
                            {
                                "annotationId": detection["id"],
                                "sourceDetectionId": detection["id"],
                                "verdict": "CONFIRMED",
                            }
                            for detection in inference["detections"]
                        ],
                    }
                ).encode()
                status, feedback = _request(
                    f"{gateway_url}/api/ai/analyses/{inference['analysisId']}/review",
                    method="PUT",
                    body=feedback_body,
                    headers={"Content-Type": "application/json", **operator_auth},
                )
                self.assertEqual(status, 200)
                self.assertTrue(feedback["queuedForLearning"])
                self.assertEqual(feedback["revision"], 1)
                self.assertGreater(feedback["reviewId"], 0)
                self.assertEqual(len(feedback["contentHash"]), 64)
                self.assertFalse(feedback["idempotent"])

                status, forbidden = _request(
                    f"{gateway_url}/api/ai/analyses/{inference['analysisId']}/review",
                    method="PUT",
                    body=feedback_body,
                    headers={"Content-Type": "application/json", **cleanup_auth},
                )
                self.assertEqual(status, 403)
                self.assertIn("role", forbidden["message"])

                status, retry = _request(
                    f"{gateway_url}/api/ai/analyses/{inference['analysisId']}/review",
                    method="PUT",
                    body=feedback_body,
                    headers={"Content-Type": "application/json", **operator_auth},
                )
                self.assertEqual(status, 200)
                self.assertEqual(retry["reviewId"], feedback["reviewId"])
                self.assertEqual(retry["revision"], 1)
                self.assertTrue(retry["idempotent"])

                stale_payload = json.loads(feedback_body)
                stale_payload["annotations"][0]["verdict"] = "FALSE_POSITIVE"
                status, stale = _request(
                    f"{gateway_url}/api/ai/analyses/{inference['analysisId']}/review",
                    method="PUT",
                    body=json.dumps(stale_payload).encode(),
                    headers={"Content-Type": "application/json", **operator_auth},
                )
                self.assertEqual(status, 409)
                self.assertIn("current revision is 1", stale["message"])

                invalid_review = json.loads(feedback_body)
                invalid_review["expectedRevision"] = 1
                invalid_review["annotations"].append({
                    "annotationId": "overflow",
                    "sourceDetectionId": None,
                    "verdict": "MISSED",
                    "correctedClass": "Mixed Waste",
                    "correctedBoundingBox": {"x": .9, "y": .1, "width": .2, "height": .2},
                })
                status, validation = _request(
                    f"{gateway_url}/api/ai/analyses/{inference['analysisId']}/review",
                    method="PUT",
                    body=json.dumps(invalid_review).encode(),
                    headers={"Content-Type": "application/json", **operator_auth},
                )
                self.assertEqual(status, 422)
                self.assertIn("correctedBoundingBox", validation["message"])

                status, legacy_response = _request(
                    f"{gateway_url}/api/ai/feedback",
                    method="POST",
                    body=json.dumps({"analysisId": inference["analysisId"], "detectionId": "AI-001", "verdict": "CONFIRMED"}).encode(),
                    headers={"Content-Type": "application/json", **operator_auth},
                )
                self.assertEqual(status, 410)
                self.assertIn("retired", legacy_response["message"])

                status, learning = _request(f"{gateway_url}/api/ai/learning")
                self.assertEqual(status, 200)
                self.assertEqual(learning["analysesStored"], 1)
                self.assertEqual(learning["framesReviewed"], 1)
                self.assertEqual(learning["detectionsReviewed"], len(inference["detections"]))
                self.assertEqual(learning["approvedTrainingExamples"], len(inference["detections"]))

                connection = sqlite3.connect(isolated_data / "learning.db")
                try:
                    analysis = connection.execute(
                        """SELECT a.image_path, fr.reviewer
                           FROM analyses a JOIN frame_reviews fr ON fr.analysis_id = a.id
                           WHERE a.id = ?""",
                        (inference["analysisId"],),
                    ).fetchone()
                    review_count = connection.execute("SELECT COUNT(*) FROM feedback").fetchone()[0]
                finally:
                    connection.close()
                self.assertIsNotNone(analysis)
                stored_image = Path(analysis[0]).resolve()
                self.assertEqual(analysis[1], "operator@oceanguard.ai")
                self.assertTrue(stored_image.is_relative_to(isolated_data.resolve()))
                self.assertEqual(stored_image.read_bytes(), image_bytes)
                self.assertEqual(review_count, len(inference["detections"]))

                status, invalid = _request(
                    f"{gateway_url}/api/ai/infer-image",
                    method="POST",
                    body=b"not an image",
                    headers={"Content-Type": "image/png", "X-File-Name": "broken.png", **operator_auth},
                )
                self.assertEqual(status, 422)
                self.assertIn("Unable to analyze image", invalid["message"])

                status, oversized = _request(
                    f"{gateway_url}/api/ai/infer-image",
                    method="POST",
                    body=b"x" * 4097,
                    headers={"Content-Type": "image/png", "X-File-Name": "oversized.png", **operator_auth},
                )
                self.assertEqual(status, 413)
                self.assertIn("limit", oversized["message"])

                status, learning = _request(f"{gateway_url}/api/ai/learning")
                self.assertEqual(status, 200)
                self.assertEqual(learning["analysesStored"], 1)
                self.assertEqual(learning["detectionsReviewed"], len(inference["detections"]))

                _stop_process(ai_process)
                ai_process = None
                status, offline = _request(
                    f"{gateway_url}/api/ai/infer-image",
                    method="POST",
                    body=image_bytes,
                    headers={"Content-Type": "image/png", **operator_auth},
                )
                self.assertEqual(status, 503)
                self.assertIn("Espada is unavailable", offline["message"])

                delayed_server = ThreadingHTTPServer(("127.0.0.1", ai_port), _DelayedEspadaHandler)
                delayed_thread = threading.Thread(target=delayed_server.serve_forever, daemon=True)
                delayed_thread.start()
                started = time.monotonic()
                status, timed_out = _request(
                    f"{gateway_url}/api/ai/infer-image",
                    method="POST",
                    body=image_bytes,
                    headers={"Content-Type": "image/png", **operator_auth},
                    timeout=5,
                )
                elapsed = time.monotonic() - started
                self.assertEqual(status, 503)
                self.assertIn("did not respond within 1000 ms", timed_out["message"])
                self.assertLess(elapsed, 4)

                self.assertEqual(_storage_snapshot(OPERATIONAL_DATA), operational_before)
            finally:
                if delayed_server is not None:
                    delayed_server.shutdown()
                    delayed_server.server_close()
                _stop_process(gateway_process)
                _stop_process(ai_process)


if __name__ == "__main__":
    unittest.main()
