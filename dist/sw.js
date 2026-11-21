// On Time service worker: when a push arrives (medicine time, a follow-up, or the family
// pressing "Call now"), show a call-style alert even if the app is closed. Tapping it opens
// the ringing screen. The push carries no data; we fetch who is calling.

async function householdId() {
  const cache = await caches.open('on-time');
  const saved = await cache.match('/__household');
  return saved ? saved.text() : null;
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    const id = await householdId();
    let household = null;
    if (id) {
      try { household = await (await fetch('/api/h/' + id, { cache: 'no-store' })).json(); } catch {}
    }
    const ringing = household?.ring;
    // The server sends the alert text already in the patient's language.
    const title = ringing ? (household.notify?.title ?? 'On Time 📞') : 'On Time';
    const body = ringing ? (household.notify?.body ?? 'Tap to answer.') : 'You have a missed call from On Time.';
    await self.registration.showNotification(title, {
      body,
      tag: 'on-time-call',
      renotify: true,
      requireInteraction: Boolean(ringing),
      vibrate: [500, 250, 500, 250, 500, 1200, 500, 250, 500, 250, 500],
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { id },
      actions: ringing ? [{ action: 'answer', title: (household.notify?.answer ?? 'Answer') + ' · Answer' }] : [],
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const id = event.notification.data?.id;
    const target = id ? '/?h=' + id + '&view=phone' : '/?app=1';
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(w => new URL(w.url).searchParams.get('view') === 'phone');
    if (open) { await open.focus(); return; }
    await self.clients.openWindow(target);
  })());
});

// Network only: always fetch fresh code (a stale cached app is worse than none for a demo).
self.addEventListener('fetch', () => {});
