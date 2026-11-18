import { useEffect, useMemo, useState } from 'react';
import { Scissors, Trash2, Type, Clapperboard, ChevronLeft, Sparkles, Search, ImagePlus, ExternalLink } from 'lucide-react';
import { layout, timelineCaptions, formatTime, retimeCaptionOps, formatTimecode, parseTimecode, toFrames, FPS, TRANSITIONS, OVERLAY_TEMPLATES, CAPTION_STYLES, STORY_ROLES, ASPECTS, BROLL_LAYOUTS } from '@shared/timeline.js';
import { GRAPHIC_TYPES, GRAPHIC_COLORS, GRAPHIC_POSITIONS, GRAPHIC_LAYOUTS } from '@shared/graphics.js';
import { THEMES } from '@shared/gfx-core.js';
import { useAuth } from '../App.jsx';
import { useToast } from './ui.jsx';

const SAMPLE = {
  headline: { text: 'The one thing *nobody* tells you' },
  chart: { text: 'Down *95%* in five years', values: [323, 8.45], labels: ['Then', 'Now', '$'], sub: 'Price over time' },
  pictogram: { text: 'One in five people *quit*', values: [5, 1], sub: '↓20%' },
  definition: { text: 'your term', sub: 'noun · /pronunciation/', body: 'What it means, in one plain sentence.' },
  iconRow: { text: 'Top 3 tools', items: ['🧠 Notion', '📅 Calendar', '✅ Todoist'], sub: 'the ones I use daily' },
  photo: { text: 'caption' },
  bubble: { text: 'What am I *actually* doing?', y: 0.3 },
  columns: { text: 'Tier list', items: ['Skip: A, B', 'Read: C, D', 'Study: E'] },
  versus: { text: 'Before', sub: 'After' },
  emoji: { text: '🔥', sub: 'so good', x: 0.72, y: 0.3 },
  follow: { text: 'Follow', sub: '@yourname' },
  lowerThird: { text: 'Your name', sub: 'What you do' },
  keyword: { text: 'Key point' },
  stat: { text: '73%', sub: 'what the number means' },
  list: { text: 'What you need', items: ['First point', 'Second point', 'Third point'] },
  callout: { text: 'Look here' },
  progress: {},
  chapter: { text: 'Section title', sub: 'Step 1' },
};
export function newGraphic(type, start, duration) {
  return { type, ...(SAMPLE[type] || {}), start: +start.toFixed(2), ...(duration ? { duration } : {}) };
}

/** Find stock footage for a B-roll slot, or generate an image. */
function FindFootage({ b, act }) {
  const { engine } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState(b.query || b.description || '');
  const [kind, setKind] = useState(b.layout === 'card' ? 'photo' : 'video');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(null);
  const search = async () => {
    setBusy('search');
    try {
      setRes(await act.searchStock(q, kind, b.layout));
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy(null);
    }
  };
  const pick = async (c) => {
    setBusy(c.id);
    await act.attachStock(b.id, c, b.layout);
    setBusy(null);
  };
  return (
    <div className="card tight stack-sm">
      <div className="section-title">Find footage</div>
      {engine?.stock?.length ? (
        <>
          <div className="row">
            <input className="input sm" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="e.g. barista pouring coffee" aria-label="Stock search" />
            <select className="select sm" style={{ width: 90 }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Video or photo">
              <option value="video">Video</option>
              <option value="photo">Photo</option>
            </select>
            <button className="btn sm" onClick={search} disabled={!q.trim() || !!busy}>
              {busy === 'search' ? <span className="spinner" /> : <Search size={14} />}
            </button>
          </div>
          {res && (
            <>
              <div className="stock-grid">
                {res.candidates.map((c) => (
                  <button key={`${c.provider}${c.id}`} onClick={() => pick(c)} disabled={!!busy} title={`${c.provider} · ${c.author || ''}${c.duration ? ` · ${c.duration}s` : ''}`}>
                    <img src={c.thumb} alt="" loading="lazy" />
                    <span>{busy === c.id ? 'Adding…' : `${c.provider}${c.duration ? ` · ${c.duration}s` : ''}`}</span>
                  </button>
                ))}
              </div>
              {!res.candidates.length && <p className="tiny muted">Nothing found. Try simpler words.</p>}
              <p className="tiny muted">
                {res.sources.map((s, i) => (
                  <span key={s.id}>
                    {i ? ' · ' : ''}
                    {s.id === 'pexels' ? 'Photos and videos provided by ' : 'Videos provided by '}
                    <a href={s.site} target="_blank" rel="noreferrer">
                      {s.name}
                    </a>
                  </span>
                ))}
              </p>
            </>
          )}
        </>
      ) : (
        <p className="tiny muted">Add a free Pexels or Pixabay key in AI settings to search stock footage here.</p>
      )}
      {engine?.images && (
        <button className="btn sm" onClick={() => act.generateBroll(b.id, q || b.description)} disabled={!!busy}>
          <ImagePlus size={14} /> Generate an AI image of this
        </button>
      )}
    </div>
  );
}

/** Number input that commits on blur/Enter (so each edit is one history step). */
function Num({ value, onCommit, step = 0.1, min, max, label, suffix = 's' }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    const n = Number(v);
    if (!Number.isNaN(n) && n !== value) onCommit(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n)));
  };
  return (
    <div className="field" style={{ flex: 1 }}>
      <label>{label}</label>
      <div className="row" style={{ gap: 4 }}>
        <button className="btn xs" onClick={() => onCommit(+(value - step).toFixed(3))} aria-label={`${label} minus`}>
          −
        </button>
        <input className="input sm mono" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} aria-label={label} />
        <button className="btn xs" onClick={() => onCommit(+(value + step).toFixed(3))} aria-label={`${label} plus`}>
          +
        </button>
        <span className="tiny muted">{suffix}</span>
      </div>
    </div>
  );
}

