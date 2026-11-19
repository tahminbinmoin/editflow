# Editflow (working name)

A professional short-form editor for creators: every project is a vertical 9:16 reel (Instagram Reels, TikTok, YouTube Shorts). Upload a talking-head, podcast or product clip and pick the type of reel. Editflow cuts it word by word, removing every silence, filler, stutter, abandoned take and mumble, and two AI passes (a story editor, then a senior-editor review) pick the strongest hook and the lines that earn their place. ChatGPT or Claude can then look at the video and add B-roll and animated motion graphics. You refine it in plain language or with simple controls, then export an MP4.

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
          ── first cut / "make it faster" / analyse video (frames) ──────────▶  ChatGPT (OpenAI) or Claude
                                                                                   (Anthropic) with the user's
                                                                                   encrypted keys; OpenAI transcription
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

Tests (no network needed: they use in-memory stand-ins for Supabase and the OpenAI/Anthropic APIs, plus native ffmpeg for the render check):

```bash
npm test
```

To run the whole app offline against the stand-ins: `npm run mock:supabase` and `npm run mock:ai`, then start Vite with `VITE_SUPABASE_URL=http://localhost:54321 SUPABASE_URL=http://localhost:54321 OPENAI_BASE_URL=http://localhost:3999/openai/v1 ANTHROPIC_BASE_URL=http://localhost:3999/anthropic/v1 npm run dev` and use the keys `sk-test` / `sk-ant-test`.

---

## AI: ChatGPT and Claude

| Option | Billing | What it does |
|---|---|---|
| Rule-based (built in) | Free, no AI | Transparent heuristics; output is always labelled "Rule-based · no AI used". |
| ChatGPT (OpenAI API) | Your OpenAI API key, pay per use | First cut, change requests, **video analysis** (still frames → B-roll and motion graphics), **transcription** (`gpt-transcribe`). Default model `gpt-6.2-sol`. |
| Claude (Anthropic API) | Your Anthropic API key, pay per use | First cut, change requests, **video analysis**. Default model `claude-sonnet-5-5`. Claude doesn't transcribe audio; transcription always uses the OpenAI key. |

**Subscriptions vs API keys.** A ChatGPT Plus/Pro or Claude Pro/Max subscription can't power Editflow:
- Anthropic's terms don't allow Claude subscription logins in third-party apps.
- OpenAI's "Sign in with ChatGPT" plan usage is only open to approved partner apps for hosted products. You can apply through OpenAI's interest form.

Until then, each user adds an API key from platform.openai.com or console.anthropic.com in **AI settings**. Keys are encrypted with `EDITFLOW_SECRET` and stored in Supabase; the browser never sees them in plaintext.

**Consent.** Editflow asks per project before anything leaves the browser, and asks separately for each kind of data:
- the transcript, for planning;
- still frames, for video analysis;
- the audio track, for transcription.

**Video analysis ("Analyse video").** Pick a look (Editorial, Clean or Bold) and how much B-roll you want, then:
1. The browser samples 8–24 small still frames across the cut, plus one frame of each of your B-roll clips.
2. ChatGPT or Claude plans the visual layer from the frames, the timed lines and the brief:
   - B-roll shots, each with a layout (full screen, split screen or photo card) and stock search phrases;
   - motion graphics, punch-in zooms and caption keywords.
3. Editflow finds footage for every shot your own clips don't cover. It searches Pexels and Pixabay, then the model takes a **second look** at the candidate thumbnails and picks the best match, or none.
4. Picked clips are downloaded into the project's Storage folder with their credit. Shots with no good match become AI images (OpenAI `gpt-image-2`) if that option is on.
5. Everything arrives as one proposal to preview. Discarding it deletes the downloaded files.

