import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import {
  Bell,
  Calculator as CalculatorIcon,
  Camera,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  Smartphone,
  Lock,
  LogOut,
  Palette,
  Percent,
  PiggyBank,
  QrCode,
  RotateCcw,
  ShieldCheck,
  Tags,
  Trash2,
  Upload,
  UserRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { today } from '../lib/dates'
import { buildCharge } from '../lib/charge'
import { money, percent } from '../lib/format'
import { pixKeyLabel, type PixKeyType } from '../lib/pix'
import { collections, useData, useUI, type Backup, type Theme } from '../lib/store'
import { legacyToDebts, type LegacyClient, type LegacyContract } from '../lib/legacy'
import { defaultTemplate } from '../lib/whatsapp'
import { haptic } from '../lib/haptics'
import { confirmSignOut, useAuth } from '../lib/auth'
import { Sheet, toast } from '../components/sheet'
import { WhatsAppIcon } from '../components/icons'
import { hashPin, PinPad } from '../components/Lock'
import { deviceStatus, useNotices } from '../lib/notify'
import { isIOS, isStandalone, promptInstall, usePWA } from '../lib/pwa'
import NotificationSettings, { statusText } from './NotificationSettings'
import WhatsAppSettings from './WhatsAppSettings'
import { aiEnabled } from '../lib/features'
import { CategoryList } from './CategorySheet'
import { Button, initials, MoneyField, NumberField, PercentField, Row, Section, SectionHeader, Segmented, SelectField, Toggle } from '../components/ui'

const keyTypes = (Object.keys(pixKeyLabel) as PixKeyType[]).map((k) => ({ value: k, label: pixKeyLabel[k] }))

const pixPlaceholder: Record<PixKeyType, string> = {
  cpf: '000.000.000-00',
  cnpj: '00.000.000/0001-00',
  telefone: '(11) 98765-4321',
  email: 'voce@email.com',
  aleatoria: 'chave aleatória',
}

type Page = 'menu' | 'whatsapp' | 'perfil' | 'categorias' | 'contas' | 'meta' | 'pix' | 'atraso' | 'mensagem' | 'seguranca' | 'notificacoes' | 'aparencia' | 'dados'

const pageTitle: Record<Page, string> = {
  menu: 'Configurações',
  whatsapp: 'WhatsApp',
  perfil: 'Perfil',
  categorias: 'Categorias',
  contas: 'Conta padrão',
  meta: 'Meta de economia',
  pix: 'Chave Pix',
  atraso: 'Multa e juros',
  mensagem: 'Lembrete de parcela',
  seguranca: 'Segurança',
  notificacoes: 'Notificações',
  aparencia: 'Aparência',
  dados: 'Backup e dados',
}

const themeLabel: Record<Theme, string> = { light: 'Claro', dark: 'Escuro', system: 'Automático' }

/** Campo empilhado (rótulo em cima, texto na largura toda): nada fica cortado em telas estreitas. */
function Field({ label, value, onChange, placeholder, inputMode, autoComplete }: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  inputMode?: 'text' | 'email' | 'numeric' | 'tel'
  autoComplete?: string
}) {
  const id = useId()
  return (
    <label htmlFor={id} className="relative block px-4 pb-3 pt-2.5">
      <span className="block text-[12px] font-medium text-label-2">{label}</span>
      <input
        id={id}
        value={value}
        inputMode={inputMode}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 block w-full min-w-0 bg-transparent text-[16px] font-semibold text-label caret-tint outline-none placeholder:font-normal placeholder:text-label-3"
      />
    </label>
  )
}

/** Reduz a foto para um quadrado de 400px: nítida em telas retina e leve para salvar no aparelho. */
async function squarePhoto(file: File, size = 400) {
  const bmp = await createImageBitmap(file)
  const side = Math.min(bmp.width, bmp.height)
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size })
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size)
  bmp.close()
  return canvas.toDataURL('image/jpeg', 0.88)
}

const pixInput: Record<PixKeyType, 'text' | 'email' | 'numeric' | 'tel'> = { cpf: 'numeric', cnpj: 'numeric', telefone: 'tel', email: 'email', aleatoria: 'text' }

