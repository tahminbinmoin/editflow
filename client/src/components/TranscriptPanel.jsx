import { useMemo, useRef, useState } from 'react';
import { FileText, Cloud, Keyboard, Pencil, Check, X, Undo2, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatTime, layout } from '@shared/timeline.js';
import { segmentInCut, removeSegmentOps, addSegmentOps } from '../lib/edits.js';
import { useAuth } from '../App.jsx';

const SOURCES = {
  sample: 'Sample transcript (written for the demo)',
  import: 'Imported caption file',
  'import-estimated': 'Imported text: timing is estimated, so check cut points',
  'openai-transcribe': 'Transcribed with OpenAI (timing from pauses in the audio)',
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

export default function TranscriptPanel({ project, timeline, time, onSeek, ops, act, readOnly, busy, status }) {
  const { engine } = useAuth();
  const [editing, setEditing] = useState(null);
  const footage = project.assets.filter((a) => a.kind === 'footage' && a.status === 'ready' && a.hasAudio);
  const { clips } = useMemo(() => layout(timeline), [timeline]);

  const tlTimeOf = (seg) => {
    const c = clips.find((k) => k.assetId === seg.assetId && k.out > seg.start + 0.1 && k.in < seg.end - 0.1);
    return c ? c.tlStart + Math.max(0, seg.start - c.in) : null;
  };
  const saveText = async (seg) => {
    await act.editSegment(seg.id, editing.text);
    setEditing(null);
  };

  if (!project.assets.some((a) => a.kind === 'footage'))
    return <p className="small muted">Upload footage in the Media tab first.</p>;

  return (
    <div className="stack">
      {project.transcript.source && (
        <div className="tiny muted">
          {SOURCES[project.transcript.source] || project.transcript.source}. Strike a line to cut it from the video; click a line to jump to it.
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
                    <div className="seg-text" onClick={() => tt != null && onSeek(tt + 0.01)} style={{ cursor: tt != null ? 'pointer' : 'default' }}>
                      <span className="tiny muted mono">{s.id} </span>
                      {s.text}
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
