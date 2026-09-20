from __future__ import annotations

import os
import math
import hmac

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Literal
from starlette.concurrency import run_in_threadpool

from .learning import LearningStore, MAX_FRAME_ANNOTATIONS, RevisionConflictError
from .model import MarineDebrisDetector, ModelNotReadyError


MAX_IMAGE_BYTES = int(os.getenv("OCEANGUARD_MAX_IMAGE_BYTES", str(4 * 1024 * 1024)))
detector = MarineDebrisDetector()
learning_store = LearningStore()


class BoundingBoxCorrection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float = Field(ge=0, le=1, strict=True, allow_inf_nan=False)
    y: float = Field(ge=0, le=1, strict=True, allow_inf_nan=False)
    width: float = Field(gt=0, le=1, strict=True, allow_inf_nan=False)
    height: float = Field(gt=0, le=1, strict=True, allow_inf_nan=False)

    @model_validator(mode="after")
    def fits_inside_image(self):
        values = (self.x, self.y, self.width, self.height)
        if not all(math.isfinite(value) for value in values):
            raise ValueError("Bounding box values must be finite numbers.")
        if self.x + self.width > 1 or self.y + self.height > 1:
            raise ValueError("Bounding boxes must fit entirely within the image.")
        return self


class DetectionFeedback(BaseModel):
    analysisId: str
    detectionId: str
    verdict: Literal["CONFIRMED", "FALSE_POSITIVE", "CORRECTED"]
    correctedClass: str | None = None
    correctedBoundingBox: BoundingBoxCorrection | None = None
    reviewer: str | None = None


class FrameReviewAnnotation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    annotationId: str = Field(min_length=1, max_length=128)
    sourceDetectionId: str | None = Field(default=None, min_length=1, max_length=128)
    verdict: Literal["CONFIRMED", "FALSE_POSITIVE", "CORRECTED", "MISSED"]
    correctedClass: str | None = Field(default=None, min_length=1, max_length=128)
    correctedBoundingBox: BoundingBoxCorrection | None = None

    @model_validator(mode="after")
    def validate_disposition(self):
        if self.verdict in {"CONFIRMED", "FALSE_POSITIVE"}:
            if self.sourceDetectionId is None:
                raise ValueError(f"{self.verdict} annotations require sourceDetectionId.")
            if self.correctedClass is not None or self.correctedBoundingBox is not None:
                raise ValueError(f"{self.verdict} annotations cannot include corrections.")
        elif self.verdict == "CORRECTED":
            if self.sourceDetectionId is None:
                raise ValueError("CORRECTED annotations require sourceDetectionId.")
            if self.correctedClass is None and self.correctedBoundingBox is None:
                raise ValueError("CORRECTED annotations require a corrected class or bounding box.")
        elif self.verdict == "MISSED":
            if self.sourceDetectionId is not None:
                raise ValueError("MISSED annotations cannot reference an original prediction.")
            if self.correctedClass is None or self.correctedBoundingBox is None:
                raise ValueError("MISSED annotations require a known class and bounding box.")
        return self


class FrameReview(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expectedRevision: int = Field(ge=0, strict=True)
    reviewer: str | None = Field(default=None, max_length=200)
    annotations: list[FrameReviewAnnotation] = Field(max_length=MAX_FRAME_ANNOTATIONS)

app = FastAPI(
    title="Espada Intelligence",
    version="1",
    description="Portable server-side marine-debris object detection and analysis.",
)

allowed_origins = [
    item.strip()
    for item in os.getenv("OCEANGUARD_ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    if item.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["*"],
)


@app.middleware("http")
async def require_service_token(request: Request, call_next):
    expected = os.getenv("ESPADA_SERVICE_TOKEN", "")
    if expected and request.url.path.startswith("/v1/"):
        supplied = request.headers.get("x-espada-service-token", "")
        if not hmac.compare_digest(supplied, expected):
            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    return await call_next(request)


@app.get("/health")
def health() -> dict:
    return detector.status()


@app.get("/v1/model")
def model_status() -> dict:
    return {**detector.status(), "learning": learning_store.stats()}


@app.get("/v1/learning")
def learning_status() -> dict:
    return learning_store.stats()


@app.post("/v1/detect")
async def detect(file: UploadFile = File(...)) -> dict:
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Upload a JPG, PNG, or WebP image.")

    image_bytes = await file.read(MAX_IMAGE_BYTES + 1)
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds the upload limit.")

    try:
        result = await run_in_threadpool(detector.predict, image_bytes, file.filename or "upload")
        analysis_id = await run_in_threadpool(learning_store.record_analysis,
            image_bytes, file.filename or "upload", result
        )
        return {**result, "analysisId": analysis_id}
    except ModelNotReadyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Unable to analyze image: {exc}") from exc


@app.post("/v1/feedback")
def feedback() -> dict:
    raise HTTPException(
        status_code=410,
        detail="Per-box feedback has been retired. Submit whole-frame reviews via PUT /v1/analyses/{analysis_id}/review.",
    )


@app.put("/v1/analyses/{analysis_id}/review")
def save_frame_review(analysis_id: str, payload: FrameReview) -> dict:
    try:
        return learning_store.save_frame_review(
            analysis_id=analysis_id,
            expected_revision=payload.expectedRevision,
            annotations=[annotation.model_dump() for annotation in payload.annotations],
            reviewer=payload.reviewer,
            allowed_classes=set(detector.classes),
        )
    except RevisionConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
