// Data layer: projects live in Supabase (table `projects`, row-level security per user).
// The client holds the project, applies edits with shared/timeline.js and saves the
// document back. Each saved version of the timeline goes to `project_history`.
import { supabase, currentUser } from './supabase.js';
import { newProjectData, HISTORY_LIMIT } from '@shared/project.js';
import { MEDIA_BUCKET } from '@shared/config.js';
import { normalizeTimeline } from '@shared/timeline.js';

const META = ['id', 'name', 'status', 'isSample', 'createdAt', 'updatedAt'];
const check = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};

export function toProject(row) {
  return { id: row.id, name: row.name, status: row.status, isSample: row.is_sample, createdAt: row.created_at, updatedAt: row.updated_at, ...row.data };
}
export function dataOf(project) {
  const d = {};
  for (const [k, v] of Object.entries(project)) if (!META.includes(k)) d[k] = v;
  return d;
}

export async function listProjects() {
  const rows = check(await supabase.from('projects').select('id, name, status, is_sample, updated_at, data').order('updated_at', { ascending: false }));
  return rows.map((r) => {
    const footage = (r.data.assets || []).find((a) => a.kind === 'footage' && (a.thumbPath || a.thumbUrl));
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      isSample: r.is_sample,
      updatedAt: r.updated_at,
      aspect: r.data.timeline?.format?.aspect || r.data.settings?.aspect,
      thumbAsset: footage || null,
      clipCount: r.data.timeline?.clips?.length || 0,
    };
  });
}

export async function getProject(id) {
  const row = check(await supabase.from('projects').select('*').eq('id', id).maybeSingle());
  if (!row) throw new Error('Project not found');
  return toProject(row);
}

export async function createProject(name, settings, { data, isSample = false } = {}) {
  const d = data || newProjectData(settings);
  const timeline = d.timeline;
  d.history = { entries: [], index: -1 };
  const row = check(await supabase.from('projects').insert({ name: String(name || 'Untitled video').slice(0, 120), is_sample: isSample, status: timeline.clips.length ? 'editing' : 'setup', data: d }).select('*').single());
  const p = toProject(row);
  const entry = await insertHistory(p.id, timeline, isSample ? 'Rule-based first cut' : 'Project created', isSample ? 'rules' : 'system');
  pushHistory(p, entry, timeline);
  await saveProject(p);
  return p;
}

// Saves are serialised per project so quick edits never overwrite each other out of order.
const queues = new Map();
export function saveProject(project) {
  const run = async () => {
    check(await supabase.from('projects').update({ name: project.name, status: project.status, data: dataOf(project) }).eq('id', project.id));
  };
  const next = (queues.get(project.id) || Promise.resolve()).then(run, run);
  queues.set(project.id, next.catch(() => {}));
  return next;
}

/** Store one timeline version; returns the history entry for the project's history list. */
export async function insertHistory(projectId, timeline, label, source) {
  const row = check(await supabase.from('project_history').insert({ project_id: projectId, label, source, timeline }).select('id, created_at').single());
  return { id: row.id, label, source, at: row.created_at, clips: timeline.clips.length };
}

export async function fetchHistoryTimeline(entryId) {
  const row = check(await supabase.from('project_history').select('timeline').eq('id', entryId).single());
  return normalizeTimeline(row.timeline);
}

export function deleteHistory(ids) {
  if (ids.length) supabase.from('project_history').delete().in('id', ids).then(() => {});
}

/** Pure: put a new entry on the project's history list (drops the redo branch). Returns dropped entry ids. */
export function pushHistory(p, entry, timeline) {
  const h = p.history || { entries: [], index: -1 };
  const dropped = h.entries.slice(h.index + 1);
  h.entries = h.entries.slice(0, h.index + 1);
  h.entries.push(entry);
  while (h.entries.length > HISTORY_LIMIT) dropped.push(h.entries.splice(1, 1)[0]);
  h.index = h.entries.length - 1;
  p.history = h;
  p.timeline = timeline;
  if (p.status === 'setup' && timeline.clips.length) p.status = 'editing';
  return dropped.map((e) => e.id);
}

async function listAll(prefix) {
  const out = [];
  const { data } = await supabase.storage.from(MEDIA_BUCKET).list(prefix, { limit: 1000 });
  for (const item of data || []) {
    const full = `${prefix}/${item.name}`;
    if (item.id === null || !item.metadata) out.push(...(await listAll(full)));
    else out.push(full);
  }
  return out;
}

export async function removeStoragePrefix(prefix) {
  const files = await listAll(prefix);
  for (let i = 0; i < files.length; i += 100) await supabase.storage.from(MEDIA_BUCKET).remove(files.slice(i, i + 100));
}

export async function deleteProject(project) {
  const user = await currentUser();
  if (user) await removeStoragePrefix(`${user.id}/${project.id}`).catch(() => {});
  check(await supabase.from('projects').delete().eq('id', project.id));
}

/** Usage for plan limits (billing-ready; see server/billing). Best effort. */
export function recordUsage(kind, amount = 1, projectId = null) {
  return supabase
    .from('usage_events')
    .insert({ kind, amount, project_id: projectId })
    .then(() => {}, () => {});
}
