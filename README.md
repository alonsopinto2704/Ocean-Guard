# OceanGuard

For the current simulation/replay completion status and final verification tasks, see [FINAL_IMPROVEMENT_PLAN.md](FINAL_IMPROVEMENT_PLAN.md).

OceanGuard is a responsive marine-debris monitoring and response application. Its AI component is **Espada version 1**, a self-hosted real-time detection service with confidence reporting, risk analysis, human review, and asynchronous continual learning.

Espada does not use Gemini, OpenAI, Roboflow, or any other paid inference API. No AI API key is required. Website visitors need only a modern browser; inference runs on the deployed server.

## What is real today

- React/TypeScript interface with image upload and live browser-camera capture.
- Express gateway that forwards image bytes to Espada without exposing the Python service.
- FastAPI inference service using a portable ONNX Runtime production path.
- A deterministic cold-start visual-anomaly mode so the flow can be tested before custom weights exist. Cold-start scores are explicitly shown as raw anomaly scores, not accuracy claims.
- Bounding boxes, measured per-image inference time, confidence meters, and rule-based risk levels.
- Reviewer actions for confirmed detections, false positives, and corrected class labels.
- SQLite learning store and an isolated retraining worker.
- Candidate model promotion only when held-out IoU-0.50 F1 improves.
- Docker Compose deployment for Windows, macOS, Linux, or a cloud host.

The operational dashboards still contain prototype monitoring records. The AI registry itself contains only Espada and never substitutes fabricated validation metrics.

## One-command deployment

Install Docker Desktop (or Docker Engine), then run:

```bash
docker compose up --build
```

Open `http://localhost:3000`. The stack starts:

- `web`: React application and Express gateway on port 3000.
- `ai`: Espada inference on the private Compose network.
- `trainer`: continual-learning worker. It sleeps until enough reviewed examples exist.

To run the website without the trainer:

```bash
docker compose up --build web ai
```

No paid AI service is contacted. A paid cloud provider can still charge for the computer hosting the containers.

### Vercel web deployment

The existing Vercel project deploys the React/Express web gateway only. Espada needs its own persistent container because reviewed images and learning state must survive restarts; Vercel functions are stateless.

Deploy `ai_service/Dockerfile` on a persistent container host with a mounted `/data` volume, then set these variables on both services and redeploy the existing Vercel project:

```text
AI_SERVICE_URL=https://your-private-espada-service.example
ESPADA_SERVICE_TOKEN=<same-long-random-secret-on-both-services>
OCEANGUARD_SESSION_SECRET=<different-long-random-secret-on-the-web-service>
```

The packaged container includes the verified `SSDLite320 MobileNetV3` ONNX pilot model. Keep `/health` available to the host health check; all `/v1/*` routes require `ESPADA_SERVICE_TOKEN` when it is configured.

## Try Espada

1. Sign in with `operator@oceanguard.ai` and password `demo1234`.
2. Open **Espada AI & Data** to see Espada’s live state, upload images, and review results.
3. Upload a JPG, PNG, or WebP image, or start the browser camera.
4. Confirm correct candidates, mark false positives, or choose the correct debris class.

The built-in cold-start detector identifies visually unusual regions in a water scene as `Mixed Waste` candidates. It is useful for testing and initial data collection; it is not a replacement for training on representative labeled marine imagery.

## Train the learned detector

Espada accepts the standard normalized YOLO bounding-box text format without depending on Ultralytics:

```text
datasets/marine_debris/
  images/train/*.jpg
  images/val/*.jpg
  labels/train/*.txt
  labels/val/*.txt
```

Each label row is:

```text
class_id x_center y_center width height
```

See [ai_service/training/README.md](ai_service/training/README.md) for the training and ONNX export commands. The production artifact is `ai_service/models/espada-v1.onnx`.

## Continual-learning safety

Espada does not update live weights from every camera frame. That would allow mistakes and hostile inputs to corrupt the model. Instead:

1. Live inferences remain stable and are available for review.
2. Human-reviewed confirmations, corrections, and hard negatives accumulate in SQLite.
3. After the configured threshold, a separate worker builds a versioned snapshot and trains a candidate using all approved data.
4. The candidate is evaluated on a separate validation split.
5. The ONNX file is atomically promoted only when validation F1 improves.
6. The inference service notices the new file and hot-reloads it without a website restart.

Set `OCEANGUARD_MIN_NEW_REVIEWS`, `OCEANGUARD_RETRAIN_EPOCHS`, and `OCEANGUARD_MIN_F1_IMPROVEMENT` in `docker-compose.yml` to tune this policy.

## Reuse Espada in another project

The AI is deliberately isolated in [`ai_service/`](ai_service/). Copy that directory into another repository and use its HTTP contract:

- `GET /health`
- `GET /v1/model`
- `POST /v1/detect` with multipart field `file`
- `PUT /v1/analyses/{analysis_id}/review`
- `GET /v1/learning`

The folder includes its runtime Dockerfile, training Dockerfile, class schema, learning store, model exporter, tests, and documentation. It does not import OceanGuard frontend code.

## Local development

Website:

```bash
pnpm install
pnpm run dev
```

Espada service in a second terminal:

```bash
python -m venv .venv
.venv/Scripts/activate
pip install -r ai_service/requirements.txt
uvicorn ai_service.app.main:app --host 0.0.0.0 --port 8000
```

On macOS or Linux, activate the environment with `source .venv/bin/activate`.

## Verification

```bash
pnpm run lint
pnpm run build
python -m unittest discover -s ai_service/tests -v
```

## Main stack

- React 19, TypeScript, Vite, Tailwind CSS
- Express and Server-Sent Events
- Three.js and Leaflet
- Python, FastAPI, Pillow, NumPy
- PyTorch/TorchVision for training
- ONNX Runtime for deployment inference
- SQLite for reviewed learning data
- Docker Compose for portable deployment

## Privacy and operations

Analyzed images and review records are stored in the `oceanguard-learning` Docker volume because they are needed for continual learning. Treat that volume as sensitive operational data, control access to the review endpoints, define a retention policy, and back it up before moving deployments.
