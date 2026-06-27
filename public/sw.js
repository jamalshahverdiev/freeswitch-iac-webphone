// Minimal service worker for the webphone PWA: makes the app installable and
// lets the shell load offline. Network-first for same-origin GETs (so online
// always gets fresh assets), cache fallback when offline. Cross-origin requests
// — the BFF, Keycloak, the SIP WSS — are left untouched.
const CACHE = "webphone-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// Show a notification on push. The DevTools "Push" button delivers a plain-text
// payload (no real subscription needed); a real server push would send JSON.
self.addEventListener("push", (e) => {
  let title = "Webphone";
  let body = "You have a new notification";
  if (e.data) {
    const text = e.data.text();
    try {
      const j = JSON.parse(text);
      title = j.title || title;
      body = j.body || body;
    } catch {
      body = text || body;
    }
  }
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
    }),
  );
});

// Focus (or open) the app window when a notification is clicked.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if ("focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })(),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(req);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (err) {
        const cached = await cache.match(req);
        if (cached) return cached;
        if (req.mode === "navigate") {
          const shell = await cache.match("/");
          if (shell) return shell;
        }
        throw err;
      }
    })(),
  );
});
