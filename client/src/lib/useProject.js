// The studio's state and actions. Every change goes through `mutate` (latest state, then a
// serialised save to Supabase), so background uploads and quick edits never overwrite each other.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { currentUser } from './supabase.js';
import * as store from './store.js';
import { assetUrls, assetBlob, probeFile, decodeAudio, peaksFrom, silencesFrom, thumbnailFrom, analyzeReference, speechWav, uploadToStorage, sampleCut } from './media.js';
import * as folder from './localFolder.js';
import { useToast } from '../components/ui.jsx';
import { useAuth } from '../App.jsx';
import { applyOps, describeOp, diffSummary, uid, normalizeTimeline } from '@shared/timeline.js';
import { cleanPlan, planToTimeline } from '@shared/plan.js';
import { rulePlan, ruleRefine } from '@shared/rules.js';
import { parseTranscriptFile, setAssetSegments } from '@shared/transcript.js';
import { mapLimit } from '@shared/speech.js';
import { SETTINGS_KEYS } from '@shared/project.js';
import { ASPECTS } from '@shared/timeline.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const activeUploads = new Set(); // asset ids being processed in this tab
const ext = (name) => (String(name).toLowerCase().match(/\.[a-z0-9]{1,5}$/) || ['.bin'])[0];

export function useProject(id) {
  const { engine } = useAuth();
  const toast = useToast();
  const [project, setProjectState] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [consent, setConsent] = useState(null);
  const [urls, setUrls] = useState({});
  const [folders, setFolders] = useState({}); // folderId → { name, status }
  const ref = useRef(null);

  const setProject = useCallback((p) => {
    ref.current = p;
    setProjectState(p);
  }, []);

  /** Apply a synchronous change to the latest project and save it. */
  const mutate = useCallback(
    (fn) => {
      const p = clone(ref.current);
      fn(p);
      setProject(p);
      return store.saveProject(p).then(() => p);
    },
    [setProject],
  );

  useEffect(() => {
    let alive = true;
    store
      .getProject(id)
      .then((p) => {
        if (!alive) return;
        // Uploads that were running when the page closed can't resume.
        let stale = false;
        for (const a of p.assets) if ((a.status === 'processing' || a.status === 'uploading') && !activeUploads.has(a.id)) ((a.status = 'error'), (a.error = 'The upload was interrupted. Remove this file and add it again.'), (stale = true));
        setProject(p);
        if (stale) store.saveProject(p);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [id, setProject]);

  // Linked folders on this computer: are they available in this browser right now?
  const folderKey = project ? (project.folders || []).map((f) => f.id).join('|') : '';
  const refreshFolders = useCallback(async () => {
    const list = ref.current?.folders || [];
    const next = {};
    for (const f of list) next[f.id] = { name: f.name, status: await folder.folderStatus(f.id) };
    setFolders(next);
    return next;
  }, []);
  useEffect(() => {
    if (project) refreshFolders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderKey]);

  // Media URLs (signed Storage URLs, or local file URLs), refreshed when assets or folders change.
  const assetKey = project ? project.assets.map((a) => `${a.id}:${a.status}`).join('|') : '';
  const folderStates = Object.values(folders).map((f) => f.status).join('|');
  useEffect(() => {
    if (!project) return;
    const ready = project.assets.filter((a) => a.url || a.path || a.source === 'local');
    assetUrls(ready)
      .then(setUrls)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetKey, folderStates]);

  /** Wrap an action: busy label, error toast, and consent retry. */
  const run = useCallback(
    async (label, fn) => {
      setBusy(label);
      try {
        return await fn();
      } catch (e) {
        if (e.code === 'consent_required') setConsent({ provider: e.provider, retry: () => run(label, fn) });
        else toast(e.message, 'err');
        return null;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );

  const commit = useCallback(
    async (timeline, label, source = 'user', extra) => {
      const entry = await store.insertHistory(id, timeline, label, source);
      let dropped = [];
      await mutate((p) => {
        extra?.(p);
        dropped = store.pushHistory(p, entry, timeline);
      });
      store.deleteHistory(dropped);
    },
    [id, mutate],
  );

  const ops = useCallback(
    async (list, label) => {
      const p = ref.current;
      const res = applyOps(p.timeline, list, { assets: p.assets });
      if (!res.applied.length) return toast(res.errors[0]?.error || 'Nothing to change', 'err');
      // Optimistic: show the change immediately, then record it.
      setProject({ ...p, timeline: res.timeline });
      const name = label || describeOp(res.applied[0], p.timeline) + (res.applied.length > 1 ? ` (+${res.applied.length - 1} more)` : '');
      await commit(res.timeline, name, 'user').catch((e) => {
        setProject(p);
        toast(`Could not save: ${e.message}`, 'err');
      });
    },
    [commit, setProject, toast],
  );

  const needsConsent = (providerId, name, dataUse, kind = 'transcript') => {
    if (ref.current.consent?.[providerId]?.allowed) return false;
    throw Object.assign(new Error('Consent needed'), { code: 'consent_required', provider: { id: providerId, name, dataUse, kind } });
  };
  const [status, setStatus] = useState(null); // progress text for long AI actions

  const act = useMemo(
    () => ({
      rename: (name) => run('rename', () => mutate((p) => (p.name = String(name).slice(0, 120)))),
      setMode: (m) => mutate((p) => (p.mode = m)),
      updateSettings: (settings) =>
        run('settings', async () => {
          await mutate((p) => {
            for (const k of SETTINGS_KEYS) if (k in settings) p.settings[k] = k === 'targetLength' ? Math.max(5, Math.min(600, Number(settings[k]) || 45)) : String(settings[k]).slice(0, 2000);
          });
          if (settings.aspect && ASPECTS[settings.aspect] && ref.current.timeline.format.aspect !== settings.aspect)
            await commit({ ...ref.current.timeline, format: { ...ref.current.timeline.format, aspect: settings.aspect } }, `Format → ${settings.aspect}`);
        }),
      allowConsent: async (providerId) => mutate((p) => (p.consent[providerId] = { allowed: true, at: new Date().toISOString() })),

      undo: () => run('undo', () => act.restore('undo')),
      redo: () => run('redo', () => act.restore('redo')),
      restore: async (target) => {
        const h = ref.current.history;
        const idx = target === 'undo' ? h.index - 1 : target === 'redo' ? h.index + 1 : h.entries.findIndex((e) => e.id === target);
        if (idx < 0 || idx >= h.entries.length) throw new Error(target === 'redo' ? 'Nothing to redo' : 'Nothing to undo');
        const timeline = await store.fetchHistoryTimeline(h.entries[idx].id);
        await mutate((p) => {
          p.history.index = idx;
          p.timeline = timeline;
        });
      },

      // ----- AI / rule-based planning -----
      firstCut: (forceRules) =>
        run('firstCut', async () => {
          const p = ref.current;
          if (!p.transcript.segments.length) throw new Error('Add a transcript first (Transcript tab).');
          let raw;
          let meta;
          if (forceRules || !engine || engine.id === 'rules') {
            raw = rulePlan(p);
            meta = { engine: 'rules', providerName: 'Rule-based (no AI)', at: new Date().toISOString() };
          } else {
            ({ data: raw, meta } = await api('/ai/first-cut', { method: 'POST', body: { projectId: p.id } }));
          }
          const { plan, warnings } = cleanPlan(raw, p.transcript.segments);
          if (!plan.clips.length) throw new Error(`The ${meta.providerName} plan had no usable clips. ${warnings.slice(0, 2).join(' ')}`);
          const timeline = planToTimeline(plan, p.transcript.segments, { aspect: p.timeline.format.aspect, previous: p.timeline });
          const pending = { id: uid('prop'), kind: 'firstCut', summary: plan.summary, plan: { ...plan, warnings, meta }, timeline, changes: diffSummary(p.timeline, timeline), meta, createdAt: new Date().toISOString() };
          await mutate((d) => {
            d.pending = pending;
            d.chat.push({ role: 'assistant', text: plan.summary, at: pending.createdAt, meta, proposalId: pending.id });
          });
          return true;
        }),
      refine: (text) =>
        run('refine', async () => {
          const p = ref.current;
          const request = String(text || '').trim().slice(0, 600);
          if (!request) throw new Error('Describe the change you want.');
          if (!p.timeline.clips.length) throw new Error('Make a first cut before asking for refinements.');
          let out;
          let meta;
          if (engine?.id === 'rules' || !engine) {
            out = ruleRefine(p, request);
            meta = { engine: 'rules', providerName: 'Rule-based (no AI)', at: new Date().toISOString() };
          } else {
            ({ meta, ...out } = await api('/ai/refine', { method: 'POST', body: { projectId: p.id, request } }));
          }
          const res = applyOps(p.timeline, out.ops || [], { assets: p.assets });
          const notes = [...(out.notes || []), ...res.errors.map((e) => `Skipped one step: ${e.error}`)];
          const now = new Date().toISOString();
          const userMsg = { role: 'user', text: request, at: now };
          if (!res.applied.length) {
            await mutate((d) => d.chat.push(userMsg, { role: 'assistant', text: String(out.summary || 'No changes proposed.'), notes, at: now, meta }));
            return true;
          }
          const pending = { id: uid('prop'), kind: 'refine', request, summary: String(out.summary || 'Proposed changes').slice(0, 600), steps: res.applied.map((o) => describeOp(o, p.timeline)), ops: res.applied, notes, timeline: res.timeline, changes: diffSummary(p.timeline, res.timeline), meta, createdAt: now };
          await mutate((d) => {
            d.pending = pending;
            d.chat.push(userMsg, { role: 'assistant', text: pending.summary, notes, at: now, meta, proposalId: pending.id });
          });
          return true;
        }),
      /**
       * "Analyse video": frames of the cut → ChatGPT/Claude plans B-roll, motion graphics, zooms
       * and caption keywords → stock footage is searched and picked → the picks are downloaded
       * into this project (and AI images generated) → one proposal to preview.
       * options: { theme, brollAmount: 'lots'|'some', aiImages }
       */
      analyzeVisuals: (options = {}) =>
        run('visuals', async () => {
          const p = ref.current;
          if (!engine || engine.id === 'rules') throw new Error('Video analysis needs ChatGPT or Claude. Connect one in AI settings.');
          if (!p.timeline.clips.length) throw new Error('Make a first cut before analysing the video.');
          needsConsent(`${engine.id}:frames`, engine.name, engine.dataUse, 'frames');
          const wantImages = options.aiImages !== false && engine.images;
          if (wantImages) needsConsent('openai:images', 'OpenAI (images)', 'OpenAI states that API data is not used to train its models by default.', 'images');
          const proposalId = uid('prop');
          const added = [];
          try {
            setStatus('Reading frames from your cut…');
            const { frames, library } = await sampleCut(p, urls, normalizeTimeline(p.timeline), setStatus);
            if (frames.length < 2) throw new Error('Could not read frames from the footage. Check that it plays in the preview (and that its folder is connected).');
            setStatus(`${engine.name} is watching ${frames.length} frames${library.length ? ` and ${library.length} of your B-roll clips` : ''}, then picking stock footage…`);
            const { meta, ...out } = await api('/ai/visuals', { method: 'POST', body: { projectId: p.id, frames, library, options: { ...options, aiImages: wantImages } } });
            const notes = [...(out.notes || [])];
            // Download the picked stock clips and generate images, a few at a time.
            const slots = out.broll || [];
            const jobs = slots.filter((b) => !b.assetId && (b.pick || b.generate));
            let done = 0;
            await mapLimit(jobs, 3, async (b) => {
              setStatus(`Adding B-roll ${++done} of ${jobs.length}: ${b.description.slice(0, 50)}…`);
              try {
                const { asset } = b.pick
                  ? await api('/broll/fetch', { method: 'POST', body: { projectId: p.id, provider: b.pick.provider, id: b.pick.id, kind: b.pick.kind } })
                  : await api('/broll/generate', { method: 'POST', body: { projectId: p.id, prompt: b.generate, layout: b.layout } });
                b.assetId = asset.id;
                if (b.pick?.kind === 'video' && asset.duration > b.duration + 1) b.srcIn = Math.min(0.6, asset.duration - b.duration);
                if (asset.mediaType !== 'image' && b.layout === 'card') b.layout = 'split';
                added.push({ ...asset, proposalId });
              } catch (e) {
                notes.push(`Couldn’t add “${b.description}”: ${e.message}`);
              }
            });
            if (added.length) await mutate((d) => d.assets.push(...added));
            const ops = [
              ...(out.replaceBroll || []).map((brollId) => ({ type: 'deleteBroll', brollId })),
              ...slots.map((b) => ({ type: 'addBroll', broll: { start: b.start, duration: b.duration, description: b.description, reason: b.reason, assetId: b.assetId || null, srcIn: b.srcIn || 0, layout: b.assetId && b.layout === 'card' && !added.find((a) => a.id === b.assetId && a.mediaType === 'image') && !ref.current.assets.find((a) => a.id === b.assetId && a.mediaType === 'image') ? 'split' : b.layout, caption: b.caption, query: b.query } })),
              ...(out.ops || []),
            ];
            const res = applyOps(ref.current.timeline, ops, { assets: ref.current.assets });
            notes.push(...res.errors.map((e) => `Skipped one step: ${e.error}`));
            const now = new Date().toISOString();
            if (!res.applied.length) throw new Error(`${engine.name} didn’t propose any visual changes for this cut.`);
            const withFootage = slots.filter((b) => b.assetId).length;
            const steps = [];
            if (slots.length) steps.push(`B-roll: ${withFootage} of ${slots.length} shots with footage (${added.filter((a) => a.stock).length} stock, ${added.filter((a) => a.generated).length} AI images, ${slots.filter((b) => b.assetId && !added.find((a) => a.id === b.assetId)).length} yours)`);
            steps.push(...res.applied.filter((o) => !['deleteBroll', 'addBroll', 'setStyle', 'setCaptionStyle'].includes(o.type)).map((o) => describeOp(o, ref.current.timeline)));
            const pending = { id: proposalId, kind: 'visuals', summary: out.summary, scenes: out.scenes || [], broll: slots, steps, ops: res.applied, notes, timeline: res.timeline, changes: diffSummary(ref.current.timeline, res.timeline), meta, newAssetIds: added.map((a) => a.id), createdAt: now };
            await mutate((d) => {
              d.pending = pending;
              d.chat.push({ role: 'assistant', text: pending.summary, notes, at: now, meta, proposalId });
            });
            return true;
          } catch (e) {
            if (added.length) await act.dropAssets(added.map((a) => a.id)).catch(() => {});
            throw e;
          } finally {
            setStatus(null);
          }
        }),
      /** Remove assets (and their files) that nothing uses, e.g. B-roll from a discarded proposal. */
      dropAssets: async (ids) => {
        const user = await currentUser();
        await mutate((d) => (d.assets = d.assets.filter((a) => !ids.includes(a.id))));
        for (const aid of ids) store.removeStoragePrefix(`${user.id}/${id}/${aid}`).catch(() => {});
      },
      /** Search stock footage for the B-roll editor. */
      searchStock: (query, kind, layout) => api('/broll/search', { method: 'POST', body: { projectId: id, query, kind, layout } }),
      /** Download a stock clip (or generate an image) into the project and attach it to a B-roll slot. */
      attachStock: (brollId, candidate, layout) =>
        run('broll', async () => {
          const { asset } = await api('/broll/fetch', { method: 'POST', body: { projectId: id, provider: candidate.provider, id: candidate.id, kind: candidate.kind } });
          await mutate((d) => d.assets.push(asset));
          const b = ref.current.timeline.broll.find((x) => x.id === brollId);
          await ops([{ type: 'updateBroll', brollId, patch: { assetId: asset.id, srcIn: asset.duration > (b?.duration || 2) + 1 ? 0.5 : 0, ...(asset.mediaType !== 'image' && layout === 'card' ? { layout: 'split' } : {}) } }], 'Attach stock footage');
          return asset;
        }),
      generateBroll: (brollId, prompt) =>
        run('broll', async () => {
          needsConsent('openai:images', 'OpenAI (images)', 'OpenAI states that API data is not used to train its models by default.', 'images');
          const b = ref.current.timeline.broll.find((x) => x.id === brollId);
          const { asset } = await api('/broll/generate', { method: 'POST', body: { projectId: id, prompt, layout: b?.layout } });
          await mutate((d) => d.assets.push(asset));
          await ops([{ type: 'updateBroll', brollId, patch: { assetId: asset.id, srcIn: 0 } }], 'Attach AI image');
          return asset;
        }),
      applyPending: () =>
        run('apply', async () => {
          const pend = ref.current.pending;
          if (!pend) return;
          const label = pend.kind === 'firstCut' ? `${pend.meta.engine === 'rules' ? 'Rule-based' : 'AI'} first cut` : pend.kind === 'visuals' ? 'AI: B-roll, motion graphics and zooms' : `AI: ${pend.request}`.slice(0, 90);
          await commit(normalizeTimeline(pend.timeline), label, pend.meta.engine === 'rules' ? 'rules' : 'ai', (p) => {
            if (pend.kind === 'firstCut') p.plan = pend.plan;
            const m = p.chat.find((c) => c.proposalId === pend.id);
            if (m) m.outcome = 'applied';
            p.pending = null;
          });
        }),
      discardPending: () =>
        run('discard', async () => {
          const drop = ref.current.pending?.newAssetIds || [];
          await mutate((p) => {
            const m = p.chat.find((c) => c.proposalId === p.pending?.id);
            if (m) m.outcome = 'discarded';
            p.pending = null;
          });
          // B-roll downloaded for this proposal and not used anywhere else goes too.
          const tl = normalizeTimeline(ref.current.timeline);
          const unused = drop.filter((aid) => !tl.broll.some((b) => b.assetId === aid) && !tl.graphics.some((g) => g.assetId === aid));
          if (unused.length) await act.dropAssets(unused);
        }),
      reference: () =>
        run('reference', async () => {
          const p = ref.current;
          const refAsset = p.assets.find((a) => a.kind === 'reference');
          if (!refAsset?.analysis && !p.settings.referenceNotes) throw new Error('Upload a reference video you have permission to analyse, or describe its style in the setup notes.');
          let insights;
          if (engine?.id === 'rules' || !engine) {
            const a = refAsset?.analysis;
            insights = {
              engine: 'rules',
              pacing: a ? `About ${a.avgShotSeconds}s per shot (${a.cutsPerMinute} cuts per minute); ${a.cutsInFirst3s} cut(s) in the first 3 seconds.` : 'Not measured — no reference video uploaded.',
              shotRhythm: a ? `Median shot ${a.medianShotSeconds}s across ${a.shotCount} shots.` : '',
              audioMood: a?.averageLevelDb != null ? `Average level ${a.averageLevelDb} dBFS (approximate, not LUFS).` : '',
              matchPlan: a
                ? [
                    `Aim for clips around ${a.medianShotSeconds}s; split long talking-head clips or cover them with B-roll to reach that rhythm.`,
                    a.cutsInFirst3s >= 2 ? 'The reference cuts quickly in the opening — use a punchy hook line plus a title in the first 2 seconds.' : 'The opening holds on one shot — let the hook line breathe.',
                    'Title treatment, transitions and music genre are not measured; describe them in setup notes or connect an AI provider.',
                  ]
                : [],
              confidence: 'Measured in your browser from the uploaded file. No AI used.',
            };
          } else {
            insights = await api('/ai/reference', { method: 'POST', body: { projectId: p.id } });
          }
          await mutate((d) => (d.referenceInsights = { ...insights, at: new Date().toISOString() }));
        }),

      // ----- files -----
      addFiles: async (files, kind) => {
        const user = await currentUser();
        for (const file of files) act.addFile(file, kind, user).catch(() => {});
      },
      addFile: async (file, kind, user, local) => {
        const aid = uid('ast');
        const base = `${user.id}/${id}/${aid}`;
        const patch = (fields) => mutate((p) => Object.assign(p.assets.find((a) => a.id === aid) || {}, fields));
        activeUploads.add(aid);
        const localFields = local ? { source: 'local', folderId: local.folderId, relPath: local.relPath, lastModified: file.lastModified } : {};
        await mutate((p) => p.assets.push({ id: aid, kind, name: file.name.slice(0, 160), mime: file.type, size: file.size, ...localFields, status: 'processing', step: 'Reading file', progress: 0.02, createdAt: new Date().toISOString() }));
        try {
          if (/^image\//.test(file.type) || /\.(jpe?g|png|webp|gif)$/i.test(file.name)) {
            // A still image (B-roll photo): no audio, rendered with a slow pan or as a photo card.
            const bmp = await createImageBitmap(file);
            const fields = { mediaType: 'image', width: bmp.width, height: bmp.height, duration: 0, hasVideo: true, hasAudio: false };
            await patch({ ...fields, step: local ? 'Saving preview' : 'Uploading', progress: 0.2 });
            const extra = local ? {} : { path: await uploadToStorage(`${base}/original${ext(file.name)}`, file, null, file.type || 'image/jpeg') };
            const c = document.createElement('canvas');
            const sc = Math.min(1, 480 / bmp.width);
            c.width = Math.round(bmp.width * sc);
            c.height = Math.round(bmp.height * sc);
            c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
            const thumb = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
            extra.thumbPath = await uploadToStorage(`${base}/thumb.jpg`, thumb, null, 'image/jpeg');
            await mutate((p) => Object.assign(p.assets.find((x) => x.id === aid), { ...fields, ...extra, thumb: true, status: 'ready', step: null, progress: 1, error: null }));
            return aid;
          }
          const info = await probeFile(file);
          await patch({ ...info, step: 'Reading audio', progress: 0.08 });
          // Decoding audio loads the whole file into memory; skip it for very large files.
          const buf = info.duration < 1800 && file.size < 1.5e9 ? await decodeAudio(file) : null;
          const fields = { hasAudio: !!buf };
          let peaks = null;
          if (buf) {
            peaks = peaksFrom(buf);
            if (kind === 'footage') fields.silences = silencesFrom(buf);
          }
          let thumb = null;
          if (info.hasVideo) thumb = await thumbnailFrom(file).catch(() => null);
          if (kind === 'reference' && info.hasVideo) {
            await patch({ ...fields, step: 'Measuring cuts and pacing', progress: 0.12 });
            fields.analysis = await analyzeReference(file, info, buf);
          }
          const extra = {};
          if (!local) {
            await patch({ ...fields, step: 'Uploading', progress: 0.15 });
            let last = 0;
            extra.path = await uploadToStorage(`${base}/original${ext(file.name)}`, file, (pr) => {
              if (Date.now() - last > 600) {
                last = Date.now();
                setProject({ ...ref.current, assets: ref.current.assets.map((a) => (a.id === aid ? { ...a, progress: 0.15 + pr * 0.8 } : a)) });
              }
            });
          } else {
            // The video stays on this computer; only a small thumbnail and waveform are stored.
            await patch({ ...fields, step: 'Saving preview', progress: 0.9 });
          }
          if (thumb) extra.thumbPath = await uploadToStorage(`${base}/thumb.jpg`, thumb, null, 'image/jpeg');
          if (peaks) extra.peaksPath = await uploadToStorage(`${base}/peaks.json`, new Blob([JSON.stringify(peaks)], { type: 'application/json' }), null, 'application/json');
          await mutate((p) => {
            Object.assign(p.assets.find((a) => a.id === aid), { ...extra, thumb: !!thumb, hasPeaks: !!peaks, status: 'ready', step: null, progress: 1, error: null });
            if (kind === 'music' && !p.timeline.music.assetId) p.timeline.music.assetId = aid;
          });
          return aid;
        } catch (e) {
          await patch({ status: 'error', step: null, error: e.message.slice(0, 300) });
          toast(`${file.name}: ${e.message}`, 'err');
          return null;
        } finally {
          activeUploads.delete(aid);
        }
      },

      // ----- folders on this computer -----
      linkFolder: async (picked) => {
        const f = picked || (await folder.pickFolder());
        if (!(ref.current.folders || []).some((x) => x.id === f.id)) await mutate((p) => (p.folders = [...(p.folders || []), { id: f.id, name: f.name }]));
        await refreshFolders();
        return f;
      },
      reconnectFolder: async (folderId, fileList) => {
        if (fileList) folder.registerPickedFiles(fileList, folderId);
        else if (!(await folder.reconnectFolder(folderId))) return toast('The browser did not allow access to the folder.', 'err');
        folder.forgetLocalUrls(folderId);
        await refreshFolders();
      },
      unlinkFolder: (folderId) => mutate((p) => (p.folders = (p.folders || []).filter((f) => f.id !== folderId))),
      listFolder: (folderId) => folder.listFolder(folderId),
      /** entries: [{ relPath, kind: 'footage'|'broll'|'music'|'reference' }] from listFolder */
      addLocalFiles: async (folderId, entries, listing = []) => {
        const user = await currentUser();
        for (const e of entries) {
          const file = await folder.getLocalFile(folderId, e.relPath);
          if (!file) {
            toast(`Could not open ${e.relPath}`, 'err');
            continue;
          }
          const aid = await act.addFile(file, e.kind, user, { folderId, relPath: e.relPath });
          // A caption file next to the video (same name, .srt or .vtt) becomes its transcript.
          const side = folder.findSidecar(listing, e.relPath);
          if (aid && side && (e.kind === 'footage' || e.kind === 'broll')) {
            const sub = await folder.getLocalFile(folderId, side.relPath);
            if (sub) await act.importTranscript(aid, await sub.text());
          }
        }
      },
      removeAsset: (asset) =>
        run('remove', async () => {
          const p = ref.current;
          const tl = normalizeTimeline(p.timeline);
          const used = tl.clips.some((c) => c.assetId === asset.id) || tl.broll.some((b) => b.assetId === asset.id) || tl.music.assetId === asset.id;
          if (used) {
            const next = {
              ...tl,
              clips: tl.clips.filter((c) => c.assetId !== asset.id),
              broll: tl.broll.map((b) => (b.assetId === asset.id ? { ...b, assetId: null } : b)),
              music: tl.music.assetId === asset.id ? { ...tl.music, assetId: null } : tl.music,
              captions: { ...tl.captions, items: tl.captions.items.filter((c) => c.assetId !== asset.id) },
            };
            await commit(next, `Removed file ${asset.name}`);
          }
          await mutate((d) => {
            d.assets = d.assets.filter((x) => x.id !== asset.id);
            d.transcript.segments = d.transcript.segments.filter((s) => s.assetId !== asset.id);
          });
          if (!asset.sample) {
            const user = await currentUser();
            store.removeStoragePrefix(`${user.id}/${id}/${asset.id}`).catch(() => {});
          }
        }),

      // ----- transcript -----
      importTranscript: (assetId, text) =>
        run('transcript', async () => {
          const a = ref.current.assets.find((x) => x.id === assetId);
          const { segments, timing } = parseTranscriptFile(text || '', a?.duration);
          if (!segments.length) throw new Error('No transcript lines found in that file.');
          let count = 0;
          await mutate((p) => (count = setAssetSegments(p.transcript, assetId, segments, timing === 'exact' ? 'import' : 'import-estimated')));
          toast(`Imported ${count} lines${timing === 'estimated' ? ' (estimated timing)' : ''}`);
        }),
      setSegments: (assetId, segments, source) => mutate((p) => setAssetSegments(p.transcript, assetId, segments.slice(0, 5000), source)),
      editSegment: (sid, text) =>
        mutate((p) => {
          const s = p.transcript.segments.find((x) => x.id === sid);
          if (s) s.text = String(text).slice(0, 600);
        }),
      /** OpenAI speech-to-text: the audio track (16 kHz mono WAV) goes to Storage, the API splits it at pauses and transcribes each part. */
      transcribe: (assetId) =>
        run('transcribing', async () => {
          needsConsent('openai:audio', 'ChatGPT (OpenAI)', 'OpenAI states that API data is not used to train its models by default.', 'audio');
          const a = ref.current.assets.find((x) => x.id === assetId);
          try {
            setStatus('Reading the audio…');
            const buf = await decodeAudio(await assetBlob(a, urls));
            if (!buf) throw new Error('Could not read the audio in this file.');
            const wav = await speechWav(buf);
            if (wav.size > 48 * 1024 * 1024) throw new Error('This clip is longer than about 25 minutes. Trim it, or import a caption file.');
            setStatus('Uploading the audio…');
            const user = await currentUser();
            const path = await uploadToStorage(`${user.id}/${id}/${a.id}/speech.wav`, wav, null, 'audio/wav');
            setStatus('Transcribing with OpenAI…');
            const out = await api('/transcribe/openai', { method: 'POST', body: { projectId: id, assetId, path } });
            if (!out.segments?.length) throw new Error('No speech was found in this file.');
            let count = 0;
            await mutate((p) => (count = setAssetSegments(p.transcript, assetId, out.segments, 'openai-transcribe')));
            toast(`Transcribed ${count} lines with OpenAI`);
          } finally {
            setStatus(null);
          }
        }),

      // ----- exports -----
      recordExport: (rec) =>
        mutate((p) => {
          p.exports = [rec, ...(p.exports || []).filter((e) => e.id !== rec.id)].slice(0, 10);
          if (rec.status === 'done') p.status = 'exported';
        }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, engine, mutate, commit, run, urls],
  );

  const allowConsent = useCallback(async () => {
    const c = consent;
    setConsent(null);
    await act.allowConsent(c.provider.id);
    c.retry();
  }, [consent, act]);

  return { project, error, busy, status, urls, folders, ops, act, consent, allowConsent, cancelConsent: () => setConsent(null) };
}
