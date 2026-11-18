import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Brand } from '../components/ui.jsx';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../App.jsx';

export default function Auth({ mode }) {
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const { refresh, user } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const signup = mode === 'signup';
  const upgrading = signup && user?.isGuest;

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setInfo('');
    setBusy(true);
    try {
      const redirect = `${window.location.origin}/app`;
      if (upgrading) {
        // Turns the guest account into a permanent one; projects stay attached.
        const { error } = await supabase.auth.updateUser({ email: form.email, password: form.password, data: { name: form.name } }, { emailRedirectTo: redirect });
        if (error) throw error;
        setInfo('Check your inbox to confirm your email. Your guest projects are already saved to this account.');
      } else if (signup) {
        if (form.password.length < 8) throw new Error('Use at least 8 characters for your password.');
        const { data, error } = await supabase.auth.signUp({ email: form.email, password: form.password, options: { data: { name: form.name }, emailRedirectTo: redirect } });
        if (error) throw error;
        if (!data.session) {
          setInfo('Check your inbox and click the confirmation link, then sign in.');
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password });
        if (error) throw error;
      }
      if (!upgrading) {
        await refresh();
        nav(params.get('next') || '/app');
      }
    } catch (e2) {
      setErr(e2.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : e2.message);
    } finally {
      setBusy(false);
    }
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <form className="card" style={{ width: 'min(420px, 100%)', padding: 28 }} onSubmit={submit}>
        <Brand />
        <h1 style={{ fontSize: 28, margin: '20px 0 6px' }}>{signup ? (upgrading ? 'Keep your demo work' : 'Create your account') : 'Welcome back'}</h1>
        <p className="muted small" style={{ marginBottom: 20 }}>
          {upgrading ? 'Add an email and password to keep your guest projects.' : signup ? 'Projects are private to your account.' : 'Sign in to your projects.'}
        </p>
        <div className="stack">
          {signup && (
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" className="input" value={form.name} onChange={set('name')} autoComplete="name" />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" required value={form.email} onChange={set('email')} autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="pw">Password</label>
            <input id="pw" className="input" type="password" required minLength={signup ? 8 : 1} value={form.password} onChange={set('password')} autoComplete={signup ? 'new-password' : 'current-password'} />
            {signup && <span className="hint">At least 8 characters.</span>}
          </div>
          {err && <div className="notice err">{err}</div>}
          {info && <div className="notice ok">{info}</div>}
          <button className="btn primary block lg" disabled={busy}>
            {busy && <span className="spinner" />} {signup ? (upgrading ? 'Save my account' : 'Create account') : 'Sign in'}
          </button>
          <p className="small muted" style={{ textAlign: 'center' }}>
            {signup ? (
              <>
                Already have an account? <Link to="/login">Sign in</Link>
              </>
            ) : (
              <>
                New here? <Link to="/signup">Create an account</Link>
              </>
            )}
          </p>
        </div>
      </form>
    </div>
  );
}
