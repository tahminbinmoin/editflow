import { useMemo, useRef, useState } from 'react';
import { FileText, Cloud, Keyboard, Pencil, Check, X, Undo2, Plus, Scissors, Wand2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatTime, layout } from '@shared/timeline.js';
import { assetWords, CUT_MODES } from '@shared/cleancut.js';
import { segmentInCut, removeSegmentOps, addSegmentOps } from '../lib/edits.js';
import { useAuth } from '../App.jsx';

const SOURCES = {
  sample: 'Sample transcript (written for the demo)',
  import: 'Imported caption file',
  'import-estimated': 'Imported text: timing is estimated, so check cut points',
  'openai-transcribe': 'Transcribed with OpenAI, word by word',
  'groq-whisper': 'Transcribed with Groq Whisper',
  'local-whisper': 'Transcribed on this device (Whisper)',
  manual: 'Typed manually',
};

function AddTranscript({ asset, act, readOnly, busy, status, openaiReady }) {
  const fileRef = useRef();
  const [manual, setManual] = useState(null);

  const importFile = async (f) => act.importTranscript(asset.id, await f.text());
  const saveManual = async () => {
    await act.importTranscript(asset.id, manual);
    setManual(null);
  };

  if (readOnly) return null;
  return (
    <div className="card tight stack">
      <div>
        <b className="small">{asset.name}</b>
        <p className="tiny muted">A transcript powers story planning, text-based cutting and captions.</p>
      </div>
      {busy === 'transcribing' ? (
        <div className="row small text-2">
          <span className="spinner" /> {status || 'Transcribing…'}
        </div>
      ) : manual != null ? (
        <div className="stack-sm">
          <textarea className="textarea" rows={6} placeholder="Paste or type what is said. One sentence per line works best." value={manual} onChange={(e) => setManual(e.target.value)} />
          <p className="tiny muted">Timing will be estimated from word counts across the clip. Check cut points afterwards.</p>
          <div className="row">
            <button className="btn sm primary" onClick={saveManual} disabled={!manual.trim()}>
              Save lines
            </button>
            <button className="btn sm ghost" onClick={() => setManual(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="stack-sm">
          <button className="btn sm block" onClick={() => fileRef.current.click()} style={{ justifyContent: 'flex-start' }}>
            <FileText size={15} /> Import .srt / .vtt / .txt
          </button>
          <button className="btn sm block" onClick={() => act.transcribe(asset.id)} disabled={!!busy} style={{ justifyContent: 'flex-start' }} title="Uses your OpenAI API key">
            <Cloud size={15} /> Transcribe with OpenAI
          </button>
          <button className="btn sm block ghost" onClick={() => setManual('')} style={{ justifyContent: 'flex-start' }}>
            <Keyboard size={15} /> Type or paste it
          </button>
          <p className="tiny muted">
            {openaiReady ? 'OpenAI: only the audio track is sent, after you confirm (clips up to about 25 minutes, billed per minute to your OpenAI API account).' : (
              <>
                OpenAI transcription needs your OpenAI API key in <Link to="/app/settings">AI settings</Link> (Claude doesn’t transcribe audio). Or import a caption file.
              </>
            )}
          </p>
          <input ref={fileRef} type="file" hidden accept=".srt,.vtt,.txt,text/plain" onChange={(e) => e.target.files[0] && importFile(e.target.files[0])} />
        </div>
      )}
    </div>
  );
}

const FLAG_LABEL = { filler: 'Filler word', stutter: 'Stutter', retake: 'Abandoned take (the speaker said it again)', noise: 'No voice here (speech-to-text noise)' };

/** Clean-cut controls + what was removed automatically. */
function CleanCut({ project, timeline, act, busy, readOnly, wordsByAsset }) {
  const counts = {};
  for (const list of Object.values(wordsByAsset)) for (const w of list) if (!w.keep && w.flag) counts[w.flag] = (counts[w.flag] || 0) + 1;
  const parts = [counts.filler && `${counts.filler} filler${counts.filler > 1 ? 's' : ''}`, counts.stutter && `${counts.stutter} stutter${counts.stutter > 1 ? 's' : ''}`, counts.retake && `${counts.retake} words of retakes`, counts.noise && `${counts.noise} noise`].filter(Boolean);
  const mode = timeline.cut?.mode || 'tight';
  return (
    <div className="card tight stack-sm">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap', gap: 8 }}>
        <b className="small" style={{ whiteSpace: 'nowrap' }}>
          <Wand2 size={14} style={{ verticalAlign: -2 }} /> Clean cut
        </b>
        {!readOnly && (
          <select className="select sm" style={{ width: 'auto' }} value={mode} onChange={(e) => act.cleanUp(e.target.value)} disabled={!!busy || !timeline.clips.length} aria-label="Pause removal">
            {Object.entries(CUT_MODES).map(([k, m]) => (
              <option key={k} value={k}>
                {m.label}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="tiny muted">
        {CUT_MODES[mode].desc}. Every cut lands on the edge of the voice; mumbling and noise with no words are cut too.
        {parts.length ? ` Found in the transcript: ${parts.join(', ')} (struck through below).` : ''}
      </p>
      {!readOnly && (
        <button className="btn sm" onClick={() => act.cleanUp(mode)} disabled={!!busy || !timeline.clips.length}>
          {busy === 'cleanUp' ? <span className="spinner" /> : <Scissors size={14} />} Re-clean the whole cut
        </button>
      )}
    </div>
  );
}

export default function TranscriptPanel({ project, timeline, time, onSeek, ops, act, readOnly, busy, status }) {
  const { engine } = useAuth();
  const [editing, setEditing] = useState(null);
  const [wordMode, setWordMode] = useState(false);
  const wordsByAsset = useMemo(() => {
    const out = {};
    for (const a of project.assets) if (project.transcript.segments.some((s) => s.assetId === a.id)) out[a.id] = assetWords(project.transcript, a.id, a.voice);
    return out;
  }, [project.transcript, project.assets]);
  const footage = project.assets.filter((a) => a.kind === 'footage' && a.status === 'ready' && a.hasAudio);
  const { clips } = useMemo(() => layout(timeline), [timeline]);

  const tlTimeOf = (seg) => {
    const c = clips.find((k) => k.assetId === seg.assetId && k.out > seg.start + 0.1 && k.in < seg.end - 0.1);
    return c ? c.tlStart + Math.max(0, seg.start - c.in) : null;
  };
  const wordTime = (w, assetId) => {
    const c = clips.find((k) => k.assetId === assetId && w.s + 0.01 >= k.in && w.s < k.out);
    return c ? c.tlStart + (w.s - c.in) : null;
  };
  const saveText = async (seg) => {
    await act.editSegment(seg.id, editing.text);
    setEditing(null);
  };

  if (!project.assets.some((a) => a.kind === 'footage'))
    return <p className="small muted">Upload footage in the Media tab first.</p>;

  return (
    <div className="stack">
      {project.transcript.segments.length > 0 && <CleanCut project={project} timeline={timeline} act={act} busy={busy} readOnly={readOnly} wordsByAsset={wordsByAsset} />}
      {project.transcript.source && (
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div className="tiny muted">
            {SOURCES[project.transcript.source] || project.transcript.source}. {wordMode ? 'Click a word to cut it, or click a struck word to bring it back.' : 'Click a word to jump to it. × removes a whole line.'}
          </div>
          {!readOnly && timeline.clips.length > 0 && (
            <button className={`btn xs ${wordMode ? 'primary' : ''}`} onClick={() => setWordMode(!wordMode)} title="Cut or restore single words">
              <Scissors size={12} /> {wordMode ? 'Done' : 'Edit words'}
            </button>
          )}
        </div>
      )}
      {footage.map((a) => {
        const segs = project.transcript.segments.filter((s) => s.assetId === a.id).sort((x, y) => x.start - y.start);
        if (!segs.length) return <AddTranscript key={a.id} asset={a} act={act} readOnly={readOnly} busy={busy} status={status} openaiReady={!!engine?.transcription} />;
        return (
          <div key={a.id} className="stack-sm">
            {footage.length > 1 && <div className="section-title">{a.name}</div>}
            {segs.map((s) => {
              const inCut = segmentInCut(timeline, s);
              const tt = tlTimeOf(s);
              const now = tt != null && time >= tt && time < tt + (s.end - s.start);
              return (
                <div key={s.id} className={`seg ${inCut ? '' : 'out'} ${now ? 'now' : ''}`}>
                  <button className="btn xs ghost mono" style={{ padding: '2px 4px' }} onClick={() => tt != null && onSeek(tt + 0.01)} disabled={tt == null} title={tt == null ? 'Not in the cut' : 'Jump to this line'}>
                    {formatTime(s.start).replace(/\.\d$/, '')}
                  </button>
                  {editing?.id === s.id ? (
                    <div className="stack-sm">
                      <textarea className="textarea" rows={2} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
                      <div className="row">
                        <button className="btn xs primary" onClick={() => saveText(s)}>
                          <Check size={13} /> Save
                        </button>
                        <button className="btn xs ghost" onClick={() => setEditing(null)}>
                          <X size={13} />
                        </button>
                      </div>
                      <span className="tiny muted">Fixes the transcript for planning. Edit caption wording in Let me edit → Captions.</span>
                    </div>
                  ) : (
                    <div className="seg-text">
                      <span className="tiny muted mono">{s.id} </span>
                      {(wordsByAsset[a.id] || [])
                        .filter((w) => w.seg === s.id)
                        .map((w) => {
                          const wt = wordTime(w, a.id);
                          return (
                            <span
                              key={w.i}
                              className={`w ${w.keep ? '' : 'cut'} ${w.flag && !w.keep ? `f-${w.flag}` : ''} ${w.k ? 'kept' : ''} ${wordMode && !readOnly ? 'editable' : ''}`}
                              title={!w.keep ? `${w.c ? 'Cut by you' : FLAG_LABEL[w.flag] || 'Cut'}${wordMode ? ' — click to bring it back' : ''}` : w.k ? 'Kept by you' : wordMode ? 'Click to cut this word' : undefined}
                              onClick={() => {
                                if (wordMode && !readOnly) act.toggleWord(s.id, w.i);
                                else if (wt != null) onSeek(wt + 0.01);
                                else if (tt != null) onSeek(tt + 0.01);
                              }}
                            >
                              {w.t}{' '}
                            </span>
                          );
                        })}
                    </div>
                  )}
                  {!readOnly && editing?.id !== s.id && (
                    <div className="row" style={{ gap: 2 }}>
                      <button className="btn xs ghost" onClick={() => setEditing({ id: s.id, text: s.text })} aria-label="Edit line text" title="Fix transcript text">
                        <Pencil size={12} />
                      </button>
                      {inCut ? (
                        <button className="btn xs ghost" onClick={() => ops(removeSegmentOps(timeline, s), `Cut line ${s.id}`)} title="Remove this line from the video">
                          <X size={13} />
                        </button>
                      ) : (
                        <button className="btn xs ghost" onClick={() => ops(addSegmentOps(timeline, s), `Restore line ${s.id}`)} title="Add this line back">
                          {timeline.clips.length ? <Undo2 size={13} /> : <Plus size={13} />}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      {project.assets.some((a) => a.kind === 'footage' && a.status === 'processing') && <p className="tiny muted">Some footage is still processing…</p>}
    </div>
  );
}
