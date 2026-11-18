import { layout, formatTime, OVERLAY_TEMPLATES, timelineCaptions } from './timeline.js';
import { GRAPHIC_TYPES, GRAPHIC_COLORS } from './graphics.js';

const t = (s) => formatTime(s);

function transcriptBlock(project) {
  const names = Object.fromEntries(project.assets.map((a, i) => [a.id, `A${i + 1}`]));
  return project.transcript.segments.map((s) => `${s.id} [${names[s.assetId] || '?'} ${t(s.start)}–${t(s.end)}] ${s.text}`).join('\n');
}

function briefBlock(project) {
  const st = project.settings;
  const ref = project.assets.find((a) => a.kind === 'reference' && a.analysis);
  const lines = [
    `Platform / format: ${st.platform || 'short-form social'} (${st.aspect})`,
    `Target length: about ${st.targetLength || 45} seconds`,
    `Audience: ${st.audience || 'not specified'}`,
    `Goal: ${st.goal || 'not specified'}`,
    st.tone ? `Tone: ${st.tone}` : null,
    st.notes ? `Editing notes from the creator: ${st.notes}` : null,
  ];
  if (ref) {
    const a = ref.analysis;
    lines.push(
      `Reference video (MEASURED by ffmpeg, the creator's own upload): ${a.duration}s long, ${a.shotCount} shots, average shot ${a.avgShotSeconds}s, ${a.cutsPerMinute} cuts/min, ${a.cutsInFirst3s} cuts in the first 3s${a.loudnessLufs != null ? `, loudness ${a.loudnessLufs} LUFS` : ''}. Not measured: ${a.notMeasured.join(', ')}.`,
    );
  }
  if (st.referenceNotes) lines.push(`Creator's description of the reference style: ${st.referenceNotes}`);
  return lines.filter(Boolean).join('\n');
}

const GRAPHIC_OPS = `{"type":"addGraphic","graphic":{"type":"${Object.keys(GRAPHIC_TYPES).join('|')}","start":2.0,"duration":2.5,"text":"...","sub":"...","items":["..."],"x":0.5,"y":0.5,"color":"${Object.keys(GRAPHIC_COLORS).join('|')}","position":"top|center|bottom"}}
{"type":"updateGraphic","graphicId":"...","patch":{"text":"...","start":2.0,"duration":2.0,"color":"yellow"}}
{"type":"deleteGraphic","graphicId":"..."}`;

const GRAPHIC_GUIDE = Object.entries(GRAPHIC_TYPES)
  .map(([k, g]) => `- ${k}: ${g.desc}${g.fields.length ? ` (fields: ${g.fields.join(', ').replace('point', 'x, y = 0–1 position of the thing it points at')})` : ''}`)
  .join('\n');

const RULES = `Rules:
- Use ONLY transcript segment IDs that appear in the transcript (e.g. "s3"). Never invent IDs, timestamps, quotes or footage.
- Story structure for short-form: hook (first ~3 s must earn attention), context, progression, payoff, call to action (only if it fits the goal).
- The hook may be moved out of chronological order if a later line is a stronger opener.
- Fit the target length: drop weak, repetitive or rambling segments. Prefer complete thoughts.
- B-roll suggestions must be shots the creator could film themselves or license; explain why each shot helps.
- Music: describe mood/tempo only. Do not name copyrighted songs or artists to copy.
- Be honest in "review": tell the creator what to check (names, claims, jump cuts, missing B-roll).
- Return ONLY a JSON object. No markdown, no commentary.`;

export function planPrompt(project) {
  const system = `You are the story editor inside Editflow, a tool that turns talking-head, podcast and product footage into short-form social videos. You plan edits as structured data that the app applies to a timeline. The creator reviews everything before export.\n\n${RULES}`;
  const templates = Object.keys(OVERLAY_TEMPLATES).join(' | ');
  const user = `CREATOR BRIEF
${briefBlock(project)}

TRANSCRIPT (segment id [asset start–end] text)
${transcriptBlock(project)}

Return JSON with exactly this shape:
{
  "summary": "2-3 sentences: the story angle you chose and why",
  "hookOptions": [{"text": "line or on-screen hook", "segmentIds": ["s4"], "why": "..."}],
  "hookTitle": "optional 2-6 word on-screen title for the first seconds, or empty string",
  "beats": [{"role": "hook|context|progression|payoff|cta", "title": "...", "segmentIds": ["s4"], "why": "..."}],
  "clips": [{"segmentIds": ["s4"], "role": "hook|context|progression|payoff|cta", "note": "why this clip is here", "trimStart": 0, "trimEnd": 0}],
  "captions": [{"segmentId": "s4", "text": "optional tightened caption text for that segment"}],
  "broll": [{"segmentId": "s6", "description": "what to show", "reason": "why it helps the story"}],
  "overlays": [{"segmentId": "s9", "template": "${templates}", "text": "short on-screen text"}],
  "music": {"mood": "e.g. warm, driving lo-fi", "tempo": "e.g. 95-110 BPM", "notes": "where it should lift or drop"},
  "soundDesign": [{"segmentId": "s4", "description": "e.g. subtle whoosh on the title"}],
  "audio": {"suggestions": ["..."], "normalize": true, "denoise": false},
  "review": ["things the creator should check"],
  "changes": ["what this first cut changed compared with the raw footage"]
}
"clips" is the final order of the cut. trimStart/trimEnd are optional seconds (0-2) to shave inside a clip.`;
  return { system, user };
}

