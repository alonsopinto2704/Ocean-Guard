import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Check, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import type {
  AIBoundingBox,
  AIFeedbackVerdict,
  AIFrameReviewAnnotation,
  AIInferenceResult,
} from '../../types';
import { aiApi } from '../../lib/api';
import { Button } from '../ui/Button';

interface AnnotationEditorProps {
  imageUrl: string;
  result: AIInferenceResult;
  classes: string[];
}

interface DraftAnnotation {
  annotationId: string;
  sourceDetectionId: string | null;
  verdict: AIFeedbackVerdict | null;
  className: string;
  box: AIBoundingBox;
  originalClassName?: string;
  originalBox?: AIBoundingBox;
}

interface PointerEdit {
  id: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  original: AIBoundingBox;
}

interface DrawState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

// Smallest box dimension (normalized units) accepted as a valid annotation.
const MIN_BOX = 0.01;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function boxesMatch(left?: AIBoundingBox, right?: AIBoundingBox) {
  if (!left || !right) return left === right;
  return (['x', 'y', 'width', 'height'] as const).every((key) => Math.abs(left[key] - right[key]) < 0.0005);
}

/** Convert a pointer event to normalized 0-1 image coordinates. */
function normalizedPoint(event: PointerEvent, element: HTMLElement) {
  const bounds = element.getBoundingClientRect();
  return {
    x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
    y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
  };
}

/** Seed one editable draft per model detection, keeping the original class/box
 *  so verdicts can revert corrections. */
function draftFromResult(result: AIInferenceResult): DraftAnnotation[] {
  return result.detections.map((detection) => ({
    annotationId: detection.id,
    sourceDetectionId: detection.id,
    verdict: null,
    className: detection.className,
    box: { ...detection.boundingBox },
    originalClassName: detection.className,
    originalBox: { ...detection.boundingBox },
  }));
}

/** Convert a draft into the wire format for the review API. Returns null while
 *  a predicted box is still undecided; corrections/misses only include fields
 *  that actually changed. */
function annotationPayload(draft: DraftAnnotation): AIFrameReviewAnnotation | null {
  if (!draft.verdict) return null;
  if (draft.sourceDetectionId === null) {
    return {
      annotationId: draft.annotationId,
      sourceDetectionId: null,
      verdict: 'MISSED',
      correctedClass: draft.className,
      correctedBoundingBox: draft.box,
    };
  }
  if (draft.verdict !== 'CORRECTED') {
    return {
      annotationId: draft.annotationId,
      sourceDetectionId: draft.sourceDetectionId,
      verdict: draft.verdict,
    };
  }
  return {
    annotationId: draft.annotationId,
    sourceDetectionId: draft.sourceDetectionId,
    verdict: 'CORRECTED',
    ...(draft.className !== draft.originalClassName ? { correctedClass: draft.className } : {}),
    ...(!boxesMatch(draft.box, draft.originalBox) ? { correctedBoundingBox: draft.box } : {}),
  };
}

/** Whole-frame review editor: confirm/reject each predicted box, drag/resize
 *  geometry, draw boxes for missed debris, then atomically submit the frame.
 *  Uses optimistic concurrency (expectedRevision) for safe concurrent review. */
