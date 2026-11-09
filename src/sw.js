// Service worker do Dinn: abre sem internet e recebe as notificações push.
// O plugin em vite.config.ts preenche VERSION, PRECACHE e DEV ao servir/gerar este arquivo.

const VERSION = __VERSION__
const PRECACHE = __PRECACHE__
const DEV = __DEV__
const SHELL = `jurospro-shell-${VERSION}`
const RUNTIME = 'jurospro-runtime'

// ─── Instalação e atualização ────────────────────────────────

self.addEventListener('install', (e) => {
  // sem cache (modo privado, disco cheio) o app só não abre offline; as notificações continuam
  e.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(PRECACHE))
      .catch((err) => console.warn('[sw] sem cache offline', err)),
  )
})

// versão nova fica esperando até o app pedir (botão "Atualizar")
self.addEventListener('message', (e) => {
  if (e.data?.type === 'skip-waiting') self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      try {
        for (const k of await caches.keys()) if (k.startsWith('jurospro-shell-') && k !== SHELL) await caches.delete(k)
      } catch {}
      await self.clients.claim()
    })(),
  )
})

// ─── Rede ────────────────────────────────────────────────────

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))

async function navigate(req) {
  // rede primeiro (pega a versão nova); sem internet ou muito lento, abre o app salvo
  try {
    return await Promise.race([fetch(req), timeout(4000)])
  } catch {
    const shell = await caches.open(SHELL).catch(() => null)
    return (await shell?.match('/index.html')) ?? (await shell?.match('/')) ?? Response.error()
  }
}

const match = (req) => caches.match(req).catch(() => undefined)
const keep = (req, res) => caches.open(RUNTIME).then((c) => c.put(req, res)).catch(() => {})

async function cacheFirst(req) {
  const hit = await match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok) keep(req, res.clone())
  return res
}

async function staleWhileRevalidate(req) {
  const hit = await match(req)
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok || res.type === 'opaque') keep(req, res.clone())
      return res
    })
    .catch(() => hit ?? Response.error())
  return hit ?? fresh
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  // em desenvolvimento o Vite serve os módulos ao vivo: nada de cache
  if (DEV || req.method !== 'GET') return
  const url = new URL(req.url)
  if (req.mode === 'navigate') return e.respondWith(navigate(req))
  if (url.origin === self.location.origin) {
    // arquivos do build têm hash no nome: o que está salvo nunca muda
    if (url.pathname.startsWith('/assets/') || PRECACHE.includes(url.pathname)) e.respondWith(cacheFirst(req))
    // logos dos bancos menos comuns: baixadas quando aparecem e guardadas para o modo offline
    else if (url.pathname.startsWith('/logos-bancos/')) e.respondWith(staleWhileRevalidate(req))
    return
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') e.respondWith(staleWhileRevalidate(req))
  // Supabase e o resto passam direto
})

// ─── Caixa de entrada: o que chega com o app fechado fica guardado até ele abrir ───

function inbox(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('jurospro-sw', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('inbox', { keyPath: 'key' })
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction('inbox', mode)
      fn(tx.objectStore('inbox'))
      tx.oncomplete = () => (db.close(), resolve())
      tx.onerror = () => (db.close(), reject(tx.error))
    }
  })
}

async function tellApp(msg) {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const c of list) c.postMessage(msg)
}

// ─── Push ────────────────────────────────────────────────────

self.addEventListener('push', (e) => {
  let d = {}
  try {
    d = e.data ? e.data.json() : {}
  } catch {
    d = { body: e.data ? e.data.text() : '' }
  }
  const n = {
    type: d.type || 'aviso',
    title: d.title || 'Dinn',
    body: d.body || '',
    url: d.url || '/',
    tag: d.tag || undefined,
    key: d.key || `push:${Date.now()}`,
    at: d.at || new Date().toISOString(),
  }
  const badge =
    typeof d.badge === 'number' && 'setAppBadge' in self.navigator
      ? (d.badge > 0 ? self.navigator.setAppBadge(d.badge) : self.navigator.clearAppBadge()).catch(() => {})
      : null
  e.waitUntil(
    Promise.all([
      self.registration.showNotification(n.title, {
        body: n.body,
        tag: n.tag,
        renotify: !!n.tag,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        lang: 'pt-BR',
        timestamp: Date.parse(n.at) || Date.now(),
        data: { url: n.url, key: n.key },
      }),
      inbox('readwrite', (s) => s.put(n)).catch(() => {}),
      tellApp({ type: 'push', notification: n }),
      badge,
    ]),
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href
  e.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // usa o app que já está aberto (o painel /admin não conta)
      const app = list.find((c) => new URL(c.url).origin === self.location.origin && !new URL(c.url).pathname.startsWith('/admin'))
      if (app) {
        app.postMessage({ type: 'open', url })
        return app.focus()
      }
      return self.clients.openWindow(url)
    })(),
  )
})

// o navegador trocou a inscrição: renova com a mesma chave; o app registra no servidor ao abrir
self.addEventListener('pushsubscriptionchange', (e) => {
  const options = e.oldSubscription?.options
  if (options) e.waitUntil(self.registration.pushManager.subscribe(options).catch(() => {}))
})
