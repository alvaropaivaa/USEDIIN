import { create } from 'zustand'

// App instalável: registra o service worker, guarda o convite de instalação e avisa quando há versão nova.

interface InstallPrompt extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

interface PWA {
  /** Versão nova baixada, esperando o toque em "Atualizar". */
  update: boolean
  /** O navegador ofereceu instalar (Android/Chrome/Edge). */
  canInstall: boolean
  installed: boolean
}

export const usePWA = create<PWA>(() => ({ update: false, canInstall: false, installed: isStandalone() }))

let deferred: InstallPrompt | null = null
let waiting: ServiceWorker | null = null

export function registerSW() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallPrompt
    usePWA.setState({ canInstall: true })
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    usePWA.setState({ canInstall: false, installed: true })
  })

  if (!('serviceWorker' in navigator)) return
  const start = async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js')
      const offer = (w: ServiceWorker | null) => {
        // só oferece atualizar quem já tinha uma versão rodando (na primeira instalação não há o que recarregar)
        if (w && navigator.serviceWorker.controller) {
          waiting = w
          usePWA.setState({ update: true })
        }
      }
      offer(reg.waiting)
      reg.addEventListener('updatefound', () => {
        const w = reg.installing
        w?.addEventListener('statechange', () => w.state === 'installed' && offer(w))
      })
      // app aberto por muito tempo: confere se saiu versão nova a cada hora e ao voltar para ele
      setInterval(() => reg.update().catch(() => {}), 60 * 60_000)
      document.addEventListener('visibilitychange', () => !document.hidden && reg.update().catch(() => {}))
    } catch (e) {
      console.warn('[pwa] service worker não registrado', e)
    }
  }
  // registra depois que a página carregou, para não disputar a rede com o app
  if (document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })
}

/** Troca para a versão nova e recarrega. */
export function applyUpdate() {
  if (!waiting) return location.reload()
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true })
  waiting.postMessage({ type: 'skip-waiting' })
}

/** Abre o convite de instalação do navegador. Retorna true se a pessoa instalou. */
export async function promptInstall() {
  if (!deferred) return false
  await deferred.prompt()
  const { outcome } = await deferred.userChoice
  deferred = null
  usePWA.setState({ canInstall: false, installed: outcome === 'accepted' })
  return outcome === 'accepted'
}

/** Registro do service worker pronto (ou null se o navegador não tem/demorou). */
export async function swReady(ms = 4000): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), ms))])
}
