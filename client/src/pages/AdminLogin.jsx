import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { Brand } from '../components/ui.jsx';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../App.jsx';

/**
 * Separate sign-in for Editflow admins. Admin accounts are ordinary accounts that claimed a
 * one-time invite code (nobody can make themselves an admin). A creator account that isn't an
 * admin is signed out again here.
 */
export default function AdminLogin() {
  const [mode, setMode] = useState('login'); // 'login' | 'create'
  const [form, setForm] = useState({ email: '', password: '', code: '' });
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const { refresh } = useAuth();
  const nav = useNavigate();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setInfo('');
    setBusy(true);
    try {
      if (mode === 'create') {
        if (form.password.length < 12) throw new Error('Admin passwords need at least 12 characters.');
        if (!form.code.trim()) throw new Error('Enter your admin invite code.');
        const { data, error } = await supabase.auth.signUp({ email: form.email, password: form.password, options: { emailRedirectTo: `${window.location.origin}/admin/login` } });
        if (error) throw error;
        if (!data.session) {
          setInfo('Confirm your email from the link we sent, then sign in here with the same invite code.');
          setMode('login');
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password });
        if (error) throw error;
      }
      if (form.code.trim()) {
        const { error } = await supabase.rpc('claim_admin', { code: form.code.trim() });
        if (error) throw new Error(error.message);
      }
      const { data: isAdmin } = await supabase.rpc('is_admin');
      if (isAdmin !== true) {
        await supabase.auth.signOut();
        throw new Error('This account isn’t an Editflow admin. Use your admin account, or enter an invite code.');
      }
      await refresh();
      nav('/admin');
    } catch (e2) {
      setErr(e2.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <form className="card" style={{ width: 'min(420px, 100%)', padding: 28 }} onSubmit={submit}>
        <Brand />
        <h1 style={{ fontSize: 26, margin: '20px 0 6px' }}>
          <ShieldCheck size={22} style={{ verticalAlign: -3 }} /> {mode === 'create' ? 'Create an admin account' : 'Admin sign-in'}
        </h1>
        <p className="muted small" style={{ marginBottom: 20 }}>
          {mode === 'create' ? 'Use a separate email from your creator account. You need a one-time invite code.' : 'For the Editflow team: training the AI on professional edits.'}
        </p>
        <div className="stack">
          <div className="field">
            <label htmlFor="aemail">Admin email</label>
            <input id="aemail" className="input" type="email" required value={form.email} onChange={set('email')} autoComplete="username" />
          </div>
          <div className="field">
            <label htmlFor="apw">Password</label>
            <input id="apw" className="input" type="password" required minLength={mode === 'create' ? 12 : 1} value={form.password} onChange={set('password')} autoComplete={mode === 'create' ? 'new-password' : 'current-password'} />
            {mode === 'create' && <span className="hint">At least 12 characters.</span>}
          </div>
          <div className="field">
            <label htmlFor="acode">Invite code {mode === 'login' && <span className="muted">(first sign-in only)</span>}</label>
            <input id="acode" className="input mono" value={form.code} onChange={set('code')} placeholder="XXXX-XXXX-XXXX" autoComplete="off" />
          </div>
          {err && <div className="notice err">{err}</div>}
          {info && <div className="notice ok">{info}</div>}
          <button className="btn primary block lg" disabled={busy}>
            {busy && <span className="spinner" />} {mode === 'create' ? 'Create admin account' : 'Sign in'}
          </button>
          <p className="small muted" style={{ textAlign: 'center' }}>
            {mode === 'create' ? (
              <button type="button" className="btn ghost sm" onClick={() => setMode('login')}>
                I already have an admin account
              </button>
            ) : (
              <button type="button" className="btn ghost sm" onClick={() => setMode('create')}>
                I have an invite code: create an admin account
              </button>
            )}
          </p>
          <p className="tiny muted" style={{ textAlign: 'center' }}>
            Creators sign in at <Link to="/login">the normal sign-in page</Link>.
          </p>
        </div>
      </form>
    </div>
  );
}
