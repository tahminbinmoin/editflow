import { useCallback, useRef, useState } from 'react';
import { Upload, Trash2, Plus, Music, Film, Gauge, AlertTriangle, HardDrive, FolderPlus, Unplug } from 'lucide-react';
import FolderBrowser from './FolderBrowser.jsx';
import { supportsFolderAccess, pickFolder, registerPickedFiles, listFolder } from '../lib/localFolder.js';
import { useToast } from './ui.jsx';
import { Progress, bytes } from './ui.jsx';
import { formatTime } from '@shared/timeline.js';
import { MAX_UPLOAD_MB } from '@shared/config.js';

const KINDS = [
  ['footage', 'Footage', 'video/*,audio/*'],
  ['broll', 'B-roll', 'video/*,image/*'],
  ['music', 'Music', 'audio/*'],
  ['reference', 'Reference', 'video/*'],
];

function AssetRow({ project, a, urls, act, ops, readOnly }) {
  const remove = () => {
    if (!window.confirm(`Remove ${a.name}? Clips that use it are removed from the timeline (you can undo).`)) return;
    act.removeAsset(a);
  };
  const thumb = urls[a.id]?.thumb;
  return (
    <div className="card tight" style={{ display: 'flex', gap: 10 }}>
      <div style={{ width: 64, height: 42, borderRadius: 6, background: 'var(--panel-3)', flex: 'none', overflow: 'hidden', display: 'grid', placeItems: 'center' }}>
        {thumb ? <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : a.kind === 'music' ? <Music size={18} color="var(--muted)" /> : <Film size={18} color="var(--muted)" />}
      </div>
      <div className="grow stack-sm" style={{ marginTop: 0 }}>
        <div className="small" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.name}>
          {a.name}
        </div>
        {a.status === 'processing' || a.status === 'uploading' ? (
          <>
            <div className="tiny muted">{a.step || 'Processing…'}</div>
            <Progress value={a.progress} />
          </>
        ) : a.status === 'error' ? (
          <div className="tiny" style={{ color: 'var(--err)' }}>
            <AlertTriangle size={12} style={{ verticalAlign: -2 }} /> {a.error}
          </div>
        ) : (
          <div className="tiny muted mono">
            {a.mediaType === 'image' ? 'Image' : formatTime(a.duration || 0)} {a.width ? `· ${a.width}×${a.height}` : ''} {a.size ? `· ${bytes(a.size)}` : ''}
            {a.stock && (
              <a className="pill info" style={{ marginLeft: 6 }} href={a.stock.pageUrl} target="_blank" rel="noreferrer" title={a.stock.licence}>
                {a.stock.provider === 'pexels' ? 'Pexels' : 'Pixabay'}
                {a.stock.author ? ` · ${a.stock.author}` : ''}
              </a>
            )}
            {a.generated && <span className="pill" style={{ marginLeft: 6 }} title={a.generated.prompt}>AI image</span>}
            {a.sample && <span className="pill warm" style={{ marginLeft: 6 }}>sample</span>}
            {a.source === 'local' && (
              <span className={`pill ${urls[a.id]?.missing ? 'err' : 'info'}`} style={{ marginLeft: 6 }} title={a.relPath}>
                <HardDrive size={10} /> {urls[a.id]?.missing ? 'folder not connected' : 'on this computer'}
              </span>
            )}
          </div>
        )}
        {!readOnly && (a.status === 'ready' || a.status === 'error') && (
          <div className="row" style={{ gap: 4 }}>
            {a.status === 'ready' && (a.kind === 'footage' || a.kind === 'broll') && (
              <button className="btn xs" onClick={() => ops([{ type: 'addClip', assetId: a.id, in: 0, out: a.duration }], `Add ${a.name} to timeline`)}>
                <Plus size={12} /> Add whole clip
              </button>
            )}
            {a.status === 'ready' && a.kind === 'music' && project.timeline.music.assetId !== a.id && (
              <button className="btn xs" onClick={() => ops([{ type: 'setMusic', patch: { assetId: a.id } }], 'Use music track')}>
                Use as music
              </button>
            )}
            {a.kind === 'music' && project.timeline.music.assetId === a.id && <span className="pill ok">In use</span>}
            <div className="grow" />
            <button className="btn xs ghost" onClick={remove} aria-label={`Remove ${a.name}`}>
              <Trash2 size={12} />
            </button>
          </div>
        )}
        {a.kind === 'reference' && a.analysis && (
          <div className="tiny text-2" style={{ background: 'var(--bg)', borderRadius: 6, padding: 8 }}>
            <Gauge size={12} style={{ verticalAlign: -2 }} /> Measured: {a.analysis.shotCount} shots · {a.analysis.avgShotSeconds}s avg · {a.analysis.cutsPerMinute} cuts/min · {a.analysis.cutsInFirst3s} cuts in first 3s
          </div>
        )}
      </div>
    </div>
  );
}