/** Frame-accurate timecode field (mm:ss:ff). Accepts "00:04:12", "4:12", "4.4" (seconds) or "132f". */
function Timecode({ value, onCommit, label, title }) {
  const [v, setV] = useState(formatTimecode(value));
  useEffect(() => setV(formatTimecode(value)), [value]);
  const commit = () => {
    const n = parseTimecode(v);
    if (n == null) return setV(formatTimecode(value));
    if (Math.abs(n - value) > 1e-6) onCommit(n);
  };
  const step = (f) => onCommit(Math.round((value + f / FPS) * FPS) / FPS);
  return (
    <div className="field" style={{ flex: 1 }}>
      <label title={title}>{label}</label>
      <div className="row" style={{ gap: 4 }}>
        <button className="btn xs" onClick={() => step(-1)} aria-label={`${label} one frame earlier`} title="−1 frame">−</button>
        <input className="input sm mono" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} aria-label={label} />
        <button className="btn xs" onClick={() => step(1)} aria-label={`${label} one frame later`} title="+1 frame">+</button>
      </div>
    </div>
  );
}

function Txt({ value, onCommit, label, area }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const Tag = area ? 'textarea' : 'input';
  return (
    <div className="field">
      <label>{label}</label>
      <Tag className={area ? 'textarea' : 'input sm'} rows={area ? 2 : undefined} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)} onKeyDown={(e) => !area && e.key === 'Enter' && v !== value && onCommit(v)} />
    </div>
  );
}

/** Premiere-style In / Out / Duration for one caption, in timeline timecode, one-frame steps. */
function CaptionTiming({ timeline, cap, time, ops, onSeek, readOnly }) {
  const chips = timelineCaptions(timeline).filter((c) => c.id === cap.id);
  if (!chips.length) return <p className="tiny muted">This caption isn't on the timeline right now (its part of the clip was trimmed away).</p>;
  // When a caption shows in more than one clip, edit the copy under the playhead.
  let index = chips.findIndex((c) => time >= c.start - 1e-6 && time <= c.end + 1e-6);
  if (index < 0) index = 0;
  const chip = chips[index];
  const frames = toFrames(chip.end - chip.start);
  const apply = (edit, label) => {
    const list = retimeCaptionOps(timeline, cap.id, edit, index);
    if (list.length) ops(list, label);
  };
  if (readOnly) {
    return <p className="small mono">{formatTimecode(chip.start)} → {formatTimecode(chip.end)} · {frames} frames</p>;
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 8 }}>
        <Timecode label="In" title="Where the caption starts (mm:ss:ff)" value={chip.start} onCommit={(t) => apply({ start: t }, 'Caption in point')} />
        <Timecode label="Out" title="Where the caption ends (mm:ss:ff)" value={chip.end} onCommit={(t) => apply({ end: t }, 'Caption out point')} />
      </div>
      <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <Num label="Duration" suffix={`frames · ${(frames / FPS).toFixed(2)}s`} step={1} min={2} value={frames} onCommit={(f) => apply({ end: chip.start + Math.round(f) / FPS }, 'Caption duration')} />
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        <button className="btn xs" onClick={() => apply({ start: time }, 'Caption in point')} title="Start the caption at the playhead">In at playhead</button>
        <button className="btn xs" onClick={() => apply({ end: time }, 'Caption out point')} title="End the caption at the playhead">Out at playhead</button>
        <button className="btn xs ghost" onClick={() => onSeek?.(chip.start)}>Go to in</button>
        <button className="btn xs ghost" onClick={() => onSeek?.(Math.max(chip.start, chip.end - 1 / FPS))}>Go to out</button>
      </div>
    </div>
  );
}

