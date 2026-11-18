import { useEffect, useMemo, useRef, useState } from 'react';
import { Scissors, Trash2, ZoomIn, Type, Clapperboard, Sparkles } from 'lucide-react';
import { layout, timelineCaptions, formatTime, retimeCaption, retimeCaptionOps, toFrames, FPS, formatTimecode } from '@shared/timeline.js';
import { GRAPHIC_TYPES, GRAPHIC_COLORS, graphicLabel } from '@shared/graphics.js';

const peakCache = new Map();
function usePeaks(urls, assets) {
  const [, force] = useState(0);
  useEffect(() => {
    assets
      .filter((a) => a.hasPeaks && urls[a.id]?.peaks && !peakCache.has(a.id))
      .forEach((a) => {
        peakCache.set(a.id, null);
        fetch(urls[a.id].peaks)
          .then((r) => (r.ok ? r.json() : null))
          .then((p) => {
            peakCache.set(a.id, p);
            force((n) => n + 1);
          })
          .catch(() => {});
      });
  }, [urls, assets]);
  return peakCache;
}

function Wave({ peaks, from, to }) {
  if (!peaks) return null;
  const a = Math.floor(from * 20);
  const b = Math.max(a + 1, Math.ceil(to * 20));
  const slice = peaks.slice(a, b);
  if (!slice.length) return null;
  const pts = slice.map((p, i) => `${(i / slice.length) * 100},${100 - Math.min(100, p * 1.6)}`).join(' ');
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      <polyline points={`0,100 ${pts} 100,100`} fill="rgba(245,240,233,.28)" stroke="none" />
    </svg>
  );
}

