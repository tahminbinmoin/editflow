import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, KeyRound, ExternalLink, Server, ShieldCheck } from 'lucide-react';
import AppHeader from '../components/AppHeader.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../App.jsx';
import { useToast } from '../components/ui.jsx';

function ProviderCard({ p, active, onChange, onActivate }) {
  const [cfg, setCfg] = useState(p.config);
  const [key, setKey] = useState('');
  const [models, setModels] = useState(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(p.lastTest);
  const toast = useToast();
  useEffect(() => setCfg(p.config), [p.config]);

  const save = async () => {
    try {
      const res = await api(`/settings/ai/${p.id}`, { method: 'PUT', body: { config: cfg, key: key || undefined } });
      setKey('');
      onChange(res);
      toast('Saved');
      return true;
    } catch (e) {
      toast(e.message, 'err');
      return false;
    }
  };
  const test = async () => {
    if (!(await save())) return;
    setTesting(true);
    try {
      const r = await api(`/settings/ai/${p.id}/test`, { method: 'POST' });
      setResult(r.lastTest);
      setModels(r.models?.length ? r.models : null);
    } catch (e) {
      setResult({ ok: false, message: e.message });
    } finally {
      setTesting(false);
    }
  };

  const tone = { free: 'ok', paid: 'warm', mixed: 'info' }[p.billing.tone];
  return (
    <div className="card stack" style={active ? { borderColor: 'var(--accent)' } : undefined}>
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="row wrap">
            <h3 style={{ fontSize: 19 }}>{p.name}</h3>
            {p.recommended && <span className="pill accent">Recommended for free prototyping</span>}
            {active && <span className="pill ok">Active</span>}
          </div>
          <p className="small muted" style={{ marginTop: 4 }}>
            {p.tagline}
          </p>
        </div>
        <span className={`pill ${tone}`}>{p.billing.label}</span>
      </div>
      <p className="small text-2">{p.billing.detail}</p>
      <div className="notice warm tiny">
        <b>Data use:</b> {p.dataUse}
      </div>
      {p.id === 'freellmapi' && (
        <details className="disclosure">
          <summary>How to set up FreeLLMAPI (5 minutes)</summary>
          <ol className="small text-2" style={{ paddingLeft: 18, margin: 0 }}>
            <li>
              Run FreeLLMAPI from{' '}
              <a href="https://github.com/tashfeenahmed/freellmapi" target="_blank" rel="noreferrer">
                github.com/tashfeenahmed/freellmapi <ExternalLink size={11} />
              </a>
              . On this hosted app it must have a public https address (for example on a small server you control). <code>localhost</code> only works when you run Editflow on your own computer.
            </li>
            <li>In its dashboard, add free-tier keys from providers whose terms you accept (Groq, Google AI Studio, Mistral, OpenRouter…), and order the fallback chain.</li>
            <li>Copy the unified key (starts with <code>freellmapi-</code>) and paste it below, then click Test.</li>
            <li>Use <code>auto:smart</code> for edit plans: structured JSON needs a capable model.</li>
          </ol>
        </details>
      )}
      <div className="grid-2">
        {p.fields.map((f) => (
          <div className="field" key={f.key}>
            <label htmlFor={`${p.id}-${f.key}`}>{f.label}</label>
            {f.key === 'model' && models ? (
              <select id={`${p.id}-${f.key}`} className="select sm" value={cfg[f.key] || ''} onChange={(e) => setCfg({ ...cfg, [f.key]: e.target.value })}>
                <option value="">Choose a model…</option>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input id={`${p.id}-${f.key}`} className="input sm" placeholder={f.placeholder} value={cfg[f.key] || ''} onChange={(e) => setCfg({ ...cfg, [f.key]: e.target.value })} />
            )}
            <span className="hint">{f.help}</span>
          </div>
        ))}
        <div className="field">
          <label htmlFor={`${p.id}-key`}>
            <KeyRound size={12} style={{ verticalAlign: -1 }} /> {p.secretLabel}
          </label>
          <input id={`${p.id}-key`} className="input sm" type="password" autoComplete="off" placeholder={p.hasKey ? `Saved (${p.keyMasked}). Paste to replace` : 'Paste key'} value={key} onChange={(e) => setKey(e.target.value)} />
          <span className="hint">Encrypted on the server. Never sent back to the browser.</span>
        </div>
      </div>
      {result && (
        <div className={`notice ${result.ok ? 'ok' : 'err'}`}>
          {result.ok ? <CheckCircle2 size={14} style={{ verticalAlign: -2 }} /> : <XCircle size={14} style={{ verticalAlign: -2 }} />} {result.message}
        </div>
      )}
      <div className="row wrap">
        <button className="btn sm" onClick={save}>
          Save
        </button>
        <button className="btn sm" onClick={test} disabled={testing || (!p.hasKey && !key)}>
          {testing && <span className="spinner" />} Test connection{p.id !== 'freellmapi' ? ' & load models' : ''}
        </button>
        {!active && (
          <button className="btn sm primary" onClick={() => onActivate(p.id)} disabled={!p.ready}>
            Use for edit planning
          </button>
        )}
        {p.hasKey && (
          <button
            className="btn sm ghost danger"
            onClick={async () => {
              onChange(await api(`/settings/ai/${p.id}/key`, { method: 'DELETE' }));
            }}
          >
            Remove key
          </button>
        )}
      </div>
    </div>
  );
}

export default function Settings() {
  const [data, setData] = useState(null);
  const [groqKey, setGroqKey] = useState('');
  const { refresh } = useAuth();
  const toast = useToast();
  const load = () => api('/settings/ai').then(setData);
  useEffect(() => {
    load();
  }, []);
  const activate = async (id) => {
    try {
      setData({ ...data, ...(await api('/settings/ai-active', { method: 'PUT', body: { active: id } })) });
      refresh();
      toast(id === 'rules' ? 'Switched to rule-based mode' : 'Provider activated');
    } catch (e) {
      toast(e.message, 'err');
    }
  };
  if (!data) return <><AppHeader /><div className="page muted">Loading…</div></>;
  const active = data.prefs.active;
  const groq = data.transcribers.find((t) => t.id === 'groq');

  return (
    <>
      <AppHeader />
      <main className="page narrow stack-lg">
        <div>
          <h1 style={{ fontSize: 32 }}>AI settings</h1>
          <p className="muted" style={{ marginTop: 6 }}>
            Choose what plans your edits. Every provider sits behind the same adapter, so you can switch at any time. Editflow asks before sending a project’s transcript anywhere, and it never sends video files to a language model.
          </p>
        </div>

        <div className="card stack" style={active === 'rules' ? { borderColor: 'var(--accent)' } : undefined}>
          <div className="spread">
            <div className="row">
              <ShieldCheck color="var(--ok)" />
              <h3 style={{ fontSize: 19 }}>Rule-based mode (no AI)</h3>
              {active === 'rules' && <span className="pill ok">Active</span>}
            </div>
            <span className="pill ok">No cost · nothing leaves the server</span>
          </div>
          <p className="small text-2">
            Drafts a first cut with simple, transparent rules: it scores lines for hook strength (questions, numbers, “you”), keeps the story in order, trims pauses and finds a call to action. Results are always labelled “rule-based”, never presented as AI analysis.
          </p>
          {active !== 'rules' && (
            <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => activate('rules')}>
              Use rule-based mode
            </button>
          )}
        </div>

        {data.providers.map((p) => (
          <ProviderCard key={p.id} p={p} active={active === p.id} onChange={(res) => setData({ ...data, ...res })} onActivate={activate} />
        ))}

        <div className="card stack">
          <div className="spread">
            <h3 style={{ fontSize: 19 }}>Transcription</h3>
            <span className="pill info">Speech to text</span>
          </div>
          <div className="stack-sm small text-2">
            <div>
              <b>On this device (experimental):</b> runs Whisper in your browser with Transformers.js. It’s free and private, but it downloads a speech model once (about 80 MB) and is slower on long clips.
            </div>
            <div>
              <b>Import:</b> .srt or .vtt caption files give exact timing. Plain text gets estimated timing. Nothing is uploaded.
            </div>
            <div>
              <b>{groq.name}:</b> {groq.billing} {groq.dataUse} If you already added a Groq key to FreeLLMAPI, you can reuse it here.
            </div>
          </div>
          <div className="row">
            <input className="input sm" type="password" autoComplete="off" placeholder={groq.hasKey ? `Saved (${groq.keyMasked}). Paste to replace` : 'Groq API key (gsk_…)'} value={groqKey} onChange={(e) => setGroqKey(e.target.value)} />
            <button
              className="btn sm"
              disabled={!groqKey}
              onClick={async () => {
                setData({ ...data, ...(await api('/settings/ai/groq', { method: 'PUT', body: { key: groqKey } })) });
                setGroqKey('');
                toast('Groq key saved');
              }}
            >
              Save
            </button>
            {groq.hasKey && (
              <button className="btn sm ghost danger" onClick={async () => setData({ ...data, ...(await api('/settings/ai/groq/key', { method: 'DELETE' })) })}>
                Remove
              </button>
            )}
          </div>
        </div>

        <div className="card stack">
          <h3 style={{ fontSize: 19 }}>Usage (last 30 days)</h3>
          {data.usage.length === 0 ? (
            <p className="small muted">No AI requests yet.</p>
          ) : (
            <table className="small" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr className="muted" style={{ textAlign: 'left' }}>
                  <th>Provider</th>
                  <th>Requests</th>
                  <th>Succeeded</th>
                  <th>Tokens in / out</th>
                </tr>
              </thead>
              <tbody>
                {data.usage.map((u) => (
                  <tr key={u.provider}>
                    <td>{u.provider}</td>
                    <td className="mono">{u.requests}</td>
                    <td className="mono">{u.ok}</td>
                    <td className="mono">
                      {u.input_tokens.toLocaleString()} / {u.output_tokens.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="tiny muted">Token counts are as reported by the provider. Check each provider’s dashboard for quota and billing. FreeLLMAPI’s dashboard shows the free-tier budget left per key.</p>
        </div>

        <div className="card stack">
          <div className="row">
            <Server size={18} color="var(--warm)" />
            <h3 style={{ fontSize: 19 }}>Before real customers use this</h3>
          </div>
          <ul className="small text-2" style={{ paddingLeft: 18, margin: 0 }}>
            <li>FreeLLMAPI is labelled by its authors as for personal experimentation, and provider free tiers generally forbid sharing your endpoint or reselling access. Switch to paid API keys (or a provider’s commercial terms) before serving paying users.</li>
            <li>Each user adds their own keys here. Don’t give everyone access to one shared free-tier router.</li>
            <li>Supabase’s Free plan limits files to 50 MB and pauses idle projects; upgrade before regular use.</li>
            <li>Turn on email confirmation with a proper SMTP sender, and add CAPTCHA if sign-ups get abused.</li>
          </ul>
        </div>
      </main>
    </>
  );
}
