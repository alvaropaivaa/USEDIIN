import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Ban, CalendarClock, Copy, Ellipsis, KeyRound, Pencil, RefreshCw, Send, ShieldCheck, Smartphone, Trash2, UserPlus, Users } from 'lucide-react'
import clsx from 'clsx'
import { maskPhone } from '../../components/ui'
import { accessStatus, addDays, daysUntil, generatePassword, PLANS, ROLES, useAdmin, type Access, type AccessStatus, type Plan, type Role } from '../store'
import { useInstances } from '../instances'
import { Avatar, Btn, Card, Confirm, copy, EmptyState, fmtDay, IconBtn, Input, inputCls, Menu, Modal, notify, notifyError, Pill, SearchBox, Select, Tabs, timeAgo, Toolbar, type PillTone } from '../ui'
import { waPhone } from '../../lib/whatsapp'
import { validEmail } from '../../lib/auth'
import { questionLabel, questions, type Answers } from '../../lib/onboarding'

const statusInfo: Record<AccessStatus, { label: string; tone: PillTone }> = {
  ativo: { label: 'Ativo', tone: 'green' },
  vencendo: { label: 'Vencendo', tone: 'orange' },
  vencido: { label: 'Vencido', tone: 'red' },
  bloqueado: { label: 'Bloqueado', tone: 'gray' },
}

type Filter = 'todos' | AccessStatus

export function StatusPill({ a }: { a: Access }) {
  const s = statusInfo[accessStatus(a)]
  return (
    <Pill tone={s.tone} dot>
      {s.label}
    </Pill>
  )
}

export function expiryText(a: Access) {
  if (!a.expiresAt) return 'Sem vencimento'
  const d = daysUntil(a.expiresAt)
  if (d < 0) return `Venceu ${d === -1 ? 'ontem' : `há ${-d} dias`}`
  if (d === 0) return 'Vence hoje'
  return `Vence em ${d} ${d === 1 ? 'dia' : 'dias'}`
}

const appUrl = () => `${location.origin}/`

function credentialsText(a: { name: string; email: string }, password: string) {
  return `Olá, ${a.name.split(' ')[0]}! Seu acesso ao Dinn está pronto ✅\n\n🔗 ${appUrl()}\n📧 E-mail: ${a.email}\n🔑 Senha: ${password}\n\nRecomendamos trocar a senha no primeiro acesso.`
}

