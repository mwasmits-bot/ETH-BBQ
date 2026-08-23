// Service worker, puur voor Web Push-meldingen (opstelling-herinnering).
// Geen caching, geen offline-gedrag — bewust minimaal, zodat dit nooit interfereert
// met het gewoon laden van de app.

self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { titel: 'ETH Scorito BBQ', tekst: event.data ? event.data.text() : '' }; }

  const titel = data.titel || 'ETH Scorito BBQ';
  const opties = {
    body: data.tekst || '',
    icon: '/eth.png',
    badge: '/eth.png',
    data: { url: data.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(titel, opties));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lijst) => {
      for (const client of lijst) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
