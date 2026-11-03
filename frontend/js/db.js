// Conversation history, stored on the device in IndexedDB.

const DB_NAME = "lucia";
const STORE = "sessions";

let dbPromise = null;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex("startedAt", "startedAt");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const saveSession = (session) => run("readwrite", (s) => s.put(session));
export const getSession = (id) => run("readonly", (s) => s.get(id));
export const deleteSession = (id) => run("readwrite", (s) => s.delete(id));

export async function listSessions() {
  const all = await run("readonly", (s) => s.index("startedAt").getAll());
  return all.reverse();
}
