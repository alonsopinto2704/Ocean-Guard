# Training Espada version 1

The training code uses PyTorch/TorchVision directly and does not depend on the
Ultralytics runtime. It fine-tunes a Faster R-CNN detector with a MobileNetV3
feature pyramid backbone, then exports the result to ONNX for portable CPU
inference.

## Dataset layout

Use standard normalized YOLO bounding-box labels:

```text
datasets/marine_debris/
  images/train/*.jpg
  images/val/*.jpg
  labels/train/*.txt
  labels/val/*.txt
```

Each label line must contain:

```text
class_id x_center y_center width height
```

Class IDs correspond to `ai_service/models/classes.json`. Include varied water,
weather, altitude, camera, lighting, partial-occlusion, and empty-ocean images.
Keep footage from the same mission in only one split to prevent data leakage.

For a Pascal VOC dataset such as IWHR_AI_Lable_Floater_V1, use
`prepare_voc.py`; the inspection/mapping workflow is documented in
`datasets/README.md`. Review the generated split for mission or video leakage:
the converter cannot infer capture-group identity from arbitrary filenames.

## Train

```bash
pip install -r ai_service/training/requirements-train.txt
python -m ai_service.training.train --dataset datasets/marine_debris --epochs 30
```

The best checkpoint is written to `training_runs/marine_detector/best.pt`.

## Export

```bash
python -m ai_service.training.export_onnx \
  --checkpoint training_runs/marine_detector/best.pt \
  --output-dir ai_service/models
```

The exported ONNX file and validation metadata are consumed by the production
service. Confidence calibration bins are derived only from the validation split.
