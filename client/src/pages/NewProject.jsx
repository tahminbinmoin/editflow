import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UploadCloud, X, Link2 } from 'lucide-react';
import AppHeader from '../components/AppHeader.jsx';
import { createProject } from '../lib/store.js';
import { pendingFiles } from '../lib/pendingFiles.js';
import { Progress, bytes, useToast } from '../components/ui.jsx';
import { ASPECTS } from '@shared/timeline.js';
import { MAX_UPLOAD_MB } from '@shared/config.js';
import { BRAND } from '../lib/brand.js';

const PLATFORMS = {
  '9:16': 'TikTok / Reels / Shorts',
  '1:1': 'Instagram or LinkedIn feed (square)',
  '4:5': 'Instagram or LinkedIn feed (portrait)',
  '16:9': 'YouTube / website',
};
const LENGTHS = [15, 30, 45, 60, 90];

export function Dropzone({ accept = 'video/*,audio/*', multiple = true, onFiles, label, sub }) {
  const ref = useRef();
  const [over, setOver] = useState(false);
  return (
    <div
      className={`dropzone ${over ? 'over' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => ref.current.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && ref.current.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles([...e.dataTransfer.files]);
      }}
    >
      <UploadCloud size={26} color="var(--warm)" />
      <div style={{ fontWeight: 650, marginTop: 8 }}>{label}</div>
      <div className="small muted">{sub}</div>
      <input ref={ref} type="file" hidden accept={accept} multiple={multiple} onChange={(e) => onFiles([...e.target.files])} />
    </div>
  );
}

export default function NewProject() {
  const nav = useNavigate();
  const toast = useToast();
  const [s, setS] = useState({ name: '', aspect: '9:16', targetLength: 45, audience: '', goal: '', tone: '', notes: '', referenceNotes: '', referenceUrl: '' });
  const [files, setFiles] = useState([]); // {file, kind, progress, status}
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setS({ ...s, [k]: e.target.value });

  const add = (list, kind) => {
    const ok = list.filter((f) => /^(video|audio)\//.test(f.type) || /\.(mp4|mov|m4v|webm|mkv|mp3|wav|m4a|aac)$/i.test(f.name));
    if (ok.length < list.length) toast('Some files were skipped — only video or audio files can be added.', 'err');
    setFiles((cur) => [...cur, ...ok.map((file) => ({ file, kind, progress: 0, status: 'queued' }))]);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!files.some((f) => f.kind === 'footage')) {
      if (!window.confirm('No footage added yet. Create the project anyway? You can upload later in the studio.')) return;
    }
    const tooBig = files.find((f) => f.file.size > MAX_UPLOAD_MB * 1024 * 1024);
    if (tooBig) return toast(`${tooBig.file.name} is over ${MAX_UPLOAD_MB} MB. Use a shorter or lower-resolution export of it.`, 'err');
    setBusy(true);
    try {
      const project = await createProject(s.name || files.find((f) => f.kind === 'footage')?.file.name.replace(/\.[^.]+$/, '') || 'Untitled video', { ...s, platform: PLATFORMS[s.aspect] });
      if (files.length) pendingFiles.set(project.id, files.map(({ file, kind }) => ({ file, kind })));
      nav(`/app/p/${project.id}`);
    } catch (err) {
      toast(err.message, 'err');
      setBusy(false);
    }
  };

  const fileList = (kind) =>
    files.map((f, i) =>
      f.kind !== kind ? null : (
        <div className="file-row" key={i}>
          <div className="grow">
            <div className="spread">
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file.name}</span>
              <span className="muted tiny">{bytes(f.file.size)}</span>
            </div>
            {f.file.size > MAX_UPLOAD_MB * 1048576 && <span className="tiny" style={{ color: 'var(--err)' }}>Over the {MAX_UPLOAD_MB} MB limit</span>}
          </div>
          {!busy && (
            <button type="button" className="btn icon ghost" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove file">
              <X size={14} />
            </button>
          )}
        </div>
      ),
    );

  return (
    <>
      <AppHeader />
      <form className="page narrow stack-lg" onSubmit={submit}>
        <div>
          <h1 style={{ fontSize: 32 }}>New project</h1>
          <p className="muted" style={{ marginTop: 6 }}>
            Tell us what you’re making. Only the footage is required. Everything else helps the first cut fit your goal.
          </p>
        </div>

        <section className="card stack">
          <div className="section-title">1 · Footage</div>
          <Dropzone label="Drop your talking-head, podcast or product clips" sub={`MP4, WebM or audio files · up to ${MAX_UPLOAD_MB} MB each`} onFiles={(l) => add(l, 'footage')} />
          <div className="stack-sm">{fileList('footage')}</div>
          <details className="disclosure">
            <summary>Add B-roll or music you have rights to (optional)</summary>
            <div className="grid-2" style={{ marginTop: 8 }}>
              <div className="stack-sm">
                <Dropzone label="B-roll clips" sub="Cutaways, product shots, screen recordings" onFiles={(l) => add(l, 'broll')} />
                {fileList('broll')}
              </div>
              <div className="stack-sm">
                <Dropzone accept="audio/*" multiple={false} label="Music track" sub="A track you’re licensed to use" onFiles={(l) => add(l, 'music')} />
                {fileList('music')}
              </div>
            </div>
          </details>
        </section>

        <section className="card stack">
          <div className="section-title">2 · Format</div>
          <div className="aspect-grid">
            {Object.entries(ASPECTS).map(([id, a]) => (
              <button type="button" key={id} className={`choice ${s.aspect === id ? 'on' : ''}`} onClick={() => setS({ ...s, aspect: id })} aria-pressed={s.aspect === id}>
                <div className="aspect-box" style={{ width: a.w > a.h ? 34 : (34 * a.w) / a.h, height: a.h >= a.w ? 34 : (34 * a.h) / a.w }} />
                <b style={{ fontSize: 14 }}>{a.label}</b>
                <span className="tiny muted">{a.hint}</span>
              </button>
            ))}
          </div>
          <div className="field">
            <label>Approximate length</label>
            <div className="row wrap">
              {LENGTHS.map((l) => (
                <button type="button" key={l} className={`chip ${Number(s.targetLength) === l ? 'on' : ''}`} style={Number(s.targetLength) === l ? { borderColor: 'var(--accent)', color: 'var(--text)' } : null} onClick={() => setS({ ...s, targetLength: l })}>
                  {l}s
                </button>
              ))}
              <input className="input sm" style={{ width: 90 }} type="number" min={5} max={600} value={s.targetLength} onChange={set('targetLength')} aria-label="Custom length in seconds" />
            </div>
          </div>
        </section>

        <section className="card stack">
          <div className="section-title">3 · Audience and goal</div>
          <div className="field">
            <label htmlFor="name">Project name</label>
            <input id="name" className="input" placeholder="e.g. Launch teaser — Sept" value={s.name} onChange={set('name')} />
          </div>
          <div className="field">
            <label htmlFor="aud">Who is it for?</label>
            <input id="aud" className="input" placeholder="e.g. First-time founders who post on LinkedIn" value={s.audience} onChange={set('audience')} />
          </div>
          <div className="field">
            <label htmlFor="goal">What should viewers do or feel?</label>
            <input id="goal" className="input" placeholder="e.g. Understand one tip and follow for part two" value={s.goal} onChange={set('goal')} />
          </div>
          <div className="field">
            <label htmlFor="tone">Tone (optional)</label>
            <input id="tone" className="input" placeholder="e.g. Energetic, no fluff" value={s.tone} onChange={set('tone')} />
          </div>
          <div className="field">
            <label htmlFor="notes">Editing notes (optional)</label>
            <textarea id="notes" className="textarea" placeholder="e.g. Keep the line about pricing. Cut the intro where I introduce myself." value={s.notes} onChange={set('notes')} />
          </div>
        </section>

        <section className="card stack">
          <div className="section-title">4 · Reference style (optional)</div>
          <p className="small text-2">
            Upload a video whose pacing you like and that you have permission to analyse. {BRAND} measures its cuts and rhythm. It never reuses the reference’s footage,
            music or graphics.
          </p>
          <Dropzone accept="video/*" multiple={false} label="Reference video" sub="Measured in your browser" onFiles={(l) => add(l, 'reference')} />
          {fileList('reference')}
          <div className="field">
            <label htmlFor="refn">Or describe the style</label>
            <textarea id="refn" className="textarea" placeholder="e.g. Fast cuts in the first 3 seconds, big yellow captions, punch-in zooms, lo-fi beat." value={s.referenceNotes} onChange={set('referenceNotes')} />
          </div>
          <div className="field">
            <label htmlFor="refu">
              <Link2 size={13} style={{ verticalAlign: -2 }} /> Reference link (for your notes)
            </label>
            <input id="refu" className="input" placeholder="https://…" value={s.referenceUrl} onChange={set('referenceUrl')} />
            <span className="hint">Links are saved as a note only. {BRAND} does not download videos from other sites.</span>
          </div>
        </section>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={() => nav('/app')} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary lg" disabled={busy}>
            {busy && <span className="spinner" />} {busy ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </>
  );
}
