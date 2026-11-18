# Editflow — notes for AI coding assistants

Read `docs/DEVELOPING.md` first: architecture, data model and recipes for adding features.

Essentials:
- Stack: React + Vite (plain JSX) on Vercel; Supabase for Auth, Postgres (RLS on every table) and Storage; one Vercel function (`api/index.js` → `server/api/handler.js`) for AI calls; ffmpeg.wasm renders exports in the browser.
- The edit is data: every change is an op in `shared/timeline.js`. New editing features = op + render (`shared/render-graph.js`) + preview (`client/src/components/Player.jsx`) + UI control.
- Client state changes go through `mutate`/`commit` in `client/src/lib/useProject.js` (never write the project from two places).
- The API runs every query with the user's own Supabase session (RLS applies). AI calls go through `runJsonTask` (consent, JSON repair, logging). Never present rule-based output as AI.
- Keys are encrypted with `EDITFLOW_SECRET` server-side and never returned to the browser.
- Video never goes through the API (Vercel's request limit is 4.5 MB): uploads go straight to Supabase Storage.
- Schema changes: add a new file in `supabase/migrations/` and apply it to the project.
- Run `npm test` before finishing; add unit tests for new ops.
