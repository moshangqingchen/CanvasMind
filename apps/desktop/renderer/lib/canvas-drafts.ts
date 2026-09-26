import type { CanvasDocument } from "../components/types";

export interface CanvasDraft {
  canvasId: string;
  title: string;
  graph: CanvasDocument;
  baseRevision: number;
  version: number;
}

const DATABASE = "super-canvas-drafts";
const STORE = "drafts";
const SESSION_KEY = "super-canvas-draft-session";
let database: Promise<IDBDatabase> | undefined;
let session: string | undefined;

function sessionId(): string {
  if (session) return session;
  try {
    session = sessionStorage.getItem(SESSION_KEY) ?? crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, session);
  } catch {
    session = crypto.randomUUID();
  }
  return session;
}

function openDatabase(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("浏览器不支持本地草稿存储"));
        return;
      }
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("本地草稿存储正在更新"));
    });
    void database.catch(() => { database = undefined; });
  }
  return database;
}

async function transact<T>(
  canvasId: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, key: string, done: (value: T) => void) => void,
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    let result: T;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("本地草稿未能保存"));
    operation(transaction.objectStore(STORE), `${sessionId()}:${canvasId}`, (value) => { result = value; });
  });
}

export function readCanvasDraft(canvasId: string): Promise<CanvasDraft | undefined> {
  return transact(canvasId, "readonly", (store, key, done) => {
    const request = store.get(key);
    request.onsuccess = () => done(request.result as CanvasDraft | undefined);
  });
}

export function writeCanvasDraft(draft: CanvasDraft): Promise<void> {
  return transact(draft.canvasId, "readwrite", (store, key, done) => {
    store.put(draft, key);
    done(undefined);
  });
}

/** An old server response must never erase a newer edit made while it was saving. */
export function draftAfterAcknowledgement(
  draft: CanvasDraft | undefined,
  savedVersion: number,
  revision: number,
): CanvasDraft | undefined {
  if (!draft || draft.version <= savedVersion) return undefined;
  return { ...draft, baseRevision: revision };
}

export function acknowledgeCanvasDraft(canvasId: string, version: number, revision: number): Promise<void> {
  return transact(canvasId, "readwrite", (store, key, done) => {
    const request = store.get(key);
    request.onsuccess = () => {
      const remaining = draftAfterAcknowledgement(request.result as CanvasDraft | undefined, version, revision);
      if (remaining) store.put(remaining, key);
      else store.delete(key);
      done(undefined);
    };
  });
}

export function discardCanvasDraft(canvasId: string): Promise<void> {
  return transact(canvasId, "readwrite", (store, key, done) => {
    store.delete(key);
    done(undefined);
  });
}

/** Compare JSON data independently of object insertion order; array order remains meaningful. */
function canonicalJson(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const object = item as Record<string, unknown>;
    return Object.fromEntries(Object.keys(object).sort().map((key) => [key, object[key]]));
  });
}

export function canvasDraftRecovery(draft: CanvasDraft | undefined, server: {
  title: string;
  revision: number;
  graph: CanvasDocument;
}): "none" | "already-saved" | "recover" | "conflict" {
  if (!draft) return "none";
  if (draft.title === server.title && canonicalJson(draft.graph) === canonicalJson(server.graph)) return "already-saved";
  return draft.baseRevision === server.revision ? "recover" : "conflict";
}
