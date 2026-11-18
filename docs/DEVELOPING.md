# Developing Editflow

A map of the codebase and recipes for the most common kinds of change.

## Run it

```bash
npm install
npm run dev     # Vite on :5173; /api/* is served by server/api/handler.js inside the dev server
npm test        # unit + API (mock Supabase + mock FreeLLMAPI) + native render of the sample
npm run build   # what Vercel runs
npm run sample  # regenerate the sample media in client/public/sample
```

## Map

```
client/                    React app (Vite root)
  src/lib/supabase.js      Supabase client (URL + publishable key from shared/config.js or VITE_* env)
  src/lib/store.js         projects + history in Postgres (RLS), storage cleanup
  src/lib/useProject.js    studio state + every action (edits, AI, uploads, transcripts, exports)
  src/lib/media.js         in-browser media: probe, waveform, pauses, thumbnails, reference pacing, uploads, signed URLs
  src/lib/render.js        ffmpeg.wasm export (runs shared/render-graph.js plans)
  src/lib/sample.js        builds the sample project from client/public/sample
  src/components/          Player, Timeline, panels (Story, Transcript, Media, AI, Edit)
  src/pages/               Landing, Auth, Dashboard, NewProject, Studio, Export, Settings
  public/sample/           sample media (committed); public/ffmpeg + public/fonts are copied at build
api/index.js               Vercel function entry → server/api/handler.js
server/api/handler.js      routes: /engine, /settings/ai*, /ai/first-cut, /ai/refine, /ai/reference, /transcribe/groq
server/ai/providers.js     provider adapters + Groq Whisper + router-URL safety check
server/lib/secrets.js      AES-256-GCM with EDITFLOW_SECRET
shared/                    pure modules used by browser, API and tests
  timeline.js              edit model + ops      plan.js       plan → timeline
  rules.js                 rule-based drafter    prompts.js    AI prompts
  render-graph.js          export as ffmpeg commands    transcript.js  SRT/VTT/text parsing
  project.js               project document     probe.js      ffmpeg log parser     config.js
supabase/migrations/       schema, RLS policies, storage bucket
test/                      unit, API and render tests + mock-supabase.js, mock-freellmapi.js
```

**The one idea to keep:** the edit is data. `project.timeline` is JSON; every change is an op applied by `shared/timeline.js`; every committed change is a row in `project_history`. The preview (`Player.jsx`) and the export (`render-graph.js`) read the same timeline.

### Data model (Supabase)

| Table | What | Access |
|---|---|---|
| `projects` | `id, user_id, name, status, is_sample, data jsonb` | owner only (RLS) |
| `project_history` | timeline snapshots for undo/history | owner only |
| `provider_settings` | per-user AI config + encrypted key (`secret`) | owner only; the API decrypts |
| `ai_log` | AI request log (provider, routed model, tokens, errors) | owner only |
| storage `media` | `<user id>/<project id>/<asset id>/original.*, thumb.jpg, peaks.json`, `…/exports/*.mp4` | owner folder only |

`projects.data` holds `settings`, `assets[]`, `transcript.segments[]` (IDs `s1`, `s2`…), `plan`, `timeline`, `history {entries, index}`, `pending` (AI proposal), `consent`, `chat[]`, `exports[]`, `mode`, `referenceInsights`.

### Timeline shape (`shared/timeline.js`)

```js
{
  format:   { aspect: '9:16' },
  clips:    [{ id, assetId, in, out, volume, transitionIn, role, note }],  // in/out = SOURCE seconds
  captions: { enabled, style, position, items: [{ id, assetId, start, end, text }] }, // SOURCE seconds → follow clips
  overlays: [{ id, template, text, sub, start, duration }],   // TIMELINE seconds
  broll:    [{ id, start, duration, description, reason, assetId|null, srcIn }],
  music:    { assetId|null, mood, volume, duck, notes },
  audio:    { normalize, denoise, voiceVolume },
  sound:    [{ id, at, description }]                          // notes only
}
```

## Recipes

### Add an edit operation (e.g. clip speed)
1. `shared/timeline.js`: field + `case` in `applyOp` (throw readable errors) + `describeOp`.
2. `shared/render-graph.js`: honour it in the per-clip segment command (`setpts`/`atempo`).
3. `Player.jsx`: approximate it in preview (`playbackRate`).
4. `EditPanel.jsx`: a control that calls `ops([{ type: 'yourOp', … }], 'History label')`.
5. Optional for AI: list it in `refinePrompt` (`shared/prompts.js`) and `REFINE_TYPES` (`server/api/handler.js`).
6. Unit test in `test/unit.test.js`.

### Add a caption style or text template
`CAPTION_STYLES`/`OVERLAY_TEMPLATES` in `shared/timeline.js`; an ASS `Style:` in `buildAss()` (`shared/render-graph.js`, colours `&HAABBGGRR`); a `.cap-*`/`.ov-*` class in `client/src/styles.css`. New fonts go in `assets/fonts/` (copied to `client/public/fonts`) and are written into ffmpeg.wasm in `loadFFmpeg()`.

### Add an AI provider
Add an entry to `PROVIDERS` in `server/ai/providers.js` (`test()` and `chat()`, honest `billing` and `dataUse`). Settings, encryption, consent, logging and the "answered by" badge pick it up automatically.

### Add an AI capability
Prompt builder in `shared/prompts.js` (JSON only, segment IDs not timestamps) → route in `server/api/handler.js` using `runJsonTask` → validate output in the client before it touches the timeline → store as `pending` so the user previews it → a rule-based fallback in `shared/rules.js` or a clear message.

### Add a database field or table
Write `supabase/migrations/000N_name.sql` (enable RLS + owner policies), apply it to the Supabase project, then use it from `client/src/lib/store.js` or the API.

### Add a page
Component in `client/src/pages/`, route in `client/src/App.jsx` (wrap in `<Private>`), link in `components/AppHeader.jsx`.

## Conventions (product rules)
- Never present rule-based output as AI (`meta.engine = 'rules'`).
- Ask before a transcript or audio leaves the browser (consent per project and provider).
- Never call something "free" unless the user's access path supports it.
- Keys: server-side, encrypted, never returned or logged.
- Big AI changes are previewed (`pending`), and everything is undoable.
- No fake social proof.

## Production checklist
| Area | Now | Next |
|---|---|---|
| Plan limits | Supabase Free (50 MB files, pauses when idle) | Supabase Pro; raise the bucket limit and `MAX_UPLOAD_MB` |
| Rendering | ffmpeg.wasm in the browser | add a server render worker for long or high-res exports |
| AI | users' own keys (free tiers for prototyping) | paid keys under commercial terms; usage limits per plan |
| Auth emails | Supabase built-in sender | custom SMTP, CAPTCHA |
| Billing | none | Stripe + plan limits |

## Feature backlog (where each would go)
| Feature | Main files |
|---|---|
| Word-level karaoke captions | Groq `timestamp_granularities[]=word`; caption items per word; ASS `\k` tags in `buildAss` |
| Clip speed / punch-in zoom | ops in `timeline.js`; filters in the segment command in `render-graph.js` |
| Face-aware reframing | face boxes from a vision step; crop focus per clip used in `fit` |
| Multi-track timeline | generalise `broll` into `tracks[]`; overlay chain in the final command; track rows in `Timeline.jsx` |
| Brand kits | `brands` table; inject fonts/colours into ASS styles + preview CSS |
| Team review links | share-token table + read-only Studio view + timestamped comments |
| Silence-removal slider | `asset.silences` → batch of trim ops |
