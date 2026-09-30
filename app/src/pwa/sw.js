const CACHE_NAME = 'escondidas-shell-v1';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/assets/icon/favicon.png'];

// Firebase Messaging needs to run in the same service worker that owns the PWA.
// These values identify the public web app; the VAPID key stays in the page code.
importScripts('https://www.gstatic.com/firebasejs/12.9.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.9.0/firebase-messaging-compat.js');
firebase.initializeApp({
  apiKey: 'AIzaSyA1S1eVQds_HlSXUOLJqHtxEqzWWIzFRYc',
  authDomain: 'hide-and-seek-2026.firebaseapp.com',
  projectId: 'hide-and-seek-2026',
  messagingSenderId: '63026952241',
  appId: '1:63026952241:web:bd9b4c7c451e63e4877d10',
});

firebase.messaging().onBackgroundMessage((payload) => {
  const notification = payload.notification || {};
  self.registration.showNotification(notification.title || 'Escondidas en la ciudad', {
    body: notification.body || '',
    icon: '/assets/icon/favicon.png',
    badge: '/assets/icon/favicon.png',
    data: payload.data || {},
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const gameId = event.notification.data && event.notification.data.gameId;
  const destination = gameId ? `/game/${encodeURIComponent(gameId)}` : '/';
  event.waitUntil(clients.matchAll({type: 'window', includeUncontrolled: true}).then((clientList) => {
    const existing = clientList.find((client) => client.url.startsWith(self.location.origin));
    return existing ? existing.focus() : clients.openWindow(destination);
  }));
});

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isNavigation = request.mode === 'navigate';
  if (!isSameOrigin) return;

  if (isNavigation) {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html')),
    );
    return;
  }

  const isStaticAsset = /\.(?:js|css|png|jpg|jpeg|svg|webp|woff2?)$/i.test(url.pathname)
    || url.pathname === '/manifest.webmanifest';
  if (!isStaticAsset) return;

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});
