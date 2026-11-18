import { useMemo, useRef, useState } from 'react';
import { FileText, Cpu, Cloud, Keyboard, Pencil, Check, X, Undo2, Plus } from 'lucide-react';
import { formatTime, layout } from '@shared/timeline.js';
import { segmentInCut, removeSegmentOps, addSegmentOps } from '../lib/edits.js';
import { Progress, useToast } from './ui.jsx';

const SOURCES = {
  sample: 'Sample transcript (written for the demo)',
  import: 'Imported caption file',
  'import-estimated': 'Imported text: timing is estimated, so check cut points',
  'groq-whisper': 'Transcribed with Groq Whisper',
  'local-whisper': 'Transcribed on this device (Whisper)',
  manual: 'Typed manually',
};

function AddTranscript({ asset, act, readOnly }) {
  const toast = useToast();
  const fileRef = useRef();
  const [manual, setManual] = useState(null);
  const [local, setLocal] = useState(null);

  const importFile = async (f) => act.importTranscript(asset.id, await f.text());
  const groq = () => act.transcribeGroq(asset.id);
  const onDevice = async () => {
    setLocal({ step: 'Starting…', progress: 0 });
    try {
      const n = await act.transcribeLocal(asset.id, setLocal);
      toast(`Transcribed ${n} lines on this device`);
    } catch (e) {
      toast(`On-device transcription failed: ${e.message}. Try importing a caption file instead.`, 'err');
    } finally {
      setLocal(null);
    }
  };
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
      {local ? (
        <div className="stack-sm">
          <div className="tiny text-2">{local.step}</div>
          <Progress value={local.progress} />
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
          <button className="btn sm block" onClick={groq} style={{ justifyContent: 'flex-start' }} title="Uses your Groq API key (free plan available, rate-limited)">
            <Cloud size={15} /> Transcribe with Groq Whisper
          </button>
          <button className="btn sm block" onClick={onDevice} style={{ justifyContent: 'flex-start' }} title="Experimental — runs Whisper in your browser">
            <Cpu size={15} /> Transcribe on this device <span className="pill" style={{ marginLeft: 'auto' }}>experimental</span>
          </button>
          <button className="btn sm block ghost" onClick={() => setManual('')} style={{ justifyContent: 'flex-start' }}>
            <Keyboard size={15} /> Type or paste it
          </button>
          <p className="tiny muted">
            Groq: needs your Groq key in AI settings; only the audio is sent, after you confirm (clips up to ~13 min). On-device: free and private, downloads a speech model once, and is slower on long clips.
          </p>
          <input ref={fileRef} type="file" hidden accept=".srt,.vtt,.txt,text/plain" onChange={(e) => e.target.files[0] && importFile(e.target.files[0])} />
        </div>
      )}
    </div>
  );
}

export default function TranscriptPanel({ project, timeline, time, onSeek, ops, act, readOnly }) {
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
        if (!segs.length) return <AddTranscript key={a.id} asset={a} act={act} readOnly={readOnly} />;
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
