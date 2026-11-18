# Editflow (working name)

Story-first video editing for solo creators and small agencies. Upload a talking-head, podcast or product clip and say who it's for. Editflow drafts an editable first cut with a hook, story structure, captions, B-roll ideas and music direction. You refine it in plain language or with simple controls, then export an MP4.

**Live:** https://editflow-brown.vercel.app

**Stack:** React + Vite (hosted on Vercel) · Supabase (Auth, Postgres with row-level security, Storage) · one Vercel serverless function for AI calls · ffmpeg.wasm for rendering in the browser.

> To rename the product, change `client/src/lib/brand.js`.

---

## How it fits together

```
Browser (Vercel static site)                       Supabase                     Vercel function (/api)
──────────────────────────                         ────────                     ─────────────────────
React app ── sign in ───────────────────────────▶  Auth (email, guest)
          ── projects / history (RLS per user) ─▶  Postgres
          ── upload footage (≤ 50 MB/file) ─────▶  Storage: media/<user>/<project>/…
          ── or read it from a folder on the PC (no upload, any size); exports saved back there
          ── probe, waveform, pauses, thumbnails: in the browser
          ── export: ffmpeg.wasm renders the MP4 on the user's device
          ── "make a first cut" / "make it faster" ────────────────────────────▶  AI adapters (FreeLLMAPI, OpenAI,
                                                                                   Claude, Gemini) with the user's
                                                                                   encrypted keys; Groq Whisper
```

Video never passes through the Vercel function, so its 4.5 MB request limit doesn't apply. Uploads go straight to Supabase Storage, and rendering happens in the browser.

### Work from a folder on your computer

For files over the 50 MB upload limit (or to avoid uploading at all), choose **Use a folder on this computer** when you start a project, or **Link folder** in the studio's Media tab. Pick the folder your videos download to (Downloads, Videos, a shoot folder), tick the files you want and choose footage, B-roll, music or reference for each.

- The video stays on your computer. The browser reads it directly for preview, analysis and export; only a small thumbnail and waveform go to your account.
- A caption file with the same name next to a video (`interview.mp4` + `interview.srt` or `.vtt`) is imported as its transcript.
- Exports are saved into an **Editflow exports** folder inside the linked folder (exports under 50 MB are also kept in your account).
- **Chrome and Edge on desktop** remember the folder: on a later visit, click **Allow access** once. Other browsers (Firefox, Safari) can read the folder for the current visit only, so choose it again after reloading, and exports download instead of saving into the folder.
- The project only plays on a computer where that folder is linked. On another device, the clips show "folder not connected" until you link a folder with the same files.

---

## Deploy (Vercel + Supabase)

**Already done for the live site:** the Vercel project `editflow` deploys automatically on every push to `main` and has `EDITFLOW_SECRET` set. In Supabase Auth, the Site URL and redirect URL point at the Vercel domain, anonymous (guest) sign-ins are on, and email confirmation is off. The steps below are for setting it up again or somewhere else.

The Supabase project `editflow` is already set up: tables, row-level security and the `media` storage bucket are applied from `supabase/migrations/0001_init.sql`. Its URL and publishable key are in `shared/config.js`. Publishable keys are safe to ship to browsers.

1. **Import the repo in Vercel.** Go to vercel.com → Add New → Project, pick this GitHub repo, and keep the settings from `vercel.json`. Framework preset: Other.
2. **Add one environment variable** in Vercel → Settings → Environment Variables:
   - `EDITFLOW_SECRET`: a long random string (for example the output of `openssl rand -hex 32`). It encrypts users' AI provider keys. Don't change it later, or saved keys stop decrypting.
3. **Deploy.** You get a URL like `https://editflow-xxxx.vercel.app`.
4. **Point Supabase Auth at it.** In the Supabase dashboard → Authentication → URL Configuration:
   - Site URL: your Vercel URL
   - Redirect URLs: add `https://<your-vercel-url>/**`
5. **Choose the sign-up behaviour** in Authentication → Sign In / Providers:
   - Turn on **Allow anonymous sign-ins** so the "Explore the demo" button works without an account.
   - **Confirm email** is on by default. Supabase's built-in email sender is heavily rate-limited, so for a public demo either turn confirmation off or add your own SMTP under Authentication → Emails.