export default function EditPanel({ project, timeline, selection, onSelect, ops, act, time, onSeek, readOnly }) {
  const { clips } = useMemo(() => layout(timeline), [timeline]);
  const assets = project.assets;
  const assetMap = Object.fromEntries(assets.map((a) => [a.id, a]));
  const brollAssets = assets.filter((a) => a.kind === 'broll' && a.status === 'ready');
  const musicAssets = assets.filter((a) => a.kind === 'music' && a.status === 'ready');
  const caps = useMemo(() => timelineCaptions(timeline), [timeline]);

  if (readOnly) return <div className="notice warm">You’re previewing a proposal. Apply or discard it to keep editing.</div>;

  const back = (
    <button className="btn xs ghost" onClick={() => onSelect(null)}>
      <ChevronLeft size={13} /> All settings
    </button>
  );

  if (selection?.type === 'clip') {
    const c = clips.find((k) => k.id === selection.id);
    if (!c) return back;
    const i = clips.indexOf(c);
    const a = assetMap[c.assetId];
    const said = project.transcript.segments.filter((s) => s.assetId === c.assetId && s.end > c.in + 0.1 && s.start < c.out - 0.1);
    return (
      <div className="stack">
        {back}
        <div>
          <h3 style={{ fontSize: 18 }}>Clip {i + 1}</h3>
          <p className="tiny muted mono">
            {a?.name} · {formatTime(c.in)}–{formatTime(c.out)} · on timeline at {formatTime(c.tlStart)}
          </p>
        </div>
        <div className="row">
          <Num label="Start in source" value={c.in} min={0} max={c.out - 0.1} onCommit={(v) => ops([{ type: 'trimClip', clipId: c.id, in: v }], 'Trim clip start')} />
        </div>
        <div className="row">
          <Num label="End in source" value={c.out} min={c.in + 0.1} max={a?.duration} onCommit={(v) => ops([{ type: 'trimClip', clipId: c.id, out: v }], 'Trim clip end')} />
        </div>
        <div className="field">
          <label>Volume · {Math.round((c.volume ?? 1) * 100)}%</label>
          <input type="range" min={0} max={2} step={0.05} defaultValue={c.volume ?? 1} key={c.id + c.volume} onMouseUp={(e) => ops([{ type: 'updateClip', clipId: c.id, patch: { volume: Number(e.target.value) } }], 'Clip volume')} onKeyUp={(e) => ops([{ type: 'updateClip', clipId: c.id, patch: { volume: Number(e.target.value) } }], 'Clip volume')} />
        </div>
        <div className="field">
          <label>Punch-in zoom · {Math.round(((c.zoom || 1) - 1) * 100)}%</label>
          <input type="range" min={1} max={1.4} step={0.02} defaultValue={c.zoom || 1} key={c.id + (c.zoom || 1)} onMouseUp={(e) => ops([{ type: 'updateClip', clipId: c.id, patch: { zoom: Number(e.target.value) } }], 'Clip zoom')} onKeyUp={(e) => ops([{ type: 'updateClip', clipId: c.id, patch: { zoom: Number(e.target.value) } }], 'Clip zoom')} aria-label="Punch-in zoom" />
        </div>
        {i > 0 && (
          <div className="field">
            <label>Transition into this clip</label>
            <select className="select sm" value={c.transitionIn} onChange={(e) => ops([{ type: 'updateClip', clipId: c.id, patch: { transitionIn: e.target.value } }], 'Change transition')}>
              {Object.entries(TRANSITIONS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label>Story role</label>
          <select className="select sm" value={c.role || ''} onChange={(e) => ops([{ type: 'updateClip', clipId: c.id, patch: { role: e.target.value } }], 'Change story role')}>
            <option value="">None</option>
            {STORY_ROLES.map((r) => (
              <option key={r} value={r}>
                {r === 'cta' ? 'Call to action' : r[0].toUpperCase() + r.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div className="row wrap">
          <button className="btn sm" onClick={() => ops([{ type: 'splitClip', at: time >= c.tlStart && time < c.tlEnd ? time : c.tlStart + c.duration / 2 }], 'Split clip')}>
            <Scissors size={14} /> Split {time >= c.tlStart && time < c.tlEnd ? 'at playhead' : 'in half'}
          </button>
          <button className="btn sm" disabled={i === 0} onClick={() => ops([{ type: 'moveClip', clipId: c.id, toIndex: i - 1 }], 'Move clip earlier')}>
            ← Earlier
          </button>
          <button className="btn sm" disabled={i === clips.length - 1} onClick={() => ops([{ type: 'moveClip', clipId: c.id, toIndex: i + 1 }], 'Move clip later')}>
            Later →
          </button>
          <button
            className="btn sm danger"
            onClick={() => {
              ops([{ type: 'deleteClip', clipId: c.id }], 'Remove clip');
              onSelect(null);
            }}
          >
            <Trash2 size={14} /> Remove
          </button>
        </div>
        {said.length > 0 && (
          <div className="card tight">
            <div className="section-title">Said in this clip</div>
            <p className="small text-2">{said.map((s) => s.text).join(' ')}</p>
          </div>
        )}
      </div>
    );
  }

  if (selection?.type === 'overlay') {
    const o = timeline.overlays.find((k) => k.id === selection.id);
    if (!o) return back;
    const up = (patch, label) => ops([{ type: 'updateOverlay', overlayId: o.id, patch }], label || 'Edit text');
    return (
      <div className="stack">
        {back}
        <h3 style={{ fontSize: 18 }}>Text overlay</h3>
        <div className="field">
          <label>Template</label>
          <select className="select sm" value={o.template} onChange={(e) => up({ template: e.target.value }, 'Change text template')}>
            {Object.entries(OVERLAY_TEMPLATES).map(([k, t]) => (
              <option key={k} value={k}>
                {t.label}: {t.desc}
              </option>
            ))}
          </select>
        </div>
        <Txt label="Text" value={o.text} onCommit={(v) => up({ text: v })} />
        {o.template === 'lowerThird' && <Txt label="Second line" value={o.sub} onCommit={(v) => up({ sub: v })} />}
        <div className="row">
          <Num label="Starts at" value={o.start} min={0} onCommit={(v) => up({ start: v }, 'Move text')} />
        </div>
        <div className="row">
          <Num label="Duration" value={o.duration} min={0.5} onCommit={(v) => up({ duration: v }, 'Text duration')} />
        </div>
        <button
          className="btn sm danger"
          onClick={() => {
            ops([{ type: 'deleteOverlay', overlayId: o.id }], 'Remove text');
            onSelect(null);
          }}
        >
          <Trash2 size={14} /> Remove text
        </button>
      </div>
    );
  }

  if (selection?.type === 'graphic') {
    const g = (timeline.graphics || []).find((k) => k.id === selection.id);
    if (!g) return back;
    const def = GRAPHIC_TYPES[g.type];
    const images = assets.filter((a) => a.mediaType === 'image' && a.status === 'ready');
    const up = (patch, label) => ops([{ type: 'updateGraphic', graphicId: g.id, patch }], label || 'Edit motion graphic');
    const total = layout(timeline).duration;
    return (
      <div className="stack">
        {back}
        <h3 style={{ fontSize: 18 }}>Motion graphic</h3>
        {g.reason && <div className="notice info">Why: {g.reason}</div>}
        <div className="field">
          <label>Type</label>
          <select className="select sm" value={g.type} onChange={(e) => up({ type: e.target.value }, 'Change graphic type')}>
            {Object.entries(GRAPHIC_TYPES).map(([k, t]) => (
              <option key={k} value={k}>
                {t.label}: {t.desc}
              </option>
            ))}
          </select>
        </div>
        {def.layouts.length > 1 && (
          <div className="field">
            <label>Layout</label>
            <div className="row wrap">
              {def.layouts.map((l) => (
                <button key={l} className={`btn xs ${g.layout === l ? 'primary' : ''}`} onClick={() => up({ layout: l }, 'Graphic layout')}>
                  {GRAPHIC_LAYOUTS[l]}
                </button>
              ))}
            </div>
          </div>
        )}
        {def.fields.includes('text') && <Txt label={def.textLabel || 'Text'} value={g.text} onCommit={(v) => up({ text: v })} />}
        {def.fields.includes('sub') && <Txt label={def.subLabel || 'Second line'} value={g.sub} onCommit={(v) => up({ sub: v })} />}
        {def.fields.includes('body') && <Txt area label="Meaning" value={g.body} onCommit={(v) => up({ body: v })} />}
        {def.fields.includes('items') && <Txt area label={def.itemsLabel || 'Items (one per line)'} value={g.items.join('\n')} onCommit={(v) => up({ items: v.split('\n') }, 'Edit items')} />}
        {def.fields.includes('values') && (
          <Txt label={g.type === 'chart' ? 'Numbers: from, to' : 'Icons: total, highlighted'} value={g.values.join(', ')} onCommit={(v) => up({ values: v.split(/[,\s]+/).map(Number).filter(Number.isFinite) }, 'Edit numbers')} />
        )}
        {def.fields.includes('labels') && <Txt label="Labels: from, to, unit (e.g. Then, Now, $)" value={g.labels.join(', ')} onCommit={(v) => up({ labels: v.split(',').map((x) => x.trim()) }, 'Edit labels')} />}
        {def.fields.includes('variant') && (
          <div className="row">
            {['thought', 'speech'].map((k) => (
              <button key={k} className={`btn xs ${g.variant === k ? 'primary' : ''}`} onClick={() => up({ variant: k }, 'Bubble style')}>
                {k === 'thought' ? 'Thought' : 'Speech'}
              </button>
            ))}
          </div>
        )}
        {def.fields.includes('asset') && (
          <div className="field">
            <label>Photo</label>
            <select className="select sm" value={g.assetId || ''} onChange={(e) => up({ assetId: e.target.value || null }, 'Change photo')}>
              <option value="">{images.length ? 'Choose an image…' : 'Add an image as B-roll in Media first'}</option>
              {images.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {def.fields.includes('point') && (
          <div className="card tight stack-sm">
            <div className="section-title">Points at</div>
            <label className="label">Across · {Math.round(g.x * 100)}%</label>
            <input type="range" min={8} max={92} defaultValue={Math.round(g.x * 100)} key={`x${g.id}${g.x}`} onMouseUp={(e) => up({ x: Number(e.target.value) / 100 }, 'Move callout')} onKeyUp={(e) => up({ x: Number(e.target.value) / 100 }, 'Move callout')} aria-label="Callout across" />
            <label className="label">Down · {Math.round(g.y * 100)}%</label>
            <input type="range" min={8} max={90} defaultValue={Math.round(g.y * 100)} key={`y${g.id}${g.y}`} onMouseUp={(e) => up({ y: Number(e.target.value) / 100 }, 'Move callout')} onKeyUp={(e) => up({ y: Number(e.target.value) / 100 }, 'Move callout')} aria-label="Callout down" />
          </div>
        )}
        <div className="field">
          <label>Colour</label>
          <div className="row wrap">
            {Object.entries(GRAPHIC_COLORS).map(([k, c]) => (
              <button key={k} className={`btn xs ${g.color === k ? 'primary' : ''}`} onClick={() => up({ color: k }, 'Graphic colour')} title={c.label}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: c.hex, display: 'inline-block', border: '1px solid rgba(0,0,0,.3)' }} /> {c.label}
              </button>
            ))}
          </div>
        </div>
        {g.type !== 'callout' && g.layout === 'overlay' && !['bubble', 'emoji'].includes(g.type) && (
          <div className="field">
            <label>Position</label>
            <div className="row">
              {Object.entries(GRAPHIC_POSITIONS)
                .filter(([k]) => g.type !== 'progress' || k !== 'center')
                .map(([k, l]) => (
                  <button key={k} className={`btn xs ${g.position === k ? 'primary' : ''}`} onClick={() => up({ position: k }, 'Graphic position')}>
                    {l}
                  </button>
                ))}
            </div>
          </div>
        )}
        <div className="row">
          <Num label="Starts at" value={g.start} min={0} onCommit={(v) => up({ start: v }, 'Move motion graphic')} />
        </div>
        <div className="row">
          <Num label="Duration" value={g.duration} min={0.6} onCommit={(v) => up({ duration: v }, 'Graphic duration')} />
        </div>
        {g.type === 'progress' && total > 0 && (
          <button className="btn sm" onClick={() => up({ start: 0, duration: total }, 'Progress bar spans the video')}>
            Span the whole video ({formatTime(total)})
          </button>
        )}
        <button
          className="btn sm danger"
          onClick={() => {
            ops([{ type: 'deleteGraphic', graphicId: g.id }], 'Remove motion graphic');
            onSelect(null);
          }}
        >
          <Trash2 size={14} /> Remove graphic
        </button>
      </div>
    );
  }

  if (selection?.type === 'broll') {
    const b = timeline.broll.find((k) => k.id === selection.id);
    if (!b) return back;
    const up = (patch, label) => ops([{ type: 'updateBroll', brollId: b.id, patch }], label || 'Edit B-roll');
    return (
      <div className="stack">
        {back}
        <h3 style={{ fontSize: 18 }}>B-roll shot</h3>
        {b.reason && <div className="notice info">Why: {b.reason}</div>}
        <Txt label="What to show" value={b.description} onCommit={(v) => up({ description: v })} />
        <div className="field">
          <label>Layout</label>
          <div className="row wrap">
            {Object.entries(BROLL_LAYOUTS).map(([k, l]) => (
              <button key={k} className={`btn xs ${(b.layout || 'full') === k ? 'primary' : ''}`} onClick={() => up({ layout: k }, 'B-roll layout')} disabled={k === 'card' && b.assetId && assetMap[b.assetId]?.mediaType !== 'image'} title={k === 'card' ? 'Works with images' : ''}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {b.layout === 'card' && <Txt label="Handwritten caption" value={b.caption || ''} onCommit={(v) => up({ caption: v })} />}
        {b.assetId && assetMap[b.assetId]?.stock && (
          <p className="tiny muted">
            From{' '}
            <a href={assetMap[b.assetId].stock.pageUrl} target="_blank" rel="noreferrer">
              {assetMap[b.assetId].stock.provider === 'pexels' ? 'Pexels' : 'Pixabay'} <ExternalLink size={10} />
            </a>
            {assetMap[b.assetId].stock.author ? ` · by ${assetMap[b.assetId].stock.author}` : ''}
          </p>
        )}
        {b.assetId && assetMap[b.assetId]?.generated && <p className="tiny muted">AI image ({assetMap[b.assetId].generated.model}).</p>}
        <div className="field">
          <label>Footage</label>
          <select className="select sm" value={b.assetId || ''} onChange={(e) => up({ assetId: e.target.value || null }, 'Attach B-roll footage')} aria-label="B-roll footage">
            <option value="">{brollAssets.length ? 'Suggestion only (not rendered)' : 'Upload B-roll in the Media tab'}</option>
            {brollAssets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <Num label="Starts at" value={b.start} min={0} onCommit={(v) => up({ start: v }, 'Move B-roll')} />
        </div>
        <div className="row">
          <Num label="Duration" value={b.duration} min={0.5} onCommit={(v) => up({ duration: v })} />
        </div>
        {b.assetId && assetMap[b.assetId]?.mediaType !== 'image' && (
          <div className="row">
            <Num label="Start inside the B-roll clip" value={b.srcIn || 0} min={0} max={assetMap[b.assetId]?.duration} onCommit={(v) => up({ srcIn: v })} />
          </div>
        )}
        <FindFootage b={b} act={act} key={b.id} />
        <button
          className="btn sm danger"
          onClick={() => {
            ops([{ type: 'deleteBroll', brollId: b.id }], 'Remove B-roll');
            onSelect(null);
          }}
        >
          <Trash2 size={14} /> Remove
        </button>
      </div>
    );
  }

  if (selection?.type === 'caption') {
    const cap = timeline.captions.items.find((k) => k.id === selection.id);
    if (!cap) return back;
    return (
      <div className="stack">
        {back}
        <h3 style={{ fontSize: 18 }}>Caption</h3>
        <Txt area label="Text" value={cap.text} onCommit={(v) => ops([{ type: 'updateCaption', captionId: cap.id, patch: { text: v } }], 'Edit caption')} />
        <CaptionTiming timeline={timeline} cap={cap} time={time} ops={ops} onSeek={onSeek} readOnly={readOnly} />
        <p className="tiny muted">Drag a caption's edges on the timeline to stretch it, or drag its middle to move it. Captions follow their clip when you trim or reorder.</p>
        <button
          className="btn sm danger"
          onClick={() => {
            ops([{ type: 'deleteCaption', captionId: cap.id }], 'Remove caption');
            onSelect(null);
          }}
        >
          <Trash2 size={14} /> Remove caption
        </button>
      </div>
    );
  }

  // Nothing selected: project-level basics first, advanced tucked away.
  return (
    <div className="stack">
      <p className="small muted">Select a clip, graphic, text, B-roll or caption on the timeline to edit it. Drag clips to reorder, and drag the white handles to trim.</p>
      <div className="card tight stack-sm">
        <div className="section-title">Look</div>
        <div className="row wrap">
          {Object.entries(THEMES).map(([k, th]) => (
            <button key={k} className={`btn xs ${timeline.style?.theme === k ? 'primary' : ''}`} onClick={() => ops([{ type: 'setStyle', patch: { theme: k } }], `Look → ${th.label}`)} title={th.desc}>
              {th.label}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={timeline.sfx?.enabled !== false} onChange={(e) => ops([{ type: 'setSfx', patch: { enabled: e.target.checked } }])} /> Sound effects on graphics and B-roll (pop, whoosh)
        </label>
        {timeline.sfx?.enabled !== false && (
          <>
            <label className="label">Sound effects volume · {Math.round((timeline.sfx?.volume ?? 0.5) * 100)}%</label>
            <input type="range" min={0} max={1} step={0.05} defaultValue={timeline.sfx?.volume ?? 0.5} key={timeline.sfx?.volume} onMouseUp={(e) => ops([{ type: 'setSfx', patch: { volume: Number(e.target.value) } }])} onKeyUp={(e) => ops([{ type: 'setSfx', patch: { volume: Number(e.target.value) } }])} aria-label="Sound effects volume" />
          </>
        )}
      </div>

      <div className="card tight stack-sm">
        <div className="section-title">Captions</div>
        <label className="check">
          <input type="checkbox" checked={timeline.captions.enabled} onChange={(e) => ops([{ type: 'setCaptionStyle', patch: { enabled: e.target.checked } }], e.target.checked ? 'Captions on' : 'Captions off')} /> Show captions
        </label>
        <select className="select sm" value={timeline.captions.style} onChange={(e) => ops([{ type: 'setCaptionStyle', patch: { style: e.target.value } }], 'Caption style')}>
          {Object.entries(CAPTION_STYLES).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <div className="row wrap">
          {Object.entries(GRAPHIC_COLORS)
            .filter(([k]) => k !== 'white')
            .map(([k, c]) => (
              <button key={k} className={`btn xs ${(timeline.style?.captionColor || 'yellow') === k ? 'primary' : ''}`} onClick={() => ops([{ type: 'setStyle', patch: { captionColor: k } }], 'Caption keyword colour')} title={`Keywords in ${c.label}`}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: c.hex, display: 'inline-block' }} />
              </button>
            ))}
        </div>
        <div className="row">
          {['lower', 'center'].map((p) => (
            <button key={p} className={`btn xs ${timeline.captions.position === p ? 'primary' : ''}`} onClick={() => ops([{ type: 'setCaptionStyle', patch: { position: p } }], 'Caption position')}>
              {p === 'lower' ? 'Lower third' : 'Center'}
            </button>
          ))}
        </div>
        {caps.length > 0 && (
          <details className="disclosure">
            <summary>Edit caption text ({caps.length})</summary>
            <div className="stack-sm" style={{ maxHeight: 260, overflow: 'auto' }}>
              {caps.map((c, i) => (
                <div key={c.id + i} className="row" style={{ alignItems: 'flex-start' }}>
                  <button className="btn xs ghost mono" onClick={() => onSeek(c.start + 0.01)}>
                    {formatTime(c.start).replace(/\.\d$/, '')}
                  </button>
                  <div className="grow">
                    <Txt value={c.text} onCommit={(v) => ops([{ type: 'updateCaption', captionId: c.id, patch: { text: v } }], 'Edit caption')} />
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="card tight stack-sm">
        <div className="section-title">Motion graphics</div>
        {['Editorial', 'Clean', 'Bold'].map((grp) => (
        <div key={grp} className="stack-sm">
        <div className="tiny muted">{grp}</div>
        <div className="row wrap">
          {Object.entries(GRAPHIC_TYPES).filter(([, t]) => t.group === grp).map(([k, t]) => (
            <button
              key={k}
              className="btn xs"
              title={t.desc}
              onClick={() => ops([{ type: 'addGraphic', graphic: newGraphic(k, k === 'progress' ? 0 : time, k === 'progress' ? layout(timeline).duration || undefined : undefined) }], `Add ${t.label.toLowerCase()}`)}
            >
              <Sparkles size={12} /> {t.label}
            </button>
          ))}
        </div>
        </div>
        ))}
        <p className="tiny muted">Animated, and exported exactly as previewed. Added at the playhead ({formatTime(time)}); select one on the timeline to edit it.</p>
      </div>

      <div className="card tight stack-sm">
        <div className="section-title">Add</div>
        <div className="row wrap">
          {Object.entries(OVERLAY_TEMPLATES).map(([k, t]) => (
            <button key={k} className="btn xs" title={t.desc} onClick={() => ops([{ type: 'addOverlay', overlay: { template: k, text: k === 'cta' ? 'Follow for more' : k === 'lowerThird' ? 'Your name' : 'Your title', start: +time.toFixed(2), duration: 2.5 } }], `Add ${t.label}`)}>
              <Type size={12} /> {t.label}
            </button>
          ))}
          <button className="btn xs" onClick={() => ops([{ type: 'addBroll', broll: { start: +time.toFixed(2), duration: 2, description: 'Cutaway shot', reason: 'Added manually' } }], 'Add B-roll slot')}>
            <Clapperboard size={12} /> B-roll slot
          </button>
        </div>
        <p className="tiny muted">Added at the playhead ({formatTime(time)}).</p>
      </div>

      <div className="card tight stack-sm">
        <div className="section-title">Music</div>
        <select className="select sm" value={timeline.music.assetId || ''} onChange={(e) => ops([{ type: 'setMusic', patch: { assetId: e.target.value || null } }], 'Change music track')}>
          <option value="">{musicAssets.length ? 'No music' : 'Upload a licensed track in Media'}</option>
          {musicAssets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <label className="label">Music volume · {Math.round((timeline.music.volume ?? 0) * 100)}%</label>
        <input type="range" min={0} max={0.8} step={0.02} defaultValue={timeline.music.volume} key={timeline.music.volume} onMouseUp={(e) => ops([{ type: 'setMusic', patch: { volume: Number(e.target.value) } }], 'Music volume')} onKeyUp={(e) => ops([{ type: 'setMusic', patch: { volume: Number(e.target.value) } }], 'Music volume')} />
        <label className="check">
          <input type="checkbox" checked={timeline.music.duck} onChange={(e) => ops([{ type: 'setMusic', patch: { duck: e.target.checked } }], 'Music ducking')} /> Lower music while someone speaks
        </label>
      </div>

      <details className="disclosure">
        <summary>More options</summary>
        <div className="stack">
          <div className="card tight stack-sm">
            <div className="section-title">Voice audio</div>
            <label className="check">
              <input type="checkbox" checked={timeline.audio.normalize} onChange={(e) => ops([{ type: 'setAudio', patch: { normalize: e.target.checked } }])} /> Normalise loudness (−14 LUFS, social standard)
            </label>
            <label className="check">
              <input type="checkbox" checked={timeline.audio.denoise} onChange={(e) => ops([{ type: 'setAudio', patch: { denoise: e.target.checked } }])} /> Reduce background noise
            </label>
            <label className="label">Voice level · {Math.round((timeline.audio.voiceVolume ?? 1) * 100)}%</label>
            <input type="range" min={0} max={2} step={0.05} defaultValue={timeline.audio.voiceVolume} key={timeline.audio.voiceVolume} onMouseUp={(e) => ops([{ type: 'setAudio', patch: { voiceVolume: Number(e.target.value) } }], 'Voice level')} />
          </div>
          <div className="card tight stack-sm">
            <div className="section-title">Transitions</div>
            <div className="row wrap">
              {Object.entries(TRANSITIONS).map(([k, l]) => (
                <button key={k} className="btn xs" onClick={() => ops(clips.slice(1).map((c) => ({ type: 'updateClip', clipId: c.id, patch: { transitionIn: k } })), `All transitions: ${l}`)} disabled={clips.length < 2}>
                  All: {l}
                </button>
              ))}
            </div>
          </div>
          <div className="card tight stack-sm">
            <div className="section-title">Format</div>
            <select className="select sm" value={timeline.format.aspect} onChange={(e) => ops([{ type: 'setFormat', patch: { aspect: e.target.value } }], `Format → ${e.target.value}`)}>
              {Object.entries(ASPECTS).map(([k, a]) => (
                <option key={k} value={k}>
                  {a.label} · {a.hint}
                </option>
              ))}
            </select>
            <p className="tiny muted">Footage is center-cropped to fill the frame.</p>
          </div>
        </div>
      </details>
    </div>
  );
}