/** Linha do menu de configurações: ícone colorido, resumo do valor atual e seta. */
function MenuRow({ icon: Icon, tone, label, detail, onClick }: { icon: LucideIcon | typeof WhatsAppIcon; tone: string; label: string; detail?: string; onClick: () => void }) {
  return (
    <motion.button
      onClick={() => (haptic(), onClick())}
      whileTap={{ backgroundColor: 'var(--fill)' }}
      className="relative flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left"
    >
      <span className={`grid size-9 shrink-0 place-items-center rounded-[10px] text-white ${tone}`}>
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{label}</span>
        {detail && <span className="mt-0.5 block truncate text-[12px] text-label-2">{detail}</span>}
      </span>
      <ChevronRight className="size-4 shrink-0 text-label-3" strokeWidth={2.5} />
    </motion.button>
  )
}

/** Confere um backup (formato atual ou da versão de empréstimos) e devolve no formato atual. */
function readBackup(raw: Record<string, unknown>): { backup: Backup; summary: string } {
  if (raw?.app !== 'jurospro') throw new Error('formato')
  const num = (v: unknown) => typeof v === 'number' && isFinite(v)
  const str = (v: unknown) => typeof v === 'string' && v.length > 0
  const list = (k: string) => (Array.isArray(raw[k]) ? (raw[k] as Record<string, unknown>[]) : [])
  if (raw.version === 2) {
    // cada item precisa de id; lançamentos com tipo, valor e data; dívidas com parcelas
    for (const k of collections) if (!list(k).every((x) => x && str(x.id))) throw new Error('conteúdo')
    const types = ['receita', 'despesa', 'transferencia']
    if (!list('transactions').every((t) => types.includes(t.type as string) && num(t.amount) && str(t.date))) throw new Error('conteúdo')
    if (!list('debts').every((d) => num(d.principal) && Array.isArray(d.schedule) && Array.isArray(d.payments))) throw new Error('conteúdo')
    const b = raw as unknown as Backup
    return { backup: b, summary: `${b.transactions?.length ?? 0} lançamentos, ${b.accounts?.length ?? 0} contas e ${b.debts?.length ?? 0} dívidas` }
  }
  // versão de empréstimos: os contratos viram dívidas a receber; o resto começa vazio
  const contracts = list('contracts') as unknown as LegacyContract[]
  if (!contracts.every((c) => str(c.id) && num(c.principal) && Array.isArray(c.schedule) && Array.isArray(c.payments))) throw new Error('conteúdo')
  const debts = legacyToDebts(list('clients') as unknown as LegacyClient[], contracts)
  const backup = { app: 'jurospro', version: 2, exportedAt: String(raw.exportedAt), accounts: [], cards: [], categories: [], transactions: [], recurrences: [], goals: [], debts, settings: (raw.settings ?? {}) as Backup['settings'] } satisfies Backup
  return { backup, summary: `${debts.length} empréstimos da versão anterior (como dívidas a receber)` }
}