Optional overrides: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (browser) and `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (function), if you point the app at a different Supabase project. Apply `supabase/migrations/0001_init.sql` to that project first.

---

## Run locally

Requirements: Node.js 20+.

```bash
npm install
npm run dev      # http://localhost:5173 — the /api function runs inside the dev server
```

Local dev uses the same hosted Supabase project by default. Put `EDITFLOW_SECRET=...` in a `.env` file if you want to save AI keys locally.

Tests (no network needed: they use in-memory stand-ins for Supabase and FreeLLMAPI, plus native ffmpeg for the render check):

```bash
npm test
```

To run the whole app offline against the stand-ins: `npm run mock:supabase` and `npm run mock:freellmapi`, then start Vite with `VITE_SUPABASE_URL=http://localhost:54321 SUPABASE_URL=http://localhost:54321 npm run dev`.

---

## AI providers

| Provider | Billing | Notes |
|---|---|---|
| Rule-based (built in) | Free, no AI | Transparent heuristics; output is always labelled "Rule-based · no AI used". Runs in the browser. |
| FreeLLMAPI router | Free tiers of keys you add | Self-hosted router ([repo](https://github.com/tashfeenahmed/freellmapi)). On the hosted app it needs a **public https URL**: the app refuses `localhost` and private addresses. Its authors label it for personal experimentation, not production. |
| OpenAI | Paid API billing | ChatGPT subscriptions are billed separately from the API. |
| Anthropic (Claude) | Paid API billing | Claude.ai subscriptions are separate from API usage. |
| Google Gemini | Rate-limited free tier, then paid | Free-tier data may be used to improve Google's products. |
| Groq Whisper (transcription) | Free plan with limits | 25 MB per file (≈13 min of 16 kHz audio). Only the audio is sent. |

Each user adds their own keys in **AI settings**. Keys are encrypted with `EDITFLOW_SECRET` and stored in Supabase; the browser never sees them in plaintext. Editflow asks for consent per project before any transcript or audio leaves the browser.

**Important:** don't put one shared free-tier router behind the public app for everyone. Provider free tiers generally forbid sharing access, and FreeLLMAPI is labelled not for production. For real customers, use paid keys under the providers' commercial terms.

---

## What works today

- Accounts (email/password, guest demo through anonymous sign-in, upgrading a guest to a full account), private projects per user, a sample project
- Uploads with progress straight to Supabase Storage, or working straight from a folder on the user's computer (any file size, exports saved back into the folder); in-browser reading of duration and resolution, waveforms, pause detection, thumbnails, and reference-video pacing (frame sampling)
- Story planning (AI or rule-based) as a structured plan: hook options, beats, clip order, captions, B-roll tied to lines with reasons, music mood, sound-design notes, audio clean-up, a review checklist
- Edits stored as JSON ops with undo/redo and history (`project_history` table); AI proposals previewed before they apply
- Manual editing: trim, split, reorder, delete, volume, transitions, caption styles and text, 4 text templates, B-roll slots, music with ducking, loudness normalisation, noise reduction, text-based cutting
- Export in the browser with ffmpeg.wasm: 9:16, 1:1, 4:5 or 16:9 at 540p, 720p or 1080p, with burned-in captions and titles, B-roll cutaways, a −14 LUFS voice and ducked music. Exports under 50 MB are also saved to the user's account.

## Limits to know

- **Supabase Free plan:** 50 MB per uploaded file (use a linked folder for bigger files), and projects pause after a period of inactivity. Upgrade before regular use.
- **Browser rendering** is slower than a server: Draft takes roughly 1–3× the video length on a laptop, and it needs a desktop browser with enough memory.
- Sample project: placeholder footage, a synthetic speech tone and a written transcript, all labelled.
- Reframing is a center crop. Reference title style, transitions and music genre aren't measured.
- On-device Whisper transcription is experimental (it downloads its model from Hugging Face).

## Developing

See [docs/DEVELOPING.md](docs/DEVELOPING.md).