export function refinePrompt(project, request) {
  const tl = project.timeline;
  const { clips, duration } = layout(tl);
  const segs = project.transcript?.segments || [];
  const caps = timelineCaptions(tl);
  const clipLines = clips
    .map((c, i) => {
      const said = segs.filter((s) => s.assetId === c.assetId && s.end > c.in && s.start < c.out).map((s) => s.id);
      return `${i + 1}. id=${c.id} role=${c.role || '-'} source=${t(c.in)}–${t(c.out)} timeline=${t(c.tlStart)}–${t(c.tlEnd)} volume=${c.volume} transition=${c.transitionIn} segments=[${said.join(',')}]`;
    })
    .join('\n');
  const system = `You are the editing assistant inside Editflow. The creator asks for changes in plain language; you answer with a small list of edit operations (JSON) that the app previews before applying. Change only what was asked. You only see the transcript here, not the picture: for anything that depends on what is on screen, say in "notes" that the creator can use "Analyse video" (which sends still frames) and propose the closest honest alternative.\nReturn ONLY a JSON object.`;
  const user = `CREATOR BRIEF
${briefBlock(project)}

TRANSCRIPT
${transcriptBlock(project)}

CURRENT CUT (total ${t(duration)})
${clipLines || '(empty)'}
Captions: enabled=${tl.captions.enabled} style=${tl.captions.style} position=${tl.captions.position}; ${caps.length} caption lines
Text overlays: ${JSON.stringify(tl.overlays.map(({ id, template, text, start, duration: d }) => ({ id, template, text, start, duration: d })))}
Motion graphics: ${JSON.stringify((tl.graphics || []).map(({ id, type, text, sub, items, start, duration: d, color, position }) => ({ id, type, text, sub, items, start, duration: d, color, position })))}
B-roll: ${JSON.stringify(tl.broll.map(({ id, start, duration: d, description, assetId }) => ({ id, start, duration: d, description, hasFootage: !!assetId })))}
Music: ${JSON.stringify(tl.music)}
Voice audio: ${JSON.stringify(tl.audio)}

AVAILABLE OPERATIONS (times in seconds; clip in/out are SOURCE times, overlay/broll start are TIMELINE times)
{"type":"trimClip","clipId":"...","in":1.2,"out":4.0}
{"type":"moveClip","clipId":"...","toIndex":0}
{"type":"deleteClip","clipId":"..."}
{"type":"addSegment","segmentId":"s7","index":2}   (adds a transcript segment as a new clip)
{"type":"updateClip","clipId":"...","patch":{"volume":1.0,"transitionIn":"cut|fade|flash","role":"hook|context|progression|payoff|cta"}}
{"type":"setCaptionStyle","patch":{"enabled":true,"style":"bold|clean|boxed|accent","position":"lower|center"}}
{"type":"addOverlay","overlay":{"template":"title|lowerThird|kicker|cta","text":"...","start":0,"duration":2.5}}
{"type":"updateOverlay","overlayId":"...","patch":{"text":"...","start":0,"duration":2}}
{"type":"deleteOverlay","overlayId":"..."}
${GRAPHIC_OPS}
{"type":"addBroll","broll":{"start":3.0,"duration":2.0,"description":"...","reason":"..."}}
{"type":"deleteBroll","brollId":"..."}
{"type":"setMusic","patch":{"mood":"...","volume":0.2,"duck":true}}
{"type":"setAudio","patch":{"normalize":true,"denoise":true,"voiceVolume":1.0}}

CREATOR REQUEST: ${request}

Return JSON: {"summary": "one or two sentences describing the change", "ops": [ ... ], "notes": ["anything the creator should know, including limits"]}`;
  return { system, user };
}

export function referencePrompt(project) {
  const system = 'You analyse the editing style of a reference video from measured statistics and the creator’s description, then give concrete guidance for matching its structure and pacing with the creator’s own footage. Never suggest copying protected footage, music or graphics. Return ONLY JSON.';
  const user = `${briefBlock(project)}

Return JSON: {"structure": "...", "pacing": "...", "shotRhythm": "...", "titleTreatment": "...", "transitions": "...", "audioMood": "...", "matchPlan": ["specific, actionable steps"], "confidence": "what is measured vs inferred from the description"}`;
  return { system, user };
}

