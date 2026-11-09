import QRCode from 'qrcode'
import { useAdmin } from './store'

// Cliente da Evolution API (v1 e v2). Sem URL configurada, roda em modo demonstração.

export type ConnState = 'open' | 'connecting' | 'close'

export interface Instance {
  name: string
  state: ConnState
  number: string
  profileName: string
  picture: string
  messages: number
  contacts: number
  chats: number
  createdAt: string
}

export interface QrResult {
  /** data URL da imagem do QR. */
  image: string
  pairingCode: string
}

export const isDemo = () => !useAdmin.getState().evolution.url

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { url, apiKey } = useAdmin.getState().evolution
  let res: Response
  try {
    res = await fetch(`${url}${path}`, {
      method,
      headers: { apikey: apiKey, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('Não foi possível falar com o servidor. Confira a URL e o CORS da Evolution API.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('API key recusada pelo servidor.')
    const msg = data?.response?.message ?? data?.message ?? data?.error
    throw Object.assign(new Error(Array.isArray(msg) ? msg.join(' ') : msg || `Erro ${res.status}`), { status: res.status })
  }
  return data as T
}

const digits = (jid?: string | null) => (jid ?? '').split('@')[0].replace(/\D/g, '')

/** Aceita o formato da v2 ({ name, connectionStatus }) e da v1 ({ instance: { instanceName, status } }). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(raw: any): Instance {
  const i = raw?.instance ?? raw
  const state = (i.connectionStatus ?? i.status ?? i.state ?? 'close') as string
  return {
    name: i.name ?? i.instanceName ?? '—',
    state: state === 'open' ? 'open' : state === 'connecting' ? 'connecting' : 'close',
    number: i.number ?? digits(i.ownerJid ?? i.owner),
    profileName: i.profileName ?? '',
    picture: i.profilePicUrl ?? i.profilePictureUrl ?? '',
    messages: i._count?.Message ?? 0,
    contacts: i._count?.Contact ?? 0,
    chats: i._count?.Chat ?? 0,
    createdAt: i.createdAt ?? '',
  }
}

async function toQr(r: { base64?: string; code?: string; pairingCode?: string; qrcode?: { base64?: string; code?: string; pairingCode?: string } }): Promise<QrResult | null> {
  const q = r.qrcode ?? r
  const image = q.base64 ? (q.base64.startsWith('data:') ? q.base64 : `data:image/png;base64,${q.base64}`) : q.code ? await QRCode.toDataURL(q.code, { margin: 1, width: 480 }) : ''
  return image ? { image, pairingCode: q.pairingCode ?? '' } : null
}

// ─── Modo demonstração ────────────────────────────────────────

const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()
let demo: Instance[] = [
  { name: 'cobranca-principal', state: 'open', number: '5511987654321', profileName: 'Dinn Cobrança', picture: '', messages: 4821, contacts: 312, chats: 287, createdAt: ago(64) },
  { name: 'loja-centro', state: 'open', number: '5521976543210', profileName: 'Crediário Centro', picture: '', messages: 1930, contacts: 140, chats: 122, createdAt: ago(31) },
  { name: 'cobrador-joao', state: 'connecting', number: '', profileName: '', picture: '', messages: 0, contacts: 0, chats: 0, createdAt: ago(2) },
  { name: 'filial-sul', state: 'close', number: '5551965432109', profileName: 'Filial Sul', picture: '', messages: 655, contacts: 58, chats: 49, createdAt: ago(120) },
]
const wait = (ms = 450) => new Promise((r) => setTimeout(r, ms))
const demoQr = async (name: string) => ({
  image: await QRCode.toDataURL(`jurospro-demo:${name}:${Date.now()}`, { margin: 1, width: 480 }),
  pairingCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
})
const setDemo = (name: string, patch: Partial<Instance>) => (demo = demo.map((i) => (i.name === name ? { ...i, ...patch } : i)))

// ─── API ──────────────────────────────────────────────────────

export async function listInstances(): Promise<Instance[]> {
  if (isDemo()) return (await wait(), demo.map((i) => ({ ...i })))
  const data = await call<unknown[]>('GET', '/instance/fetchInstances')
  return (Array.isArray(data) ? data : []).map(normalize)
}

export async function createInstance(name: string, number?: string): Promise<QrResult | null> {
  if (isDemo()) {
    await wait()
    if (demo.some((i) => i.name === name)) throw new Error('Já existe uma instância com esse nome.')
    demo = [{ name, state: 'connecting', number: '', profileName: '', picture: '', messages: 0, contacts: 0, chats: 0, createdAt: new Date().toISOString() }, ...demo]
    return demoQr(name)
  }
  const r = await call<Parameters<typeof toQr>[0]>('POST', '/instance/create', {
    instanceName: name,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS',
    ...(number ? { number: number.replace(/\D/g, '') } : {}),
  })
  return toQr(r)
}

export async function connectInstance(name: string): Promise<QrResult | null> {
  if (isDemo()) return (await wait(), setDemo(name, { state: 'connecting' }), demoQr(name))
  return toQr(await call('GET', `/instance/connect/${encodeURIComponent(name)}`))
}

export async function instanceState(name: string): Promise<ConnState> {
  if (isDemo()) return demo.find((i) => i.name === name)?.state ?? 'close'
  const r = await call<{ instance?: { state?: string }; state?: string }>('GET', `/instance/connectionState/${encodeURIComponent(name)}`)
  const s = r.instance?.state ?? r.state
  return s === 'open' ? 'open' : s === 'connecting' ? 'connecting' : 'close'
}

/** Só na demonstração: simula o celular lendo o QR. */
export function demoPair(name: string) {
  setDemo(name, { state: 'open', number: `55119${Math.floor(10000000 + Math.random() * 89999999)}`, profileName: name })
}

export async function restartInstance(name: string) {
  if (isDemo()) return void (await wait())
  const path = `/instance/restart/${encodeURIComponent(name)}`
  // v2 usa POST, v1 usa PUT
  await call('POST', path).catch((e) => (e.status === 404 || e.status === 405 ? call('PUT', path) : Promise.reject(e)))
}

export async function logoutInstance(name: string) {
  if (isDemo()) return void (await wait(), setDemo(name, { state: 'close' }))
  await call('DELETE', `/instance/logout/${encodeURIComponent(name)}`)
}

export async function deleteInstance(name: string) {
  if (isDemo()) return void (await wait(), (demo = demo.filter((i) => i.name !== name)))
  await call('DELETE', `/instance/delete/${encodeURIComponent(name)}`)
}

/** Testa URL + chave antes de salvar. */
export async function testConnection(url: string, apiKey: string): Promise<number> {
  let res: Response
  try {
    res = await fetch(`${url.trim().replace(/\/+$/, '')}/instance/fetchInstances`, { headers: { apikey: apiKey.trim() } })
  } catch {
    throw new Error('Servidor inacessível (URL errada ou CORS bloqueado).')
  }
  if (res.status === 401 || res.status === 403) throw new Error('API key inválida.')
  if (!res.ok) throw new Error(`O servidor respondeu ${res.status}.`)
  const data = await res.json().catch(() => [])
  return Array.isArray(data) ? data.length : 0
}

export const fmtPhone = (n: string) => {
  const d = n.replace(/\D/g, '')
  if (d.length === 13 && d.startsWith('55')) return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`
  if (d.length === 12 && d.startsWith('55')) return `+55 (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`
  return d ? `+${d}` : ''
}
