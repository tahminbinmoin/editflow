// Work on videos straight from a folder on the user's computer (no upload, no size limit).
//
// Chrome / Edge (desktop): the File System Access API. The folder handle is remembered in
// IndexedDB, so the folder stays linked across visits; the browser asks once per visit to
// re-allow access. We can also write exports back into the folder.
// Other browsers: a folder picker (<input webkitdirectory>) that works until the page is
// reloaded; the user picks the same folder again to reconnect.

const DB = 'editflow-local';
const STORE = 'folders';
const MEDIA_RE = /\.(mp4|mov|m4v|webm|mkv|avi|mp3|wav|m4a|aac|ogg|flac)$/i;
const SUB_RE = /\.(srt|vtt)$/i;

export const supportsFolderAccess = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
const sessionFiles = new Map(); // folderId → Map(relPath → File)   (fallback mode + cache)

function db() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}
// Test seam: automated tests provide an in-memory Map (headless Chrome can't persist test handles).
const memStore = typeof window !== 'undefined' ? window.__editflowHandleStore : null;
const saveHandle = (id, rec) => (memStore ? Promise.resolve(memStore.set(id, rec)) : idb('readwrite', (s) => s.put(rec, id)));
const loadHandle = (id) => (memStore ? Promise.resolve(memStore.get(id)) : idb('readonly', (s) => s.get(id)));

export const kindOf = (name) => (SUB_RE.test(name) ? 'subtitle' : /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(name) ? 'audio' : MEDIA_RE.test(name) ? 'video' : null);
const stemOf = (relPath) => relPath.replace(/\.[^./]+$/, '').toLowerCase();
/** The caption file (.srt / .vtt) next to a video with the same name, if the listing has one. */
export const findSidecar = (listing, relPath) => (listing || []).find((x) => x.kind === 'subtitle' && x.relPath !== relPath && stemOf(x.relPath) === stemOf(relPath)) || null;

/** Ask the user for a folder (Chrome/Edge). Pass `existingId` to re-link a project's folder. Returns { id, name }. */
export async function pickFolder(existingId) {
  const handle = await window.showDirectoryPicker({ id: 'editflow-media', mode: 'readwrite', startIn: 'videos' });
  const id = existingId || crypto.randomUUID();
  forgetLocalUrls(id);
  await saveHandle(id, { handle, name: handle.name, savedAt: Date.now() });
  return { id, name: handle.name };
}

/** Fallback for browsers without folder access: register files from <input webkitdirectory>. */
export function registerPickedFiles(fileList, existingId) {
  const files = [...fileList];
  if (!files.length) return null;
  const root = (files[0].webkitRelativePath || files[0].name).split('/')[0];
  const map = new Map();
  for (const f of files) {
    const rel = (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name;
    map.set(rel, f);
  }
  const id = existingId || crypto.randomUUID();
  sessionFiles.set(id, map);
  return { id, name: root, session: true };
}

/** 'ready' | 'needs-permission' | 'unavailable' */
export async function folderStatus(folderId) {
  const rec = await loadHandle(folderId).catch(() => null);
  if (!rec?.handle) return sessionFiles.has(folderId) ? 'ready' : 'unavailable';
  if (!rec.handle.queryPermission) return 'ready';
  const p = await rec.handle.queryPermission({ mode: 'readwrite' });
  if (p === 'granted') return 'ready';
  const r = await rec.handle.queryPermission({ mode: 'read' });
  return r === 'granted' ? 'ready' : 'needs-permission';
}

/** Must run from a click: asks the browser to allow the remembered folder again. */
export async function reconnectFolder(folderId) {
  const rec = await loadHandle(folderId).catch(() => null);
  if (!rec?.handle) return false;
  if (!rec.handle.requestPermission) return true;
  const p = await rec.handle.requestPermission({ mode: 'readwrite' });
  return p === 'granted' || (await rec.handle.requestPermission({ mode: 'read' })) === 'granted';
}

export async function folderName(folderId) {
  const rec = await loadHandle(folderId).catch(() => null);
  return rec?.name || null;
}

/** List media and subtitle files (up to `maxDepth` folders deep). */
export async function listFolder(folderId, { maxDepth = 3 } = {}) {
  const session = sessionFiles.get(folderId);
  const rec = await loadHandle(folderId).catch(() => null);
  const out = [];
  if (rec?.handle) {
    const walk = async (dir, prefix, depth) => {
      for await (const [name, h] of dir.entries()) {
        if (name.startsWith('.')) continue;
        if (h.kind === 'directory') {
          if (depth < maxDepth && name !== 'Editflow exports') await walk(h, `${prefix}${name}/`, depth + 1);
        } else if (kindOf(name)) {
          const f = await h.getFile();
          out.push({ relPath: `${prefix}${name}`, name, size: f.size, lastModified: f.lastModified, kind: kindOf(name) });
        }
      }
    };
    await walk(rec.handle, '', 0);
  } else if (session) {
    for (const [rel, f] of session) if (kindOf(f.name) && !rel.startsWith('Editflow exports/')) out.push({ relPath: rel, name: f.name, size: f.size, lastModified: f.lastModified, kind: kindOf(f.name) });
  } else throw new Error('This folder is not connected in this browser.');
  return out.sort((a, b) => b.lastModified - a.lastModified);
}

/** The File for an asset that lives in a linked folder (null if the folder isn't available here). */
export async function getLocalFile(folderId, relPath) {
  const session = sessionFiles.get(folderId);
  if (session?.has(relPath)) return session.get(relPath);
  const rec = await loadHandle(folderId).catch(() => null);
  if (!rec?.handle) return null;
  try {
    let dir = rec.handle;
    const parts = relPath.split('/');
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
    return await (await dir.getFileHandle(parts.at(-1))).getFile();
  } catch {
    return null;
  }
}

/** Save a file into the linked folder (Chrome/Edge only). Returns the relative path written. */
export async function saveToFolder(folderId, subdir, name, blob) {
  const rec = await loadHandle(folderId).catch(() => null);
  if (!rec?.handle?.getDirectoryHandle) throw new Error('Saving into the folder needs Chrome or Edge on a computer.');
  if (rec.handle.requestPermission && (await rec.handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    if ((await rec.handle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Permission to save into the folder was not given.');
  }
  const dir = await rec.handle.getDirectoryHandle(subdir, { create: true });
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
  return `${subdir}/${name}`;
}

export const canSaveToFolder = async (folderId) => !!(await loadHandle(folderId).catch(() => null))?.handle?.getDirectoryHandle;

// Object URLs for local files, cached per file version.
const urlCache = new Map();
export async function localUrl(asset) {
  const key = `${asset.folderId}/${asset.relPath}`;
  const hit = urlCache.get(key);
  if (hit) return hit;
  const f = await getLocalFile(asset.folderId, asset.relPath);
  if (!f) return null;
  const url = URL.createObjectURL(f);
  urlCache.set(key, url);
  return url;
}
export function forgetLocalUrls(folderId) {
  for (const [k, u] of urlCache) if (k.startsWith(`${folderId}/`)) (URL.revokeObjectURL(u), urlCache.delete(k));
}
