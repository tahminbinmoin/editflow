import { useMemo } from 'react';
import { layout, formatTime } from '@shared/timeline.js';
import { RolePill, Empty } from './ui.jsx';
import { ListOrdered } from 'lucide-react';

export default function StoryPanel({ project, timeline, time, onSeek, selection, onSelect }) {
  const { clips, duration } = useMemo(() => layout(timeline), [timeline]);
  const segs = project.transcript.segments;
  const textFor = (c) =>
    segs
      .filter((s) => s.assetId === c.assetId && s.end > c.in + 0.1 && s.start < c.out - 0.1)
      .map((s) => s.text)
      .join(' ');
  const assetName = (id) => project.assets.find((a) => a.id === id)?.name || 'clip';

  if (!clips.length)
    return (
      <Empty icon={<ListOrdered />} title="No scenes yet">
        Your cut appears here as a scene list, in story order, once you make a first cut or add clips.
      </Empty>
    );

  return (
    <div className="stack">
      <div className="spread">
        <div className="section-title" style={{ margin: 0 }}>
          Scene list
        </div>
        <span className="tiny muted mono">
          {clips.length} scenes · {formatTime(duration)}
        </span>
      </div>
      <div className="stack-sm">
        {clips.map((c, i) => {
          const on = selection?.type === 'clip' && selection.id === c.id;
          const now = time >= c.tlStart && time < c.tlEnd;
          const text = textFor(c);
          return (
            <div
              key={c.id}
              className={`list-item ${on ? 'on' : ''}`}
              style={now && !on ? { background: 'var(--accent-soft)' } : undefined}
              onClick={() => {
                onSelect({ type: 'clip', id: c.id });
                onSeek(c.tlStart + 0.01);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && (onSelect({ type: 'clip', id: c.id }), onSeek(c.tlStart + 0.01))}
            >
              <div className="spread">
                <span className="row">
                  <b className="mono small">{i + 1}</b>
                  {c.role ? <RolePill role={c.role} /> : <span className="tiny muted">{assetName(c.assetId)}</span>}
                </span>
                <span className="tiny muted mono">{c.duration.toFixed(1)}s</span>
              </div>
              <div className="small text-2" style={{ marginTop: 4, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {text || <span className="muted">No transcript for this part. {formatTime(c.in)}–{formatTime(c.out)} of {assetName(c.assetId)}</span>}
              </div>
              {c.note && <div className="tiny muted" style={{ marginTop: 4 }}>↳ {c.note}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
