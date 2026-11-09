import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Ellipsis, Loader2, MessageCircle, Plus, Power, QrCode, RefreshCw, RotateCw, Server, Smartphone, Trash2, WifiOff } from 'lucide-react'
import clsx from 'clsx'
import { connectInstance, createInstance, deleteInstance, demoPair, fmtPhone, instanceState, isDemo, logoutInstance, restartInstance, type ConnState, type Instance, type QrResult } from '../evolution'
import { useInstances } from '../instances'
import { useAdmin } from '../store'
import { Btn, Card, Confirm, copy, EmptyState, IconBtn, Input, Menu, Modal, notify, notifyError, Pill, SearchBox, Tabs, timeAgo, Toolbar, type PillTone } from '../ui'

export const connInfo: Record<ConnState, { label: string; tone: PillTone }> = {
  open: { label: 'Conectado', tone: 'green' },
  connecting: { label: 'Aguardando QR', tone: 'orange' },
  close: { label: 'Desconectado', tone: 'red' },
}

type Filter = 'todas' | ConnState

export default function WhatsApp({ onNew, goSettings }: { onNew: { open: boolean; set: (o: boolean) => void }; goSettings: () => void }) {
  const { list, loading, error, loadedAt, refresh } = useInstances()
  const accesses = useAdmin((s) => s.accesses)
  const addLog = useAdmin((s) => s.addLog)
  const [filter, setFilter] = useState<Filter>('todas')
  const [q, setQ] = useState('')
  const [qr, setQr] = useState<{ name: string; data: QrResult } | null>(null)
  const [removing, setRemoving] = useState<Instance | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // atualiza sozinho a cada 15s enquanto a página está aberta
  useEffect(() => {
    refresh()
    const t = setInterval(() => !document.hidden && refresh(), 15_000)
    return () => clearInterval(t)
  }, [refresh])

  const run = async (name: string, fn: () => Promise<unknown>, ok: string, log?: string) => {
    setBusy(name)
    try {
      await fn()
      notify(ok)
      if (log) addLog(log, 'blue')
      await refresh()
    } catch (e) {
      notifyError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const connect = (name: string) =>
    run(name, async () => {
      const data = await connectInstance(name)
      if (!data) throw new Error('Instância já está conectada.')
      setQr({ name, data })
    }, 'QR Code gerado')

  const count = (s: ConnState) => list.filter((i) => i.state === s).length
  const shown = list.filter((i) => (filter === 'todas' || i.state === filter) && (!q || `${i.name} ${i.profileName} ${i.number}`.toLowerCase().includes(q.toLowerCase())))
  const owners = (name: string) => accesses.filter((a) => a.instance === name)

  return (
    <>
      {isDemo() && (
        <div className="mb-8 flex flex-col gap-4 rounded-[24px] bg-surface p-6 shadow-card sm:flex-row sm:items-center">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[#ff9500]/12 text-[#c93400]"><Server className="size-[22px]" /></span>
          <p className="flex-1 text-[15px] leading-relaxed">
            <span className="block text-[17px] font-semibold">Você está vendo exemplos</span> <span className="text-label-2">Conecte sua Evolution API para ver e controlar suas instâncias reais.</span>
          </p>
          <Btn variant="secondary" onClick={goSettings}>
            Conectar servidor
          </Btn>
        </div>
      )}

      <Toolbar
        tabs={
          <Tabs
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'todas', label: 'Todas', count: list.length },
              { value: 'open', label: 'Conectadas', count: count('open') },
              { value: 'connecting', label: 'Aguardando', count: count('connecting') },
              { value: 'close', label: 'Desconectadas', count: count('close') },
            ]}
          />
        }
      >
        <SearchBox value={q} onChange={setQ} placeholder="Buscar instância" className="flex-1 md:w-64" />
        <button onClick={refresh} title={loadedAt ? `Atualizado ${timeAgo(new Date(loadedAt).toISOString())}` : 'Atualizar'} aria-label="Atualizar" className="grid size-11 shrink-0 place-items-center rounded-full bg-fill text-label hover:bg-fill-2">
          <RefreshCw className={clsx('size-[18px]', loading && 'animate-spin')} />
        </button>
      </Toolbar>

      {error && (
        <div className="mb-6 flex items-center gap-3 rounded-[20px] bg-red/8 px-5 py-4 text-[15px]">
          <WifiOff className="size-[18px] shrink-0 text-red" />
          <span className="flex-1">{error}</span>
          <Btn size="sm" variant="secondary" onClick={goSettings}>
            Revisar conexão
          </Btn>
        </div>
      )}

      {loading && !list.length ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[320px] animate-pulse rounded-[24px] bg-surface shadow-card" />
          ))}
        </div>
      ) : shown.length === 0 && !error ? (
        <Card pad={false}>
          <EmptyState
            icon={<MessageCircle />}
            title={list.length ? 'Nenhuma instância neste filtro' : 'Nenhuma instância ainda'}
            text="Crie uma instância e leia o QR Code com o WhatsApp do celular que vai enviar os lembretes."
            action={
              <Btn onClick={() => onNew.set(true)}>
                <Plus className="size-4" /> Nova instância
              </Btn>
            }
          />
        </Card>
      ) : (
        <motion.div layout className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          <AnimatePresence initial={false}>
            {shown.map((i) => (
              <InstanceCard
                key={i.name}
                i={i}
                owners={owners(i.name).map((a) => a.name)}
                busy={busy === i.name}
                onConnect={() => connect(i.name)}
                onRestart={() => run(i.name, () => restartInstance(i.name), 'Instância reiniciada', `Instância ${i.name} reiniciada`)}
                onLogout={() => run(i.name, () => logoutInstance(i.name), 'WhatsApp desconectado', `Instância ${i.name} desconectada`)}
                onDelete={() => setRemoving(i)}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <NewInstance
        open={onNew.open}
        onClose={() => onNew.set(false)}
        onCreated={(name, data) => {
          addLog(`Instância ${name} criada`, 'green')
          refresh()
          if (data) setQr({ name, data })
        }}
      />
      <QrModal qr={qr} onClose={() => setQr(null)} onRetry={(name) => connect(name)} />
      <Confirm
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Excluir instância?"
        text={
          <>
            A instância <b className="text-label">{removing?.name}</b> será desconectada e apagada do servidor. Os acessos ligados a ela ficam sem WhatsApp.
          </>
        }
        action="Excluir"
        onConfirm={async () => {
          const name = removing!.name
          try {
            await deleteInstance(name)
            useAdmin.getState().accesses.filter((a) => a.instance === name).forEach((a) => useAdmin.getState().updateAccess(a.id, { instance: '' }))
            addLog(`Instância ${name} excluída`, 'red')
            notify('Instância excluída')
            refresh()
          } catch (e) {
            notifyError((e as Error).message)
          }
        }}
      />
    </>
  )
}

function InstanceCard({ i, owners, busy, onConnect, onRestart, onLogout, onDelete }: {
  i: Instance
  owners: string[]
  busy: boolean
  onConnect: () => void
  onRestart: () => void
  onLogout: () => void
  onDelete: () => void
}) {
  const info = connInfo[i.state]
  return (
    <motion.article layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} className="flex flex-col rounded-[24px] bg-surface p-6 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="relative">
          {i.picture ? (
            <img src={i.picture} alt="" className="size-14 rounded-full object-cover" />
          ) : (
            <span className={clsx('grid size-14 place-items-center rounded-full', i.state === 'open' ? 'bg-[#34c759]/12 text-[#1f8a3b] dark:text-[#30d158]' : 'bg-fill text-label-3')}>
              <MessageCircle className="size-6" />
            </span>
          )}
          <span className="absolute bottom-0.5 right-0.5 size-3.5 rounded-full ring-[3px] ring-surface" style={{ background: i.state === 'open' ? '#34c759' : i.state === 'connecting' ? '#ff9500' : '#ff3b30' }} />
        </div>
        <Menu
          trigger={
            <IconBtn label="Ações" onClick={() => {}}>
              <Ellipsis className="size-5" />
            </IconBtn>
          }
          items={[
            i.state !== 'open' && { label: 'Conectar (QR Code)', icon: <QrCode />, onClick: onConnect },
            { label: 'Reiniciar', icon: <RotateCw />, onClick: onRestart },
            i.state !== 'close' && { label: 'Desconectar WhatsApp', icon: <Power />, onClick: onLogout },
            !!i.number && { label: 'Copiar número', icon: <Smartphone />, onClick: () => copy(i.number, 'Número copiado') },
            { label: 'Excluir instância', icon: <Trash2 />, onClick: onDelete, danger: true },
          ]}
        />
      </div>

      <p className="mt-5 truncate text-[19px] font-semibold tracking-[-0.02em]">{i.profileName || i.name}</p>
      <p className="truncate text-[14.5px] text-label-2">{i.number ? fmtPhone(i.number) : 'Nenhum número vinculado'}</p>
      <div className="mt-3">
        <Pill tone={info.tone} dot pulse={i.state !== 'close'}>
          {info.label}
        </Pill>
      </div>

      <dl className="mt-6 grid grid-cols-3 gap-2">
        {[
          ['Mensagens', i.messages],
          ['Contatos', i.contacts],
          ['Conversas', i.chats],
        ].map(([l, v]) => (
          <div key={l}>
            <dd className="tabular font-display text-[22px] font-bold leading-none tracking-[-0.03em]">{Number(v).toLocaleString('pt-BR')}</dd>
            <dt className="mt-1.5 text-[13px] text-label-2">{l}</dt>
          </div>
        ))}
      </dl>

      <div className="mt-6 flex min-h-11 items-center justify-between gap-3 border-t border-separator pt-4">
        <span className="min-w-0 truncate text-[14px] text-label-2">
          <span className="text-label-3">{i.name}</span>
          {owners.length > 0 && <> · {owners.join(', ')}</>}
        </span>
        {i.state !== 'open' ? (
          <Btn size="sm" onClick={onConnect} busy={busy}>
            {!busy && <QrCode className="size-4" />} Conectar
          </Btn>
        ) : (
          busy && <Loader2 className="size-4 animate-spin text-label-3" />
        )}
      </div>
    </motion.article>
  )
}

function NewInstance({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (name: string, qr: QrResult | null) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const valid = /^[a-z0-9][a-z0-9_-]{2,39}$/.test(name)

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!valid) return setError('Use de 3 a 40 letras minúsculas, números, - ou _.')
    setBusy(true)
    try {
      const qr = await createInstance(name)
      onClose()
      onCreated(name, qr)
      setName('')
      setError('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nova instância"
      subtitle="Cada instância é um número de WhatsApp conectado."
      width={440}
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancelar
          </Btn>
          <Btn busy={busy} onClick={() => submit()}>
            Criar e gerar QR
          </Btn>
        </>
      }
    >
      <form onSubmit={submit} noValidate>
        <Input
          label="Nome da instância"
          autoFocus
          value={name}
          onChange={(e) => (setName(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '')), setError(''))}
          placeholder="ex.: cobranca-loja-centro"
          hint="Sem espaços ou acentos. Use um nome que identifique o cliente ou a loja."
        />
        {error && <p className="mt-3 text-[14px] font-medium text-red">{error}</p>}
      </form>
    </Modal>
  )
}

