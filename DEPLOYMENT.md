# OceanGuard + Espada deployment

The supported deployment is a three-container Docker Compose stack. This keeps Espada server-side, so a visitor can use the website from any current laptop, desktop, tablet, or phone without installing Python or model files.

## Requirements

- Docker Desktop on Windows/macOS, or Docker Engine with Compose on Linux.
- 4 GB free memory for inference-only use; more memory is recommended while the trainer runs.
- HTTPS in production if browser-camera access is required.
- No AI API key or paid model subscription.

## Start the complete stack

```bash
docker compose up --build -d
docker compose ps
```

Open `http://localhost:3000`. On a server, point your HTTPS reverse proxy at port 3000. Do not expose port 8000 publicly; the Express gateway reaches Espada over the private Compose network.

## Services and persistent data

| Service | Purpose | Public port |
| --- | --- | --- |
| `web` | React application and Express API gateway | `3000` |
| `ai` | Espada inference and feedback API | none |
| `trainer` | Background continual-learning worker | none |

Reviewed images, SQLite data, snapshots, and training state persist in the `oceanguard-learning` volume. Model artifacts persist in `ai_service/models/`.

Back up both before migration:

```bash
docker compose stop
```

Then back up the project’s `ai_service/models` directory and the Docker volume with your platform’s standard volume-backup procedure.

## Inference-only mode

On a small host, omit the trainer and periodically train elsewhere:

```bash
docker compose up --build -d web ai
```

This still provides real-time inference and stores reviews. Start `trainer` later to consume the accumulated queue:

```bash
docker compose up --build -d trainer
```

## Continual-learning settings

The defaults wait for 50 new reviewed detections, train for 12 epochs, and require an IoU-0.50 F1 improvement of at least 0.005 before promotion. Change these environment values on the `trainer` service:

- `OCEANGUARD_MIN_NEW_REVIEWS`
- `OCEANGUARD_RETRAIN_POLL_SECONDS`
- `OCEANGUARD_RETRAIN_EPOCHS`
- `OCEANGUARD_MIN_F1_IMPROVEMENT`

CPU training is portable but can be slow. A GPU-enabled trainer image can be substituted without changing the website or production ONNX service.

## Production checklist

- Put an HTTPS reverse proxy or managed load balancer in front of port 3000.
- Restrict access to operator and review screens.
- Set disk quotas and retention rules for stored inference images.
- Monitor `/api/health` and `/api/ai/status`.
- Keep training and validation imagery from the same mission in only one split.
- Inspect every promoted metric record in `ai_service/models/model-metadata.json`.
- Back up the learning volume and current ONNX file.
- Scale inference separately from the trainer for heavier camera traffic.

## Vercel website deployment

The React website and Express gateway are Vercel-compatible through
`api/index.ts` and `vercel.json`. Set `AI_SERVICE_URL` in the Vercel project to
the HTTPS URL of a separately deployed Espada inference service. Without it,
the website remains available but Espada reports offline because Vercel's
ephemeral serverless filesystem cannot safely host SQLite-backed continuous
learning or the persistent trainer.

Deploy from the repository root:

```bash
vercel
vercel --prod
```

The mock dashboard data is currently process-local and is demonstration-only.
Replace it with a managed database before treating operator changes as durable.

On Vercel, the demo JSON store uses the writable temporary directory. It is
instance-local and can be reset during scaling or redeployment, including login
sessions. For local testing, `OCEANGUARD_WEB_DATA_DIR` selects an isolated store.
Local operator data and credentials are excluded from Git and deployment uploads.
Self-service password recovery returns an explicit unavailable response until a
verified recovery delivery channel is configured; reset tokens are never returned
by the public recovery endpoint.

## Other cloud notes

Use a container host that supports Docker Compose or deploy the three services separately on a private network. A static-only host such as a basic Netlify/Vercel static deployment cannot run the persistent Python inference and continual-learning services by itself.

The software does not incur model/API usage fees. Your hosting provider may charge for CPU, memory, GPU, storage, bandwidth, or backups.
