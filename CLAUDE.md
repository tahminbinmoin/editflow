# Editflow — notes for AI coding assistants

Read `docs/DEVELOPING.md` first: architecture, data model and recipes for adding features.

Essentials:
- Stack: React + Vite (plain JSX) on Vercel; Supabase for Auth, Postgres (RLS on every table) and Storage; one Vercel function (`api/index.js` → `server/api/handler.js`) for AI calls (ChatGPT via the OpenAI API, Claude via the Anthropic API, users' own keys); ffmpeg.wasm renders exports in the browser.
- Motion graphics, photo-card B-roll and animated captions are drawn by `shared/layer.js` (graphics.js, captions-anim.js, gfx-core.js) with Canvas 2D — one implementation for preview and export. Don't add a second renderer. Speaker push-down and sound effects also live there.
- B-roll downloads go server → Storage (`server/media/stock.js`, `/broll/*`): resolve stock by numeric id, download only from allowlisted hosts, never fetch a URL the browser sent.
- The edit is data: every change is an op in `shared/timeline.js`. New editing features = op + render (`shared/render-graph.js`) + preview (`client/src/components/Player.jsx`) + UI control.
- Client state changes go through `mutate`/`commit` in `client/src/lib/useProject.js` (never write the project from two places).
- The API runs every query with the user's own Supabase session (RLS applies). AI calls go through `runJsonTask` (consent, JSON repair, logging). Never present rule-based output as AI.
- Keys are encrypted with `EDITFLOW_SECRET` server-side and never returned to the browser.
- Video never goes through the API (Vercel's request limit is 4.5 MB): uploads go straight to Supabase Storage, or assets are read from a linked local folder (`client/src/lib/localFolder.js`, `source: 'local'`). Read media through `media.assetUrls`/`assetBlob` so both kinds work.
- Schema changes: add a new file in `supabase/migrations/` and apply it to the project.
- Run `npm test` before finishing; add unit tests for new ops.