/**
 * Video analysis: the model sees still frames sampled across the CURRENT CUT (timeline times),
 * the timed transcript lines, and the creator's own B-roll library, and proposes B-roll and
 * motion graphics tied to what is said and shown.
 */
export function visualsPrompt(project, frameTimes, libraryLabels = []) {
  const tl = project.timeline;
  const { duration } = layout(tl);
  const caps = timelineCaptions(tl);
  const lines = caps.length
    ? caps.map((c) => `${t(c.start)}–${t(c.end)} ${c.text}`).join('\n')
    : '(no captions on the cut yet)';
  const library = project.assets.filter((a) => a.kind === 'broll' && a.status === 'ready' && a.hasVideo !== false);
  const libText = libraryLabels.length
    ? libraryLabels.map((l) => { const a = library[Number(String(l).slice(1)) - 1]; return `${l}: "${a?.name || 'clip'}" (${a?.duration ? a.duration.toFixed(1) : '?'}s long)`; }).join('\n')
    : '(the creator has not added B-roll footage — suggest shots to film or license)';
  const system = `You are the visual editor inside Editflow, a short-form video editor. You look at still frames from the creator's current cut and its timed transcript, then propose B-roll cutaways and animated motion graphics that make the video clearer and more engaging. Everything you return is previewed by the creator before it is applied.

Rules:
- Base every suggestion on what is actually said (timed lines) and actually visible (frames). Describe what you see honestly; never invent products, people, brands, numbers or claims that are not in the transcript or frames.
- Times are seconds on the TIMELINE of the cut (0 to ${duration.toFixed(1)}). Frames are labelled with their timeline time.
- B-roll: cover moments where the talking head can be replaced by something that SHOWS what is said (a product, a step, a place, a result). If a clip from the creator's B-roll library fits, set "footage" to its label (e.g. "B2") and "srcIn" to where in that clip to start. Otherwise set "footage": null and describe a shot the creator could film or license. 1.5–4 s each, not overlapping each other, and not in the first 1.5 s (keep the hook on the speaker's face) unless the hook is about an object.
- Motion graphics: use sparingly (about one every 6–10 seconds at most) where they add information: a lowerThird when the speaker introduces themselves, a stat when a number is said, a keyword for the single key idea of a sentence, a list when steps or items are enumerated, a callout to point at an object visible in a frame (x, y = its position in the frame, 0–1), a chapter tag when the topic shifts, a progress bar only for tutorials or lists. Keep text short: keyword ≤ 3 words, list items ≤ 5 words. Time each graphic to start when the words are said. Never let two graphics in the same screen area overlap in time (a progress bar is the exception), and keep clear of the existing text overlays listed below.
- Colours: pick from ${Object.keys(GRAPHIC_COLORS).join(', ')}; prefer one consistent colour that contrasts with the footage you see. Positions: top, center or bottom (captions sit at the bottom; avoid covering the speaker's face).
- Return ONLY a JSON object.

Motion graphic types:
${GRAPHIC_GUIDE}`;
  const user = `CREATOR BRIEF
${briefBlock(project)}

CUT: ${t(duration)} long, ${tl.clips.length} clips. ${frameTimes.length} frames attached at ${frameTimes.map((x) => x.toFixed(1)).join(', ')} s.

TIMED LINES ON THE CUT (timeline start–end, text)
${lines}

EXISTING B-ROLL: ${JSON.stringify(tl.broll.map(({ start, duration: d, description, assetId }) => ({ start, duration: d, description, hasFootage: !!assetId })))}  (slots without footage will be replaced by your suggestions)
EXISTING MOTION GRAPHICS: ${JSON.stringify((tl.graphics || []).map(({ type, text, start, duration: d, position }) => ({ type, text, start, duration: d, position })))}  (don't duplicate or overlap these)
EXISTING TEXT OVERLAYS: ${JSON.stringify(tl.overlays.map(({ template, text, start, duration: d }) => ({ template, text, start, duration: d })))}  (title = center, kicker = top, lowerThird/cta = bottom)

CREATOR'S B-ROLL LIBRARY (one frame of each is attached after the cut frames)
${libText}

Return JSON with exactly this shape:
{
  "summary": "2-3 sentences: what the video shows and what your visual plan adds",
  "scenes": [{"start": 0, "end": 3.5, "what": "what is on screen"}],
  "broll": [{"start": 4.2, "duration": 2.5, "description": "what to show", "reason": "why it helps here", "footage": "B1 or null", "srcIn": 0}],
  "graphics": [{"type": "${Object.keys(GRAPHIC_TYPES).join('|')}", "start": 6.0, "duration": 2.5, "text": "...", "sub": "...", "items": ["..."], "x": 0.5, "y": 0.5, "color": "accent", "position": "center", "reason": "why it helps here"}],
  "notes": ["anything the creator should check or film"]
}`;
  return { system, user };
}
