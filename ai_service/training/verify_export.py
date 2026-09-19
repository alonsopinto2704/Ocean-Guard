"""Verify ONNX parity and measure the deployed preprocessing on a held-out set."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
from typing import Callable
import numpy as np
import onnxruntime as ort
import torch
from PIL import Image
from .detector import build_detector
from .export_onnx import SingleImageDetector
from .dataset import YoloBoxDataset
from .metrics import match_predictions, calibration_bins


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def record_verification_metadata(
    checkpoint_path: Path,
    model_dir: Path,
    report: dict,
    outcomes: list[tuple[float, bool]],
) -> None:
    """Replace training-time estimates with metrics from the exported ONNX file."""
    metadata_path = model_dir / 'model-metadata.json'
    metadata = json.loads(metadata_path.read_text(encoding='utf-8'))
    metadata['metrics'] = {
        key: value
        for key, value in report.items()
        if key.startswith('iou50') or key in ('truePositives', 'falsePositives', 'falseNegatives')
    }
    metadata['calibrationBins'] = calibration_bins(outcomes)
    metadata['validationImages'] = report['validationImages']
    metadata['verification'] = {
        'modelSha256': _sha256(model_dir / 'espada-v1.onnx'),
        'checkpointSha256': _sha256(checkpoint_path),
        'parityImages': report['parityImages'],
        'preprocessing': report['preprocessing'],
    }
    metadata['deploymentStage'] = 'PILOT'
    metadata['validationScope'] = 'General-litter pilot: limited recall, one Mixed Waste class. Not validated for marine deployment; review every result.'
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding='utf-8')


def verify(checkpoint_path: Path, model_dir: Path, dataset_root: Path, heartbeat: Callable[[], None] | None = None) -> dict:
    torch.set_num_threads(4)
    checkpoint = torch.load(checkpoint_path, map_location='cpu', weights_only=True)
    classes = json.loads((model_dir / 'classes.json').read_text(encoding='utf-8'))
    if checkpoint['classes'] != classes:
        raise ValueError('Checkpoint and exported class schema differ.')
    model = build_detector(len(checkpoint['classes']), pretrained=False, architecture=checkpoint['architecture'], input_size=checkpoint['inputSize'])
    model.load_state_dict(checkpoint['model_state_dict'])
    wrapper = SingleImageDetector(model.eval()).eval()
    options = ort.SessionOptions(); options.intra_op_num_threads = 4
    session = ort.InferenceSession(str(model_dir / 'espada-v1.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
    size = checkpoint['inputSize']; threshold = checkpoint.get('scoreThreshold', .25)
    dataset = YoloBoxDataset(dataset_root, 'val', model_dir / 'classes.json', training=False)
    outcomes = []; fn = 0; parity_samples = 0
    for index, path in enumerate(dataset.images):
        if heartbeat:
            heartbeat()
        with Image.open(path) as image:
            array = np.asarray(image.convert('RGB').resize((size, size)), dtype=np.float32) / 255
        tensor = torch.from_numpy(array.transpose(2, 0, 1).copy())[None]
        boxes, scores, labels = session.run(None, {session.get_inputs()[0].name: tensor.numpy()})
        if index < 8:
            with torch.inference_mode():
                pt_boxes, pt_scores, pt_labels = [v.numpy() for v in wrapper(tensor)]
            keep, pt_keep = scores >= threshold, pt_scores >= threshold
            np.testing.assert_array_equal(labels[keep], pt_labels[pt_keep])
            np.testing.assert_allclose(scores[keep], pt_scores[pt_keep], atol=2e-4, rtol=2e-4)
            np.testing.assert_allclose(boxes[keep], pt_boxes[pt_keep], atol=.08, rtol=2e-4)
            parity_samples += 1
        image_tensor, target = dataset[index]
        h, w = image_tensor.shape[-2:]
        prediction = {'boxes': torch.tensor(boxes * np.array([w/size,h/size,w/size,h/size])), 'scores': torch.tensor(scores), 'labels': torch.tensor(labels)}
        matched, missed = match_predictions(prediction, target, threshold, .5)
        outcomes.extend(matched); fn += missed
    tp = sum(correct for _, correct in outcomes); fp = len(outcomes) - tp
    report = {'parityImages': parity_samples, 'validationImages': len(dataset), 'iou50Precision': tp/max(tp+fp,1), 'iou50Recall': tp/max(tp+fn,1), 'iou50F1': 2*tp/max(2*tp+fp+fn,1), 'truePositives': tp, 'falsePositives': fp, 'falseNegatives': fn, 'scoreThreshold': threshold, 'preprocessing': 'Pillow RGB square resize, matching deployed inference'}
    (model_dir / 'verification.json').write_text(json.dumps(report, indent=2))
    record_verification_metadata(checkpoint_path, model_dir, report, outcomes)
    print(json.dumps(report, indent=2), flush=True)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--model-dir', type=Path, required=True)
    parser.add_argument('--dataset', type=Path, required=True)
    args = parser.parse_args()
    verify(args.checkpoint, args.model_dir, args.dataset)
