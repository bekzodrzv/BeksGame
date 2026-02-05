const CACHE_NAME = "beks-game-v1";
const ASSETS_TO_CACHE = [
  "./index.html",
  "./game.html",
  "./index.css",
  "./game.css",
  "./firebase.js",
  "./game.js",
  "./base.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

// Install service worker & cache assets
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

// Activate & cleanup old caches
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => {
        if (key !== CACHE_NAME) return caches.delete(key);
      }))
    )
  );
});

// Fetch from cache first, fallback to network
self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request)
      .then(res => res || fetch(event.request))
      .catch(() => {
        // Agar HTML fayl bo‘lsa offline fallback
        if (event.request.destination === "document") {
          return caches.match("./index.html");
        }
      })
  );
});
