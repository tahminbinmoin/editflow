// Text-based editing helpers: turn "remove this transcript line" / "add it back" into ops.
import { layout, uid } from '@shared/timeline.js';

const PAD_IN = 0.08;
const PAD_OUT = 0.12;

export function segmentInCut(timeline, seg) {
  return timeline.clips.some((c) => c.assetId === seg.assetId && c.out > seg.start + 0.15 && c.in < seg.end - 0.15);
}

export function removeSegmentOps(timeline, seg) {
  const ops = [];
  const s = seg.start - PAD_IN;
  const e = seg.end + PAD_OUT;
  const { clips } = layout(timeline);
  clips.forEach((c, idx) => {
    if (c.assetId !== seg.assetId || c.out <= seg.start + 0.15 || c.in >= seg.end - 0.15) return;
    if (c.in >= s - 0.3 && c.out <= e + 0.3) ops.push({ type: 'deleteClip', clipId: c.id });
    else if (c.in >= s - 0.3) ops.push({ type: 'trimClip', clipId: c.id, in: Math.min(c.out - 0.1, e) });
    else if (c.out <= e + 0.3) ops.push({ type: 'trimClip', clipId: c.id, out: Math.max(c.in + 0.1, s) });
    else {
      // Segment sits in the middle of the clip: keep the head, add the tail as a new clip.
      ops.push({ type: 'trimClip', clipId: c.id, out: s });
      ops.push({ type: 'addClip', clipId: uid('clip'), assetId: c.assetId, in: e, out: c.out, index: idx + 1, role: c.role });
    }
  });
  return ops;
}

export function addSegmentOps(timeline, seg) {
  // Insert in source order: after the last clip of the same asset that starts before this line.
  let index = timeline.clips.length;
  for (let i = timeline.clips.length - 1; i >= 0; i--) {
    const c = timeline.clips[i];
    if (c.assetId === seg.assetId && c.in <= seg.start) {
      index = i + 1;
      break;
    }
  }
  return [{ type: 'addClip', assetId: seg.assetId, in: Math.max(0, seg.start - PAD_IN), out: seg.end + PAD_OUT, index }];
}

/** Make the clip that contains a hook line the opening clip. */
export function openWithLineOps(timeline, seg) {
  const c = timeline.clips.find((k) => k.assetId === seg.assetId && k.in <= seg.start + 0.2 && k.out >= seg.end - 0.2);
  if (c) return [{ type: 'moveClip', clipId: c.id, toIndex: 0 }, { type: 'updateClip', clipId: c.id, patch: { role: 'hook' } }];
  return [{ type: 'addClip', assetId: seg.assetId, in: Math.max(0, seg.start - PAD_IN), out: seg.end + PAD_OUT, index: 0, role: 'hook' }];
}