function FoldersSection({ project, folders, act, readOnly }) {
  const toast = useToast();
  const [browsing, setBrowsing] = useState(null);
  const fallback = useRef();
  const [fallbackFor, setFallbackFor] = useState(null);
  const linked = project.folders || [];
  const listFn = useCallback(() => (browsing ? listFolder(browsing.id) : Promise.resolve([])), [browsing]);
  const link = async () => {
    try {
      if (supportsFolderAccess) await act.linkFolder();
      else (setFallbackFor('new'), fallback.current.click());
    } catch (e) {
      if (e.name !== 'AbortError') toast(e.message, 'err');
    }
  };
  const relink = async (f) => {
    try {
      if (supportsFolderAccess) {
        await pickFolder(f.id);
        await act.reconnectFolder(f.id, null);
      } else (setFallbackFor(f.id), fallback.current.click());
    } catch (e) {
      if (e.name !== 'AbortError') toast(e.message, 'err');
    }
  };
  return (
    <div className="stack-sm">
      <div className="spread">
        <div className="section-title" style={{ margin: 0 }}>
          Folders on this computer
        </div>
        {!readOnly && (
          <button className="btn xs" onClick={link}>
            <FolderPlus size={12} /> Link folder
          </button>
        )}
      </div>
      {!linked.length && <p className="tiny muted">Work with large videos without uploading: link a folder such as Downloads or Videos. Files stay on your computer.</p>}
      {linked.map((f) => {
        const st = folders[f.id]?.status;
        const used = project.assets.filter((a) => a.folderId === f.id).map((a) => a.relPath);
        return (
          <div key={f.id} className="card tight stack-sm">
            <div className="spread">
              <span className="small" style={{ fontWeight: 600 }}>
                <HardDrive size={13} style={{ verticalAlign: -2 }} /> {f.name}
              </span>
              <span className={`pill ${st === 'ready' ? 'ok' : st === 'needs-permission' ? 'warm' : 'err'}`}>{st === 'ready' ? 'Connected' : st === 'needs-permission' ? 'Needs permission' : st ? 'Not connected here' : '…'}</span>
            </div>
            {st === 'ready' && !readOnly && (
              <div className="row">
                <button className="btn xs primary" onClick={() => setBrowsing(f)}>
                  <Plus size={12} /> Add files from folder
                </button>
                <button className="btn xs ghost" title="Unlink folder" aria-label={`Unlink ${f.name}`} onClick={() => window.confirm(`Unlink “${f.name}”? Files already added stay in the project.`) && act.unlinkFolder(f.id)}>
                  <Unplug size={12} />
                </button>
              </div>
            )}
            {st === 'needs-permission' && (
              <button className="btn xs primary" style={{ alignSelf: 'flex-start' }} onClick={() => act.reconnectFolder(f.id)}>
                Allow access to {f.name}
              </button>
            )}
            {st === 'unavailable' && (
              <>
                <p className="tiny muted">This folder was linked in another browser or on another computer. Choose the same folder here to reconnect it.</p>
                <button className="btn xs" style={{ alignSelf: 'flex-start' }} onClick={() => relink(f)}>
                  Choose “{f.name}” again
                </button>
              </>
            )}
            {used.length > 0 && <span className="tiny muted">{used.length} file{used.length === 1 ? '' : 's'} in this project</span>}
          </div>
        );
      })}
      <input
        ref={fallback}
        type="file"
        hidden
        webkitdirectory=""
        directory=""
        multiple
        onChange={async (e) => {
          const files = e.target.files;
          if (fallbackFor === 'new') {
            const f = registerPickedFiles(files);
            if (f) await act.linkFolder(f);
          } else if (fallbackFor) await act.reconnectFolder(fallbackFor, files);
          e.target.value = '';
        }}
      />
      {browsing && (
        <FolderBrowser
          folder={browsing}
          list={listFn}
          already={project.assets.filter((a) => a.folderId === browsing.id).map((a) => a.relPath)}
          onAdd={(entries, listing) => act.addLocalFiles(browsing.id, entries, listing)}
          onClose={() => setBrowsing(null)}
        />
      )}
    </div>
  );
}

