import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ShieldCheck, LogOut, GraduationCap, Plus, Trash2, Download, Sparkles, Star, KeyRound, Upload, Check } from 'lucide-react';
import { Brand, useToast, timeAgo } from '../components/ui.jsx';
import { supabase } from '../lib/supabase.js';
import { api } from '../lib/api.js';
import { listProjects } from '../lib/store.js';
import { CUT_MODES } from '@shared/cleancut.js';
import { useAuth } from '../App.jsx';

/** Only admins get past this; everyone else goes to the admin sign-in. */
export function AdminOnly({ children }) {
  const { loading, user } = useAuth();
  const [ok, setOk] = useState(null);
  useEffect(() => {
    if (!user) return;
    supabase.rpc('is_admin').then(({ data }) => setOk(data === true), () => setOk(false));
  }, [user]);
  if (loading || (user && ok === null)) return <div className="page muted">Loading…</div>;
  if (!user || !ok) return <Navigate to="/admin/login" replace />;
  return children;
}

function Stats({ me, toast }) {
  const [code, setCode] = useState(null);
  const s = me?.stats || {};
  const invite = async () => {
    try {
      setCode((await api('/admin/invites', { method: 'POST' })).code);
    } catch (e) {
      toast(e.message, 'err');
    }
  };
  return (
    <section className="stack">
      <div className="stat-grid">
        {[
          ['Users', s.users],
          ['New this week', s.signups_7d],
          ['Projects', s.projects],
          ['Exported', s.exported],
          ['AI requests (30 days)', s.ai_requests_30d],
          ['Admins', s.admins],
        ].map(([l, v]) => (
          <div key={l} className="card tight">
            <div className="tiny muted">{l}</div>
            <div style={{ fontSize: 26, fontWeight: 700 }}>{v ?? '—'}</div>
          </div>
        ))}
      </div>
      <div className="card tight row wrap" style={{ justifyContent: 'space-between' }}>
        <div className="small">
          <KeyRound size={14} style={{ verticalAlign: -2 }} /> Add another admin with a one-time invite code (valid 7 days).
        </div>
        {code ? (
          <span className="mono" style={{ fontSize: 16 }}>
            {code} <span className="tiny muted">shown once: copy it now</span>
          </span>
        ) : (
          <button className="btn sm" onClick={invite}>
            Create invite code
          </button>
        )}
      </div>
    </section>
  );
}

function AddExample({ type, onAdded, toast }) {
  const [projects, setProjects] = useState(null);
  const [f, setF] = useState({ projectId: '', title: '', notes: '', rating: 5 });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    listProjects()
      .then((ps) => setProjects(ps.filter((p) => !p.isSample)))
      .catch(() => setProjects([]));
  }, []);
  const add = async () => {
    setBusy(true);
    try {
      await api('/admin/examples', { method: 'POST', body: { ...f, editType: type.key } });
      setF({ projectId: '', title: '', notes: '', rating: 5 });
      toast('Example added');
      onAdded();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card tight stack-sm">
      <b className="small">
        <Upload size={14} style={{ verticalAlign: -2 }} /> Add a finished edit
      </b>
      <p className="tiny muted">Edit a {type.label} reel by hand in the studio (signed in with this admin account) until it’s exactly how a pro would cut it, then add it here. If the AI made the first cut, what you changed is recorded too: those corrections teach the most.</p>
      <select className="select sm" value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value, title: f.title || projects.find((p) => p.id === e.target.value)?.name || '' })}>
        <option value="">{projects == null ? 'Loading your projects…' : projects.length ? 'Choose one of your projects' : 'No projects yet: make one first'}</option>
        {(projects || []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {timeAgo(p.updatedAt)}
          </option>
        ))}
      </select>
      <input className="input sm" placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <textarea className="textarea" rows={2} placeholder="What makes this edit good? (e.g. opens on the result, cuts the whole backstory, ends on the punchline)" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      <div className="row">
        <span className="tiny muted">Quality</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" className="btn xs ghost" onClick={() => setF({ ...f, rating: n })} aria-label={`${n} stars`}>
            <Star size={14} fill={n <= f.rating ? 'currentColor' : 'none'} />
          </button>
        ))}
        <div className="grow" />
        <button className="btn sm primary" onClick={add} disabled={!f.projectId || busy}>
          {busy ? <span className="spinner" /> : <Plus size={14} />} Add example
        </button>
      </div>
    </div>
  );
}

