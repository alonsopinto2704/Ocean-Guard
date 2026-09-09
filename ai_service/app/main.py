from __future__ import annotations

import os

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Literal

from .learning import LearningStore
from .model import MarineDebrisDetector, ModelNotReadyError


MAX_IMAGE_BYTES = int(os.getenv("OCEANGUARD_MAX_IMAGE_BYTES", str(20 * 1024 * 1024)))
detector = MarineDebrisDetector()
learning_store = LearningStore()


class BoundingBoxCorrection(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)


class DetectionFeedback(BaseModel):
    analysisId: str
    detectionId: str
    verdict: Literal["CONFIRMED", "FALSE_POSITIVE", "CORRECTED"]
    correctedClass: str | None = None
    correctedBoundingBox: BoundingBoxCorrection | None = None
    reviewer: str | None = None

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
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


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
        raise HTTPException(status_code=413, detail="Image exceeds the 20 MB limit.")

    try:
        result = detector.predict(image_bytes, file.filename or "upload")
        analysis_id = learning_store.record_analysis(
            image_bytes, file.filename or "upload", result
        )
        return {**result, "analysisId": analysis_id}
    except ModelNotReadyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Unable to analyze image: {exc}") from exc


@app.post("/v1/feedback")
def feedback(payload: DetectionFeedback) -> dict:
    if payload.correctedClass and payload.correctedClass not in detector.classes:
        raise HTTPException(status_code=422, detail="Corrected class is not in the model class list.")
    try:
        return learning_store.save_feedback(
            analysis_id=payload.analysisId,
            detection_id=payload.detectionId,
            verdict=payload.verdict,
            corrected_class=payload.correctedClass,
            corrected_box=(
                payload.correctedBoundingBox.model_dump()
                if payload.correctedBoundingBox
                else None
            ),
            reviewer=payload.reviewer,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