export default function Accesses({ onNew }: { onNew: { open: boolean; set: (o: boolean) => void } }) {
  const accesses = useAdmin((s) => s.accesses)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('todos')
  const [editing, setEditing] = useState<Access | null>(null)
  const [renewing, setRenewing] = useState<Access | null>(null)
  const [removing, setRemoving] = useState<Access | null>(null)
  const [creds, setCreds] = useState<{ access: Access; password: string; fresh: boolean } | null>(null)
  const { updateAccess, removeAccess, resetPassword, addLog } = useAdmin()

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { todos: accesses.length, ativo: 0, vencendo: 0, vencido: 0, bloqueado: 0 }
    accesses.forEach((a) => c[accessStatus(a)]++)
    return c
  }, [accesses])

  const shown = accesses.filter((a) => {
    if (filter !== 'todos' && accessStatus(a) !== filter) return false
    const t = q.trim().toLowerCase()
    return !t || a.name.toLowerCase().includes(t) || a.email.includes(t) || a.phone.replace(/\D/g, '').includes(t.replace(/\D/g, '') || '§')
  })

  const toggleBlock = (a: Access) => {
    updateAccess(a.id, { blocked: !a.blocked })
    addLog(`${a.name} ${a.blocked ? 'desbloqueado' : 'bloqueado'}`, a.blocked ? 'green' : 'red')
    notify(a.blocked ? 'Acesso desbloqueado' : 'Acesso bloqueado')
  }

  const newPassword = async (a: Access) => {
    const p = generatePassword()
    const err = await resetPassword(a.id, p)
    if (err) return notifyError(err)
    setCreds({ access: a, password: p, fresh: false })
  }

  const menu = (a: Access) => (
    <Menu
      trigger={
        <IconBtn label="Ações" onClick={() => {}}>
          <Ellipsis className="size-5" />
        </IconBtn>
      }
      items={[
        { label: 'Editar', icon: <Pencil className="size-4" />, onClick: () => setEditing(a) },
        { label: 'Renovar plano', icon: <CalendarClock className="size-4" />, onClick: () => setRenewing(a) },
        { label: 'Gerar nova senha', icon: <KeyRound className="size-4" />, onClick: () => newPassword(a) },
        { label: a.blocked ? 'Desbloquear' : 'Bloquear', icon: a.blocked ? <ShieldCheck className="size-4" /> : <Ban className="size-4" />, onClick: () => toggleBlock(a) },
        { label: 'Excluir acesso', icon: <Trash2 className="size-4" />, onClick: () => setRemoving(a), danger: true },
      ]}
    />
  )

  return (
    <>
      <Toolbar
        tabs={
          <Tabs
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'todos', label: 'Todos', count: counts.todos },
              { value: 'ativo', label: 'Ativos', count: counts.ativo },
              { value: 'vencendo', label: 'Vencendo', count: counts.vencendo },
              { value: 'vencido', label: 'Vencidos', count: counts.vencido },
              { value: 'bloqueado', label: 'Bloqueados', count: counts.bloqueado },
            ]}
          />
        }
      >
        <SearchBox value={q} onChange={setQ} placeholder="Buscar nome, e-mail ou telefone" className="w-full md:w-80" />
      </Toolbar>

      {accesses.length === 0 ? (
        <Card pad={false}>
          <EmptyState
            icon={<Users />}
            title="Nenhum acesso ainda"
            text="Crie o primeiro acesso: o sistema gera a senha e você envia direto no WhatsApp do cliente."
            action={
              <Btn onClick={() => onNew.set(true)}>
                <UserPlus className="size-4" /> Criar acesso
              </Btn>
            }
          />
        </Card>
      ) : (
        <Card pad={false}>
          {/* tabela no computador */}
          <table className="hidden w-full text-left text-[15px] md:table">
            <thead>
              <tr className="text-[13.5px] text-label-3">
                <th className="h-12 pl-7 pr-3 font-medium">Nome</th>
                <th className="px-3 font-medium">Plano</th>
                <th className="px-3 font-medium">Situação</th>
                <th className="hidden px-3 font-medium lg:table-cell">Vencimento</th>
                <th className="hidden px-3 font-medium xl:table-cell">WhatsApp</th>
                <th className="hidden px-3 font-medium xl:table-cell">Último acesso</th>
                <th className="w-14 pr-5" />
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {shown.map((a) => (
                  <motion.tr key={a.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="border-t border-separator transition-colors hover:bg-fill/60">
                    <td className="py-4 pl-7 pr-3">
                      <button onClick={() => setEditing(a)} className="flex min-w-0 items-center gap-4 text-left">
                        <Avatar name={a.name} size={44} />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{a.name}</span>
                          <span className="block truncate text-[14px] text-label-2">{a.email}</span>
                        </span>
                      </button>
                    </td>
                    <td className="px-3">
                      <span className="block font-medium">{PLANS.find((p) => p.value === a.plan)?.label}</span>
                      <span className="block text-[14px] text-label-2">{ROLES.find((r) => r.value === a.role)?.label}</span>
                    </td>
                    <td className="px-3">
                      <StatusPill a={a} />
                    </td>
                    <td className="hidden px-3 lg:table-cell">
                      <span className="tabular block">{a.expiresAt ? fmtDay(a.expiresAt) : '—'}</span>
                      <span className={clsx('block text-[14px]', accessStatus(a) === 'vencido' ? 'text-red' : 'text-label-2')}>{expiryText(a)}</span>
                    </td>
                    <td className="hidden px-3 xl:table-cell">
                      {a.instance ? <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-[#34c759]" />{a.instance}</span> : <span className="text-label-3">—</span>}
                    </td>
                    <td className="hidden px-3 text-label-2 xl:table-cell">{timeAgo(a.lastLogin)}</td>
                    <td className="pr-5 text-right">{menu(a)}</td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>

          {/* cartões no celular */}
          <ul className="md:hidden">
            {shown.map((a) => (
              <li key={a.id} className="flex items-center gap-3 border-t border-separator px-5 py-4 first:border-t-0">
                <button onClick={() => setEditing(a)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <Avatar name={a.name} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-semibold">{a.name}</span>
                    <span className="block truncate text-[14px] text-label-2">
                      {PLANS.find((p) => p.value === a.plan)?.label} · {expiryText(a)}
                    </span>
                  </span>
                  <StatusPill a={a} />
                </button>
                {menu(a)}
              </li>
            ))}
          </ul>

          {shown.length === 0 && <p className="border-t border-separator px-5 py-16 text-center text-[15px] text-label-2">Nada encontrado com esse filtro.</p>}
          {shown.length > 0 && (
            <div className="hidden border-t border-separator px-7 py-4 text-[14px] text-label-3 md:block">
              Mostrando {shown.length} de {accesses.length} {accesses.length === 1 ? 'acesso' : 'acessos'}
            </div>
          )}
        </Card>
      )}

      <AccessForm
        open={onNew.open || !!editing}
        access={editing}
        onClose={() => (onNew.set(false), setEditing(null))}
        onCreated={(access, password) => setCreds({ access, password, fresh: true })}
      />
      <RenewModal access={renewing} onClose={() => setRenewing(null)} />
      <Credentials data={creds} onClose={() => setCreds(null)} />
      <Confirm
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Excluir acesso?"
        text={
          <>
            <b className="text-label">{removing?.name}</b> não vai mais conseguir entrar. Esta ação não pode ser desfeita.
          </>
        }
        action="Excluir"
        onConfirm={async () => {
          const err = await removeAccess(removing!.id)
          if (err) notifyError(err)
          else notify('Acesso excluído')
        }}
      />
    </>
  )
}

// ─── Criar / editar ───────────────────────────────────────────

function AccessForm({ open, access, onClose, onCreated }: { open: boolean; access: Access | null; onClose: () => void; onCreated: (a: Access, password: string) => void }) {
  const { createAccess, updateAccess, addLog } = useAdmin()
  const instances = useInstances((s) => s.list)
  const editing = !!access
  const blank = { name: '', email: '', phone: '', role: 'operador' as Role, plan: 'mensal' as Plan, expiresAt: addDays(30), instance: '', note: '' }
  const [f, setF] = useState(blank)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lastKey, setLastKey] = useState<string | null>(null)

  // abre limpo ao criar, ou com os dados do acesso ao editar
  const key = open ? (access?.id ?? 'new') : null
  if (key !== lastKey) {
    setLastKey(key)
    if (key) {
      setF(access ? { name: access.name, email: access.email, phone: access.phone, role: access.role, plan: access.plan, expiresAt: access.expiresAt, instance: access.instance, note: access.note } : blank)
      setPassword(generatePassword())
      setError('')
    }
  }

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }))
  const setPlan = (plan: Plan) => {
    const days = PLANS.find((p) => p.value === plan)!.days
    setF((s) => ({ ...s, plan, expiresAt: days ? addDays(days) : '' }))
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (f.name.trim().length < 2) return setError('Digite o nome.')
    if (!validEmail(f.email)) return setError('Digite um e-mail válido.')
    if (!editing && password.length < 6) return setError('A senha precisa ter pelo menos 6 caracteres.')
    setBusy(true)
    if (editing) {
      updateAccess(access.id, { ...f, name: f.name.trim(), email: access.email })
      addLog(`Acesso de ${f.name.trim()} atualizado`, 'blue')
      notify('Alterações salvas')
      onClose()
    } else {
      const r = await createAccess({ ...f, password })
      if (typeof r === 'string') {
        setBusy(false)
        return setError(r)
      }
      onClose()
      onCreated(r, password)
    }
    setBusy(false)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Editar acesso' : 'Novo acesso'}
      subtitle={editing ? access.email : 'O cliente entra no app com este e-mail e senha.'}
      width={600}
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancelar
          </Btn>
          <Btn type="submit" form="access-form" busy={busy}>
            {editing ? 'Salvar' : 'Criar acesso'}
          </Btn>
        </>
      }
    >
      <form id="access-form" onSubmit={save} noValidate className="grid gap-5 sm:grid-cols-2">
        {editing && <AboutBusiness answers={access.onboarding} />}
        <Input label="Nome" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Maria Souza" autoFocus />
        <Input label="E-mail de login" type="email" value={f.email} disabled={editing} onChange={(e) => set('email', e.target.value)} placeholder="maria@email.com" className={editing ? 'opacity-60' : ''} />
        <Input label="WhatsApp" inputMode="tel" value={f.phone} onChange={(e) => set('phone', maskPhone(e.target.value))} placeholder="(11) 98765-4321" />
        <Select label="Perfil" value={f.role} options={ROLES} onChange={(v) => set('role', v)} />
        <Select label="Plano" value={f.plan} options={PLANS} onChange={setPlan} />
        <Input label="Vence em" type="date" value={f.expiresAt} onChange={(e) => set('expiresAt', e.target.value)} hint={!f.expiresAt ? 'Sem vencimento' : undefined} />
        <Select label="Instância de WhatsApp" value={f.instance} options={[{ value: '', label: 'Nenhuma' }, ...instances.map((i) => ({ value: i.name, label: i.name }))]} onChange={(v) => set('instance', v)} />
        {!editing && (
          <div>
            <label className="mb-2 block text-[14px] font-medium text-label-2">Senha inicial</label>
            <div className="flex gap-2">
              <input value={password} onChange={(e) => setPassword(e.target.value)} className={clsx(inputCls, 'min-w-0 flex-1 font-mono')} />
              <button type="button" onClick={() => setPassword(generatePassword())} title="Gerar outra" aria-label="Gerar outra senha" className="grid size-12 shrink-0 place-items-center rounded-full bg-fill text-label hover:bg-fill-2">
                <RefreshCw className="size-[18px]" />
              </button>
            </div>
          </div>
        )}
        <div className="sm:col-span-2">
          <Input label="Observação" value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="Opcional — ex.: pagou via Pix em 05/10" />
        </div>
        {error && <p className="text-[14px] font-medium text-red sm:col-span-2">{error}</p>}
      </form>
    </Modal>
  )
}

