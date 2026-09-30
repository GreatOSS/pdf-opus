// Opt-in list of recently opened files, kept in IndexedDB on this device only.
// Where the browser gives us a file handle (Chrome, Edge) we keep just the handle; elsewhere a copy.

// `data` is an ArrayBuffer rather than a Blob: WebKit can't store Blobs in IndexedDB in private/ephemeral sessions.
export interface RecentEntry { id: string; name: string; size: number; when: number; handle?: any; data?: ArrayBuffer }

const KEY = "leaflark.recent";
const MAX = 8;
const MAX_COPY = 50 * 1024 * 1024;

export const recentEnabled = () => localStorage.getItem(KEY) === "on";

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("leaflark", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("recent", { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction("recent", mode);
    const r = fn(t.objectStore("recent"));
    t.oncomplete = () => { d.close(); resolve(r ? r.result : undefined); };
    t.onerror = () => { d.close(); reject(t.error); };
  });
}

export async function listRecent(): Promise<RecentEntry[]> {
  if (!recentEnabled()) return [];
  const all = ((await tx("readonly", (s) => s.getAll())) ?? []) as RecentEntry[];
  return all.sort((a, b) => b.when - a.when);
}

export async function setRecentEnabled(on: boolean) {
  localStorage.setItem(KEY, on ? "on" : "off");
  if (!on) await tx("readwrite", (s) => { s.clear(); }).catch(() => {});
}

/** Remember a file that just opened. Returns false if it wasn't stored (off, too big, storage error). */
export async function addRecent(file: { name: string; size: number }, bytes: Uint8Array, handle: any): Promise<boolean> {
  if (!recentEnabled()) return false;
  if (!handle && bytes.byteLength > MAX_COPY) return false;
  const id = `${file.name}|${file.size}`;
  const entry: RecentEntry = { id, name: file.name, size: file.size, when: Date.now(), ...(handle ? { handle } : { data: bytes.slice().buffer }) };
  try {
    const all = await listRecent();
    await tx("readwrite", (s) => {
      s.put(entry);
      for (const old of all.filter((e) => e.id !== id).slice(MAX - 1)) s.delete(old.id);
    });
    return true;
  } catch { return false; }
}

export const removeRecent = (id: string) => tx("readwrite", (s) => { s.delete(id); });

/** Get the file back; for handles this may ask the user for permission again. */
export async function readRecent(e: RecentEntry): Promise<{ file: File; handle: any } | null> {
  if (e.handle) {
    const opts = { mode: "readwrite" };
    if ((await e.handle.queryPermission?.(opts)) !== "granted" && (await e.handle.requestPermission?.(opts)) !== "granted") return null;
    return { file: await e.handle.getFile(), handle: e.handle };
  }
  return e.data ? { file: new File([e.data], e.name, { type: "application/pdf" }), handle: null } : null;
}
