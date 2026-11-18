import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { BRAND } from '../lib/brand.js';
import { Link } from 'react-router-dom';

export function Brand({ to = '/' }) {
  return (
    <Link to={to} className="brand">
      <span className="brand-mark">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <path d="M3 4h10M3 8h6M3 12h8" stroke="#1b0a06" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </span>
      <span className="brand-name">{BRAND}</span>
    </Link>
  );
}

export function Modal({ open, onClose, title, children, wide }) {
  useEffect(() => {
    if (!open) return;
    const k = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={wide ? { width: 'min(760px,100%)' } : undefined}>
        <div className="spread" style={{ marginBottom: 14 }}>
          <h3 style={{ fontSize: 21 }}>{title}</h3>
          {onClose && (
            <button className="btn icon ghost" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, kind = 'info') => {
    const id = Math.random();
    setItems((x) => [...x, { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'err' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function Progress({ value }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round((value || 0) * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${Math.max(2, Math.round((value || 0) * 100))}%` }} />
    </div>
  );
}

export function RolePill({ role }) {
  if (!role) return null;
  return (
    <span className="role" style={{ color: `var(--role-${role})` }}>
      <span className="dot" />
      {role === 'cta' ? 'Call to action' : role}
    </span>
  );
}

export function EngineBadge({ meta }) {
  if (!meta) return null;
  if (meta.engine === 'rules') return <span className="pill">Rule-based · no AI used</span>;
  return (
    <span className="pill info" title={meta.usage ? `${meta.usage.input ?? '?'} in / ${meta.usage.output ?? '?'} out tokens` : ''}>
      AI · {meta.routedVia || meta.model || meta.providerName}
      {meta.provider === 'freellmapi' ? ' via FreeLLMAPI' : ''}
    </span>
  );
}

/** Asks before any transcript/audio leaves the machine. */
export function ConsentModal({ request, onAllow, onCancel }) {
  if (!request) return null;
  const p = request.provider || {};
  const audio = p.id === 'groq';
  return (
    <Modal open title={`Send this project to ${p.name}?`} onClose={onCancel}>
      <div className="stack">
        <p className="text-2">
          {audio
            ? 'To transcribe, Editflow uploads a compressed copy of this file’s audio track (not the video) to Groq.'
            : 'To plan the edit, Editflow sends this project’s transcript text, your brief (audience, goal, notes) and any measured reference stats. Your video files are never sent.'}
        </p>
        <div className="notice warm">{p.dataUse}</div>
        <p className="small muted">This choice is saved for this project only. You can switch to rule-based mode (no AI, nothing sent) in Settings at any time.</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" onClick={onAllow}>
            Allow for this project
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function Empty({ icon, title, children, action }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: 28 }}>
      {icon && <div style={{ color: 'var(--warm)', marginBottom: 10, display: 'flex', justifyContent: 'center' }}>{icon}</div>}
      <h4 style={{ fontSize: 17, marginBottom: 6 }}>{title}</h4>
      <div className="small muted">{children}</div>
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export const timeAgo = (iso) => {
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return d.toLocaleDateString();
};

export const bytes = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round((n || 0) / 1e3)} KB`);