/** Respostas que a pessoa deu antes de criar a conta (também as do cadastro antigo, de empréstimos). */
function AboutBusiness({ answers }: { answers?: Answers }) {
  const order = questions.map((q) => q.id)
  const rows = Object.entries(answers ?? {})
    .filter(([, v]) => v?.length)
    .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
  if (!rows.length) return null
  return (
    <div className="rounded-[16px] bg-fill p-4 sm:col-span-2">
      <p className="mb-2.5 text-[13px] font-semibold text-label-2">Sobre a pessoa (respondido no cadastro)</p>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map(([id, v]) => (
          <div key={id} className="min-w-0">
            <dt className="text-[12px] text-label-2">{questionLabel[id] ?? id}</dt>
            <dd className="text-[14px] font-medium">{Array.isArray(v) ? v.join(', ') : v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

// ─── Renovar ──────────────────────────────────────────────────

function RenewModal({ access, onClose }: { access: Access | null; onClose: () => void }) {
  const renewAccess = useAdmin((s) => s.renewAccess)
  const [plan, setPlan] = useState<Plan>('mensal')
  return (
    <Modal
      open={!!access}
      onClose={onClose}
      title="Renovar plano"
      subtitle={access ? `${access.name} · ${expiryText(access)}` : ''}
      width={440}
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancelar
          </Btn>
          <Btn
            onClick={() => {
              renewAccess(access!.id, plan)
              notify('Plano renovado')
              onClose()
            }}
          >
            Renovar
          </Btn>
        </>
      }
    >
      <div className="grid gap-2">
        {PLANS.filter((p) => p.value !== 'teste').map((p) => (
          <button
            key={p.value}
            onClick={() => setPlan(p.value)}
            className={clsx('flex items-center justify-between rounded-[16px] px-5 py-4 text-left transition-colors', plan === p.value ? 'bg-tint/10 ring-2 ring-tint' : 'bg-fill hover:bg-fill-2')}
          >
            <span className="text-[16px] font-semibold">{p.label}</span>
            <span className="text-[14px] text-label-2">{p.days ? `+${p.days} dias` : 'sem vencimento'}</span>
          </button>
        ))}
      </div>
      <p className="mt-4 text-[14px] leading-relaxed text-label-2">Se o plano ainda não venceu, os dias são somados ao vencimento atual. Acessos bloqueados são liberados.</p>
    </Modal>
  )
}

// ─── Credenciais geradas ──────────────────────────────────────

function Credentials({ data, onClose }: { data: { access: Access; password: string; fresh: boolean } | null; onClose: () => void }) {
  const text = data ? credentialsText(data.access, data.password) : ''
  const phone = data?.access.phone.replace(/\D/g, '') ?? ''
  return (
    <Modal open={!!data} onClose={onClose} title={data?.fresh ? 'Acesso criado' : 'Nova senha gerada'} subtitle="Envie estes dados ao cliente. A senha não fica visível depois." width={460}>
      {data && (
        <>
          <div className="adm-brand relative overflow-hidden rounded-[22px] p-6 text-white">
            <p className="text-[13.5px] font-medium text-white/55">E-mail</p>
            <p className="truncate text-[18px] font-semibold">{data.access.email}</p>
            <p className="mt-4 text-[13.5px] font-medium text-white/55">Senha</p>
            <div className="flex items-center justify-between gap-3">
              <p className="font-display text-[28px] font-bold tracking-[0.04em]">{data.password}</p>
              <button onClick={() => copy(data.password, 'Senha copiada')} className="grid size-10 place-items-center rounded-full bg-white/12 hover:bg-white/20" aria-label="Copiar senha">
                <Copy className="size-4" />
              </button>
            </div>
          </div>
          <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
            <Btn variant="secondary" onClick={() => copy(text, 'Mensagem copiada')}>
              <Copy className="size-4" /> Copiar mensagem
            </Btn>
            <Btn
              onClick={() => {
                if (!phone) return notifyError('Este acesso não tem WhatsApp cadastrado.')
                window.open(`https://wa.me/${waPhone(phone)}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
              }}
            >
              <Send className="size-4" /> Enviar no WhatsApp
            </Btn>
          </div>
          {!phone && (
            <p className="mt-4 flex items-center justify-center gap-1.5 text-[14px] text-label-2">
              <Smartphone className="size-3.5" /> Cadastre o WhatsApp do cliente para enviar direto.
            </p>
          )}
        </>
      )}
    </Modal>
  )
}
