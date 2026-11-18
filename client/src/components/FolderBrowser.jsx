import { useEffect, useMemo, useState } from 'react';
import { Film, Music, FileText, RefreshCw } from 'lucide-react';
import { Modal, bytes, timeAgo } from './ui.jsx';

const KIND_OPTIONS = [
  ['footage', 'Footage'],
  ['broll', 'B-roll'],
  ['music', 'Music'],
  ['reference', 'Reference'],
];

/** Pick files from a linked folder. `list()` returns [{ relPath, name, size, lastModified, kind }]. */
export function FolderFileList({ list, onChange, already = [] }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [sel, setSel] = useState({}); // relPath → kind
  const load = () => {
    setItems(null);
    setError(null);
    list()
      .then(setItems)
      .catch((e) => setError(e.message));
  };
  useEffect(load, [list]);
  useEffect(() => onChange?.(Object.entries(sel).map(([relPath, kind]) => ({ relPath, kind })), items || []), [sel, items]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => (items || []).filter((f) => f.kind !== 'subtitle' && f.relPath.toLowerCase().includes(filter.toLowerCase())), [items, filter]);
  const subs = new Set((items || []).filter((f) => f.kind === 'subtitle').map((f) => f.relPath.replace(/\.[^./]+$/, '').toLowerCase()));

  if (error) return <div className="notice err">{error}</div>;
  if (!items) return <div className="row muted small"><span className="spinner" /> Reading the folder…</div>;
  if (!shown.length && !filter) return <p className="small muted">No video or audio files found in this folder (or its subfolders).</p>;
  return (
    <div className="stack-sm">
      <div className="row">
        <input className="input sm" placeholder="Filter by name…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button type="button" className="btn icon ghost" onClick={load} aria-label="Refresh folder" title="Refresh">
          <RefreshCw size={15} />
        </button>
      </div>
      <div className="stack-sm" style={{ maxHeight: 340, overflow: 'auto' }}>
        {shown.map((f) => {
          const on = f.relPath in sel;
          const isAudio = f.kind === 'audio';
          const hasSub = subs.has(f.relPath.replace(/\.[^./]+$/, '').toLowerCase());
          const added = already.includes(f.relPath);
          return (
            <label key={f.relPath} className="file-row" style={{ cursor: added ? 'default' : 'pointer', opacity: added ? 0.55 : 1 }}>
              <input
                type="checkbox"
                className="check"
                disabled={added}
                checked={on}
                onChange={(e) => {
                  const next = { ...sel };
                  if (e.target.checked) next[f.relPath] = isAudio ? 'music' : 'footage';
                  else delete next[f.relPath];
                  setSel(next);
                }}
                style={{ accentColor: 'var(--accent)', width: 16, height: 16 }}
              />
              {isAudio ? <Music size={15} color="var(--muted)" /> : <Film size={15} color="var(--muted)" />}
              <div className="grow" style={{ minWidth: 0 }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.relPath}>
                  {f.relPath}
                </div>
                <div className="tiny muted">
                  {bytes(f.size)} · {timeAgo(new Date(f.lastModified).toISOString())}
                  {hasSub && (
                    <span className="pill info" style={{ marginLeft: 6 }}>
                      <FileText size={10} /> captions found
                    </span>
                  )}
                  {added && <span className="pill" style={{ marginLeft: 6 }}>added</span>}
                </div>
              </div>
              {on && (
                <select className="select sm" style={{ width: 120 }} value={sel[f.relPath]} onClick={(e) => e.preventDefault()} onChange={(e) => setSel({ ...sel, [f.relPath]: e.target.value })} aria-label={`Use ${f.name} as`}>
                  {KIND_OPTIONS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              )}
            </label>
          );
        })}
        {!shown.length && <p className="small muted">No files match “{filter}”.</p>}
      </div>
    </div>
  );
}

export default function FolderBrowser({ folder, list, already, onAdd, onClose }) {
  const [picked, setPicked] = useState([]);
  const [listing, setListing] = useState([]);
  return (
    <Modal open wide title={`Add files from “${folder.name}”`} onClose={onClose}>
      <div className="stack">
        <p className="small muted">Files stay on this computer. Editflow reads them in your browser; only a small thumbnail and waveform are saved to your account. Caption files with the same name (.srt or .vtt) are imported automatically.</p>
        <FolderFileList
          list={list}
          already={already}
          onChange={(p, l) => {
            setPicked(p);
            setListing(l);
          }}
        />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!picked.length}
            onClick={() => {
              onAdd(picked, listing);
              onClose();
            }}
          >
            Add {picked.length || ''} file{picked.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
