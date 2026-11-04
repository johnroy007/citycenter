// The phone app's service worker. It does one thing: shows a friendly page when there is no signal.
// It never stores conversations, visit codes or anything from /api, and it leaves every other request alone.
"use strict";
const CACHE = "citycenter-offline-1";
const KEEP = ["/offline", "/public/offline.css", "/public/icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(KEEP)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("/offline")));
  } else if (url.origin === location.origin && KEEP.includes(url.pathname)) {
    e.respondWith(fetch(e.request).catch(() => caches.match(url.pathname)));
  }
});
