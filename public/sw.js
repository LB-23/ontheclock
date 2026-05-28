// Bump CACHE version when shipping new builds — forces refresh of cached shell
const CACHE = 'ontheclock-v15'
const SHELL = [
  '/', '/index.html', '/lb-outlined.svg', '/lb-outlined.png', '/apple-touch-icon.png',
  // Brand typeface — self-hosted, precached so first paint after install has
  // the real font (no FOUT through Calibri fallback)
  '/fonts/FamiljenGrotesk-Regular.ttf',
  '/fonts/FamiljenGrotesk-SemiBold.ttf',
  '/fonts/FamiljenGrotesk-Bold.ttf',
]

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

  // Derive title from the reminder kind so the OS renders the bold heading the
  // brand wants ("Reminder to Clock-In" / "Reminder to Clock-Out") — even if
  // the Edge Function payload only carries `kind`. Falls back to whatever the
  // server explicitly set, then to the company name.
  const kind = data.kind || ''
  const titleByKind =
    kind === 'clock_in_reminder'  ? 'Reminder to Clock-In'  :
    kind === 'clock_out_reminder' ? 'Reminder to Clock-Out' :
    null
  const title = data.title || titleByKind || 'Larkin Building Group'

  const opts = {
    icon: '/lb-outlined.png',
    badge: '/lb-outlined.png',
    tag: kind || 'ontheclock',
    data: { url: data.url || '/clock' },
    requireInteraction: false,
    vibrate: [200, 100, 200],
  }
  // Body line beneath the bold title. Defaults to "from Larkin Building Group"
  // so the company is named even when iOS hides the source-app tag. Server can
  // override with any non-empty string; explicit `body: ''` collapses it.
  const body =
    typeof data.body === 'string'
      ? data.body
      : titleByKind ? 'from Larkin Building Group' : ''
  if (body.length > 0) opts.body = body

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
