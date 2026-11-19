import { useMemo, useState } from 'react';
import { ShieldCheck, AlertTriangle, XCircle, CheckCircle2, Wand2 } from 'lucide-react';
import { reviewCut } from '@shared/quality.js';

const ICON = { error: XCircle, warn: AlertTriangle, ok: CheckCircle2 };
const COLOR = { error: 'var(--err)', warn: 'var(--warn, #e0a03a)', ok: 'var(--ok, #5fb37a)' };

/** Measured reel checks (dead air, fillers, mumbles, hook, length, pacing, captions). */
export default function QualityCard({ project, timeline, act, busy, readOnly, compact = false }) {
  const qa = useMemo(() => reviewCut(project, timeline), [project, timeline]);
  const [showOk, setShowOk] = useState(false);
  if (!timeline.clips.length) return null;
  const bad = qa.checks.filter((c) => c.level !== 'ok');
  const ok = qa.checks.filter((c) => c.level === 'ok');
  const canFix = bad.some((c) => c.fix === 'cleanUp');
  return (
    <div className="card tight stack-sm quality">
      <div className="spread">
        <b className="small">
          <ShieldCheck size={14} style={{ verticalAlign: -2 }} /> Reel check
        </b>
        <span className={`pill ${qa.score >= 85 ? 'ok' : qa.score >= 60 ? 'warm' : 'err'}`} title="Measured from the audio and the words, not guessed">
          {qa.score}/100
        </span>
      </div>
      {bad.length === 0 && <div className="tiny text-2">Nothing a professional editor would flag. Ready to export.</div>}
      {bad.map((c) => {
        const I = ICON[c.level];
        return (
          <div key={c.id} className="row small" style={{ alignItems: 'flex-start', gap: 6 }}>
            <I size={14} color={COLOR[c.level]} style={{ marginTop: 2, flex: 'none' }} />
            <div>
              <div>{c.title}</div>
              {!compact && c.detail && <div className="tiny muted">{c.detail}</div>}
            </div>
          </div>
        );
      })}
      {canFix && !readOnly && (
        <button className="btn sm primary" onClick={() => act.cleanUp()} disabled={!!busy}>
          {busy === 'cleanUp' ? <span className="spinner" /> : <Wand2 size={14} />} Fix automatically
        </button>
      )}
      {ok.length > 0 && (
        <button className="btn xs ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShowOk(!showOk)}>
          {showOk ? 'Hide' : 'Show'} {ok.length} passed check{ok.length > 1 ? 's' : ''}
        </button>
      )}
      {showOk &&
        ok.map((c) => (
          <div key={c.id} className="row tiny text-2" style={{ gap: 6 }}>
            <CheckCircle2 size={12} color={COLOR.ok} /> {c.title}
          </div>
        ))}
    </div>
  );
}
