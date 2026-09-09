# Espada version 1

This service runs object detection on the deployment server. Website visitors
only need a browser; they do not install Python, PyTorch, or model weights.
The directory is self-contained so it can be copied into another project.

## Runtime

- FastAPI receives images from the OceanGuard Node API.
- ONNX Runtime performs CPU inference on Windows, macOS, Linux, or a cloud VM.
- A CUDA provider can be used automatically when it is available in a custom
  runtime image.
- Before trained weights exist, Espada runs a deterministic visual-anomaly
  bootstrap to collect initial reviewed candidates. Its UI/API label these
  values as uncalibrated anomaly scores.
- When validated weights exist, the service hot-loads `espada-v1.onnx` and
  returns learned model scores or validation-calibrated confidence values.
- No paid AI API, API key, or hosted-model account is used.

## Model files

Place the exported artifacts in `ai_service/models/`:

- `espada-v1.onnx`
- `classes.json`
- `model-metadata.json`

The Docker Compose deployment shares this folder with the trainer at `/models`.

## HTTP contract

- `GET /health`
- `GET /v1/model`
- `POST /v1/detect` with multipart image field `file`
- `POST /v1/feedback`
- `GET /v1/learning`

## Development

```bash
python -m venv .venv
.venv/Scripts/activate        # Windows
pip install -r ai_service/requirements.txt
uvicorn ai_service.app.main:app --host 0.0.0.0 --port 8000
```

On macOS or Linux, activate with `source .venv/bin/activate`.
