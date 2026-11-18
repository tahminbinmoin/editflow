import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { supabase } from './lib/supabase.js';
import { api } from './lib/api.js';
import { ToastProvider } from './components/ui.jsx';
import Landing from './pages/Landing.jsx';
import Auth from './pages/Auth.jsx';
import Dashboard from './pages/Dashboard.jsx';
import NewProject from './pages/NewProject.jsx';
import Studio from './pages/Studio.jsx';
import ExportPage from './pages/Export.jsx';
import Settings from './pages/Settings.jsx';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

const toUser = (u) => (u ? { id: u.id, email: u.email, isGuest: !!u.is_anonymous } : null);

function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, engine: null });

  const loadEngine = useCallback(async () => {
    try {
      const engine = await api('/engine');
      setState((s) => ({ ...s, engine }));
      return engine;
    } catch {
      // API unreachable (or not deployed): everything still works in rule-based mode.
      setState((s) => ({ ...s, engine: { id: 'rules', name: 'Rule-based (no AI)', fallbackReason: null } }));
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setState((s) => ({ ...s, loading: false, user: toUser(data.session?.user) }));
      if (data.session) loadEngine();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState((s) => ({ ...s, loading: false, user: toUser(session?.user) }));
    });
    return () => sub.subscription.unsubscribe();
  }, [loadEngine]);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    setState((s) => ({ ...s, user: toUser(data.session?.user) }));
    if (data.session) await loadEngine();
  }, [loadEngine]);

  return <AuthCtx.Provider value={{ ...state, refresh, refreshEngine: loadEngine }}>{children}</AuthCtx.Provider>;
}

function Private({ children }) {
  const { loading, user } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="page muted">Loading…</div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Auth mode="login" />} />
            <Route path="/signup" element={<Auth mode="signup" />} />
            <Route path="/app" element={<Private><Dashboard /></Private>} />
            <Route path="/app/new" element={<Private><NewProject /></Private>} />
            <Route path="/app/settings" element={<Private><Settings /></Private>} />
            <Route path="/app/p/:id" element={<Private><Studio /></Private>} />
            <Route path="/app/p/:id/export" element={<Private><ExportPage /></Private>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
