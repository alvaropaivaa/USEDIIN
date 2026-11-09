import { useState } from 'react'
import { CircleCheck, Eye, EyeOff, PlugZap, Server, Unplug } from 'lucide-react'
import { testConnection } from '../evolution'
import { useInstances } from '../instances'
import { todayIso, useAdmin } from '../store'
import { Btn, Card, Input, notify, Pill } from '../ui'

export default function Settings() {
  const { evolution, setEvolution, addLog, adminEmail, accesses } = useAdmin()
  const refresh = useInstances((s) => s.refresh)
  const [url, setUrl] = useState(evolution.url)
  const [key, setKey] = useState(evolution.apiKey)
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const save = async () => {
    if (!/^https?:\/\/.+/.test(url.trim())) return setResult({ ok: false, text: 'A URL precisa começar com http:// ou https://' })
    setBusy(true)
    setResult(null)
    try {
      const n = await testConnection(url, key)
      setEvolution({ url, apiKey: key })
      addLog('Evolution API conectada', 'green')
      setResult({ ok: true, text: `Conectado! ${n} instância(s) encontrada(s).` })
      notify('Servidor conectado')
      useInstances.setState({ list: [], loadedAt: 0 })
      refresh()
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const disconnect = () => {
    setEvolution({ url: '', apiKey: '' })
    setUrl('')
    setKey('')
    setResult(null)
    addLog('Evolution API desconectada', 'red')
    useInstances.setState({ list: [], loadedAt: 0 })
    refresh()
    notify('Voltou ao modo demonstração')
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), accesses }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `dinn-acessos-${todayIso()}.json`
    a.click()
    // revogar na hora cancela o download em alguns navegadores (Safari, Firefox)
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  return (
    <div className="grid max-w-[720px] gap-5">
      <Card
        title="Servidor de WhatsApp (Evolution API)"
        subtitle="Onde ficam as instâncias. Funciona com a Evolution API v1 e v2."
        action={evolution.url ? <Pill tone="green" dot pulse>Conectado</Pill> : <Pill tone="gray" dot>Demonstração</Pill>}
      >
        <div className="grid gap-5">
          <Input label="URL do servidor" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://evolution.seudominio.com" inputMode="url" />
          <div>
            <label className="mb-2 block text-[14px] font-medium text-label-2">API key global</label>
            <div className="flex h-12 items-center rounded-[14px] bg-fill pr-1 transition-[box-shadow,background] focus-within:bg-surface focus-within:shadow-[0_0_0_2px_var(--color-tint),0_0_0_6px_color-mix(in_srgb,var(--color-tint)_14%,transparent)]">
              <input
                type={show ? 'text' : 'password'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="AUTHENTICATION_API_KEY do servidor"
                className="h-full min-w-0 flex-1 bg-transparent px-4 text-[15.5px] outline-none placeholder:text-label-3"
              />
              <button onClick={() => setShow((s) => !s)} className="grid size-10 place-items-center rounded-full text-label-3 hover:text-label" aria-label={show ? 'Esconder' : 'Mostrar'}>
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          {result && (
            <p className={`flex items-center gap-2 rounded-[14px] px-4 py-3 text-[14.5px] font-medium ${result.ok ? 'bg-tint/10 text-green' : 'bg-red/8 text-red'}`}>
              {result.ok ? <CircleCheck className="size-4" /> : <Unplug className="size-4" />}
              {result.text}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Btn onClick={save} busy={busy}>
              <PlugZap className="size-4" /> Testar e salvar
            </Btn>
            {evolution.url && (
              <Btn variant="danger" onClick={disconnect}>
                Desconectar
              </Btn>
            )}
          </div>
          <p className="flex gap-2 text-[14px] leading-relaxed text-label-2">
            <Server className="mt-1 size-4 shrink-0" />
            O navegador fala direto com o servidor, então ele precisa aceitar CORS deste endereço (variável CORS_ORIGIN da Evolution). A chave fica salva no banco e só o administrador consegue ler.
          </p>
        </div>
      </Card>

      <Card title="Conta do administrador">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[14px] text-label-2">Entrando como</p>
            <p className="text-[17px] font-semibold">{adminEmail}</p>
          </div>
          <Btn variant="secondary" onClick={exportJson}>
            Exportar acessos (JSON)
          </Btn>
        </div>
      </Card>
    </div>
  )
}
