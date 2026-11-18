import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wand2, Send, Check, X, RefreshCw, Eye, EyeOff, Sparkles, ScanEye } from 'lucide-react';
import { RolePill, EngineBadge } from './ui.jsx';
import { openWithLineOps } from '../lib/edits.js';
import { formatTime } from '@shared/timeline.js';
import { GRAPHIC_TYPES, GRAPHIC_COLORS } from '@shared/graphics.js';

const EXAMPLES = ['Make the first three seconds faster', 'Add a stat graphic when a number is mentioned', 'Use yellow for all graphics', 'Make the music less intense', 'Use boxed captions', 'Cut it closer to 30 seconds'];

function Section({ title, children, open = true, count }) {
  return (
    <details className="disclosure" open={open}>
      <summary>
        {title}
        {count != null && <span className="pill">{count}</span>}
      </summary>
      <div className="stack-sm" style={{ paddingBottom: 8 }}>
        {children}
      </div>
    </details>
  );
}

function Proposal({ project, act, preview, setPreview }) {
  const p = project.pending;
  const ref = useRef();
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [p.id]);
  return (
    <div className="proposal stack" ref={ref} style={{ scrollMarginTop: 12 }}>
      <div className="spread">
        <span className="pill warm">
          <Sparkles size={12} /> {p.kind === 'firstCut' ? 'Proposed first cut' : p.kind === 'visuals' ? 'Proposed B-roll & graphics' : 'Proposed change'}
        </span>
        <EngineBadge meta={p.meta} />
      </div>
      {p.request && <div className="small muted">“{p.request}”</div>}
      <p className="small">{p.summary}</p>
      {p.steps?.length > 0 && (
        <ul className="small text-2" style={{ paddingLeft: 18, margin: 0 }}>
          {p.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
      {p.changes?.length > 0 && (
        <div className="chips">
          {p.changes.map((c) => (
            <span key={c} className="pill">
              {c}
            </span>
          ))}
        </div>
      )}
      {p.scenes?.length > 0 && (
        <details className="disclosure">
          <summary>What the AI saw ({p.scenes.length} scenes)</summary>
          <div className="stack-sm">
            {p.scenes.map((sc, i) => (
              <div key={i} className="tiny text-2">
                <span className="mono muted">{formatTime(sc.start)}</span> {sc.what}
              </div>
            ))}
          </div>
        </details>
      )}
      {p.notes?.length > 0 && p.notes.map((n, i) => <div key={i} className="notice info">{n}</div>)}
      {p.plan?.warnings?.length > 0 && <div className="tiny muted">{p.plan.warnings.join(' · ')}</div>}
      <div className="row wrap">
        <button className="btn primary sm" onClick={act.applyPending}>
          <Check size={15} /> Apply
        </button>
        <button className="btn sm" onClick={act.discardPending}>
          <X size={15} /> Discard
        </button>
        <button className="btn sm ghost" onClick={() => setPreview(!preview)}>
          {preview ? <EyeOff size={15} /> : <Eye size={15} />} {preview ? 'Show current cut' : 'Preview proposal'}
        </button>
      </div>
      <p className="tiny muted">{preview ? 'The player and timeline are showing the proposal.' : 'The player is showing your current cut.'} You can undo after applying.</p>
    </div>
  );
}

export default function AIPanel({ project, engine, act, busy, status, ops, preview, setPreview, onSeek }) {
  const [req, setReq] = useState('');
  const plan = project.plan;
  const tl = project.timeline;
  const segById = Object.fromEntries(project.transcript.segments.map((s) => [s.id, s]));
  const hasTranscript = project.transcript.segments.length > 0;
  const brollAssets = project.assets.filter((a) => a.kind === 'broll' && a.status === 'ready');
  const musicAssets = project.assets.filter((a) => a.kind === 'music' && a.status === 'ready');
  const rules = engine?.id === 'rules';

  const firstCut = async (forceRules) => {
    if (await act.firstCut(forceRules)) setPreview(true);
  };
  const analyze = async () => {
    if (await act.analyzeVisuals()) setPreview(true);
  };
  const graphics = tl.graphics || [];
  const refine = async (text) => {
    const r = (text ?? req).trim();
    if (!r) return;
    if (await act.refine(r)) {
      setReq('');
      setPreview(true);
    }
  };

  return (
    <div className="stack">
      <div className="spread">
        <span className={`pill ${rules ? '' : 'info'}`}>{rules ? 'Rule-based mode · no AI' : `${engine?.name}${engine?.model ? ` · ${engine.model}` : ''}`}</span>
        <Link to="/app/settings" className="tiny muted">
          Change
        </Link>
      </div>
      {engine?.fallbackReason && <div className="notice warm">{engine.fallbackReason}, so the rule-based drafter is used.</div>}

      {project.pending && <Proposal project={project} act={act} preview={preview} setPreview={setPreview} />}

      {!hasTranscript ? (
        <div className="card tight stack-sm">
          <b>Add a transcript to get a first cut</b>
          <p className="small muted">Story planning works from what’s said in the footage. Open the Transcript tab to transcribe, import a caption file, or paste the lines.</p>
        </div>
      ) : !plan && !project.pending ? (
        <div className="card raised stack">
          <Wand2 color="var(--accent)" />
          <div>
            <h3 style={{ fontSize: 19 }}>Make my first cut</h3>
            <p className="small text-2" style={{ marginTop: 6 }}>
              Picks a hook, orders the story, trims pauses, writes captions and suggests B-roll and music, all as an editable plan you preview before applying.
            </p>
          </div>
          <button className="btn primary block" onClick={() => firstCut(false)} disabled={!!busy}>
            {busy === 'firstCut' ? <span className="spinner" /> : <Wand2 size={16} />} {busy === 'firstCut' ? 'Planning…' : 'Make my first cut'}
          </button>
          <p className="tiny muted">
            {rules ? 'Rule-based: simple, transparent heuristics on your transcript. No AI, and nothing is sent anywhere.' : `Sends the transcript and brief to ${engine?.name} after you confirm. Video files are never sent.`}
          </p>
        </div>
      ) : null}

      {tl.clips.length > 0 && !project.pending && (
        <div className="card raised stack-sm">
          <div className="row">
            <ScanEye color="var(--accent)" size={20} />
            <b>B-roll & motion graphics from the video</b>
          </div>
          <p className="small text-2">
            {rules
              ? 'Connect ChatGPT or Claude to have it look at your cut and suggest cutaways and animated graphics.'
              : `${engine?.name} looks at still frames from your cut, your timed lines and your B-roll clips, then proposes cutaways and animated graphics (lower thirds, stats, keywords, checklists, callouts) timed to what’s said. You preview before applying.`}
          </p>
          {busy === 'visuals' ? (
            <div className="row small text-2">
              <span className="spinner" /> {status || 'Analysing…'}
            </div>
          ) : rules ? (
            <Link to="/app/settings" className="btn sm" style={{ alignSelf: 'flex-start' }}>
              Connect ChatGPT or Claude
            </Link>
          ) : (
            <button className={`btn ${graphics.length ? '' : 'primary'} block`} onClick={analyze} disabled={!!busy}>
              <ScanEye size={16} /> {graphics.length || tl.broll.some((b) => b.assetId) ? 'Analyse again' : 'Analyse video'}
            </button>
          )}
          {!rules && <p className="tiny muted">Sends about 6–20 small still frames (not the video file) after you confirm. Billed to your {engine?.name} API account.</p>}
        </div>
      )}

      {plan && (
        <div className="card tight">
          <div className="spread" style={{ marginBottom: 6 }}>
            <b>Story plan</b>
            <EngineBadge meta={plan.meta} />
          </div>
          <p className="small text-2">{plan.summary}</p>
          <div className="divider" />
          <Section title="Story beats" count={plan.beats.length}>
            {plan.beats.map((b, i) => (
              <div key={i} className="small">
                <RolePill role={b.role} /> <b>{b.title}</b>
                <div className="text-2 tiny">{b.why}</div>
                <div className="tiny muted mono">{b.segmentIds.join(', ')}</div>
              </div>
            ))}
          </Section>
          {plan.hookOptions.length > 0 && (
            <Section title="Hook options" count={plan.hookOptions.length} open={false}>
              {plan.hookOptions.map((h, i) => (
                <div key={i} className="card tight stack-sm" style={{ background: 'var(--bg-2)' }}>
                  <div className="small">“{h.text}”</div>
                  <div className="tiny muted">{h.why}</div>
                  {h.segmentIds[0] && segById[h.segmentIds[0]] && !project.pending && (
                    <button className="btn xs" onClick={() => ops(openWithLineOps(tl, segById[h.segmentIds[0]]), `Use ${h.segmentIds[0]} as hook`)}>
                      Open with this line
                    </button>
                  )}
                </div>
              ))}
            </Section>
          )}
          <Section title="B-roll suggestions" count={tl.broll.length} open={tl.broll.length > 0}>
            {tl.broll.length === 0 && <p className="tiny muted">No B-roll suggested.</p>}
            {tl.broll.map((b) => (
              <div key={b.id} className="card tight stack-sm" style={{ background: 'var(--bg-2)' }}>
                <div className="spread">
                  <b className="small">{b.description}</b>
                  <button className="btn xs ghost mono" onClick={() => onSeek(b.start + 0.01)}>
                    {formatTime(b.start)}
                  </button>
                </div>
                {b.reason && <div className="tiny text-2">Why: {b.reason}</div>}
                <select
                  className="select sm"
                  value={b.assetId || ''}
                  disabled={!!project.pending}
                  onChange={(e) => ops([{ type: 'updateBroll', brollId: b.id, patch: { assetId: e.target.value || null } }], e.target.value ? 'Attach B-roll footage' : 'Detach B-roll footage')}
                >
                  <option value="">{brollAssets.length ? 'Suggestion only (no footage)' : 'Upload B-roll in Media to attach'}</option>
                  {brollAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      Show: {a.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </Section>
          <Section title="Motion graphics" count={graphics.length} open={graphics.length > 0}>
            {graphics.length === 0 && <p className="tiny muted">None yet. Use “Analyse video”, or add one in Let me edit.</p>}
            {graphics.map((g) => (
              <div key={g.id} className="spread small">
                <span>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: GRAPHIC_COLORS[g.color]?.hex, marginRight: 6 }} />
                  <b>{GRAPHIC_TYPES[g.type]?.label}</b> <span className="text-2">{g.text || g.items?.[0] || ''}</span>
                  {g.reason && <div className="tiny muted">{g.reason}</div>}
                </span>
                <button className="btn xs ghost mono" onClick={() => onSeek(g.start + 0.6)}>
                  {formatTime(g.start)}
                </button>
              </div>
            ))}
          </Section>
          <Section title="Music and sound" open={false}>
            <div className="small">
              <b>Mood:</b> {tl.music.mood || plan.music.mood || '—'}
            </div>
            {tl.music.notes && <div className="tiny text-2">{tl.music.notes}</div>}
            <select className="select sm" value={tl.music.assetId || ''} disabled={!!project.pending} onChange={(e) => ops([{ type: 'setMusic', patch: { assetId: e.target.value || null } }], 'Change music track')}>
              <option value="">{musicAssets.length ? 'No music' : 'Upload a licensed track in Media'}</option>
              {musicAssets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            {tl.sound.length > 0 && (
              <>
                <div className="tiny muted" style={{ marginTop: 6 }}>
                  Sound design ideas (notes only, not rendered):
                </div>
                {tl.sound.map((s) => (
                  <div key={s.id} className="tiny text-2">
                    {formatTime(s.at)} · {s.description}
                  </div>
                ))}
              </>
            )}
          </Section>
          <Section title="Audio clean-up" open={false}>
            {plan.audio.suggestions.map((s, i) => (
              <div key={i} className="tiny text-2">
                • {s}
              </div>
            ))}
            <label className="check">
              <input type="checkbox" checked={tl.audio.normalize} disabled={!!project.pending} onChange={(e) => ops([{ type: 'setAudio', patch: { normalize: e.target.checked } }])} /> Normalise loudness (−14 LUFS)
            </label>
            <label className="check">
              <input type="checkbox" checked={tl.audio.denoise} disabled={!!project.pending} onChange={(e) => ops([{ type: 'setAudio', patch: { denoise: e.target.checked } }])} /> Reduce background noise
            </label>
          </Section>
          <Section title="Review before export" count={plan.review.length} open={false}>
            {plan.review.map((r, i) => (
              <label key={i} className="check small" style={{ alignItems: 'flex-start' }}>
                <input type="checkbox" style={{ marginTop: 3 }} /> <span className="text-2">{r}</span>
              </label>
            ))}
          </Section>
          {plan.changes.length > 0 && (
            <Section title="What the first cut changed" open={false}>
              {plan.changes.map((c, i) => (
                <div key={i} className="tiny text-2">
                  • {c}
                </div>
              ))}
            </Section>
          )}
          <button className="btn sm ghost" onClick={() => firstCut(false)} disabled={!!busy || !!project.pending}>
            <RefreshCw size={14} /> Regenerate first cut
          </button>
        </div>
      )}

      {(plan || tl.clips.length > 0) && (
        <div className="card tight stack-sm">
          <b className="small">Ask for a change</b>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <textarea
              className="textarea"
              rows={2}
              style={{ minHeight: 44 }}
              placeholder="e.g. make the first three seconds faster"
              value={req}
              onChange={(e) => setReq(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  refine();
                }
              }}
              disabled={!!project.pending}
            />
            <button className="btn icon primary" onClick={() => refine()} disabled={!!busy || !req.trim() || !!project.pending} aria-label="Send request">
              {busy === 'refine' ? <span className="spinner" /> : <Send size={16} />}
            </button>
          </div>
          {project.pending ? (
            <p className="tiny muted">Apply or discard the proposal above first.</p>
          ) : (
            <div className="chips">
              {EXAMPLES.map((ex) => (
                <button key={ex} className="chip" onClick={() => refine(ex)} disabled={!!busy}>
                  {ex}
                </button>
              ))}
            </div>
          )}
          {rules && <p className="tiny muted">Rule-based mode understands a few phrasings (faster, music quieter/louder, captions, clean audio, fades). Connect ChatGPT or Claude for anything else.</p>}
        </div>
      )}

      {project.chat.length > 0 && (
        <Section title="Conversation" count={project.chat.length} open={false}>
          {project.chat.slice(-12).map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}`}>
              <div>{m.text}</div>
              {m.notes?.map((n, j) => (
                <div key={j} className="tiny muted" style={{ marginTop: 4 }}>
                  {n}
                </div>
              ))}
              {m.role === 'assistant' && (
                <div className="row tiny muted" style={{ marginTop: 6 }}>
                  <EngineBadge meta={m.meta} />
                  {m.outcome && <span className={`pill ${m.outcome === 'applied' ? 'ok' : ''}`}>{m.outcome}</span>}
                </div>
              )}
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}
