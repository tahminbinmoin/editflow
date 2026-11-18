// Project document helpers (pure). A project row stores this object in its `data` column.
import { emptyTimeline } from './timeline.js';

export const HISTORY_LIMIT = 50;

export function newProjectData(settings = {}) {
  const aspect = settings.aspect || '9:16';
  return {
    settings: {
      platform: settings.platform || 'TikTok / Reels / Shorts',
      aspect,
      targetLength: Number(settings.targetLength) || 45,
      audience: settings.audience || '',
      goal: settings.goal || '',
      tone: settings.tone || '',
      notes: settings.notes || '',
      referenceNotes: settings.referenceNotes || '',
      referenceUrl: settings.referenceUrl || '',
    },
    assets: [],
    folders: [], // folders on the user's computer linked to this project: [{ id, name }]
    transcript: { source: null, language: null, segments: [] },
    plan: null,
    timeline: emptyTimeline(aspect),
    // Snapshots live in the project_history table; this keeps the ordered list and the pointer.
    history: { entries: [], index: -1 },
    pending: null,
    consent: {},
    chat: [],
    exports: [],
    mode: 'auto',
    referenceInsights: null,
  };
}

export const SETTINGS_KEYS = ['platform', 'aspect', 'targetLength', 'audience', 'goal', 'tone', 'notes', 'referenceNotes', 'referenceUrl'];
