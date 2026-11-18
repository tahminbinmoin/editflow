import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, KeyRound, ExternalLink, Server, ShieldCheck, Info } from 'lucide-react';
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
          {testing && <span className="spinner" />} Test key & load models
        </button>
        {!active && (
          <button className="btn sm primary" onClick={() => onActivate(p.id)} disabled={!p.ready}>
            Use {p.short || p.name}
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

function StockCard({ src, onChange }) {
  const [key, setKey] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const save = async () => {
    setBusy(true);
    try {
      onChange(await api(`/settings/ai/${src.id}`, { method: 'PUT', body: { key } }));
      setKey('');
      const r = await api(`/settings/ai/${src.id}/test`, { method: 'POST' });
      setResult(r.lastTest);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack-sm">
      <div className="spread">
        <b>{src.name}</b>
        <span className={`pill ${src.hasKey || src.serverKey ? 'ok' : ''}`}>{src.hasKey ? `Your key (${src.keyMasked})` : src.serverKey ? 'Provided by this app' : 'Not connected'}</span>
      </div>
      <p className="tiny muted">
        {src.licence}{' '}
        <a href={src.keyUrl} target="_blank" rel="noreferrer">
          Get a free key <ExternalLink size={10} />
        </a>
      </p>
      <div className="row">
        <input className="input sm" type="password" autoComplete="off" placeholder={src.hasKey ? 'Paste to replace' : `${src.name} API key`} value={key} onChange={(e) => setKey(e.target.value)} aria-label={`${src.name} API key`} />
        <button className="btn sm" onClick={save} disabled={!key || busy}>
          {busy && <span className="spinner" />} Save & test
        </button>
        {src.hasKey && (
          <button className="btn sm ghost danger" onClick={async () => onChange(await api(`/settings/ai/${src.id}/key`, { method: 'DELETE' }))}>
            Remove
          </button>
        )}
      </div>
      {result && <div className={`notice ${result.ok ? 'ok' : 'err'} tiny`}>{result.message}</div>}
    </div>
  );
}

export default function Settings() {
  const [data, setData] = useState(null);
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
  const openai = data.providers.find((p) => p.id === 'openai');

  return (
    <>
      <AppHeader />
      <main className="page narrow stack-lg">
        <div>
          <h1 style={{ fontSize: 32 }}>AI settings</h1>
          <p className="muted" style={{ marginTop: 6 }}>
            Connect ChatGPT or Claude to plan edits, answer change requests and analyse your video for B-roll and motion graphics. You can switch at any time. Editflow asks before sending anything: a transcript, still frames or audio. It never uploads the video file to a language model.
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

        <div className="notice info stack-sm">
          <div className="row">
            <Info size={16} /> <b>About ChatGPT and Claude subscriptions</b>
          </div>
          <div className="small text-2">
            A ChatGPT Plus/Pro or Claude Pro/Max subscription covers the ChatGPT and Claude apps, not requests from other apps. Anthropic’s terms don’t allow a Claude subscription to power third-party apps, and OpenAI only lets approved partner apps use a ChatGPT plan. So Editflow uses an API key from each provider’s developer platform, billed per request (a typical analysis of a 45-second video sends ~20 small frames and costs a few cents).{' '}
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
              OpenAI API keys <ExternalLink size={11} />
            </a>{' '}
            ·{' '}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
              Anthropic API keys <ExternalLink size={11} />
            </a>
          </div>
        </div>

        {data.providers.map((p) => (
          <ProviderCard key={p.id} p={p} active={active === p.id} onChange={(res) => setData({ ...data, ...res })} onActivate={activate} />
        ))}

        <div className="card stack">
          <div className="spread">
            <h3 style={{ fontSize: 19 }}>B-roll sources</h3>
            <span className="pill info">Used by “Analyse video”</span>
          </div>
          <p className="small text-2">
            When ChatGPT or Claude plans B-roll, Editflow searches these free stock libraries, lets the AI pick the best match from the thumbnails, and saves the clip into your project. Your own B-roll clips are always tried first.
          </p>
          {(data.stock || []).map((src) => (
            <StockCard key={src.id} src={src} onChange={(res) => setData({ ...data, ...res })} />
          ))}
          <label className="check">
            <input
              type="checkbox"
              checked={data.prefs.aiImages !== false}
              onChange={async (e) => {
                setData({ ...data, ...(await api('/settings/prefs', { method: 'PUT', body: { aiImages: e.target.checked } })) });
                refresh();
              }}
            />{' '}
            When no stock clip fits, generate an image with OpenAI (needs your OpenAI key; a few cents per image)
          </label>
        </div>

        <div className="card stack">
          <div className="spread">
            <h3 style={{ fontSize: 19 }}>Transcription</h3>
            <span className={`pill ${openai?.hasKey ? 'ok' : ''}`}>{openai?.hasKey ? 'Ready (uses your OpenAI key)' : 'Needs an OpenAI key'}</span>
          </div>
          <div className="stack-sm small text-2">
            <div>
              <b>OpenAI:</b> the Transcript tab sends the clip’s audio track (not the picture), split into short parts at pauses; each part becomes a timed line. Uses the OpenAI key above and its transcription model, billed per minute of audio. Works whichever provider plans your edits; Claude doesn’t transcribe audio.
            </div>
            <div>
              <b>Import:</b> .srt or .vtt caption files give exact timing, and nothing is uploaded. Plain text gets estimated timing.
            </div>
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
          <p className="tiny muted">Token counts are as reported by the provider. Check platform.openai.com/usage and console.anthropic.com for spend and limits.</p>
        </div>

        <div className="card stack">
          <div className="row">
            <Server size={18} color="var(--warm)" />
            <h3 style={{ fontSize: 19 }}>Before real customers use this</h3>
          </div>
          <ul className="small text-2" style={{ paddingLeft: 18, margin: 0 }}>
            <li>Each user adds their own API keys here and pays the provider directly. If you want to include AI in your price instead, add your own keys on the server and meter usage per user.</li>
            <li>To let users pay with their ChatGPT plan, apply to OpenAI’s “Sign in with ChatGPT” partner programme for hosted apps.</li>
            <li>Supabase’s Free plan limits files to 50 MB and pauses idle projects; upgrade before regular use.</li>
            <li>Turn on email confirmation with a proper SMTP sender, and add CAPTCHA if sign-ups get abused.</li>
          </ul>
        </div>
      </main>
    </>
  );
}