export default function MediaPanel({ project, urls, folders = {}, act, ops, busy, readOnly }) {
  const refs = useRef({});
  const refAsset = project.assets.find((a) => a.kind === 'reference');
  const ins = project.referenceInsights;

  return (
    <div className="stack">
      <FoldersSection project={project} folders={folders} act={act} readOnly={readOnly} />
      <div className="divider" style={{ margin: '4px 0' }} />
      <p className="tiny muted">Uploads are processed in your browser, then stored privately in your account (up to {MAX_UPLOAD_MB} MB per file). For bigger files, link a folder above.</p>
      {KINDS.map(([kind, label, accept]) => {
        const list = project.assets.filter((a) => a.kind === kind);
        return (
          <div key={kind} className="stack-sm">
            <div className="spread">
              <div className="section-title" style={{ margin: 0 }}>
                {label}
              </div>
              {!readOnly && (
                <button className="btn xs" onClick={() => refs.current[kind].click()}>
                  <Upload size={12} /> Upload
                </button>
              )}
              <input ref={(el) => (refs.current[kind] = el)} type="file" hidden accept={accept} multiple={kind !== 'reference'} onChange={(e) => (act.addFiles([...e.target.files], kind), (e.target.value = ''))} />
            </div>
            {list.length ? (
              list.map((a) => <AssetRow key={a.id} project={project} a={a} urls={urls} act={act} ops={ops} readOnly={readOnly} />)
            ) : (
              <p className="tiny muted">
                {kind === 'footage' && 'Your main talking-head, podcast or product clips.'}
                {kind === 'broll' && 'Cutaways you own or licensed. Attach them to B-roll suggestions.'}
                {kind === 'music' && 'A track you’re licensed to use. Editflow doesn’t ship a music library yet.'}
                {kind === 'reference' && 'A video whose pacing you like and that you have permission to analyse.'}
              </p>
            )}
            {kind === 'reference' && (refAsset?.analysis || project.settings.referenceNotes) && (
              <div className="card tight stack-sm">
                <div className="spread">
                  <b className="small">Style guidance</b>
                  <button className="btn xs" onClick={act.reference} disabled={busy === 'reference'}>
                    {busy === 'reference' && <span className="spinner" style={{ width: 11, height: 11 }} />} {ins ? 'Refresh' : 'Analyse style'}
                  </button>
                </div>
                {ins ? (
                  <div className="tiny text-2 stack-sm">
                    {['structure', 'pacing', 'shotRhythm', 'titleTreatment', 'transitions', 'audioMood'].map((k) =>
                      ins[k] ? (
                        <div key={k}>
                          <b>{k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}:</b> {ins[k]}
                        </div>
                      ) : null,
                    )}
                    {ins.matchPlan?.length > 0 && (
                      <ul style={{ paddingLeft: 16, margin: 0 }}>
                        {ins.matchPlan.map((m, i) => (
                          <li key={i}>{m}</li>
                        ))}
                      </ul>
                    )}
                    <div className="muted">{ins.engine === 'rules' ? 'Measured only · no AI used' : `AI · ${ins.meta?.routedVia || ins.meta?.providerName}`}</div>
                  </div>
                ) : (
                  <p className="tiny muted">The first cut takes these measurements into account when an AI provider is connected.</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
