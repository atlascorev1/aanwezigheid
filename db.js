// Small IndexedDB wrapper. Everything Rens records lives here, on the phone only.

const DB_NAME = "aanwezigheid";
const DB_VERSION = 1;
export const STORES = ["meta", "classes", "students", "periods", "lessons", "attendance", "alerts"];

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("meta", {keyPath: "key"});
      db.createObjectStore("classes", {keyPath: "id"});
      db.createObjectStore("students", {keyPath: "id"}).createIndex("class_id", "class_id");
      db.createObjectStore("periods", {keyPath: "id"});
      db.createObjectStore("lessons", {keyPath: "key"}).createIndex("class_id", "class_id");
      const att = db.createObjectStore("attendance", {keyPath: ["lesson_key", "student_id"]});
      att.createIndex("lesson_key", "lesson_key");
      att.createIndex("student_id", "student_id");
      db.createObjectStore("alerts", {keyPath: ["student_id", "period_key"]});
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll(store, index, value) {
  const db = await open();
  const os = db.transaction(store).objectStore(store);
  return done(index ? os.index(index).getAll(value) : os.getAll());
}

export async function get(store, key) {
  const db = await open();
  return done(db.transaction(store).objectStore(store).get(key));
}

export async function getMeta(key, fallback = null) {
  const row = await get("meta", key);
  return row ? row.value : fallback;
}

// writes: {store: [rows]}; clear: [stores emptied first]. One transaction, so all or nothing.
export async function write(writes, clear = []) {
  const db = await open();
  const names = [...new Set([...Object.keys(writes), ...clear])];
  const tx = db.transaction(names, "readwrite");
  for (const name of clear) tx.objectStore(name).clear();
  for (const [name, rows] of Object.entries(writes)) {
    const os = tx.objectStore(name);
    for (const row of rows) os.put(row);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function setMeta(values) {
  return write({meta: Object.entries(values).map(([key, value]) => ({key, value}))});
}

// Asks the browser not to evict this data. On iOS this is granted for home-screen apps.
export async function persist() {
  if (!navigator.storage || !navigator.storage.persist) return null;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