export default function SettingsSheet() {
  const open = useUI((s) => s.settings)
  const openSettings = useUI((s) => s.openSettings)
  const { settings, setSettings, exportBackup, importBackup, loadDemo, clearAll } = useData()
  const accounts = useData((s) => s.accounts)
  const [pinStep, setPinStep] = useState<null | { first?: string; error?: string }>(null)
  const [page, setPage] = useState<Page>('menu')
  // aberto já numa página (ex.: "Configurar" da central de notificações)
  const startPage = useUI((s) => s.settingsPage)
  useEffect(() => {
    if (open && startPage && startPage in pageTitle) setPage(startPage as Page)
  }, [open, startPage])
  const notices = useNotices((s) => deviceStatus(s))
  const { canInstall, installed } = usePWA()
  const showInstall = !installed && (canInstall || (isIOS && !isStandalone()))
  const fileRef = useRef<HTMLInputElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)

  const sample = buildCharge(settings, { id: 'exemplo', person: 'Ana Souza' }, { n: 2, count: 6, due: today(), amount: 450, paid: 0, remaining: 450, status: 'hoje' })

  /** Fecha as configurações e abre outra coisa quando a folha terminar de fechar. */
  const leave = (fn: () => void) => {
    openSettings(false)
    setTimeout(() => (setPage('menu'), fn()), 300)
  }

  const doExport = () => {
    const data = JSON.stringify(exportBackup(), null, 2)
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
    Object.assign(document.createElement('a'), { href: url, download: `dinn-backup-${today()}.json` }).click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    toast('Backup salvo')
  }

  const doImport = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text()) as Record<string, unknown>
      const { backup, summary } = readBackup(raw)
      const when = new Date(String(raw.exportedAt)).toLocaleString('pt-BR')
      if (!confirm(`Restaurar o backup de ${when}? ${summary} vão substituir os dados atuais.`)) return
      importBackup(backup)
      toast('Backup restaurado')
    } catch {
      toast('Arquivo inválido')
    }
  }

  const pickPhoto = async (file: File) => {
    try {
      setSettings({ photo: await squarePhoto(file) })
      toast('Foto atualizada')
    } catch {
      toast('Não deu para abrir a foto')
    }
  }

  const owner = settings.owner.trim()
  const avatar = (cls: string, text: string) => (
    <span className={`grad-green grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-white ${cls}`}>
      {settings.photo ? (
        <img src={settings.photo} alt="" className="size-full object-cover" />
      ) : owner ? (
        <span className={text}>{initials(owner)}</span>
      ) : (
        <UserRound className="size-1/2" />
      )}
    </span>
  )
  const active = accounts.filter((a) => !a.archived)
  const defaultName = active.find((a) => a.id === settings.defaultAccount)?.name

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        openSettings(o)
        // volta ao menu depois que a folha termina de fechar
        if (!o) setTimeout(() => setPage('menu'), 300)
      }}
      title={pageTitle[page]}
      action={
        page !== 'menu' && (
          <button onClick={() => (haptic(), setPage('menu'))} className="-ml-1.5 flex items-center text-[17px] font-medium text-tint">
            <ChevronLeft className="size-6" strokeWidth={2.2} /> Voltar
          </button>
        )
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={page}
          initial={{ opacity: 0, x: page === 'menu' ? -24 : 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: page === 'menu' ? 24 : -24 }}
          transition={{ duration: 0.16 }}
        >
          {page === 'menu' && (
            <>
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => (haptic(), setPage('perfil'))}
                className="mb-6 mt-1 flex w-full items-center gap-3 rounded-[22px] bg-surface p-4 text-left shadow-card"
              >
                {avatar('size-14', 'text-[18px]')}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[17px] font-semibold">{owner || 'Seu perfil'}</span>
                  <span className="block truncate text-[13px] text-label-2">{owner ? (useAuth.getState().email ?? 'Nome e foto') : 'Toque para adicionar seu nome e foto'}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-label-3" strokeWidth={2.5} />
              </motion.button>

              {aiEnabled && (
                <Section>
                  <MenuRow icon={WhatsAppIcon} tone="bg-[#25d366]" label="Assistente no WhatsApp" detail="Lance por texto, áudio ou print" onClick={() => setPage('whatsapp')} />
                </Section>
              )}

              <Section header="Organização">
                <MenuRow icon={Tags} tone="bg-tint" label="Categorias" detail="Cores, ícones, subcategorias e palavras-chave" onClick={() => setPage('categorias')} />
                <MenuRow icon={Wallet} tone="bg-blue" label="Conta padrão" detail={defaultName ?? 'Nenhuma'} onClick={() => setPage('contas')} />
                <MenuRow icon={PiggyBank} tone="bg-[#0d9488]" label="Meta de economia do mês" detail={settings.goal > 0 ? money(settings.goal) : 'Desativada'} onClick={() => setPage('meta')} />
                <MenuRow icon={CalculatorIcon} tone="bg-[#0f3b2c]" label="Simulador de financiamento" detail="Compare prazos, parcelas e juros" onClick={() => leave(() => useUI.getState().openCalculator(true))} />
              </Section>

              <Section header="Quem te deve" footer="Para lembrar no WhatsApp quem pegou dinheiro emprestado com você (aba Dívidas).">
                <MenuRow
                  icon={QrCode}
                  tone="bg-[#1fa855]"
                  label="Chave Pix"
                  detail={settings.pix ? `${pixKeyLabel[settings.pixType]} · ${settings.pix}` : 'Não configurada'}
                  onClick={() => setPage('pix')}
                />
                <MenuRow
                  icon={Percent}
                  tone="bg-orange"
                  label="Multa e juros por atraso"
                  detail={`Multa ${percent(settings.late.fee)} · ${percent(settings.late.daily)} ao dia`}
                  onClick={() => setPage('atraso')}
                />
                <MenuRow
                  icon={WhatsAppIcon}
                  tone="bg-[#25d366]"
                  label="Mensagem do lembrete"
                  detail={settings.template === defaultTemplate ? 'Mensagem padrão' : 'Personalizada'}
                  onClick={() => setPage('mensagem')}
                />
              </Section>

              <Section header="App">
                <MenuRow
                  icon={ShieldCheck}
                  tone="bg-[#0f3b2c]"
                  label="Segurança e privacidade"
                  detail={[settings.pinHash ? 'PIN ativo' : 'Sem PIN', settings.privacy && 'valores ocultos'].filter(Boolean).join(' · ')}
                  onClick={() => setPage('seguranca')}
                />
                <MenuRow icon={Bell} tone="bg-red" label="Notificações" detail={statusText[notices]} onClick={() => setPage('notificacoes')} />
                <MenuRow icon={Palette} tone="bg-[#8e5cf7]" label="Aparência" detail={themeLabel[settings.theme]} onClick={() => setPage('aparencia')} />
                <MenuRow icon={Database} tone="bg-[#64748b]" label="Backup e dados" detail="Salvar, restaurar e começar do zero" onClick={() => setPage('dados')} />
                {showInstall && (
                  <MenuRow
                    icon={Smartphone}
                    tone="bg-tint"
                    label="Instalar o app"
                    detail="Ícone na tela inicial e avisos no celular"
                    onClick={async () => {
                      // no iPhone não há botão de instalar: a página de notificações mostra o passo a passo
                      if (!canInstall) return setPage('notificacoes')
                      if (await promptInstall()) toast('App instalado')
                    }}
                  />
                )}
              </Section>

              <Section footer={useAuth.getState().email ?? undefined}>
                <Row
                  icon={<LogOut className="size-[18px] text-red" />}
                  label={<span className="text-red">Sair da conta</span>}
                  onClick={() => {
                    if (!confirmSignOut()) return
                    useUI.getState().closeAll()
                    useAuth.getState().signOut()
                  }}
                />
              </Section>
              <p className="px-4 text-center text-[12px] text-label-2">Dinn · finanças pessoais</p>
            </>
          )}

          {page === 'perfil' && (
            <>
              <div className="mb-6 mt-2 flex flex-col items-center">
                <button onClick={() => (haptic(), photoRef.current?.click())} aria-label="Escolher foto" className="relative">
                  {avatar('size-28 shadow-card', 'text-[36px]')}
                  <span className="absolute bottom-0.5 right-0.5 grid size-9 place-items-center rounded-full bg-tint text-white ring-4 ring-bg">
                    <Camera className="size-[18px]" />
                  </span>
                </button>
                <div className="mt-3 flex items-center gap-5 text-[14px] font-semibold">
                  <button onClick={() => (haptic(), photoRef.current?.click())} className="text-tint">
                    {settings.photo ? 'Trocar foto' : 'Adicionar foto'}
                  </button>
                  {settings.photo && (
                    <button onClick={() => (haptic(), setSettings({ photo: '' }))} className="text-red">
                      Remover
                    </button>
                  )}
                </div>
                <input
                  ref={photoRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) pickPhoto(f)
                  }}
                />
              </div>
              <Section footer="Seu nome aparece na saudação da tela inicial e assina os lembretes de parcela.">
                <Field label="Seu nome" value={settings.owner} onChange={(owner) => setSettings({ owner })} placeholder="Como quer ser chamado" autoComplete="name" />
              </Section>
            </>
          )}

          {page === 'categorias' && <CategoryList onOpen={(opts) => leave(() => useUI.getState().openCategory(true, opts))} />}

          {page === 'contas' && (
            <>
              <Section footer="Novos lançamentos já vêm com esta conta escolhida (dá para trocar na hora).">
                <SelectField
                  label="Conta padrão"
                  value={defaultName ? settings.defaultAccount : ''}
                  onChange={(defaultAccount) => setSettings({ defaultAccount })}
                  placeholder="Nenhuma"
                  options={active.map((a) => ({ value: a.id, label: a.name }))}
                />
              </Section>
              <Button variant="tinted" onClick={() => leave(() => useUI.getState().setTab('accounts'))}>
                <Wallet className="size-[18px]" /> Gerenciar contas e cartões
              </Button>
            </>
          )}

          {page === 'meta' && (
            <Section footer="Quanto você quer que sobre no mês (receitas − despesas). Aparece no balanço da tela inicial. Deixe zerada para esconder.">
              <MoneyField label="Guardar por mês" value={settings.goal} onChange={(goal) => setSettings({ goal })} />
            </Section>
          )}

          {page === 'pix' && (
            <>
              <SectionHeader>Tipo de chave</SectionHeader>
              <div role="radiogroup" className="mb-6 grid grid-cols-3 gap-2">
                {keyTypes.map((k) => {
                  const on = k.value === settings.pixType
                  return (
                    <motion.button
                      key={k.value}
                      role="radio"
                      aria-checked={on}
                      whileTap={{ scale: 0.96 }}
                      onClick={() => (haptic(), setSettings({ pixType: k.value }))}
                      className={`h-10 truncate rounded-full px-2 text-[13px] font-semibold transition-colors ${on ? 'bg-tint text-white' : 'bg-surface text-label-2 shadow-card'}`}
                    >
                      {k.label}
                    </motion.button>
                  )
                })}
              </div>
              <Section footer="O lembrete no WhatsApp leva o Pix copia e cola com o valor exato da parcela (já com encargos, se houver).">
                <Field label="Chave Pix" value={settings.pix} onChange={(pix) => setSettings({ pix })} placeholder={pixPlaceholder[settings.pixType]} inputMode={pixInput[settings.pixType]} />
                <Field label="Nome do recebedor" value={settings.pixName} onChange={(pixName) => setSettings({ pixName })} placeholder="Como aparece no banco" />
                <Field label="Cidade" value={settings.pixCity} onChange={(pixCity) => setSettings({ pixCity })} placeholder="São Paulo" />
              </Section>
            </>
          )}

          {page === 'atraso' && (
            <Section footer="Valem para o dinheiro que te devem: entram sozinhos nas parcelas vencidas, no lembrete, no Pix e ao receber (dá para dispensar na hora).">
              <PercentField label="Multa" value={settings.late.fee} onChange={(fee) => setSettings({ late: { ...settings.late, fee } })} />
              <PercentField label="Juros ao dia" value={settings.late.daily} onChange={(daily) => setSettings({ late: { ...settings.late, daily } })} />
              <NumberField
                label="Tolerância"
                value={settings.late.grace}
                onChange={(grace) => setSettings({ late: { ...settings.late, grace: Math.max(0, Math.round(grace)) } })}
                suffix="dias"
              />
            </Section>
          )}

          {page === 'mensagem' && (
            <>
              <Section footer="Variáveis: {nome}, {parcela}, {valor}, {situacao}, {vencimento}, {pix}, {empresa} (seu nome).">
                <textarea
                  value={settings.template}
                  onChange={(e) => setSettings({ template: e.target.value })}
                  rows={8}
                  className="block w-full resize-none bg-transparent px-4 py-3 text-[14px] leading-5 outline-none"
                />
              </Section>
              <SectionHeader>Prévia</SectionHeader>
              <div className="mb-6 rounded-[22px] rounded-tl-[4px] bg-[#dcf8c6] p-3 text-[13px] leading-5 break-words whitespace-pre-line text-[#111b21] shadow-card dark:bg-[#005c4b] dark:text-white">
                {sample.text}
              </div>
              {settings.template !== defaultTemplate && (
                <Button variant="plain" className="-mt-2 mb-4" onClick={() => setSettings({ template: defaultTemplate })}>
                  <RotateCcw className="size-4" /> Restaurar mensagem padrão
                </Button>
              )}
            </>
          )}

          {page === 'seguranca' && (
            <>
              <Section header="Bloqueio">
                <Row
                  icon={<Lock className="size-[18px]" />}
                  label={settings.pinHash ? 'Bloqueio com PIN ativo' : 'Bloquear app com PIN'}
                  detail={settings.pinHash ? 'Toque para remover' : 'Pede o PIN ao abrir'}
                  onClick={() => {
                    if (!settings.pinHash) return setPinStep({})
                    if (confirm('Remover o bloqueio por PIN?')) setSettings({ pinHash: null })
                  }}
                />
              </Section>
              <Section header="Privacidade" footer="Também dá para alternar pelo olho ao lado do saldo na tela inicial.">
                <Toggle label="Esconder valores" detail="Mostra R$ •••• no lugar dos valores" checked={settings.privacy} onChange={(privacy) => setSettings({ privacy })} />
              </Section>
            </>
          )}

          {page === 'notificacoes' && <NotificationSettings />}

          {page === 'whatsapp' && <WhatsAppSettings />}

          {page === 'aparencia' && (
            <>
              <SectionHeader>Tema</SectionHeader>
              <Segmented<Theme>
                value={settings.theme}
                onChange={(theme) => setSettings({ theme })}
                options={[
                  { value: 'light', label: 'Claro' },
                  { value: 'dark', label: 'Escuro' },
                  { value: 'system', label: 'Automático' },
                ]}
              />
            </>
          )}

          {page === 'dados' && (
            <>
              <Section header="Backup" footer="Seus dados ficam na sua conta e neste aparelho. O backup é uma cópia extra em arquivo (também aceita backups da versão de empréstimos).">
                <Row icon={<Download className="size-[18px]" />} label="Salvar backup" detail="Baixa um arquivo .json" onClick={doExport} />
                <Row icon={<Upload className="size-[18px]" />} label="Restaurar backup" detail="Escolher arquivo salvo" onClick={() => fileRef.current?.click()} />
              </Section>
              <Section header="Dados">
                <Row
                  icon={<Database className="size-[18px]" />}
                  label="Carregar dados de exemplo"
                  detail="Três meses de uma família, para conhecer o app"
                  onClick={() => {
                    if (!confirm('Substituir seus dados pelos dados de exemplo?')) return
                    loadDemo()
                    toast('Exemplo carregado')
                  }}
                />
                <Row
                  icon={<Trash2 className="size-[18px] text-red" />}
                  label={<span className="text-red">Começar do zero</span>}
                  detail="Apaga contas, cartões, lançamentos, metas e dívidas"
                  onClick={() => {
                    if (!confirm('Apagar contas, cartões, lançamentos, metas e dívidas? As categorias voltam ao padrão. Essa ação não pode ser desfeita.')) return
                    clearAll()
                    toast('Tudo apagado')
                  }}
                />
              </Section>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      {/* fica fora das páginas para o seletor de arquivo não se perder na troca de página */}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) doImport(f)
        }}
      />

      {createPortal(
        <AnimatePresence>
          {pinStep && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grad-green pointer-events-auto fixed inset-0 z-[110]">
              <button onClick={() => setPinStep(null)} className="absolute right-5 top-[max(var(--sat),16px)] z-10 text-[15px] font-semibold text-white/80">
                Cancelar
              </button>
              <PinPad
                title={pinStep.first ? 'Confirme o PIN' : 'Crie um PIN de 4 dígitos'}
                subtitle="Será pedido ao abrir o app"
                error={pinStep.error}
                onComplete={async (pin) => {
                  if (!pinStep.first) return setPinStep({ first: pin })
                  if (pin !== pinStep.first) return setPinStep({ error: 'Os PINs não conferem. Tente de novo.' })
                  setSettings({ pinHash: await hashPin(pin) })
                  setPinStep(null)
                  toast('Bloqueio ativado')
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </Sheet>
  )
}
