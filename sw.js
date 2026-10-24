// Offline cache for the app's own files. No other network calls: the app never talks to a server.
// The build (tools/make_builder.py) replaces "dev" with a hash of the files, so every new version
// gets a fresh cache and the page offers "Vernieuwen".
const VERSION = "dev";
const CACHE = `aanwezigheid-${VERSION}`;
const FILES = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./db.js",
  "./sync.js",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("aanwezigheid-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});

// Cache first; only same-origin GETs. Anything else (Teams links) goes straight to the browser.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request, {ignoreSearch: true}).then((hit) => hit || fetch(event.request)),
  );
});

