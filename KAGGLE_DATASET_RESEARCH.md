# Espada marine-debris dataset research

Prepared: 2026-09-13  
Status: research only; no datasets downloaded and no model training started.

Espada currently uses TACO general-litter imagery and exposes one learned class, `Mixed Waste`. New sources should expand marine-domain coverage without mixing evaluation footage into training or overstating commercial reuse rights.

## Recommended shortlist

| Priority | Dataset | Domain and contents | Reuse note | Intended use |
|---|---|---|---|---|
| 1 | [SeaClear on Kaggle](https://www.kaggle.com/datasets/jocelyndumlao/seaclear-marine-debris-detection-and-segmentation) / [official repository](https://github.com/adjuras/seaclear-dataset) | 8,610 ROV images, 40 debris/bio/robot categories, COCO boxes and masks, five Croatia/France sites | Use the official repository's CC BY 4.0 statement; do not rely on Kaggle's conflicting CC0 label | First underwater training addition; collapse debris categories to `mixed_waste`, retain bio/ROV for hard-negative evaluation |
| 2 | [Marine Monitoring — Dalnie Zelentsy](https://www.kaggle.com/datasets/olgabilousova/marine-monitoring-autumn-2023-dalnie-zelentsy) | About 10,000 ship-camera frames with YOLO boxes for marine debris plus birds, glare and lens water drops | CC BY-SA 4.0 | Separate surface-ocean branch and false-positive stress set |
| 3 | [TrashCan 1.0 on Kaggle](https://www.kaggle.com/datasets/mexwell/trashcan-1-0) / [official project](https://irvlab.cs.umn.edu/projects/tackling-marine-debris) | 7,212 deep-underwater images with COCO boxes/masks; material and instance taxonomies | Follow stricter upstream academic/research and JAMSTEC permission language despite Kaggle's CC BY display | External underwater benchmark first, not training |
| 4 | [FloW official repository](https://github.com/ORCAUBOAT/FloW-Dataset) / [ICCV paper](https://openaccess.thecvf.com/content/ICCV2021/papers/Cheng_FloW_A_Dataset_and_Benchmark_for_Floating_Waste_Detection_in_ICCV_2021_paper.pdf) | FloW-Img has 2,000 images and 5,271 small floating-waste boxes; FloW-RI adds image/radar frames | No clear reusable license found; official access requires an application | Add only after written license and format review |
| 5 | [BePLi v1 paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC10173386/) / [official dataset DOI](https://doi.org/10.17882/92297) | 3,709 Japanese beach images, one plastic-litter class, COCO boxes/masks | CC BY-NC-SA | Only if shoreline monitoring becomes an explicit product scope |
| 6 | [Underwater Plastic Pollution Detection](https://www.kaggle.com/datasets/arnavs19/underwater-plastic-pollution-detection) | 5,130 images, 15 classes, text bounding-box labels, Dark Channel preprocessing | Kaggle says CC BY 4.0, but provenance is weak | Audit hashes/provenance before any use; never use as trusted validation by default |

## Avoid as primary validation

- [Marine Debris Images Dataset](https://www.kaggle.com/datasets/zienabesam/marine-debris-images-dataset): only 575 images and an unspecified Roboflow source.
- [litter-detection](https://www.kaggle.com/datasets/davianmartinovci/litter-detection): explicitly mixes TACO, BlueROV2 and land imagery, which would reintroduce existing TACO samples.
- [Trash-ICRA19 Kaggle mirror](https://www.kaggle.com/datasets/shivamb/underwater-trash-detection): useful research footage but overlaps the J-EDI source family used by TrashCan/CleanSea derivatives.
- [AFO aerial floating objects](https://www.kaggle.com/datasets/jangsienicajzkowy/afo-aerial-dataset-of-floating-objects): primarily search-and-rescue objects and people, not litter; use only as a carefully separated hard-negative source.

## Required ingestion and leakage controls

1. Record canonical upstream dataset ID, version, license, download date, source URL, and per-image source group in a manifest.
2. Never combine a Kaggle mirror with the canonical copy or another derivative of the same footage.
3. Compute exact hashes and perceptual hashes before merging with TACO or another marine source.
4. Split by site, camera, source video, expedition/day and capture sequence—not randomly by frame.
5. Maintain separate surface, underwater and beach validation reports. Do not collapse them into one headline score.
6. Preserve nuisance annotations such as bio, ROV, birds, glare and water drops for false-positive analysis rather than relabeling them as unreviewed background.
7. Keep TrashCan/J-EDI-family data outside training initially and use it as an external benchmark to reveal domain shift.
8. Inspect Roboflow-derived mirrors for augmentation artifacts and source leakage before accepting any sample.
9. Kaggle's displayed license never overrides a stricter upstream license or permission requirement.

## Proposed staged experiment

1. Build a SeaClear converter and provenance manifest; create site-camera grouped train/validation splits.
2. Fine-tune a candidate from the current owned checkpoint with SeaClear debris collapsed to `Mixed Waste`.
3. Evaluate the unchanged incumbent and candidate separately on TACO, held-out SeaClear, Dalnie Zelentsy surface footage, and TrashCan external footage.
4. Add Dalnie Zelentsy training only after checking sequence overlap and keep a frozen day/video-grouped nuisance test set.
5. Promote nothing unless ONNX parity, per-domain precision/recall/F1, calibration, false positives, bundle checks and current promotion policy all pass.

This plan expands evidence. It does not make the current low-recall pilot production-ready by itself.