/** QR Code para parear; fecha sozinho quando o celular conecta. */
function QrModal({ qr, onClose, onRetry }: { qr: { name: string; data: QrResult } | null; onClose: () => void; onRetry: (name: string) => void }) {
  const [connected, setConnected] = useState(false)
  const [seconds, setSeconds] = useState(40)
  const refresh = useInstances((s) => s.refresh)
  const name = qr?.name
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    if (!name) return
    setConnected(false)
    setSeconds(40)
    // fechou o QR ou trocou de instância: a resposta que chegar depois não mexe em nada
    let alive = true
    let done = 0
    const tick = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000)
    const poll = setInterval(async () => {
      try {
        if ((await instanceState(name)) === 'open' && alive) {
          setConnected(true)
          clearInterval(poll)
          refresh()
          done = window.setTimeout(() => closeRef.current(), 1600)
        }
      } catch {
        /* tenta de novo no próximo ciclo */
      }
    }, 3000)
    return () => {
      alive = false
      clearInterval(tick)
      clearInterval(poll)
      clearTimeout(done)
    }
  }, [name, qr?.data.image, refresh])

  return (
    <Modal open={!!qr} onClose={onClose} title="Conectar WhatsApp" subtitle={name} width={420}>
      {qr && (
        <div className="flex flex-col items-center">
          <div className="relative">
            <img src={qr.data.image} alt="QR Code de conexão" className={clsx('size-64 rounded-[24px] bg-white p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.06)] transition', (connected || seconds === 0) && 'opacity-15 blur-[2px]')} />
            <AnimatePresence>
              {connected ? (
                <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="absolute inset-0 grid place-items-center">
                  <div className="flex flex-col items-center gap-2">
                    <span className="grid size-16 place-items-center rounded-full bg-[#22c55e] text-white shadow-lg">
                      <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                        <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, delay: 0.15 }} />
                      </svg>
                    </span>
                    <span className="text-[15px] font-semibold">Conectado!</span>
                  </div>
                </motion.div>
              ) : (
                seconds === 0 && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 grid place-items-center">
                    <Btn onClick={() => onRetry(qr.name)}>
                      <RefreshCw className="size-4" /> Gerar novo QR
                    </Btn>
                  </motion.div>
                )
              )}
            </AnimatePresence>
          </div>

          {!connected && (
            <>
              <p className="mt-4 text-[14px] text-label-2">{seconds > 0 ? `O código expira em ${seconds}s` : 'Código expirado'}</p>
              <ol className="mt-6 w-full space-y-3 rounded-[20px] bg-fill p-5 text-[15px]">
                {['Abra o WhatsApp no celular', 'Toque em ⋮ ou Configurações → Aparelhos conectados', 'Toque em Conectar aparelho e aponte para o QR'].map((s, n) => (
                  <li key={n} className="flex gap-3">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-tint text-[12px] font-bold text-white dark:text-black">{n + 1}</span>
                    {s}
                  </li>
                ))}
              </ol>
              {qr.data.pairingCode && (
                <button onClick={() => copy(qr.data.pairingCode, 'Código copiado')} className="mt-4 text-[14px] text-label-2">
                  Ou use o código <b className="tracking-[0.12em] text-label">{qr.data.pairingCode}</b>
                </button>
              )}
              {isDemo() && (
                <Btn variant="secondary" size="sm" className="mt-4" onClick={() => demoPair(qr.name)}>
                  Simular leitura do QR
                </Btn>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
