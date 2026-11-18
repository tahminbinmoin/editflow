import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Wand2, SlidersHorizontal, Upload, ListChecks, Film, ShieldCheck } from 'lucide-react';
import { Brand, useToast } from '../components/ui.jsx';
import { useAuth } from '../App.jsx';
import { supabase } from '../lib/supabase.js';
import { BRAND } from '../lib/brand.js';

export default function Landing() {
  const { user, refresh } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const demo = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      await refresh();
      nav('/app');
    } catch (e) {
      toast(/anonymous/i.test(e.message) ? 'Guest demo is switched off on this server. Create a free account to try it.' : e.message, 'err');
      if (/anonymous/i.test(e.message)) nav('/signup');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="topbar">
        <Brand />
        <div className="grow" />
        {user ? (
          <Link to="/app" className="btn sm primary">
            Open your projects
          </Link>
        ) : (
          <>
            <Link to="/login" className="navlink">
              Sign in
            </Link>
            <Link to="/signup" className="btn sm primary">
              Start a project
            </Link>
          </>
        )}
      </header>
      <main className="page">
        <section className="hero">
          <div>
            <div className="eyebrow">For solo creators and small agencies</div>
            <h1 style={{ marginTop: 14 }}>
              Turn raw talking-head footage into a short people <em>finish watching.</em>
            </h1>
            <p className="lede">
              Upload your clip and say who it’s for. {BRAND} drafts a first cut with a hook, a clear story, captions, B-roll ideas and music direction. Then you
              tweak it in plain language or with simple controls, and export a vertical, square or wide video.
            </p>
            <div className="row wrap" style={{ marginTop: 28, gap: 12 }}>
              <Link to={user ? '/app/new' : '/signup'} className="btn lg primary">
                Start a project
              </Link>
              <button className="btn lg" onClick={user ? () => nav('/app') : demo} disabled={busy}>
                {busy ? <span className="spinner" /> : null} Explore the demo project
              </button>
            </div>
            <p className="small muted" style={{ marginTop: 14 }}>
              The demo uses placeholder footage and needs no account. Nothing is uploaded until you choose a file.
            </p>
          </div>
          <div className="hero-visual" aria-hidden>
            <div className="phone">
              <div className="kick">MISTAKE #1</div>
              <div className="cap">Show the problem first.</div>
            </div>
            <div className="plan-float">
              <div className="section-title" style={{ marginBottom: 6 }}>
                Story plan
              </div>
              {[
                ['hook', 'Hook', 'Why do 90% of viewers leave…'],
                ['context', 'Set up', 'I filmed 200 product videos…'],
                ['progression', 'Main points', 'Three mistakes, one per beat'],
                ['payoff', 'Payoff', 'Give them a reason to stay'],
                ['cta', 'Call to action', 'Follow for part two'],
              ].map(([r, t, d]) => (
                <div className="beat-row" key={r}>
                  <span className="dot" style={{ color: `var(--role-${r})`, marginTop: 6 }} />
                  <div>
                    <b>{t}</b> <span className="muted">· {d}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section">
          <h2>How it works</h2>
          <div className="grid-3" style={{ marginTop: 26 }}>
            {[
              [<Upload key="i" size={20} />, 'Add footage and a goal', 'Drop in a talking-head, podcast or product clip. Pick the platform, the audience and roughly how long it should be. Optionally add a reference video whose pacing you like.'],
              [<ListChecks key="i" size={20} />, 'Get an editable first cut', 'A story plan picks the strongest opening line, orders the rest into setup → points → payoff → call to action, removes dead air and adds captions. Every choice comes with a reason.'],
              [<Film key="i" size={20} />, 'Refine and export', '“Make the first three seconds faster.” “Music less intense.” Preview each change before you apply it, undo anything, then export an MP4.'],
            ].map(([icon, t, d], i) => (
              <div className="card" key={t}>
                <div className="row" style={{ marginBottom: 12 }}>
                  <span className="step-num">{i + 1}</span>
                  <span style={{ color: 'var(--warm)' }}>{icon}</span>
                </div>
                <h3 style={{ fontSize: 19, marginBottom: 8 }}>{t}</h3>
                <p className="text-2 small">{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="section">
          <h2>Two ways to work. Switch any time.</h2>
          <div className="grid-2" style={{ marginTop: 26 }}>
            <div className="card raised">
              <Wand2 color="var(--accent)" />
              <h3 style={{ fontSize: 21, margin: '12px 0 8px' }}>Make it for me</h3>
              <p className="text-2">
                Describe the result. You get a story plan, an ordered cut, captions, B-roll suggestions tied to specific lines, music mood and audio clean-up. Ask for changes in your own
                words and approve them before they land.
              </p>
            </div>
            <div className="card raised">
              <SlidersHorizontal color="var(--warm)" />
              <h3 style={{ fontSize: 21, margin: '12px 0 8px' }}>Let me edit</h3>
              <p className="text-2">
                Trim, split, reorder, set volume, add fades, edit captions, drop in title templates and cutaways. Cut by text too: strike a line in the transcript and it leaves the video.
              </p>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="grid-2">
            <div>
              <h2>What works today</h2>
              <ul className="ticks" style={{ marginTop: 16 }}>
                <li>Real trimming, reordering, captions, text templates, B-roll cutaways and fades, rendered to MP4 in your browser (ffmpeg.wasm) in 9:16, 1:1, 4:5 or 16:9</li>
                <li>Loudness normalisation (−14 LUFS), noise reduction and music ducking under speech</li>
                <li>Pause detection and measured pacing of your reference video (cuts per minute, shot length)</li>
                <li>Work straight from a folder on your computer (e.g. Downloads): any file size, nothing uploaded, exports saved back into the folder (Chrome and Edge remember it)</li>
                <li>Undo, redo and a full edit history; AI changes are previewed before they apply</li>
                <li>ChatGPT or Claude (your own API key) plans the story, then looks at frames of your video to add B-roll and motion graphics; or use a transparent rule-based draft with no AI at all</li>
                <li>Animated motion graphics: lower thirds, keyword pops, stat counters, checklists, callout arrows, progress bars and chapter tags, exported exactly as previewed</li>
              </ul>
            </div>
            <div>
              <h2>Coming later</h2>
              <ul className="ticks" style={{ marginTop: 16 }}>
                <li>Multi-track editing, colour grading and motion-graphics tools</li>
                <li>Face-aware reframing and close-up detection (needs visual analysis)</li>
                <li>A licensed music and B-roll library</li>
                <li>Team review links and comments</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="card raised row" style={{ alignItems: 'flex-start', gap: 16 }}>
            <ShieldCheck color="var(--ok)" style={{ flex: 'none', marginTop: 4 }} />
            <div className="stack-sm">
              <h3 style={{ fontSize: 20 }}>Your footage, your choice of AI</h3>
              <p className="text-2">
                {BRAND} works without any AI provider, using a clearly labelled rule-based draft. Connect ChatGPT or Claude with your own API key and it asks before sending
                anything: the transcript for planning, a few small still frames for video analysis, or the audio track for transcription. The video file itself is never uploaded to a language model, and exports render on your own device.
              </p>
            </div>
          </div>
        </section>
      </main>
      <footer className="page small muted" style={{ paddingTop: 0 }}>
        {BRAND} MVP · early product, built to learn from creators.
      </footer>
    </>
  );
}