function StyleEditor({ type, version, onSaved, toast }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    setD(
      version
        ? { label: version.label, desc: version.description || '', rules: (version.rules || []).join('\n'), targetLength: version.pacing?.targetLength || '', cutMode: version.pacing?.cutMode || '', examples: version.examples || [] }
        : { label: type.label, desc: type.desc || '', rules: '', targetLength: '', cutMode: '', examples: [] },
    );
  }, [version, type]);
  if (!d) return null;
  const save = async (published) => {
    try {
      const row = await api('/admin/styles', {
        method: 'POST',
        body: { key: type.key, label: d.label, desc: d.desc, rules: d.rules.split('\n').map((r) => r.replace(/^[-•\s]+/, '').trim()).filter(Boolean), examples: d.examples, pacing: { targetLength: Number(d.targetLength) || null, cutMode: d.cutMode || null }, published, trainedFrom: version?.trained_from || 0 },
      });
      toast(published ? `Version ${row.version} saved and live` : `Saved as draft version ${row.version}`);
      onSaved(row);
    } catch (e) {
      toast(e.message, 'err');
    }
  };
  return (
    <div className="stack-sm">
      <div className="grid-2">
        <input className="input sm" value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} aria-label="Name" />
        <input className="input sm" value={d.desc} onChange={(e) => setD({ ...d, desc: e.target.value })} placeholder="One-line description" aria-label="Description" />
      </div>
      <label className="tiny muted">Rules the story editor follows (one per line)</label>
      <textarea className="textarea mono" rows={10} value={d.rules} onChange={(e) => setD({ ...d, rules: e.target.value })} placeholder={'Open on the result, never the setup\nCut any line that repeats the hook\nEnd on the payoff, no outro'} />
      <div className="row wrap">
        <span className="tiny muted">Default length</span>
        <input className="input sm" style={{ width: 80 }} type="number" min={5} max={180} value={d.targetLength} onChange={(e) => setD({ ...d, targetLength: e.target.value })} aria-label="Default length" />
        <span className="tiny muted">Pauses</span>
        <select className="select sm" value={d.cutMode} onChange={(e) => setD({ ...d, cutMode: e.target.value })}>
          <option value="">Creator chooses</option>
          {Object.entries(CUT_MODES).map(([k, m]) => (
            <option key={k} value={k}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      {d.examples.length > 0 && (
        <details className="disclosure">
          <summary>{d.examples.length} worked example{d.examples.length > 1 ? 's' : ''} included in the prompt</summary>
          {d.examples.map((e, i) => (
            <div key={i} className="tiny text-2" style={{ marginTop: 6 }}>
              <b>{e.title || `Example ${i + 1}`}</b>: {e.why}
            </div>
          ))}
        </details>
      )}
      <div className="row wrap">
        <button className="btn sm" onClick={() => save(false)}>
          Save as draft
        </button>
        <button className="btn sm primary" onClick={() => save(true)}>
          <Check size={14} /> Save and publish
        </button>
      </div>
    </div>
  );
}

function TypeDetail({ type, reload, toast }) {
  const [examples, setExamples] = useState(null);
  const [busy, setBusy] = useState(null);
  const [selected, setSelected] = useState(null);
  const loadExamples = useCallback(() => api(`/admin/examples/${type.key}`).then((r) => setExamples(r.examples), (e) => toast(e.message, 'err')), [type.key, toast]);
  useEffect(() => {
    setExamples(null);
    setSelected(type.versions[0] || null);
    loadExamples();
  }, [type.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSelected((cur) => type.versions.find((v) => v.id === cur?.id) || type.versions[0] || null);
  }, [type.versions]);

  const train = async () => {
    setBusy('train');
    try {
      const r = await api('/admin/train', { method: 'POST', body: { key: type.key } });
      toast(`Trained draft version ${r.style.version} from ${r.style.trained_from} example${r.style.trained_from > 1 ? 's' : ''}. Review it, then publish.`);
      await reload();
      setSelected(r.style);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy(null);
    }
  };
  const publish = async (v, on) => {
    try {
      await api(`/admin/styles/${v.id}/publish`, { method: 'POST', body: { published: on } });
      toast(on ? `Version ${v.version} is live` : `Version ${v.version} unpublished`);
      reload();
    } catch (e) {
      toast(e.message, 'err');
    }
  };
  const remove = async (ex) => {
    if (!window.confirm(`Remove the example “${ex.title}”?`)) return;
    await api(`/admin/examples/${ex.id}`, { method: 'DELETE' }).catch((e) => toast(e.message, 'err'));
    loadExamples();
    reload();
  };
  const dataset = async () => {
    try {
      const r = await api(`/admin/dataset/${type.key}`);
      if (!r.count) return toast('Add examples first', 'err');
      const url = URL.createObjectURL(new Blob([r.jsonl + '\n'], { type: 'application/jsonl' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: r.filename });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      toast(e.message, 'err');
    }
  };
  const live = type.versions.find((v) => v.published);

  return (
    <div className="stack">
      <div>
        <h2 style={{ fontSize: 22 }}>{type.label}</h2>
        <p className="small text-2">{type.desc}</p>
        <p className="tiny muted">
          {live ? `Live: version ${live.version}${live.trained_from ? `, trained from ${live.trained_from} example${live.trained_from > 1 ? 's' : ''}` : ''}. Every creator’s ${type.label} first cut follows it.` : 'No house style is live yet: creators get the general reel rules.'}
        </p>
      </div>

      <section className="card stack-sm">
        <div className="spread">
          <b>
            1 · Examples <span className="muted">({examples?.length ?? '…'})</span>
          </b>
          <button className="btn xs ghost" onClick={dataset} title="Chat-format JSONL for an OpenAI fine-tuning job">
            <Download size={13} /> Fine-tuning data (JSONL)
          </button>
        </div>
        {(examples || []).map((ex) => {
          const d = ex.data || {};
          const kept = (d.lines || []).filter((l) => l.kept).length;
          return (
            <div key={ex.id} className="example-row">
              <div className="grow">
                <div className="small">
                  <b>{ex.title || 'Untitled'}</b> <span className="tiny muted">{'★'.repeat(ex.rating || 0)}</span>
                </div>
                <div className="tiny text-2">
                  {d.duration}s · kept {kept} of {(d.lines || []).length} lines · {d.cutsPerMinute} cuts/min{d.hook ? ` · hook: “${d.hook.text.slice(0, 70)}”` : ''}
                </div>
                {d.aiDiff && (
                  <div className="tiny muted">
                    Corrected the AI: +{d.aiDiff.added.length} / −{d.aiDiff.removed.length} lines{d.aiDiff.hookChanged ? ', new hook' : ''}
                    {d.aiDiff.reordered ? ', reordered' : ''}
                  </div>
                )}
                {ex.notes && <div className="tiny muted">“{ex.notes}”</div>}
              </div>
              <button className="btn xs ghost" onClick={() => remove(ex)} aria-label="Remove example">
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
        <AddExample type={type} toast={toast} onAdded={() => (loadExamples(), reload())} />
      </section>

      <section className="card stack-sm">
        <div className="spread">
          <b>2 · Train the house style</b>
          <button className="btn sm primary" onClick={train} disabled={busy === 'train' || !examples?.length}>
            {busy === 'train' ? <span className="spinner" /> : <Sparkles size={14} />} Train from {examples?.length || 0} example{examples?.length === 1 ? '' : 's'}
          </button>
        </div>
        <p className="tiny muted">
          Your active AI (ChatGPT or Claude, set in AI settings) studies the examples and writes the rules a pro follows for this type of reel, plus the most useful worked examples. The result is a draft: check it, edit it, then publish. This teaches through the prompt; it doesn’t retrain ChatGPT or Claude themselves. For that, download the fine-tuning data above.
        </p>
      </section>

      <section className="card stack-sm">
        <b>3 · Versions</b>
        {type.versions.length === 0 && <p className="tiny muted">No versions yet. Train one, or write the rules yourself below.</p>}
        <div className="chips">
          {type.versions.map((v) => (
            <button key={v.id} className={`chip ${selected?.id === v.id ? 'on' : ''}`} onClick={() => setSelected(v)}>
              v{v.version} {v.published ? '· live' : '· draft'}
            </button>
          ))}
        </div>
        {selected && (
          <div className="row wrap tiny muted">
            Version {selected.version} · {timeAgo(selected.created_at)}
            {selected.trained_from ? ` · trained from ${selected.trained_from} examples` : ' · written by hand'}
            <div className="grow" />
            {selected.published ? (
              <button className="btn xs" onClick={() => publish(selected, false)}>
                Unpublish
              </button>
            ) : (
              <button className="btn xs primary" onClick={() => publish(selected, true)}>
                Publish v{selected.version}
              </button>
            )}
          </div>
        )}
        <StyleEditor type={type} version={selected} toast={toast} onSaved={(row) => (reload(), setSelected(row))} />
      </section>
    </div>
  );
}

export default function Admin() {
  const toast = useToast();
  const nav = useNavigate();
  const { user } = useAuth();
  const [me, setMe] = useState(null);
  const [types, setTypes] = useState(null);
  const [current, setCurrent] = useState(null);
  const [newType, setNewType] = useState(null);

  const reload = useCallback(async () => {
    const r = await api('/admin/styles');
    setTypes(r.types);
    return r.types;
  }, []);
  useEffect(() => {
    api('/admin/me').then(setMe, (e) => toast(e.message, 'err'));
    reload().then((t) => setCurrent((c) => c || t[0]?.key), (e) => toast(e.message, 'err'));
  }, [reload, toast]);
  const type = useMemo(() => types?.find((t) => t.key === current), [types, current]);

  const createType = async () => {
    const key = newType.label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    if (!key) return;
    try {
      await api('/admin/styles', { method: 'POST', body: { key, label: newType.label, desc: newType.desc, rules: [], published: false } });
      setNewType(null);
      await reload();
      setCurrent(key);
    } catch (e) {
      toast(e.message, 'err');
    }
  };
  const signOut = async () => {
    await supabase.auth.signOut();
    nav('/admin/login');
  };

  return (
    <div className="admin">
      <header className="admin-top">
        <Brand />
        <span className="pill warm">
          <ShieldCheck size={12} /> Admin
        </span>
        <div className="grow" />
        <span className="tiny muted desktop-only">{user?.email}</span>
        <Link className="btn sm ghost" to="/app">
          Creator app
        </Link>
        <button className="btn sm ghost" onClick={signOut}>
          <LogOut size={14} /> Sign out
        </button>
      </header>
      <main className="page stack-lg">
        <Stats me={me} toast={toast} />
        <div>
          <h1 style={{ fontSize: 28 }}>
            <GraduationCap size={24} style={{ verticalAlign: -3 }} /> Training studio
          </h1>
          <p className="small text-2">Teach the AI how professional editors cut each type of reel. Published house styles are used in every creator’s first cut for that type.</p>
        </div>
        <div className="admin-split">
          <aside className="stack-sm">
            {(types || []).map((t) => (
              <button key={t.key} className={`choice ${current === t.key ? 'on' : ''}`} onClick={() => setCurrent(t.key)} style={{ alignItems: 'flex-start', textAlign: 'left' }}>
                <b className="small">{t.label}</b>
                <span className="tiny muted">
                  {t.examples} example{t.examples === 1 ? '' : 's'} · {t.published ? `v${t.published.version} live` : 'no house style'}
                </span>
              </button>
            ))}
            {newType ? (
              <div className="card tight stack-sm">
                <input className="input sm" autoFocus placeholder="Name, e.g. Real estate tour" value={newType.label} onChange={(e) => setNewType({ ...newType, label: e.target.value })} />
                <input className="input sm" placeholder="What this reel does" value={newType.desc} onChange={(e) => setNewType({ ...newType, desc: e.target.value })} />
                <div className="row">
                  <button className="btn xs primary" onClick={createType} disabled={!newType.label.trim()}>
                    Add
                  </button>
                  <button className="btn xs ghost" onClick={() => setNewType(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn sm ghost" onClick={() => setNewType({ label: '', desc: '' })}>
                <Plus size={14} /> New type of reel
              </button>
            )}
          </aside>
          <div>{type ? <TypeDetail type={type} reload={reload} toast={toast} /> : <p className="muted">Loading…</p>}</div>
        </div>
      </main>
    </div>
  );
}
