// Bump CACHE version when shipping new builds — forces refresh of cached shell
const CACHE = 'ontheclock-v7'
const SHELL = ['/', '/index.html', '/lb-outlined.svg', '/lb-outlined.png', '/apple-touch-icon.png']

self.addEventListener('install', e => {
  // Activate the new SW immediately on install
  self.skipWaiting()
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)))
})

self.addEventListener('activate', e => {
  // Take control of open pages and purge old caches
  e.waitUntil(
    Promise.all([
      clients.claim(),
      caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
      ),
    ])
  )
})

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return
  const url = new URL(e.request.url)

  // Network-first for HTML navigations so users always get the latest app shell
  if (e.request.mode === 'navigate' || e.request.destination === 'document') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, copy))
          return res
        })
        .catch(() => caches.match(e.request).then(cached => cached || caches.match('/index.html')))
    )
    return
  }

  // Cache-first for everything else (assets, fonts, icons)
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        const copy = res.clone()
        caches.open(CACHE).then(c => c.put(e.request, copy))
        return res
      }))
    )
  }
})

self.addEventListener('push', e => {
  let data = {}
  try { data = e.data?.json() ?? {} } catch { data = { title: e.data?.text() } }
  const title = data.title || 'OnTheClock'
  const opts = {
    body: data.body || '',
    icon: '/lb-outlined.png',
    badge: '/lb-outlined.png',
    tag: data.kind || 'ontheclock',
    data: { url: data.url || '/clock' },
    requireInteraction: false,
    vibrate: [200, 100, 200],
  }
  e.waitUntil(self.registration.showNotification(title, opts))
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const target = e.notification.data?.url || '/clock'
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin))
      if (existing) { existing.focus(); existing.navigate?.(target); return }
      return clients.openWindow(target)
    })
  )
})