**B-roll sources.** Add a free [Pexels](https://www.pexels.com/api/new/) and/or [Pixabay](https://pixabay.com/api/docs/) key in **AI settings → B-roll sources**. You can also set `PEXELS_API_KEY` / `PIXABAY_API_KEY` on Vercel to provide them for every user. Licences: Pexels (free, credit appreciated) and the Pixabay Content License. Every stock asset keeps its source page and author, shown in the Media tab and the B-roll editor. In the B-roll editor you can also search stock yourself, or generate an AI image for a slot.

**Transcription.** The browser makes a 16 kHz mono WAV and uploads it to Storage. The API then:
1. splits it at pauses (`shared/speech.js`);
2. transcribes the parts with OpenAI, 6 at a time;
3. uses each part's start and end as the line timing;
4. deletes the audio.

Clips can be up to about 25 minutes.

## What works today

- **Clean cut (word level):** speech-to-text with word timing (OpenAI `whisper-1` word timestamps merged onto the better `gpt-transcribe` text), plus a 10 ms voice-activity map of the audio. Cuts land on the real edge of the voice; fillers (um, uh, “you know,”…), stutters, abandoned takes (the last take is kept), words heard in silence and mumbling with no words are removed; every pause over the chosen limit (Natural 0.3 s, Tight 0.15 s, Ultra 0.07 s) is cut, and jump cuts alternate a gentle punch-in. Captions are rebuilt from the kept words with exact word timing. In the transcript you can cut any word, or bring back one the clean cut removed, and only that part of the edit is re-cut.
- **Reel story edit in two passes:** the planner sees the cleaned transcript (removed words marked, spoken seconds per line) and strict reel rules (hook in the first 1–2 s, one idea, best take only, every line earns its place, length within ±15%); a second pass reviews the draft as it will actually play, scores hook / retention / clarity / payoff and returns an improved plan.
- **Reel check:** a measured quality check (dead air, mumbling, leftover fillers, weak opener, length, repeated footage, flash frames, stretches with no visual change, caption coverage, mid-sentence ending) with a one-click fix, shown in the studio, on proposals and before export.
- **Types of reel and house styles:** Tips, Storytime, Explainer, Hot take, Podcast clip, Product, Motivation, Day in the life (admins can add more). Each can have a house style trained by Editflow's editors that every first cut of that type follows.
- **Admin area** at `/admin` with its own sign-in (admin accounts are created with one-time invite codes): usage stats, invite codes, and the **training studio**: add finished professional edits as examples (including what the editor changed from the AI's cut), train a house style from them with ChatGPT or Claude, review/edit, publish versions, and export chat-format JSONL for a real fine-tuning job later.
- **Billing-ready (payments off):** plans and limits in `shared/plans.js`, usage recorded per user (`usage_events`), a `subscriptions` table only the server can write, and stub checkout/webhook routes. See “Payments later” below.

- Accounts (email/password, guest demo through anonymous sign-in, upgrading a guest to a full account), private projects per user, a sample project
- Uploads with progress straight to Supabase Storage, or working straight from a folder on the user's computer (any file size, exports saved back into the folder); in-browser reading of duration and resolution, waveforms, pause detection, thumbnails, and reference-video pacing (frame sampling)
- Story planning (ChatGPT, Claude or rule-based) as a structured plan: hook options, beats, clip order, captions, B-roll tied to lines with reasons, music mood, sound-design notes, audio clean-up, a review checklist
- Video analysis with ChatGPT or Claude (see above): B-roll that actually gets added (stock, AI images or your clips), motion graphics, punch-in zooms and caption keywords, in one of three looks modelled on reference creators:
  - **Editorial:** Neel Nafis-style cream panels with serif headlines and italic coloured keywords.
  - **Clean:** Ali Abdaal-style white cards, statement cards and handwritten notes.
  - **Bold:** promo-reel style.
- 18 motion graphics:
  - **Editorial:** headline panel, stat + self-drawing chart, pictogram, definition card.
  - **Clean:** icon header, polaroid photo card, thought/speech bubble, tier list, versus, emoji pop, follow button.
  - **Bold:** keyword pop, stat counter, lower third, checklist, chapter tag, callout arrow, progress bar.
  - Top panels push the speaker down and full-screen cards cover the frame.
  - All of them are drawn by one Canvas 2D implementation in the preview and the export.
- Animated captions (pill, pop, editorial, karaoke): word by word, with keyword colour. Bangla works, thanks to Hind Siliguri and canvas rendering.
- Premiere-style timing: drag a caption's edges to stretch it (it rolls into the next caption), or set In / Out / Duration to the frame. Scrub by dragging the playhead or the ruler, and use ←/→ to step one frame (Shift for one second).
- B-roll layouts: full screen, split screen (speaker below), photo card. Images get a slow pan.
- Punch-in zooms per clip, and synthesised sound effects (pop, whoosh, ding, click) on graphics and B-roll.
- Transcription with OpenAI (word-level timing), or import .srt/.vtt (word timing estimated from the voice map)
- Edits stored as JSON ops with undo/redo and history (`project_history` table); AI proposals previewed before they apply
- Manual editing: trim, split, reorder, delete, volume, transitions, caption styles and text, 4 text templates, 7 motion graphics, B-roll slots, music with ducking, loudness normalisation, noise reduction, text-based cutting
- Export in the browser with ffmpeg.wasm: vertical 9:16 at 540p, 720p or 1080p, with burned-in captions and titles, motion graphics, B-roll cutaways, a −14 LUFS voice and ducked music. Exports under 50 MB are also saved to the user's account.

## Admins and training

1. Go to `/admin/login`, choose “I have an invite code”, and create an admin account with a separate email, a 12+ character password and the invite code. The first code was created in the database; more come from the admin area (“Create invite code”, valid 7 days, single use, stored hashed).
2. Edit reels by hand in the studio with that admin account until they're exactly right, then add them as examples of their type in the training studio.
3. Click **Train** (uses the admin account's active ChatGPT or Claude key). Check the draft rules, edit them, then **Publish**. Every creator's first cut of that type now follows it.

“Training” teaches through the prompt (rules + worked examples); it doesn't change ChatGPT's or Claude's weights. The JSONL export is ready for an OpenAI fine-tuning job if you want a fine-tuned model later.

## Payments later

Nothing is charged and nothing is limited today (free beta). To switch payments on: add a payment provider adapter in `server/billing/index.js` (Stripe, Paddle, Lemon Squeezy, or SSLCommerz / bKash for Bangladesh), set prices in `shared/plans.js`, make the webhook write `subscriptions` with the Supabase service-role key, then set `BILLING_ENABLED=true` on Vercel. Limits are already checked at AI tasks, transcription and export.

## Limits to know

- **Accuracy:** word timing comes from OpenAI's `whisper-1` (OpenAI supports its word timestamps until 26 Feb 2027) and is refined with the audio's voice map. If word timing isn't available, timing is estimated from the audio. Always watch the reel before posting; the Reel check flags what it can measure.

- **Supabase Free plan:** 50 MB per uploaded file (use a linked folder for bigger files), and projects pause after a period of inactivity. Upgrade before regular use.
- **Browser rendering** is slower than a server: Draft takes roughly 1–3× the video length on a laptop, and it needs a desktop browser with enough memory.
- Sample project: placeholder footage, a synthetic speech tone and a written transcript, all labelled.
- Reframing is a center crop. Reference title style, transitions and music genre aren't measured.
- Video analysis sees still frames, not motion or sound. Graphic placement (like a callout's target) is the model's estimate from those frames, so check it in the preview.
- Stock search needs a Pexels or Pixabay key. Pixabay asks API users to cache searches for 24 hours; Editflow doesn't cache yet, so keep volumes low or add a cache before scaling.
- Motion graphics and animated captions are rendered as PNG frames in the browser before the ffmpeg pass. Long videos at 1080p take noticeably longer to export than Draft.

## Developing

See [docs/DEVELOPING.md](docs/DEVELOPING.md).
