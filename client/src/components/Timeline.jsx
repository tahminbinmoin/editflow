import { useEffect, useMemo, useRef, useState } from 'react';
import { Scissors, Trash2, ZoomIn, Type, Clapperboard } from 'lucide-react';
import { layout, timelineCaptions, formatTime } from '@shared/timeline.js';

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

  const seekFromEvent = (e) => {
    const r = scrollRef.current.getBoundingClientRect();
    const t = (e.clientX - r.left + scrollRef.current.scrollLeft) / pps;
    onSeek(Math.max(0, Math.min(duration, t)));
  };

  // Generic pointer drag: mode = 'move' | 'trimL' | 'trimR'
  const startDrag = (e, kind, id, mode) => {
    if (readOnly) return;
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    let moved = false;
    const move = (ev) => {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 4) moved = true;
      if (moved) setDrag({ kind, id, mode, dx });
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const dx = ev.clientX - startX;
      setDrag(null);
      if (!moved) {
        onSelect({ type: kind, id });
        if (kind === 'clip') seekFromEvent(ev);
        return;
      }
      const dt = dx / pps;
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
          <div className="tl-label">Text</div>
          <div className="tl-label">Captions</div>
          <div className="tl-label">Music</div>
        </div>
        <div className="tl-scroll" ref={scrollRef}>
          <div className="tl-inner" style={{ width: innerW, paddingLeft: 0 }}>
            <div className="tl-ruler" onPointerDown={seekFromEvent}>
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
                    {b.assetId ? '' : '+ '}
                    {b.description}
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
              {caps.map((c, i) => (
                <div
                  key={`${c.id}-${i}`}
                  className={`tl-chip cap ${selection?.id === c.id ? 'sel' : ''}`}
                  style={{ left: x(c.start), width: Math.max(8, x(c.end - c.start) - 2) }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelect({ type: 'caption', id: c.id });
                    onSeek(c.start + 0.01);
                  }}
                  title={c.text}
                >
                  {c.text}
                </div>
              ))}
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
            <div className="tl-playhead" style={{ left: x(time) }} />
          </div>
        </div>
      </div>
    </div>
  );
}
