import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Film, CheckCircle2, AlertTriangle, Cpu } from 'lucide-react';
import AppHeader from '../components/AppHeader.jsx';
import { useProject } from '../lib/useProject.js';
import { renderVideo } from '../lib/render.js';
import { uploadToStorage, signedUrls } from '../lib/media.js';
import { currentUser } from '../lib/supabase.js';
import { Progress, bytes, timeAgo, useToast } from '../components/ui.jsx';
import { layout, formatTime, ASPECTS, uid } from '@shared/timeline.js';
import { QUALITIES, dimensions } from '@shared/render-graph.js';
import { MAX_UPLOAD_MB } from '@shared/config.js';

export default function ExportPage() {
  const { id } = useParams();
  const { project, urls, act } = useProject(id);
  const toast = useToast();
  const [aspect, setAspect] = useState(null);
  const [quality, setQuality] = useState('draft');
  const [job, setJob] = useState(null); // { step, progress, eta }
  const [results, setResults] = useState({}); // exportId → blob URL (this session)

  if (!project) return <><AppHeader /><div className="page row muted"><span className="spinner" /> Loading…</div></>;
  const tl = project.timeline;
  const curAspect = aspect || tl.format.aspect;
  const { clips, duration } = layout(tl);
  const brollMissing = tl.broll.filter((b) => !b.assetId).length;
  const size = dimensions(curAspect, quality);
  const notReady = project.assets.some((a) => a.status !== 'ready' && a.status !== 'error');

  const render = async () => {
    const exportId = uid('exp');
    setJob({ step: 'Starting…', progress: 0 });
    try {
      const out = await renderVideo(project, urls, { aspect: curAspect, quality }, setJob);
      const url = URL.createObjectURL(out.blob);
      setResults((r) => ({ ...r, [exportId]: url }));
      const safe = project.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'editflow';
      const file = `${safe}-${curAspect.replace(':', 'x')}-${quality}.mp4`;
      const rec = { id: exportId, status: 'done', aspect: curAspect, quality, width: out.W, height: out.H, duration: out.duration, file, size: out.blob.size, renderSeconds: out.seconds, createdAt: new Date().toISOString() };
      if (out.blob.size <= MAX_UPLOAD_MB * 1048576) {
        setJob({ step: 'Saving a copy to your account…', progress: 1 });
        const user = await currentUser();
        rec.path = await uploadToStorage(`${user.id}/${project.id}/exports/${exportId}.mp4`, out.blob, null, 'video/mp4').catch(() => null);
      }
      await act.recordExport(rec);
      const a = document.createElement('a');
      a.href = url;
      a.download = file;
      a.click();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setJob(null);
    }
  };

  const openSaved = async (e) => {
    if (results[e.id]) return results[e.id];
    const u = await signedUrls([e.path]);
    return u[e.path];
  };

  return (
    <>
      <AppHeader />
      <main className="page narrow stack-lg">
        <Link to={`/app/p/${id}`} className="btn sm ghost" style={{ alignSelf: 'flex-start' }}>
          <ArrowLeft size={15} /> Back to studio
        </Link>
        <div>
          <h1 style={{ fontSize: 32 }}>Export “{project.name}”</h1>
          <p className="muted" style={{ marginTop: 6 }}>
            {clips.length} clips · {formatTime(duration)} · rendered in this browser with ffmpeg.wasm
          </p>
        </div>

        <div className="notice info">
          <Cpu size={14} style={{ verticalAlign: -2 }} /> Rendering runs on your device, so keep this tab open until it finishes. Expect about 1–3× the video length at Draft quality on a typical laptop; higher qualities take longer. A desktop browser works best.
        </div>
        {project.isSample && <div className="notice info">This is the sample project. The export is real, but the footage is placeholder video with a synthetic “speech” tone.</div>}

        <section className="card stack">
          <div className="section-title">Aspect ratio</div>
          <div className="aspect-grid">
            {Object.entries(ASPECTS).map(([aid, a]) => (
              <button key={aid} className={`choice ${curAspect === aid ? 'on' : ''}`} onClick={() => setAspect(aid)} aria-pressed={curAspect === aid}>
                <div className="aspect-box" style={{ width: a.w > a.h ? 34 : (34 * a.w) / a.h, height: a.h >= a.w ? 34 : (34 * a.h) / a.w }} />
                <b style={{ fontSize: 14 }}>{a.label}</b>
                <span className="tiny muted">{a.hint}</span>
              </button>
            ))}
          </div>
          {curAspect !== tl.format.aspect && <p className="tiny muted">Your edit is set to {ASPECTS[tl.format.aspect].label}. This export reframes it to {ASPECTS[curAspect].label} with a center crop.</p>}
          <div className="section-title" style={{ marginTop: 8 }}>
            Quality
          </div>
          <div className="row wrap">
            {Object.entries(QUALITIES).map(([qid, q]) => (
              <button key={qid} className={`btn sm ${quality === qid ? 'primary' : ''}`} onClick={() => setQuality(qid)}>
                {q.label}
              </button>
            ))}
          </div>
          <p className="tiny muted mono">
            Output: {size.W}×{size.H} · H.264 MP4 · 30 fps · AAC audio{tl.audio.normalize ? ' · −14 LUFS' : ''}
          </p>
          <div className="divider" />
          <div className="stack-sm small text-2">
            <div>
              <CheckCircle2 size={14} color="var(--ok)" style={{ verticalAlign: -2 }} /> Included: trims and order, {tl.captions.enabled ? `${tl.captions.style} captions` : 'no captions'}, {tl.overlays.length} text overlay
              {tl.overlays.length === 1 ? '' : 's'}, {tl.broll.length - brollMissing} B-roll cutaway{tl.broll.length - brollMissing === 1 ? '' : 's'}
              {tl.music.assetId ? ', music' + (tl.music.duck ? ' with ducking' : '') : ''}
              {tl.audio.denoise ? ', noise reduction' : ''}.
            </div>
            {brollMissing > 0 && (
              <div>
                <AlertTriangle size={14} color="var(--warm)" style={{ verticalAlign: -2 }} /> {brollMissing} B-roll suggestion{brollMissing > 1 ? 's have' : ' has'} no footage attached and won’t appear.
              </div>
            )}
            {tl.sound.length > 0 && (
              <div>
                <AlertTriangle size={14} color="var(--warm)" style={{ verticalAlign: -2 }} /> Sound-design ideas are notes only and aren’t rendered.
              </div>
            )}
          </div>
          {job ? (
            <div className="stack-sm">
              <div className="small">
                {job.step}
                {job.progress > 0 && ` · ${Math.round(job.progress * 100)}%`}
                {job.eta != null && ` · about ${job.eta}s left`}
              </div>
              <Progress value={job.progress} />
            </div>
          ) : (
            <button className="btn primary lg" disabled={!clips.length || notReady} onClick={render}>
              <Film size={18} /> {notReady ? 'Waiting for uploads to finish…' : 'Render video'}
            </button>
          )}
        </section>

        <section className="stack">
          <div className="section-title">Exports</div>
          {project.exports.length === 0 && <p className="small muted">No exports yet.</p>}
          {project.exports.map((e) => (
            <div key={e.id} className="card tight spread">
              <div>
                <b className="small">{e.file}</b>
                <div className="tiny muted mono">
                  {e.width}×{e.height} · {formatTime(e.duration)} · {timeAgo(e.createdAt)} {e.size ? `· ${bytes(e.size)}` : ''} {e.renderSeconds ? `· rendered in ${e.renderSeconds}s` : ''}
                </div>
                {!e.path && !results[e.id] && <div className="tiny muted">Not saved to your account (over {MAX_UPLOAD_MB} MB). Render again to download.</div>}
              </div>
              {(e.path || results[e.id]) && (
                <button
                  className="btn sm primary"
                  onClick={async () => {
                    const url = await openSaved(e);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = e.file;
                    a.target = '_blank';
                    a.click();
                  }}
                >
                  <Download size={14} /> Download
                </button>
              )}
            </div>
          ))}
        </section>
      </main>
    </>
  );
}
