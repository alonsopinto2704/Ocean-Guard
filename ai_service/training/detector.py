from __future__ import annotations

from torchvision.models.detection import (
    FasterRCNN_MobileNet_V3_Large_320_FPN_Weights,
    fasterrcnn_mobilenet_v3_large_320_fpn,
)
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from torchvision.models.detection import ssdlite320_mobilenet_v3_large, SSDLite320_MobileNet_V3_Large_Weights
import torch


def build_detector(class_count: int, pretrained: bool = True, architecture: str = "Faster R-CNN MobileNetV3 FPN", input_size: int = 640):
    if architecture == "SSDLite320 MobileNetV3":
        model = ssdlite320_mobilenet_v3_large(
            weights=SSDLite320_MobileNet_V3_Large_Weights.DEFAULT if pretrained else None,
            weights_backbone=None,
            num_classes=91 if pretrained else class_count + 1,
        )
        if pretrained:
            head = model.head.classification_head
            for block in head.module_list:
                old = block[-1]
                anchors = old.out_channels // 91
                new = torch.nn.Conv2d(old.in_channels, anchors * (class_count + 1), 1)
                torch.nn.init.normal_(new.weight, std=0.01)
                torch.nn.init.zeros_(new.bias)
                block[-1] = new
            head.num_columns = class_count + 1
        return model
    weights = FasterRCNN_MobileNet_V3_Large_320_FPN_Weights.DEFAULT if pretrained else None
    model = fasterrcnn_mobilenet_v3_large_320_fpn(
        weights=weights,
        weights_backbone=None,
        min_size=input_size,
        max_size=input_size,
    )
    input_features = model.roi_heads.box_predictor.cls_score.in_features
    model.roi_heads.box_predictor = FastRCNNPredictor(input_features, class_count + 1)
    return model
