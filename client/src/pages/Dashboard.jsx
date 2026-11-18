import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Film, Trash2, Sparkles } from 'lucide-react';
import AppHeader from '../components/AppHeader.jsx';
import { listProjects, deleteProject } from '../lib/store.js';
import { createSampleProject } from '../lib/sample.js';
import { assetUrls } from '../lib/media.js';
import { useAuth } from '../App.jsx';
import { timeAgo, useToast } from '../components/ui.jsx';

const STATUS = {
  setup: ['Needs footage', ''],
  editing: ['In edit', 'warm'],
  exported: ['Exported', 'ok'],
};

export default function Dashboard() {
  const [projects, setProjects] = useState(null);
  const [thumbs, setThumbs] = useState({});
  const { user, engine } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const load = async () => {
    try {
      let list = await listProjects();
      const flag = `ef_sample_${user.id}`;
      if (!list.length && !localStorage.getItem(flag)) {
        await createSampleProject();
        localStorage.setItem(flag, '1');
        list = await listProjects();
      }
      setProjects(list);
      const withThumb = list.filter((p) => p.thumbAsset).map((p) => ({ ...p.thumbAsset, id: p.id }));
      assetUrls(withThumb).then((u) => setThumbs(Object.fromEntries(Object.entries(u).map(([k, v]) => [k, v.thumb]))));
    } catch (e) {
      toast(e.message, 'err');
      setProjects([]);
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async (e, p) => {
    e.preventDefault();
    if (!window.confirm(`Delete “${p.name}”? Its uploaded files and exports are removed too.`)) return;
    try {
      await deleteProject(p);
    } catch (err) {
      toast(err.message, 'err');
    }
    load();
  };

  return (
    <>
      <AppHeader />
      <main className="page">
        {user?.isGuest && (
          <div className="notice info spread" style={{ marginBottom: 20 }}>
            <span>You’re in a guest demo. Create an account to keep your projects and AI settings.</span>
            <Link to="/signup" className="btn sm">
              Save my work
            </Link>
          </div>
        )}
        <div className="spread" style={{ marginBottom: 22 }}>
          <div>
            <h1 style={{ fontSize: 32 }}>Your projects</h1>
            <p className="muted small" style={{ marginTop: 6 }}>
              {engine?.id === 'rules' ? (
                <>
                  First cuts use the rule-based drafter (no AI).{' '}
                  <Link to="/app/settings">Connect ChatGPT or Claude</Link> for AI story planning and video analysis.
                </>
              ) : (
                <>AI story planning via {engine?.name}.</>
              )}
            </p>
          </div>
          <button className="btn primary" onClick={() => nav('/app/new')}>
            <Plus size={16} /> New project
          </button>
        </div>
        {!projects ? (
          <div className="row muted">
            <span className="spinner" /> Loading projects… (the first visit prepares the sample project)
          </div>
        ) : (
          <div className="proj-grid">
            <button className="proj-card proj-new" onClick={() => nav('/app/new')}>
              <div className="col" style={{ alignItems: 'center' }}>
                <Plus size={26} />
                <b>New project</b>
                <span className="small muted">Upload footage and set a goal</span>
              </div>
            </button>
            {projects.map((p) => (
              <Link key={p.id} to={`/app/p/${p.id}`} className="proj-card">
                <div className="proj-thumb">
                  {thumbs[p.id] ? <img src={thumbs[p.id]} alt="" /> : <Film size={28} color="var(--muted)" />}
                  <span className="pill" style={{ position: 'absolute', top: 10, left: 10 }}>
                    {p.aspect}
                  </span>
                  {p.isSample && (
                    <span className="pill warm" style={{ position: 'absolute', top: 10, right: 10 }}>
                      <Sparkles size={11} /> Sample
                    </span>
                  )}
                </div>
                <div style={{ padding: 14 }} className="stack-sm">
                  <div className="spread">
                    <b style={{ fontSize: 15 }}>{p.name}</b>
                    <button className="btn icon ghost" onClick={(e) => remove(e, p)} aria-label={`Delete ${p.name}`}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="row small muted">
                    <span className={`pill ${STATUS[p.status]?.[1] || ''}`}>{STATUS[p.status]?.[0] || p.status}</span>
                    <span>
                      {p.clipCount} clip{p.clipCount === 1 ? '' : 's'} · {timeAgo(p.updatedAt)}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
        {projects && !projects.some((p) => p.isSample) && (
          <p className="small muted" style={{ marginTop: 24 }}>
            Want to look around first?{' '}
            <button
              className="btn xs"
              onClick={async () => {
                await createSampleProject().catch((err) => toast(err.message, 'err'));
                load();
              }}
            >
              Add the sample project
            </button>
          </p>
        )}
      </main>
    </>
  );
}
