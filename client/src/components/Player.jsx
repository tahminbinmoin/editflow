// Sequence preview: plays the timeline by seeking one <video> through the clips' source ranges,
// with captions, text templates, B-roll and music layered on top. It is an approximation for
// review — the export renders the exact result with ffmpeg.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, SkipBack } from 'lucide-react';
import { layout, timelineCaptions, ASPECTS, formatTime } from '@shared/timeline.js';
import { drawGraphics } from '@shared/graphics.js';
import { ensureGraphicsFont } from '../lib/graphicsFrames.js';

export default function Player({ urls, timeline, assets, time, onTime, playing, setPlaying, badge }) {
  const main = useRef();
  const broll = useRef();
  const music = useRef();
  const raf = useRef();
  const stageRef = useRef();
  const gfx = useRef();
  const [fontReady, setFontReady] = useState(false);
  const [box, setBox] = useState({ w: 300, h: 533 });
  const { clips, duration } = useMemo(() => layout(timeline), [timeline]);
  const caps = useMemo(() => timelineCaptions(timeline), [timeline]);
  const assetMap = useMemo(() => Object.fromEntries(assets.map((a) => [a.id, a])), [assets]);
  const aspect = ASPECTS[timeline.format.aspect] || ASPECTS['9:16'];
  const state = useRef({ clipIdx: -1, src: null });
  const timeRef = useRef(time);
  timeRef.current = time;

  // Fit the frame inside the stage.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const W = el.clientWidth - 8;
      const H = el.clientHeight - 8;
      const r = aspect.w / aspect.h;
      const w = Math.min(W, H * r);
      setBox({ w, h: w / r });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect.w, aspect.h]);

  useEffect(() => {
    ensureGraphicsFont().then(() => setFontReady(true));
  }, []);

  // Motion graphics: drawn with the same code the export uses (shared/graphics.js).
  const graphics = timeline.graphics || [];
  useEffect(() => {
    const c = gfx.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(box.w * dpr);
    const H = Math.round(box.h * dpr);
    if (c.width !== W || c.height !== H) ((c.width = W), (c.height = H));
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    drawGraphics(ctx, graphics, time, W, H);
  }, [time, graphics, box.w, box.h, fontReady]);

  const clipAt = (t) => {
    const i = clips.findIndex((c) => t >= c.tlStart && t < c.tlEnd);
    return i >= 0 ? i : t >= duration && clips.length ? clips.length - 1 : -1;
  };

  const loadClip = (i, t, autoplay) => {
    const v = main.current;
    const c = clips[i];
    if (!v || !c) return;
    const src = urls[c.assetId]?.file;
    if (!src) return;
    const seekTo = c.in + Math.max(0, t - c.tlStart);
    state.current.clipIdx = i;
    v.volume = Math.min(1, (c.volume ?? 1) * (timeline.audio.voiceVolume ?? 1));
    if (state.current.src !== src) {
      state.current.src = src;
      v.src = src;
      v.onloadedmetadata = () => {
        v.currentTime = seekTo;
        if (autoplay) v.play().catch(() => {});
      };
    } else {
      if (Math.abs(v.currentTime - seekTo) > 0.08) v.currentTime = seekTo;
      if (autoplay && v.paused) v.play().catch(() => {});
    }
  };

  // Paused: show the frame under the playhead.
  useEffect(() => {
    if (playing) return;
    const i = clipAt(time);
    if (i >= 0) loadClip(i, time, false);
    main.current?.pause();
    music.current?.pause();
    broll.current?.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time, playing, clips, urls]);

  // Playing: drive the timeline from the video clock.
  useEffect(() => {
    if (!playing) return;
    if (!clips.length) return setPlaying(false);
    let t0 = timeRef.current >= duration - 0.05 ? 0 : timeRef.current;
    let i = clipAt(t0);
    loadClip(i, t0, true);
    const tick = () => {
      const v = main.current;
      const c = clips[state.current.clipIdx];
      if (v && c && !v.seeking && v.readyState >= 2) {
        const t = c.tlStart + (v.currentTime - c.in);
        if (v.currentTime >= c.out - 0.02 || v.ended) {
          const next = state.current.clipIdx + 1;
          if (next >= clips.length) {
            onTime(duration);
            setPlaying(false);
            return;
          }
          loadClip(next, clips[next].tlStart, true);
        } else onTime(Math.max(c.tlStart, Math.min(c.tlEnd, t)));
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, clips]);

  const activeBroll = timeline.broll.find((b) => time >= b.start && time < b.start + b.duration);
  const brollAsset = activeBroll?.assetId ? assetMap[activeBroll.assetId] : null;
  useEffect(() => {
    const v = broll.current;
    if (!v) return;
    if (!brollAsset) {
      v.pause();
      return;
    }
    const src = urls[brollAsset.id]?.file;
    if (!src) return;
    if (v.src !== src) v.src = src;
    const want = (activeBroll.srcIn || 0) + (time - activeBroll.start);
    if (Math.abs(v.currentTime - want) > 0.3) v.currentTime = want;
    if (playing && v.paused) v.play().catch(() => {});
    if (!playing) v.pause();
  }, [brollAsset?.id, activeBroll?.id, time, playing, urls]);

  const musicAsset = timeline.music.assetId ? assetMap[timeline.music.assetId] : null;
  const activeCap = timeline.captions.enabled ? caps.find((c) => time >= c.start && time < c.end) : null;
  useEffect(() => {
    const a = music.current;
    if (!a || !musicAsset) return;
    const src = urls[musicAsset.id]?.file;
    if (!src) return;
    if (a.src !== src) a.src = src;
    const vol = timeline.music.volume ?? 0.22;
    a.volume = Math.min(1, timeline.music.duck && activeCap ? vol * 0.45 : vol);
    if (playing) {
      const want = musicAsset.duration ? time % musicAsset.duration : time;
      if (Math.abs(a.currentTime - want) > 0.4) a.currentTime = want;
      if (a.paused) a.play().catch(() => {});
    } else a.pause();
  }, [musicAsset?.id, playing, time, timeline.music, activeCap, urls]);

  const overlays = timeline.overlays.filter((o) => time >= o.start && time < o.start + o.duration);
  const curIdx = clipAt(time);
  const cur = clips[curIdx];
  const sinceStart = cur ? time - cur.tlStart : 9;
  const flash = cur && curIdx > 0 && sinceStart < 0.2 ? cur.transitionIn : null;
  const curAsset = cur && assetMap[cur.assetId];
  const fs = box.w;

  return (
    <div className="stage">
      <div className="stage-inner" ref={stageRef}>
        {clips.length ? (
          <div className="frame" style={{ width: box.w, height: box.h }}>
            {badge && <div className="preview-badge">{badge}</div>}
            <video ref={main} playsInline preload="auto" style={{ opacity: curAsset && !curAsset.hasVideo ? 0 : 1 }} />
            <video ref={broll} playsInline muted preload="auto" style={{ opacity: brollAsset ? 1 : 0 }} />
            <audio ref={music} preload="auto" />
            <canvas ref={gfx} className="gfx-layer" style={{ width: box.w, height: box.h }} aria-hidden />
            <div className="layer">
              {activeBroll && !brollAsset && (
                <div className="broll-tag">
                  B-roll idea: {activeBroll.description}
                  <div className="tiny" style={{ fontWeight: 500, opacity: 0.85 }}>
                    Attach a clip to show it here
                  </div>
                </div>
              )}
              {overlays.map((o) => (
                <div key={o.id} className={`ov ov-${o.template}`} style={{ fontSize: fs * (o.template === 'title' ? 0.085 : o.template === 'cta' ? 0.06 : 0.045) }}>
                  <span>{o.text}</span>
                  {o.sub && <div style={{ fontSize: '0.6em', fontWeight: 600, marginTop: 4 }}>{o.sub}</div>}
                </div>
              ))}
              {activeCap && (
                <div
                  className={`cap-preview cap-${timeline.captions.style}`}
                  style={{ fontSize: fs * 0.064, ...(timeline.captions.position === 'center' ? { top: '50%', transform: 'translateY(-50%)' } : { bottom: '17%' }) }}
                >
                  <span>{activeCap.text}</span>
                </div>
              )}
              <div className="flash" style={{ background: flash === 'flash' ? '#fff' : '#000', opacity: flash === 'fade' || flash === 'flash' ? 1 - sinceStart / 0.2 : 0 }} />
            </div>
          </div>
        ) : (
          <div className="card" style={{ maxWidth: 360, textAlign: 'center' }}>
            <h4 style={{ fontSize: 17, marginBottom: 6 }}>Nothing on the timeline yet</h4>
            <p className="small muted">Make a first cut from the panel on the right, or add footage from the Media tab.</p>
          </div>
        )}
      </div>
      <div className="transport">
        <button className="btn icon ghost" onClick={() => onTime(0)} aria-label="Back to start">
          <SkipBack size={17} />
        </button>
        <button className="btn icon" style={{ borderRadius: 999, padding: 10 }} onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'} disabled={!clips.length}>
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <span className="mono small muted" style={{ minWidth: 110 }}>
          {formatTime(time)} / {formatTime(duration)}
        </span>
        <span className="tiny muted desktop-only">
          <span className="kbd">Space</span> play · preview is approximate, export is exact
        </span>
      </div>
    </div>
  );
}
