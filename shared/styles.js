// Types of reels. Each type can have a house style trained by Editflow's editors in the admin
// training studio (rules + worked examples) that the story editor follows for that type.
// Admins can add more types; these are the built-in ones.

export const EDIT_TYPES = {
  tips: { label: 'Tips & how-to', desc: 'Teaches one useful thing fast: problem → steps → result.' },
  story: { label: 'Storytime', desc: 'A personal story with tension and a turn: setup → conflict → twist or lesson.' },
  explainer: { label: 'Explainer', desc: 'Makes one idea click: question → simple explanation → example → takeaway.' },
  opinion: { label: 'Hot take', desc: 'A strong opinion argued fast: claim → reasons → proof → mic drop.' },
  podcast: { label: 'Podcast clip', desc: 'The single best moment of a conversation, self-contained, with context in one line.' },
  product: { label: 'Product / promo', desc: 'Pain → product as the answer → proof → offer / call to action.' },
  motivation: { label: 'Motivation', desc: 'An emotional, quotable message that builds to a strong last line.' },
  vlog: { label: 'Day in the life', desc: 'Fast-moving moments with a thread that pays off at the end.' },
};

export const DEFAULT_EDIT_TYPE = 'tips';

/** Clean a style guide coming from the database or an AI training pass. */
export function cleanStyle(raw = {}) {
  const str = (v, n) => String(v ?? '').trim().slice(0, n);
  return {
    key: str(raw.key, 40).toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    label: str(raw.label, 60),
    desc: str(raw.desc, 200),
    rules: (Array.isArray(raw.rules) ? raw.rules : []).map((r) => str(r, 300)).filter(Boolean).slice(0, 25),
    examples: (Array.isArray(raw.examples) ? raw.examples : []).slice(0, 4).map((e) => ({ title: str(e?.title, 80), raw: str(e?.raw, 1500), cut: str(e?.cut, 1500), why: str(e?.why, 400) })).filter((e) => e.raw && e.cut),
    pacing: raw.pacing && typeof raw.pacing === 'object' ? { targetLength: Number(raw.pacing.targetLength) || null, cutMode: ['natural', 'tight', 'ultra'].includes(raw.pacing.cutMode) ? raw.pacing.cutMode : null } : {},
  };
}
