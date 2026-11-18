import { NavLink, useNavigate } from 'react-router-dom';
import { Brand } from './ui.jsx';
import { useAuth } from '../App.jsx';
import { supabase } from '../lib/supabase.js';

export default function AppHeader() {
  const { user, engine, refresh } = useAuth();
  const nav = useNavigate();
  return (
    <header className="topbar">
      <Brand to="/app" />
      <nav className="row" style={{ marginLeft: 12 }}>
        <NavLink to="/app" end className="navlink">
          Projects
        </NavLink>
        <NavLink to="/app/settings" className="navlink">
          AI settings
        </NavLink>
      </nav>
      <div className="grow" />
      {engine && (
        <NavLink to="/app/settings" className={`pill ${engine.id === 'rules' ? '' : 'info'} desktop-only`} style={{ textDecoration: 'none' }} title="Which engine plans your edits">
          <span className="dot" style={{ color: engine.id === 'rules' ? 'var(--muted)' : 'var(--ok)' }} />
          {engine.id === 'rules' ? 'Rule-based mode (no AI)' : `${engine.name}${engine.model ? ` · ${engine.model}` : ''}`}
        </NavLink>
      )}
      <span className="small muted desktop-only">{user?.isGuest ? 'Guest demo' : user?.email}</span>
      <button
        className="btn sm ghost"
        onClick={async () => {
          await supabase.auth.signOut();
          await refresh();
          nav('/');
        }}
      >
        {user?.isGuest ? 'Leave demo' : 'Sign out'}
      </button>
    </header>
  );
}
