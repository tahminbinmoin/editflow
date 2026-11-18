import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Undo2, Redo2, History, Download, Pencil } from 'lucide-react';
import { useProject } from '../lib/useProject.js';
import { pendingFiles } from '../lib/pendingFiles.js';
import { useAuth } from '../App.jsx';
import Player from '../components/Player.jsx';
import Timeline from '../components/Timeline.jsx';
import StoryPanel from '../components/StoryPanel.jsx';
import TranscriptPanel from '../components/TranscriptPanel.jsx';
import MediaPanel from '../components/MediaPanel.jsx';
import AIPanel from '../components/AIPanel.jsx';
import EditPanel from '../components/EditPanel.jsx';
import { ConsentModal, Modal, timeAgo } from '../components/ui.jsx';
import { normalizeTimeline, totalDuration, layout } from '@shared/timeline.js';

function HistoryMenu({ project, act, onClose }) {
  const h = project.history;
  return (
    <Modal open title="Edit history" onClose={onClose}>
      <p className="small muted" style={{ marginBottom: 10 }}>
        Every change is saved as a step. Jump back to any version; newer steps stay available until you make a new edit.
      </p>
      <div className="stack-sm" style={{ maxHeight: 420, overflow: 'auto' }}>
        {[...h.entries].reverse().map((e) => {
          const idx = h.entries.indexOf(e);
          const cur = idx === h.index;
          return (
            <div key={e.id} className={`list-item ${cur ? 'on' : ''}`} style={{ opacity: idx > h.index ? 0.55 : 1 }}>
              <div className="spread">
                <div>
                  <div className="small" style={{ fontWeight: 600 }}>
                    {e.label}
                  </div>
                  <div className="tiny muted">
                    {e.source === 'ai' ? 'AI' : e.source === 'rules' ? 'Rule-based' : e.source === 'system' ? 'System' : 'You'} · {timeAgo(e.at)} · {e.clips} clips
                  </div>
                </div>
                {cur ? (
                  <span className="pill ok">Current</span>
                ) : (
                  <button className="btn xs" onClick={() => act.restore(e.id).then(onClose).catch(() => {})}>
                    Restore
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

export default function Studio() {
  const { id } = useParams();
  const nav = useNavigate();
  const { engine } = useAuth();
  const { project, error, ops, act, busy, urls, consent, allowConsent, cancelConsent } = useProject(id);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState(null);
  const [leftTab, setLeftTab] = useState('story');
  const [showHistory, setShowHistory] = useState(false);
  const [preview, setPreview] = useState(true);
  const [renaming, setRenaming] = useState(null);
  const [mobileTab, setMobileTab] = useState('assist');

  const showingPending = !!(project?.pending && preview);
  const timeline = useMemo(() => (project ? normalizeTimeline(showingPending ? project.pending.timeline : project.timeline) : null), [project, showingPending]);
  const mode = project?.mode || 'auto';
  const setMode = (m) => act.setMode(m);

  // Files chosen on the New project page upload here, so progress shows in the Media tab.
  useEffect(() => {
    if (!project || !pendingFiles.has(id)) return;
    const files = pendingFiles.get(id);
    pendingFiles.delete(id);
    setLeftTab('media');
    for (const kind of ['footage', 'broll', 'music', 'reference']) {
      const list = files.filter((f) => f.kind === kind).map((f) => f.file);
      if (list.length) act.addFiles(list, kind);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  useEffect(() => {
    if (timeline) setTime((t) => Math.min(t, totalDuration(timeline)));
  }, [timeline]);
  useEffect(() => {
    if (project?.pending) setPreview(true);
  }, [project?.pending?.id]);

  const undo = useCallback(() => act.undo(), [act]);
  const redo = useCallback(() => act.redo(), [act]);
  const deleteSelected = useCallback(() => {
    if (!selection) return;
    const op = { clip: { type: 'deleteClip', clipId: selection.id }, overlay: { type: 'deleteOverlay', overlayId: selection.id }, broll: { type: 'deleteBroll', brollId: selection.id }, caption: { type: 'deleteCaption', captionId: selection.id } }[selection.type];
    if (op) ops([op], 'Delete');
    setSelection(null);
  }, [selection, ops]);
  const selectAndEdit = (sel) => {
    setSelection(sel);
    if (sel && mode === 'auto') setMode('manual');
  };

  // Keyboard shortcuts (ignored while typing).
  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (showingPending) return;
        e.shiftKey ? redo() : undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (showingPending) {
        return;
      } else if (e.key === 's' && !mod) {
        ops([{ type: 'splitClip', at: time }], 'Split clip');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected();
      } else if (e.key === 'ArrowLeft') {
        setTime((t) => Math.max(0, t - (e.shiftKey ? 1 : 0.1)));
      } else if (e.key === 'ArrowRight') {
        setTime((t) => Math.min(totalDuration(timeline), t + (e.shiftKey ? 1 : 0.1)));
      } else if (e.key === 'Escape') setSelection(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [time, timeline, undo, redo, ops, deleteSelected, showingPending]);

  if (error) return <div className="page"><div className="notice err">{error}</div><Link to="/app">Back to projects</Link></div>;
  if (!project || !timeline) return <div className="page row muted"><span className="spinner" /> Opening studio…</div>;

  const h = project.history;
  const processing = project.assets.filter((a) => a.status === 'processing');
  const seek = (t) => {
    setPlaying(false);
    setTime(t);
  };

  const assist = (
    <AIPanel project={project} engine={engine} act={act} busy={busy} ops={ops} preview={preview} setPreview={setPreview} onSeek={seek} />
  );
  const edit = <EditPanel project={project} timeline={timeline} selection={selection} onSelect={setSelection} ops={ops} time={time} onSeek={seek} readOnly={showingPending} />;
  const leftPanels = {
    story: <StoryPanel project={project} timeline={timeline} time={time} onSeek={seek} selection={selection} onSelect={selectAndEdit} />,
    transcript: <TranscriptPanel project={project} timeline={timeline} time={time} onSeek={seek} ops={ops} act={act} readOnly={showingPending} />,
    media: <MediaPanel project={project} urls={urls} act={act} ops={ops} busy={busy} readOnly={showingPending} />,
  };

  return (
    <div className="studio">
      <div className="studio-top">
        <button className="btn icon ghost" onClick={() => nav('/app')} aria-label="Back to projects">
          <ArrowLeft size={18} />
        </button>
        {renaming != null ? (
          <input
            className="input sm"
            style={{ maxWidth: 280 }}
            autoFocus
            value={renaming}
            onChange={(e) => setRenaming(e.target.value)}
            onBlur={() => {
              if (renaming.trim() && renaming !== project.name) act.rename(renaming.trim());
              setRenaming(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
          />
        ) : (
          <button className="btn ghost sm" onClick={() => setRenaming(project.name)} title="Rename" style={{ fontWeight: 650, fontSize: 15, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {project.name} <Pencil size={12} color="var(--muted)" />
          </button>
        )}
        {project.isSample && <span className="pill warm desktop-only">Sample footage</span>}
        {processing.length > 0 && (
          <span className="pill desktop-only">
            <span className="spinner" style={{ width: 11, height: 11 }} /> Processing {processing.length} file{processing.length > 1 ? 's' : ''}
          </span>
        )}
        {busy && busy !== 'edit' && (
          <span className="pill info">
            <span className="spinner" style={{ width: 11, height: 11 }} /> {busy === 'firstCut' ? 'Planning the cut…' : busy === 'refine' ? 'Working on your request…' : busy === 'transcribing' ? 'Transcribing…' : busy === 'reference' ? 'Analysing style…' : 'Saving…'}
          </span>
        )}
        <div className="grow" />
        <button className="btn icon ghost" onClick={undo} disabled={h.index <= 0 || showingPending} title="Undo (Ctrl/Cmd+Z)" aria-label="Undo">
          <Undo2 size={17} />
        </button>
        <button className="btn icon ghost" onClick={redo} disabled={h.index >= h.entries.length - 1 || showingPending} title="Redo (Shift+Ctrl/Cmd+Z)" aria-label="Redo">
          <Redo2 size={17} />
        </button>
        <button className="btn sm ghost desktop-only" onClick={() => setShowHistory(true)}>
          <History size={15} /> History
        </button>
        <Link to={`/app/p/${id}/export`} className={`btn sm primary ${layout(project.timeline).clips.length ? '' : 'disabled'}`} aria-disabled={!project.timeline.clips.length}>
          <Download size={15} /> Export
        </Link>
      </div>

      <div className="studio-body">
        <aside className="side left">
          <div className="tabs" role="tablist">
            {[
              ['story', 'Story'],
              ['transcript', 'Transcript'],
              ['media', 'Media'],
            ].map(([k, l]) => (
              <button key={k} role="tab" aria-selected={leftTab === k} className={`tab ${leftTab === k ? 'on' : ''}`} onClick={() => setLeftTab(k)}>
                {l}
                {k === 'transcript' && !project.transcript.segments.length && project.assets.some((a) => a.kind === 'footage') ? ' •' : ''}
              </button>
            ))}
          </div>
          <div className="side-scroll">{leftPanels[leftTab]}</div>
        </aside>

        <Player
          urls={urls}
          timeline={timeline}
          assets={project.assets}
          time={time}
          onTime={setTime}
          playing={playing}
          setPlaying={setPlaying}
          badge={showingPending ? <span className="pill warm">Previewing proposal</span> : null}
        />

        <aside className="side right">
          <div className="mode-switch desktop-only" role="tablist" aria-label="Working mode">
            <button className={mode === 'auto' ? 'on' : ''} onClick={() => setMode('auto')} role="tab" aria-selected={mode === 'auto'}>
              Make it for me
            </button>
            <button className={mode === 'manual' ? 'on' : ''} onClick={() => setMode('manual')} role="tab" aria-selected={mode === 'manual'}>
              Let me edit
            </button>
          </div>
          <div className="mobile-only">
            <div className="tabs">
              {[
                ['assist', 'Review & refine'],
                ['edit', 'Quick edits'],
              ].map(([k, l]) => (
                <button key={k} className={`tab ${mobileTab === k ? 'on' : ''}`} onClick={() => setMobileTab(k)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="side-scroll desktop-only">{mode === 'auto' ? assist : edit}</div>
          <div className="side-scroll mobile-only">
            {mobileTab === 'assist' ? assist : edit}
            <p className="tiny muted" style={{ marginTop: 16 }}>
              The full timeline is available on a larger screen.
            </p>
          </div>
        </aside>
      </div>

      <Timeline
        urls={urls}
        timeline={timeline}
        assets={project.assets}
        time={time}
        onSeek={seek}
        selection={selection}
        onSelect={selectAndEdit}
        onDelete={deleteSelected}
        ops={ops}
        readOnly={showingPending}
      />

      {showHistory && <HistoryMenu project={project} act={act} onClose={() => setShowHistory(false)} />}
      <ConsentModal request={consent} onAllow={allowConsent} onCancel={cancelConsent} />
    </div>
  );
}