export function AnnotationEditor({ imageUrl, result, classes }: AnnotationEditorProps) {
  const [drafts, setDrafts] = useState<DraftAnnotation[]>(() => draftFromResult(result));
  const [selectedId, setSelectedId] = useState<string | null>(result.detections[0]?.id ?? null);
  const [drawMode, setDrawMode] = useState(false);
  const [drawState, setDrawState] = useState<DrawState | null>(null);
  const [pointerEdit, setPointerEdit] = useState<PointerEdit | null>(null);
  const [checkedWholeFrame, setCheckedWholeFrame] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedRevision, setSavedRevision] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDrafts(draftFromResult(result));
    setSelectedId(result.detections[0]?.id ?? null);
    setDrawMode(false);
    setDrawState(null);
    setPointerEdit(null);
    setCheckedWholeFrame(false);
    setSavedRevision(0);
    setMessage(null);
  }, [result.analysisId]);

  const availableClasses = useMemo(
    () => Array.from(new Set([...classes, ...result.detections.map((item) => item.className)])).filter(Boolean),
    [classes, result.detections],
  );
  const selected = drafts.find((item) => item.annotationId === selectedId) ?? null;
  const unresolvedCount = drafts.filter((item) => item.sourceDetectionId !== null && item.verdict === null).length;

  function updateDraft(id: string, update: (draft: DraftAnnotation) => DraftAnnotation) {
    setDrafts((current) => current.map((draft) => draft.annotationId === id ? update(draft) : draft));
    setMessage(null);
  }

  function setVerdict(id: string, verdict: AIFeedbackVerdict) {
    updateDraft(id, (draft) => ({
      ...draft,
      verdict,
      ...(verdict === 'CONFIRMED' || verdict === 'FALSE_POSITIVE'
        ? { className: draft.originalClassName ?? draft.className, box: draft.originalBox ? { ...draft.originalBox } : draft.box }
        : {}),
    }));
  }

  function markCorrected(id: string, patch: Partial<Pick<DraftAnnotation, 'className' | 'box'>>) {
    updateDraft(id, (draft) => ({ ...draft, ...patch, verdict: draft.sourceDetectionId === null ? 'MISSED' : 'CORRECTED' }));
  }

  function beginExistingEdit(id: string, mode: PointerEdit['mode'], event: PointerEvent<HTMLElement>) {
    const frame = frameRef.current;
    const draft = drafts.find((item) => item.annotationId === id);
    if (!frame || !draft || draft.verdict === 'FALSE_POSITIVE') return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = normalizedPoint(event, frame);
    setSelectedId(id);
    setPointerEdit({ id, mode, startX: point.x, startY: point.y, original: { ...draft.box } });
  }

  function moveExisting(event: PointerEvent<HTMLElement>) {
    if (!pointerEdit || !frameRef.current) return;
    const point = normalizedPoint(event, frameRef.current);
    const dx = point.x - pointerEdit.startX;
    const dy = point.y - pointerEdit.startY;
    let next: AIBoundingBox;
    if (pointerEdit.mode === 'move') {
      next = {
        ...pointerEdit.original,
        x: clamp(pointerEdit.original.x + dx, 0, 1 - pointerEdit.original.width),
        y: clamp(pointerEdit.original.y + dy, 0, 1 - pointerEdit.original.height),
      };
    } else {
      next = {
        ...pointerEdit.original,
        width: clamp(pointerEdit.original.width + dx, MIN_BOX, 1 - pointerEdit.original.x),
        height: clamp(pointerEdit.original.height + dy, MIN_BOX, 1 - pointerEdit.original.y),
      };
    }
    markCorrected(pointerEdit.id, { box: next });
  }

  function beginDraw(event: PointerEvent<HTMLDivElement>) {
    if (!drawMode) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = normalizedPoint(event, event.currentTarget);
    setDrawState({ startX: point.x, startY: point.y, currentX: point.x, currentY: point.y });
  }

  function moveDraw(event: PointerEvent<HTMLDivElement>) {
    if (!drawState || !drawMode) return;
    const point = normalizedPoint(event, event.currentTarget);
    setDrawState((current) => current ? { ...current, currentX: point.x, currentY: point.y } : null);
  }

  function finishDraw() {
    if (!drawState) return;
    const x = Math.min(drawState.startX, drawState.currentX);
    const y = Math.min(drawState.startY, drawState.currentY);
    const width = Math.abs(drawState.currentX - drawState.startX);
    const height = Math.abs(drawState.currentY - drawState.startY);
    setDrawState(null);
    if (width < MIN_BOX || height < MIN_BOX) {
      setMessage('Drag a larger box around the missed object.');
      return;
    }
    const annotationId = `MISS-${crypto.randomUUID()}`;
    setDrafts((current) => [...current, {
      annotationId,
      sourceDetectionId: null,
      verdict: 'MISSED',
      className: availableClasses[0] ?? '',
      box: { x, y, width, height },
    }]);
    setSelectedId(annotationId);
    setDrawMode(false);
    setMessage(null);
  }

  function updateBoxField(field: keyof AIBoundingBox, rawValue: string) {
    if (!selected) return;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;
    const box = { ...selected.box, [field]: parsed };
    box.width = clamp(box.width, MIN_BOX, 1);
    box.height = clamp(box.height, MIN_BOX, 1);
    box.x = clamp(box.x, 0, 1 - box.width);
    box.y = clamp(box.y, 0, 1 - box.height);
    markCorrected(selected.annotationId, { box });
  }

  function removeMissed(id: string) {
    setDrafts((current) => current.filter((draft) => draft.annotationId !== id));
    setSelectedId(result.detections[0]?.id ?? null);
    setMessage(null);
  }

  function resetDraft() {
    setDrafts(draftFromResult(result));
    setSelectedId(result.detections[0]?.id ?? null);
    setCheckedWholeFrame(false);
    setDrawMode(false);
    setMessage(null);
  }

  async function submitReview() {
    const annotations = drafts.map(annotationPayload);
    if (annotations.some((annotation) => annotation === null)) {
      setMessage('Review every predicted box before submitting the frame.');
      return;
    }
    if (!checkedWholeFrame) {
      setMessage('Confirm that you checked the whole frame for missed debris.');
      return;
    }
    if (annotations.some((annotation) => annotation?.verdict === 'CORRECTED'
      && !annotation.correctedClass && !annotation.correctedBoundingBox)) {
      setMessage('A corrected detection needs a changed class or bounding box.');
      return;
    }
    if (annotations.some((annotation) => annotation?.verdict === 'MISSED' && !annotation.correctedClass)) {
      setMessage('Choose a class for every missed object.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const response = await aiApi.submitFrameReview(result.analysisId, {
        expectedRevision: savedRevision,
        annotations: annotations as AIFrameReviewAnnotation[],
      });
      setSavedRevision(response.revision);
      setMessage(`Frame review saved at revision ${response.revision}. It is queued for candidate training.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Frame review could not be saved. Your draft is still here.');
    } finally {
      setSaving(false);
    }
  }

  const previewBox = drawState ? {
    x: Math.min(drawState.startX, drawState.currentX),
    y: Math.min(drawState.startY, drawState.currentY),
    width: Math.abs(drawState.currentX - drawState.startX),
    height: Math.abs(drawState.currentY - drawState.startY),
  } : null;

  return (
    <section className="space-y-4" aria-label="Whole-frame debris review">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-[var(--ocean-text)]">Review the whole frame</h3>
          <p className="mt-1 text-[11px] text-[var(--ocean-text-dim)]">
            Decide every proposed box, adjust geometry if needed, and draw boxes around debris Espada missed.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="xs" variant={drawMode ? 'success' : 'outline'} icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setDrawMode((active) => !active)}>
            {drawMode ? 'Drag on image' : 'Add missed object'}
          </Button>
          <Button size="xs" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={resetDraft}>Reset</Button>
        </div>
      </div>

      <div
        ref={frameRef}
        className={`relative w-fit max-w-full overflow-hidden rounded border bg-[#080e1a] ${drawMode ? 'cursor-crosshair border-[#00f5d4]' : 'border-[var(--ocean-border)]'}`}
        style={{ touchAction: drawMode ? 'none' : 'pan-y' }}
        onPointerDown={beginDraw}
        onPointerMove={moveDraw}
        onPointerUp={finishDraw}
        onPointerCancel={() => setDrawState(null)}
      >
        <img src={imageUrl} alt="Exact source frame being reviewed" className="pointer-events-none block h-auto max-h-[38rem] max-w-full select-none" draggable={false} />
        <div className="absolute inset-0">
          {drafts.map((draft, index) => {
            const selectedBox = draft.annotationId === selectedId;
            const rejected = draft.verdict === 'FALSE_POSITIVE';
            const color = rejected ? '#ff5964' : draft.sourceDetectionId === null ? '#ffaa00' : selectedBox ? '#00f5d4' : '#4cd6fb';
            return (
              <div
                key={draft.annotationId}
                className={`absolute border-2 ${rejected ? 'opacity-45' : ''}`}
                style={{
                  left: `${draft.box.x * 100}%`, top: `${draft.box.y * 100}%`,
                  width: `${draft.box.width * 100}%`, height: `${draft.box.height * 100}%`,
                  borderColor: color,
                  cursor: rejected ? 'pointer' : 'move',
                  touchAction: 'none',
                }}
                onClick={(event) => { event.stopPropagation(); setSelectedId(draft.annotationId); }}
                onPointerDown={(event) => beginExistingEdit(draft.annotationId, 'move', event)}
                onPointerMove={moveExisting}
                onPointerUp={() => setPointerEdit(null)}
                onPointerCancel={() => setPointerEdit(null)}
              >
                <span className="absolute -top-6 left-[-2px] max-w-48 truncate whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[10px] font-bold text-[#080e1a]" style={{ backgroundColor: color }}>
                  {draft.sourceDetectionId === null ? 'MISSED' : `#${index + 1}`} · {draft.className}{draft.verdict ? ` · ${draft.verdict.replace('_', ' ')}` : ' · REVIEW'}
                </span>
                {!rejected && selectedBox && (
                  <button
                    type="button"
                    aria-label={`Resize ${draft.className} bounding box`}
                    className="absolute -bottom-3 -right-3 h-6 w-6 rounded-full border-2 border-[#080e1a] bg-[#00f5d4] shadow"
                    onPointerDown={(event) => beginExistingEdit(draft.annotationId, 'resize', event)}
                    onPointerMove={moveExisting}
                    onPointerUp={() => setPointerEdit(null)}
                    onPointerCancel={() => setPointerEdit(null)}
                  />
                )}
              </div>
            );
          })}
          {previewBox && (
            <div className="pointer-events-none absolute border-2 border-dashed border-[#ffaa00] bg-[#ffaa00]/10" style={{
              left: `${previewBox.x * 100}%`, top: `${previewBox.y * 100}%`,
              width: `${previewBox.width * 100}%`, height: `${previewBox.height * 100}%`,
            }} />
          )}
        </div>
      </div>

      {drafts.length > 1 && (
        <div className="flex flex-wrap gap-2" aria-label="Select an annotation to review">
          {drafts.map((draft, index) => (
            <Button
              key={draft.annotationId}
              size="xs"
              variant={draft.annotationId === selectedId ? 'success' : 'outline'}
              onClick={() => setSelectedId(draft.annotationId)}
            >
              {draft.sourceDetectionId === null ? `Missed ${index + 1}` : `Prediction ${index + 1}`} · {draft.verdict ? draft.verdict.replace('_', ' ') : 'Review'}
            </Button>
          ))}
        </div>
      )}

      {selected ? (
        <div className="rounded border border-[var(--ocean-border)] bg-[var(--ocean-surface)] p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-[var(--ocean-text)]">
                {selected.sourceDetectionId === null ? 'Missed object' : `Prediction ${selected.sourceDetectionId}`}
              </p>
              <p className="mt-1 text-[10px] text-[var(--ocean-text-muted)]">Drag the box to move it; use the lower-right handle to resize.</p>
            </div>
            {selected.sourceDetectionId === null && (
              <Button size="xs" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => removeMissed(selected.annotationId)}>Remove</Button>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[10px] text-[var(--ocean-text-muted)]">
              <span className="mb-1 block">Class</span>
              <select
                value={selected.className}
                onChange={(event) => markCorrected(selected.annotationId, { className: event.target.value })}
                className="min-h-9 rounded border border-[var(--ocean-border)] bg-[#080e1a] px-2 text-xs text-[var(--ocean-text)] focus:outline-none focus:ring-2 focus:ring-[#4cd6fb]"
              >
                {availableClasses.map((className) => <option key={className} value={className}>{className}</option>)}
              </select>
            </label>
            {(['x', 'y', 'width', 'height'] as const).map((field) => (
              <label key={field} className="text-[10px] uppercase text-[var(--ocean-text-muted)]">
                <span className="mb-1 block">{field}</span>
                <input
                  type="number" min="0" max="1" step="0.01" value={selected.box[field].toFixed(3)}
                  onChange={(event) => updateBoxField(field, event.target.value)}
                  className="w-20 rounded border border-[var(--ocean-border)] bg-[#080e1a] px-2 py-2 font-mono text-xs text-[var(--ocean-text)]"
                />
              </label>
            ))}
            {selected.sourceDetectionId !== null && (
              <div className="flex flex-wrap gap-2">
                <Button size="xs" variant={selected.verdict === 'CONFIRMED' ? 'success' : 'outline'} icon={<Check className="h-3.5 w-3.5" />} onClick={() => setVerdict(selected.annotationId, 'CONFIRMED')}>Confirm</Button>
                <Button size="xs" variant={selected.verdict === 'FALSE_POSITIVE' ? 'danger' : 'outline'} icon={<X className="h-3.5 w-3.5" />} onClick={() => setVerdict(selected.annotationId, 'FALSE_POSITIVE')}>Not debris</Button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded border border-[var(--ocean-border)] bg-[var(--ocean-surface)] p-3 text-xs text-[var(--ocean-text-dim)]">
          {result.detections.length === 0 ? 'Espada proposed no boxes. Draw any missed objects, or confirm the frame is empty below.' : 'Select a box to review it.'}
        </div>
      )}

      <label className="flex items-start gap-2 rounded border border-[var(--ocean-border)] bg-[var(--ocean-surface)] p-3 text-xs text-[var(--ocean-text-dim)]">
        <input type="checkbox" checked={checkedWholeFrame} onChange={(event) => setCheckedWholeFrame(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[#00f5d4]" />
        <span>I checked the entire frame for missed debris. This commits the frame atomically to the reviewed learning set.</span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm" variant="primary" icon={<Save className="h-4 w-4" />} loading={saving}
          disabled={unresolvedCount > 0 || !checkedWholeFrame}
          onClick={() => void submitReview()}
        >
          Submit reviewed frame
        </Button>
        <span className="text-[10px] text-[var(--ocean-text-muted)]">
          {unresolvedCount > 0 ? `${unresolvedCount} prediction${unresolvedCount === 1 ? '' : 's'} still need a decision` : `${drafts.length} annotation${drafts.length === 1 ? '' : 's'} ready`}
        </span>
      </div>
      {message && <p role="status" className={`text-xs ${message.includes('saved at revision') ? 'text-[#00f5d4]' : 'text-[#ffb4ab]'}`}>{message}</p>}
    </section>
  );
}
