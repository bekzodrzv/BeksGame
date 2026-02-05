const CACHE_NAME = "beks-game-cache-v1";
const urlsToCache = [
  "/",
  "/index.html",
  "/game.html",
  "/index.css",
  "/game.css",
  "/game.js",
  "/firebase.js"
];

// Install event
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log("Caching all: app shell and content");
        return cache.addAll(urlsToCache);
      })
  );
});

// Activate event
self.addEventListener("activate", (event) => {
  console.log("Service Worker activated");
});

// Fetch event
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        return cachedResponse || fetch(event.request)
          .catch(() => {
            // fallback HTML agar offline va fayl topilmasa
            if (event.request.mode === "navigate") {
              return caches.match("/index.html");
            }
          });
      })
  );
});
