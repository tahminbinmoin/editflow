import { useEffect, useMemo, useState } from 'react';
import { Scissors, Trash2, Type, Clapperboard, ChevronLeft, Sparkles } from 'lucide-react';
import { layout, timelineCaptions, formatTime, TRANSITIONS, OVERLAY_TEMPLATES, CAPTION_STYLES, STORY_ROLES, ASPECTS } from '@shared/timeline.js';
import { GRAPHIC_TYPES, GRAPHIC_COLORS, GRAPHIC_POSITIONS } from '@shared/graphics.js';

const SAMPLE_TEXT = { lowerThird: ['Your name', 'What you do'], keyword: ['Key point'], stat: ['73%', 'what the number means'], list: ['What you need'], callout: ['Look here'], progress: [''], chapter: ['Section title', 'Step 1'] };
export function newGraphic(type, start, duration) {
  const [text, sub] = SAMPLE_TEXT[type] || [''];
  return { type, text, sub: sub || '', items: type === 'list' ? ['First point', 'Second point', 'Third point'] : [], start: +start.toFixed(2), ...(duration ? { duration } : {}) };
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

export default function EditPanel({ project, timeline, selection, onSelect, ops, time, onSeek, readOnly }) {
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
        {def.fields.includes('text') && <Txt label={def.textLabel || 'Text'} value={g.text} onCommit={(v) => up({ text: v })} />}
        {def.fields.includes('sub') && <Txt label={def.subLabel || 'Second line'} value={g.sub} onCommit={(v) => up({ sub: v })} />}
        {def.fields.includes('items') && (
          <Txt area label="Points (one per line, up to 4)" value={g.items.join('\n')} onCommit={(v) => up({ items: v.split('\n') }, 'Edit checklist')} />
        )}
        {def.fields.includes('point') && (
          <div className="card tight stack-sm">
            <div className="section-title">Points at</div>
            <label className="label">Across · {Math.round(g.x * 100)}%</label>
            <input type="range" min={4} max={96} defaultValue={Math.round(g.x * 100)} key={`x${g.id}${g.x}`} onMouseUp={(e) => up({ x: Number(e.target.value) / 100 }, 'Move callout')} onKeyUp={(e) => up({ x: Number(e.target.value) / 100 }, 'Move callout')} aria-label="Callout across" />
            <label className="label">Down · {Math.round(g.y * 100)}%</label>
            <input type="range" min={4} max={96} defaultValue={Math.round(g.y * 100)} key={`y${g.id}${g.y}`} onMouseUp={(e) => up({ y: Number(e.target.value) / 100 }, 'Move callout')} onKeyUp={(e) => up({ y: Number(e.target.value) / 100 }, 'Move callout')} aria-label="Callout down" />
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
        {g.type !== 'callout' && (
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
          <label>Footage</label>
          <select className="select sm" value={b.assetId || ''} onChange={(e) => up({ assetId: e.target.value || null }, 'Attach B-roll footage')}>
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
        {b.assetId && (
          <div className="row">
            <Num label="Start inside the B-roll clip" value={b.srcIn || 0} min={0} max={assetMap[b.assetId]?.duration} onCommit={(v) => up({ srcIn: v })} />
          </div>
        )}
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
        <p className="tiny muted">Captions follow their clip when you trim or reorder.</p>
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
        <div className="row wrap">
          {Object.entries(GRAPHIC_TYPES).map(([k, t]) => (
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