export default function Timeline({ urls, timeline, assets, time, onSeek, selection, onSelect, onDelete, ops, readOnly }) {
  const scrollRef = useRef();
  const [width, setWidth] = useState(800);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState(null); // {kind, id, dx, mode}
  const peaks = usePeaks(urls, assets);
  const { clips, duration } = useMemo(() => layout(timeline), [timeline]);
  const caps = useMemo(() => timelineCaptions(timeline), [timeline]);
  const assetMap = useMemo(() => Object.fromEntries(assets.map((a) => [a.id, a])), [assets]);
  // Overlapping motion graphics are stacked in lanes so each one stays clickable.
  const gfxLanes = useMemo(() => {
    const ends = [];
    const lane = {};
    for (const g of [...(timeline.graphics || [])].sort((a, b) => a.start - b.start)) {
      let l = ends.findIndex((e) => e <= g.start + 0.01);
      if (l < 0) l = ends.length;
      ends[l] = g.start + g.duration;
      lane[g.id] = l;
    }
    return { lane, count: Math.max(1, ends.length) };
  }, [timeline.graphics]);

  useEffect(() => {
    const el = scrollRef.current;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const span = Math.max(duration + 2, 10);
  const pps = ((width - 24) / span) * zoom;
  const x = (t) => t * pps;
  const innerW = Math.max(width, x(span) + 24);
  const tickStep = [0.5, 1, 2, 5, 10, 15, 30, 60].find((s) => s * pps >= 64) || 120;

  const timeAt = (clientX) => {
    const r = scrollRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(duration, (clientX - r.left + scrollRef.current.scrollLeft) / pps));
  };
  const seekFromEvent = (e) => onSeek(Math.round(timeAt(e.clientX) * FPS) / FPS);

  // Scrub: press on the ruler or the playhead and drag; the view follows near the edges.
  const [scrubbing, setScrubbing] = useState(false);
  const startScrub = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setScrubbing(true);
    seekFromEvent(e);
    const el = scrollRef.current;
    let lastX = e.clientX;
    let raf = 0;
    const edge = () => {
      const r = el.getBoundingClientRect();
      const d = lastX > r.right - 40 ? 14 : lastX < r.left + 40 ? -14 : 0;
      if (d) {
        el.scrollLeft += d;
        onSeek(Math.round(timeAt(lastX) * FPS) / FPS);
      }
      raf = requestAnimationFrame(edge);
    };
    raf = requestAnimationFrame(edge);
    const move = (ev) => {
      lastX = ev.clientX;
      onSeek(Math.round(timeAt(ev.clientX) * FPS) / FPS);
    };
    const up = () => {
      cancelAnimationFrame(raf);
      setScrubbing(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Caption retiming while dragging (snaps to frames, to the playhead, stays inside its clip).
  const SNAP_PX = 8;
  const captionEdit = (chip, mode, dx) => {
    const snapToHead = (v) => (Math.abs(v - time) * pps < SNAP_PX ? time : v);
    if (mode === 'trimL') return { start: snapToHead(chip.start + dx / pps) };
    if (mode === 'trimR') return { end: snapToHead(chip.end + dx / pps) };
    const ns = chip.start + dx / pps;
    const ne = chip.end + dx / pps;
    return { move: Math.abs(ns - time) * pps < SNAP_PX ? time - chip.start : Math.abs(ne - time) * pps < SNAP_PX ? time - chip.end : dx / pps };
  };
  /** Where a caption chip would sit (timeline seconds) after an edit, for the drag preview. */
  const capDrag = useMemo(() => {
    if (drag?.kind !== 'caption') return null;
    const chip = caps.filter((k) => k.id === drag.id)[drag.index || 0];
    return chip ? { chip, res: retimeCaption(timeline, drag.id, captionEdit(chip, drag.mode, drag.dx), drag.index || 0) } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, timeline, caps]);
  const chipAfter = (chip, res) => {
    const c = clips.find((k) => k.id === chip.clipId);
    if (!c || !res) return chip;
    const toTl = (src) => c.tlStart + (src - c.in);
    return { start: Math.max(c.tlStart, toTl(res.start)), end: Math.min(c.tlEnd, toTl(res.end)) };
  };

  // Generic pointer drag: mode = 'move' | 'trimL' | 'trimR'
  const startDrag = (e, kind, id, mode, extra) => {
    if (readOnly) return;
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    let moved = false;
    const move = (ev) => {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 4) moved = true;
      if (moved) setDrag({ kind, id, mode, dx, index: extra?.index });
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const dx = ev.clientX - startX;
      setDrag(null);
      if (!moved) {
        onSelect({ type: kind, id });
        if (kind === 'clip') seekFromEvent(ev);
        if (kind === 'caption') onSeek(extra.chip.start + 0.01);
        return;
      }
      const dt = dx / pps;
      if (kind === 'caption') {
        const list = retimeCaptionOps(timeline, id, captionEdit(extra.chip, mode, dx), extra.index);
        if (list.length) ops(list, mode === 'move' ? 'Move caption' : 'Retime caption');
        return;
      }
      if (kind === 'clip') {
        const c = clips.find((k) => k.id === id);
        if (mode === 'trimL') ops([{ type: 'trimClip', clipId: id, in: Math.max(0, Math.min(c.out - 0.1, c.in + dt)) }], 'Trim clip start');
        else if (mode === 'trimR') ops([{ type: 'trimClip', clipId: id, out: Math.max(c.in + 0.1, Math.min(assetMap[c.assetId]?.duration ?? Infinity, c.out + dt)) }], 'Trim clip end');
        else {
          const center = c.tlStart + c.duration / 2 + dt;
          let idx = clips.filter((k) => k.id !== id && k.tlStart + k.duration / 2 < center).length;
          if (idx !== clips.findIndex((k) => k.id === id)) ops([{ type: 'moveClip', clipId: id, toIndex: idx }], 'Reorder clip');
        }
      } else if (kind === 'overlay') {
        const o = timeline.overlays.find((k) => k.id === id);
        ops([{ type: 'updateOverlay', overlayId: id, patch: { start: Math.max(0, +(o.start + dt).toFixed(2)) } }], 'Move text');
      } else if (kind === 'graphic') {
        const g = timeline.graphics.find((k) => k.id === id);
        ops([{ type: 'updateGraphic', graphicId: id, patch: { start: Math.max(0, +(g.start + dt).toFixed(2)) } }], 'Move motion graphic');
      } else if (kind === 'broll') {
        const b = timeline.broll.find((k) => k.id === id);
        ops([{ type: 'updateBroll', brollId: id, patch: { start: Math.max(0, +(b.start + dt).toFixed(2)) } }], 'Move B-roll');
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Drop indicator for clip reordering
  let dropX = null;
  if (drag?.kind === 'clip' && drag.mode === 'move') {
    const c = clips.find((k) => k.id === drag.id);
    const center = c.tlStart + c.duration / 2 + drag.dx / pps;
    const before = clips.filter((k) => k.id !== drag.id && k.tlStart + k.duration / 2 < center);
    const last = before[before.length - 1];
    dropX = last ? x(last.tlEnd) : 0;
  }

  const sel = selection?.type === 'clip' ? clips.find((c) => c.id === selection.id) : null;

  return (
    <div className="tl-wrap desktop-only">
      <div className="tl-tools">
        <button className="btn sm ghost" disabled={readOnly || !clips.length} onClick={() => ops([{ type: 'splitClip', at: time }], 'Split clip')} title="Split at playhead (S)">
          <Scissors size={15} /> Split
        </button>
        <button className="btn sm ghost" disabled={readOnly || !selection} onClick={onDelete} title="Delete selected (Del)">
          <Trash2 size={15} /> Delete
        </button>
        <button
          className="btn sm ghost"
          disabled={readOnly}
          onClick={() => ops([{ type: 'addOverlay', overlay: { template: 'title', text: 'Your title', start: +time.toFixed(2), duration: 2.5 } }], 'Add title')}
        >
          <Type size={15} /> Add text
        </button>
        <button
          className="btn sm ghost"
          disabled={readOnly}
          onClick={() => ops([{ type: 'addGraphic', graphic: { type: 'keyword', text: 'Key point', start: +time.toFixed(2) } }], 'Add motion graphic')}
        >
          <Sparkles size={15} /> Add graphic
        </button>
        <button
          className="btn sm ghost"
          disabled={readOnly}
          onClick={() => ops([{ type: 'addBroll', broll: { start: +time.toFixed(2), duration: 2, description: 'Cutaway shot', reason: 'Added manually' } }], 'Add B-roll slot')}
        >
          <Clapperboard size={15} /> Add B-roll
        </button>
        <div className="grow" />
        {readOnly && <span className="pill warm">Previewing a proposal: apply or discard it to edit</span>}
        {sel && !readOnly && (
          <span className="tiny muted mono">
            Clip {clips.indexOf(sel) + 1}: {formatTime(sel.in)}–{formatTime(sel.out)} ({sel.duration.toFixed(1)}s)
          </span>
        )}
        <ZoomIn size={15} color="var(--muted)" />
        <input type="range" min={1} max={8} step={0.25} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} style={{ width: 110 }} aria-label="Timeline zoom" />
      </div>
      <div className="tl">
        <div className="tl-labels">
          <div className="tl-label big">Video</div>
          <div className="tl-label">B-roll</div>
          <div className="tl-label">Graphics</div>
          <div className="tl-label">Text</div>
          <div className="tl-label">Captions</div>
          <div className="tl-label">Music</div>
        </div>
        <div className="tl-scroll" ref={scrollRef}>
          <div className="tl-inner" style={{ width: innerW, paddingLeft: 0 }}>
            <div className={`tl-ruler ${scrubbing ? 'scrubbing' : ''}`} onPointerDown={startScrub} title="Click or drag to move the playhead">
              {Array.from({ length: Math.ceil(span / tickStep) + 1 }, (_, i) => (
                <div key={i} className="tl-tick" style={{ left: x(i * tickStep) }}>
                  {formatTime(i * tickStep).replace(/\.0$/, '')}
                </div>
              ))}
            </div>
            <div className="tl-track big" onPointerDown={(e) => e.target === e.currentTarget && onSelect(null)}>
              {clips.map((c, i) => {
                const a = assetMap[c.assetId];
                const d = drag?.kind === 'clip' && drag.id === c.id ? drag : null;
                let left = x(c.tlStart);
                let w = x(c.duration);
                let from = c.in;
                let to = c.out;
                if (d?.mode === 'move') left += d.dx;
                if (d?.mode === 'trimL') {
                  const dt = Math.max(-c.in, Math.min(c.duration - 0.1, d.dx / pps));
                  left += x(dt);
                  w -= x(dt);
                  from += dt;
                }
                if (d?.mode === 'trimR') {
                  const dt = Math.max(-(c.duration - 0.1), Math.min((a?.duration ?? Infinity) - c.out, d.dx / pps));
                  w += x(dt);
                  to += dt;
                }
                const isSel = selection?.type === 'clip' && selection.id === c.id;
                return (
                  <div
                    key={c.id}
                    className={`tl-clip ${isSel ? 'sel' : ''}`}
                    style={{ left, width: Math.max(6, w - 2), zIndex: d ? 6 : 1, opacity: d?.mode === 'move' ? 0.85 : 1 }}
                    onPointerDown={(e) => startDrag(e, 'clip', c.id, 'move')}
                    title={`${c.role || 'clip'} · ${formatTime(from)}–${formatTime(to)}${c.note ? ` · ${c.note}` : ''}`}
                  >
                    {urls[c.assetId]?.thumb && <div className="thumbbg" style={{ backgroundImage: `url(${urls[c.assetId].thumb})` }} />}
                    <div className="role-bar" style={{ background: c.role ? `var(--role-${c.role})` : 'var(--line-2)' }} />
                    <div className="lbl">
                      {i + 1}
                      {c.role ? ` · ${c.role === 'cta' ? 'CTA' : c.role}` : ''}
                      {c.transitionIn !== 'cut' && i > 0 ? ' · ◐' : ''}
                    </div>
                    <Wave peaks={peaks.get(c.assetId)} from={from} to={to} />
                    {isSel && !readOnly && (
                      <>
                        <div className="tl-handle l" onPointerDown={(e) => startDrag(e, 'clip', c.id, 'trimL')} aria-label="Trim start" />
                        <div className="tl-handle r" onPointerDown={(e) => startDrag(e, 'clip', c.id, 'trimR')} aria-label="Trim end" />
                      </>
                    )}
                  </div>
                );
              })}
              {dropX != null && <div className="tl-drop" style={{ left: dropX - 1 }} />}
            </div>
            <div className="tl-track">
              {timeline.broll.map((b) => {
                const d = drag?.kind === 'broll' && drag.id === b.id ? drag.dx : 0;
                return (
                  <div
                    key={b.id}
                    className={`tl-chip broll ${b.assetId ? '' : 'empty'} ${selection?.id === b.id ? 'sel' : ''}`}
                    style={{ left: x(b.start) + d, width: Math.max(18, x(b.duration) - 2) }}
                    onPointerDown={(e) => startDrag(e, 'broll', b.id, 'move')}
                    title={`${b.description}${b.reason ? ` — ${b.reason}` : ''}${b.assetId ? '' : ' (suggestion — no footage attached)'}`}
                  >
                    {b.assetId ? (b.layout === 'split' ? '◧ ' : b.layout === 'card' ? '▣ ' : '') : '+ '}
                    {b.description}
                  </div>
                );
              })}
            </div>
            <div className="tl-track">
              {(timeline.graphics || []).map((g) => {
                const d = drag?.kind === 'graphic' && drag.id === g.id ? drag.dx : 0;
                const lane = gfxLanes.lane[g.id] % 3;
                const n = Math.min(3, gfxLanes.count);
                const laneStyle = n > 1 ? { top: 3 + lane * (32 / n), bottom: 'auto', height: 32 / n - 2, fontSize: n > 2 ? 9 : 10, padding: '0 5px' } : {};
                const label = graphicLabel(g);
                return (
                  <div
                    key={g.id}
                    className={`tl-chip gfx ${selection?.id === g.id ? 'sel' : ''}`}
                    style={{ left: x(g.start) + d, width: Math.max(18, x(g.duration) - 2), ...laneStyle }}
                    onPointerDown={(e) => startDrag(e, 'graphic', g.id, 'move')}
                    title={`${GRAPHIC_TYPES[g.type]?.label}: ${label}${g.reason ? ` — ${g.reason}` : ''}`}
                  >
                    <span className="sw" style={{ background: GRAPHIC_COLORS[g.color]?.hex }} />
                    {label}
                  </div>
                );
              })}
            </div>
            <div className="tl-track">
              {timeline.overlays.map((o) => {
                const d = drag?.kind === 'overlay' && drag.id === o.id ? drag.dx : 0;
                return (
                  <div
                    key={o.id}
                    className={`tl-chip text ${selection?.id === o.id ? 'sel' : ''}`}
                    style={{ left: x(o.start) + d, width: Math.max(18, x(o.duration) - 2) }}
                    onPointerDown={(e) => startDrag(e, 'overlay', o.id, 'move')}
                    title={o.text}
                  >
                    {o.text}
                  </div>
                );
              })}
            </div>
            <div className="tl-track" style={{ opacity: timeline.captions.enabled ? 1 : 0.35 }}>
              {caps.map((c, i) => {
                const index = caps.slice(0, i).filter((k) => k.id === c.id).length;
                const d = drag?.kind === 'caption' && drag.id === c.id && drag.index === index ? drag : null;
                // A neighbour being rolled into shows its new length live too.
                const nb = capDrag?.res?.neighbours?.find((n) => n.id === c.id);
                const src = timeline.captions.items.find((k) => k.id === c.id);
                const shown = d ? chipAfter(c, capDrag?.res) : nb && src ? chipAfter(c, { ...src, ...nb }) : c;
                const sel = selection?.id === c.id;
                const len = shown.end - shown.start;
                return (
                  <div
                    key={`${c.id}-${i}`}
                    className={`tl-chip cap ${sel ? 'sel' : ''} ${d ? 'dragging' : ''}`}
                    style={{ left: x(shown.start), width: Math.max(8, x(len) - 2), zIndex: d ? 6 : undefined }}
                    onPointerDown={(e) => startDrag(e, 'caption', c.id, 'move', { chip: c, index })}
                    title={`${c.text}\n${formatTimecode(c.start)} → ${formatTimecode(c.end)} · ${toFrames(c.end - c.start)} frames\nDrag the edges to change how long it shows`}
                  >
                    {d ? `${len.toFixed(2)}s · ${toFrames(len)}f` : c.text}
                    {!readOnly && (
                      <>
                        <div className="tl-cap-edge l" onPointerDown={(e) => startDrag(e, 'caption', c.id, 'trimL', { chip: c, index })} aria-label="Change caption start" />
                        <div className="tl-cap-edge r" onPointerDown={(e) => startDrag(e, 'caption', c.id, 'trimR', { chip: c, index })} aria-label="Change caption end" />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="tl-track">
              {timeline.music.assetId && duration > 0 && (
                <div className="tl-chip music" style={{ left: 0, width: x(duration) }}>
                  ♪ {assetMap[timeline.music.assetId]?.name || 'Music'} · vol {Math.round((timeline.music.volume ?? 0) * 100)}%{timeline.music.duck ? ' · ducks under voice' : ''}
                </div>
              )}
              {!timeline.music.assetId && timeline.music.mood && (
                <div className="tl-chip broll empty" style={{ left: 0, width: Math.max(140, x(Math.min(duration, 12))) }}>
                  ♪ Suggested: {timeline.music.mood}
                </div>
              )}
            </div>
            <div className={`tl-playhead ${scrubbing ? 'scrubbing' : ''}`} style={{ left: x(time) }}>
              <div className="tl-playhead-grab" onPointerDown={startScrub} title={`${formatTimecode(time)} — drag to scrub`} />
              {scrubbing && <div className="tl-playhead-time mono">{formatTimecode(time)}</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
