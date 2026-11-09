import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Loader2, Lock, Mail, Moon, Phone, Sun, User } from 'lucide-react'
import clsx from 'clsx'
import { CONFIRM_EMAIL, useAuth, validEmail } from '../lib/auth'
import { haptic } from '../lib/haptics'
import { questions, savePending, type Answers } from '../lib/onboarding'
import { maskPhone } from '../components/ui'
import { useDesktop } from '../lib/media'
import { useData } from '../lib/store'
import { MobileHero, Showcase, type Pose } from '../components/LoginArt'
import dinnIcon from '../assets/dinn-icone.webp'

// start: os botões "Continuar com Google" e "Entrar com e-mail"; login: o formulário de e-mail e senha
type Mode = 'start' | 'login' | 'quiz' | 'signup' | 'forgot' | 'reset'

const copy: Record<Exclude<Mode, 'quiz'>, { title: string; subtitle: string }> = {
  start: { title: 'Bem-vindo(a) de volta', subtitle: 'Entre para ver como está o seu dinheiro.' },
  login: { title: 'Entrar com e-mail', subtitle: 'Use o e-mail e a senha da sua conta Dinn.' },
  signup: { title: 'Criar conta', subtitle: 'Último passo: seus dados de acesso.' },
  forgot: { title: 'Recuperar senha', subtitle: 'Enviamos um link para criar uma nova senha.' },
  reset: { title: 'Nova senha', subtitle: 'Escolha a senha que vai usar daqui em diante.' },
}

const ease = [0.32, 0.72, 0, 1] as const

// itens do formulário entram um depois do outro
const list = { show: { transition: { staggerChildren: 0.05, delayChildren: 0.15 } } }
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease } } }
const Rise = ({ children, className }: { children: ReactNode; className?: string }) => (
  <motion.div variants={item} className={className}>
    {children}
  </motion.div>
)

// botões do formulário: verde para a ação principal, cinza para as outras
const primary =
  'grid h-[52px] w-full place-items-center rounded-[14px] bg-tint text-[15.5px] font-semibold text-white shadow-[0_10px_24px_-14px_rgba(21,128,61,0.9)] transition-[filter] hover:brightness-110 disabled:opacity-65'
const secondary =
  'flex h-[52px] w-full items-center justify-center gap-3 rounded-[14px] bg-fill text-[15.5px] font-medium text-label transition-colors hover:bg-fill-2 disabled:opacity-70'

/** Força da senha de 0 a 4. */
const strengthOf = (p: string) => {
  if (!p) return 0
  let s = 0
  if (p.length >= 8) s++
  if (p.length >= 12) s++
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++
  if (/\d/.test(p)) s++
  if (/[^A-Za-z0-9]/.test(p)) s++
  return Math.max(1, Math.min(4, s))
}
const STRENGTH = [
  { label: '', color: '' },
  { label: 'Fraca', color: '#ef4444' },
  { label: 'Média', color: '#f59e0b' },
  { label: 'Forte', color: '#22c55e' },
  { label: 'Muito forte', color: '#15803d' },
]

/** Campo cinza arredondado: ícone, texto e, se tiver, um botão no fim (o olho da senha). */
function Field({ icon, trailing, ...input }: { icon: ReactNode; trailing?: ReactNode } & React.ComponentProps<'input'>) {
  return (
    <label className="flex h-[52px] items-center gap-3 rounded-[14px] bg-fill px-[18px] text-label-3 transition-[background-color,box-shadow] hover:bg-fill-2 focus-within:bg-surface focus-within:shadow-[0_0_0_2px_var(--tint),0_0_0_6px_rgba(21,128,61,0.14)]">
      {icon}
      <input {...input} aria-label={input['aria-label'] ?? input.placeholder} className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-label outline-none placeholder:text-label-3" />
      {trailing}
    </label>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="size-[18px]" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

/** Claro/escuro no canto do formulário (computador). */
function ThemeToggle() {
  const theme = useData((s) => s.settings.theme)
  const setSettings = useData((s) => s.setSettings)
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  return (
    <button
      type="button"
      onClick={() => (haptic(), setSettings({ theme: dark ? 'light' : 'dark' }))}
      title={dark ? 'Tema claro' : 'Tema escuro'}
      aria-label={dark ? 'Tema claro' : 'Tema escuro'}
      className="absolute top-6 right-6 hidden size-10 place-items-center rounded-full text-label-2 transition-colors hover:bg-fill hover:text-label lg:grid"
    >
      {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </button>
  )
}

/** Título centralizado do formulário, com a seta de voltar à esquerda quando dá para voltar. */
function Head({ title, subtitle, eyebrow, onBack }: { title: string; subtitle: string; eyebrow?: string; onBack?: () => void }) {
  return (
    <Rise className="relative text-center">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Voltar"
          className="absolute -top-1 -left-2 grid size-9 place-items-center rounded-full text-label-2 transition-colors hover:bg-fill hover:text-label"
        >
          <ArrowLeft className="size-5" />
        </button>
      )}
      <div className={clsx(onBack && 'px-9')}>
        {eyebrow && <p className="mb-1 text-[12.5px] font-semibold text-tint">{eyebrow}</p>}
        <h1 className="text-[26px] leading-[1.2] font-semibold tracking-[-0.03em] text-label lg:text-[31px]">{title}</h1>
        <p className="mt-1.5 text-[15px] text-label-2 lg:mt-2 lg:text-[16px]">{subtitle}</p>
      </div>
    </Rise>
  )
}

const DOMAINS = ['gmail.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'yahoo.com.br', 'live.com']

// perguntas sobre como a pessoa cuida do dinheiro + o WhatsApp no fim
const QUIZ_STEPS = questions.length + 1

/** Antes de criar a conta: perguntas rápidas sobre o seu dinheiro, uma por vez (tocar já avança). */
function Quiz({ step, answers, phone, onAnswer, onPhone, onNext, onBack, onLogin }: {
  step: number
  answers: Answers
  phone: string
  onAnswer: (id: string, value: string | string[]) => void
  onPhone: (v: string) => void
  onNext: () => void
  onBack: () => void
  onLogin: () => void
}) {
  const q = questions[step]
  const value = q ? answers[q.id] : undefined
  const picked = (o: string) => (Array.isArray(value) ? value.includes(o) : value === o)

  return (
    <>
      <Head
        eyebrow={`Sobre você · ${step + 1} de ${QUIZ_STEPS}`}
        title={q ? q.title : 'Qual o seu WhatsApp?'}
        subtitle={q ? q.hint : 'Para o suporte falar com você sobre o seu acesso. É opcional.'}
        onBack={onBack}
      />

      <Rise className="mt-5 flex gap-1">
        {Array.from({ length: QUIZ_STEPS }, (_, i) => (
          <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-fill">
            <motion.span
              className="block h-full rounded-full bg-tint"
              initial={false}
              animate={{ scaleX: i <= step ? 1 : 0 }}
              style={{ originX: 0 }}
              transition={{ duration: 0.3, ease }}
            />
          </span>
        ))}
      </Rise>

      {q ? (
        <Rise className="mt-5">
          <div role={q.multi ? 'group' : 'radiogroup'} aria-label={q.title} className="space-y-2.5">
            {q.options.map((o) => {
              const on = picked(o)
              return (
                <motion.button
                  key={o}
                  type="button"
                  role={q.multi ? 'checkbox' : 'radio'}
                  aria-checked={on}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    haptic()
                    if (!q.multi) return onAnswer(q.id, o)
                    const chosen = Array.isArray(value) ? value : []
                    onAnswer(q.id, on ? chosen.filter((x) => x !== o) : [...chosen, o])
                  }}
                  className={clsx(
                    'flex min-h-[52px] w-full items-center gap-3 rounded-[14px] px-[18px] py-3 text-left text-[15px] font-medium text-label transition-colors',
                    on ? 'bg-tint/10 ring-2 ring-tint' : 'bg-fill hover:bg-fill-2',
                  )}
                >
                  <span className="flex-1">{o}</span>
                  <span
                    className={clsx(
                      'grid size-5 shrink-0 place-items-center transition-colors',
                      q.multi ? 'rounded-[6px]' : 'rounded-full',
                      on ? 'bg-tint' : 'ring-[1.5px] ring-label-3',
                    )}
                  >
                    {on && <Check className="size-3 text-white" strokeWidth={3.5} />}
                  </span>
                </motion.button>
              )
            })}
          </div>
          {q.multi && (
            <motion.button type="button" whileTap={{ scale: 0.98 }} disabled={!Array.isArray(value) || !value.length} onClick={() => (haptic(), onNext())} className={clsx(primary, 'mt-4')}>
              Continuar
            </motion.button>
          )}
        </Rise>
      ) : (
        <Rise className="mt-5">
          <Field
            icon={<Phone className="size-[19px]" />}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => onPhone(maskPhone(e.target.value))}
            placeholder="(11) 98765-4321"
            aria-label="WhatsApp"
          />
          <motion.button type="button" whileTap={{ scale: 0.98 }} onClick={() => (haptic(), onNext())} className={clsx(primary, 'mt-4')}>
            {phone.replace(/\D/g, '').length >= 10 ? 'Continuar' : 'Pular e continuar'}
          </motion.button>
        </Rise>
      )}

      <Rise>
        <p className="mt-6 text-center text-[15px] text-label-2">
          Já tem conta?{' '}
          <button type="button" onClick={onLogin} className="font-semibold text-tint">
            Entrar
          </button>
        </p>
      </Rise>
    </>
  )
}

export default function Login() {
  const { signIn, signUp, signInGoogle, sendReset, setNewPassword } = useAuth()
  const [mode, setMode] = useState<Mode>(() => (useAuth.getState().recovery ? 'reset' : 'start'))
  const [name, setName] = useState('')
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Answers>({})
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [show, setShow] = useState(false)
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [shake, setShake] = useState(0)
  const [emailFocus, setEmailFocus] = useState(false)
  const [done, setDone] = useState(false)
  const enter = useAuth((s) => s.enter)
  const desktop = useDesktop()

  // deu certo: o botão mostra "tudo certo" e o app abre num círculo que cresce a partir do botão tocado
  const submitRef = useRef<HTMLButtonElement>(null)
  const googleRef = useRef<HTMLButtonElement>(null)
  const finish = (from: HTMLElement | null) => {
    haptic('success')
    setDone(true)
    setNotice('Tudo certo! Abrindo o Dinn…')
    const r = from?.getBoundingClientRect()
    setTimeout(() => enter(r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined), 700)
  }

  // força da senha (só ao criar conta ou trocar a senha): vibra quando fica forte
  const strength = mode === 'signup' || mode === 'reset' ? strengthOf(pass) : 0
  const wasStrong = useRef(false)
  useEffect(() => {
    const strong = strength >= 3
    if (strong && !wasStrong.current) haptic('success')
    wasStrong.current = strong
  }, [strength])

  // atalhos de domínio: aparecem enquanto digita e filtram pelo que vem depois do @
  const passRef = useRef<HTMLInputElement>(null)
  const [local, typedDomain = ''] = email.split('@')
  const domains = emailFocus && local ? DOMAINS.filter((d) => d.startsWith(typedDomain.toLowerCase()) && d !== typedDomain.toLowerCase()) : []
  const pickDomain = (d: string) => {
    haptic()
    setEmail(`${local}@${d}`)
    passRef.current?.focus()
  }
  const emailProps = { onFocus: () => setEmailFocus(true), onBlur: () => setEmailFocus(false) }

  const go = (m: Mode) => {
    haptic()
    setMode(m)
    setError('')
    setNotice('')
  }

  // perguntas do cadastro: tocar numa opção já passa para a próxima
  const answer = (id: string, value: string | string[]) => {
    setAnswers((a) => ({ ...a, [id]: value }))
    // dois toques rápidos não pulam a pergunta seguinte: só avança se ainda estiver nesta
    const at = step
    if (!Array.isArray(value)) setTimeout(() => setStep((s) => (s === at ? s + 1 : s)), 220)
  }
  const nextStep = () => {
    if (step < QUIZ_STEPS - 1) return setStep((s) => s + 1)
    // fim das perguntas: guarda (vale também para o Google) e pede os dados de acesso
    savePending({ answers, phone: phone.replace(/\D/g, '') })
    go('signup')
  }
  const backStep = () => {
    if (step > 0) return (haptic(), setStep((s) => s - 1))
    go('start')
  }

  const fail = (msg: string) => {
    haptic('medium')
    setError(msg)
    setShake((s) => s + 1)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || done) return
    setNotice('')
    if (mode === 'signup' && name.trim().length < 2) return fail('Digite seu nome.')
    if (mode !== 'reset' && !validEmail(email)) return fail('Digite um e-mail válido.')
    if (mode === 'forgot') {
      setBusy(true)
      const err = await sendReset(email)
      setBusy(false)
      if (err) return fail(err)
      haptic('success')
      setError('')
      return setNotice('Se houver uma conta com este e-mail, o link chega em instantes. Confira também o spam.')
    }
    if (pass.length < 6) return fail('A senha precisa ter pelo menos 6 caracteres.')
    setBusy(true)
    const err =
      mode === 'reset'
        ? await setNewPassword(pass)
        : mode === 'signup'
          ? await signUp(name, email, pass, { phone: phone.replace(/\D/g, ''), answers })
          : await signIn(email, pass, remember)
    setBusy(false)
    if (err === CONFIRM_EMAIL) {
      // conta criada, falta confirmar o e-mail: volta para o login com o aviso
      setMode('login')
      setPass('')
      setError('')
      return setNotice(err)
    }
    if (err) fail(err)
    else finish(submitRef.current)
  }

  const { title, subtitle } = mode === 'quiz' ? copy.signup : copy[mode]
  // pose do mascote no celular: comemora ao criar a conta e ao entrar, organiza moedas nas perguntas,
  // toca o sino na recuperação de senha
  // celular, na entrada: o painel das frases ocupa o alto da tela e a folha branca só tem os botões
  const intro = !desktop && mode === 'start'
  const pose: Pose = done || mode === 'signup' ? 'metas' : mode === 'quiz' ? 'categorias' : mode === 'forgot' || mode === 'reset' ? 'avisos' : 'nuvem'
  const shaking = { animate: shake ? { x: [0, -6, 6, -4, 4, 0] } : {}, transition: { duration: 0.3 } }
  const message = (
    <p role="alert" className={clsx('min-h-5 pt-2.5 text-center text-[13.5px]', error ? 'text-red' : notice ? 'font-medium text-tint' : 'text-label-2')}>
      {error || notice}
    </p>
  )
  const link = 'font-semibold text-tint underline decoration-tint/35 underline-offset-4 transition-colors hover:decoration-tint'
  const toSignup = () => (setStep(0), go('quiz'))
  const back = mode === 'signup' ? () => go('quiz') : mode === 'forgot' ? () => go('login') : mode === 'login' ? () => go('start') : undefined

  const google = (
    <motion.button
      ref={googleRef}
      type="button"
      whileTap={{ scale: 0.99 }}
      disabled={busy || googleBusy || done}
      onClick={async () => {
        haptic()
        setError('')
        setNotice('')
        setGoogleBusy(true)
        const err = await signInGoogle()
        setGoogleBusy(false)
        if (err) fail(err)
        else finish(googleRef.current)
      }}
      className={secondary}
    >
      {googleBusy ? (
        <>
          <Loader2 className="size-[18px] animate-spin text-label-2" /> Conectando ao Google…
        </>
      ) : (
        <>
          <GoogleIcon /> Continuar com Google
        </>
      )}
    </motion.button>
  )

  return (
    // computador: formulário à esquerda e o painel verde da marca à direita, meio a meio
    // celular: o topo verde com os bancos e a logo, e o formulário numa folha branca que sobe por cima
    <div className="font-login fixed inset-0 overflow-y-auto overscroll-contain bg-surface lg:grid lg:grid-cols-2 lg:overflow-hidden">
      <div className="relative flex min-h-full flex-col lg:h-full lg:min-h-0 lg:overflow-y-auto">
        {!desktop && (intro ? <Showcase mobile /> : <MobileHero pose={pose} />)}

        <div className={clsx('relative z-10 -mt-7 flex flex-col rounded-t-[28px] bg-surface px-6 pb-[calc(var(--sab)+24px)] lg:mt-0 lg:flex-1 lg:rounded-none lg:px-8 lg:py-12', intro ? 'pt-6' : 'flex-1 pt-9')}>
          <motion.form
            onSubmit={submit}
            noValidate
            initial={{ y: 18, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.45, ease }}
            className="mx-auto w-full max-w-[456px] lg:my-auto"
          >
            {desktop && (
              <img src={dinnIcon} alt="Dinn" draggable={false} className="mx-auto mb-8 block size-[60px] rounded-2xl shadow-[0_10px_26px_-12px_rgba(21,128,61,0.55)] select-none" />
            )}

            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={mode === 'quiz' ? `quiz-${step}` : mode} variants={list} initial="hidden" animate="show" exit={{ opacity: 0, transition: { duration: 0.12 } }}>
                {mode === 'quiz' ? (
                  <Quiz
                    step={step}
                    answers={answers}
                    phone={phone}
                    onAnswer={answer}
                    onPhone={setPhone}
                    onNext={nextStep}
                    onBack={backStep}
                    onLogin={() => go('start')}
                  />
                ) : (
                  <>
                    {!intro && <Head title={title} subtitle={subtitle} onBack={back} />}

                    {mode === 'start' ? (
                      // primeira tela: escolher como entrar
                      <>
                        <Rise className={clsx('space-y-2.5', !intro && 'mt-8 lg:mt-10')}>
                          {google}
                          <motion.button type="button" whileTap={{ scale: 0.99 }} disabled={googleBusy || done} onClick={() => go('login')} className={secondary}>
                            <Mail className="size-[19px] text-tint" /> Entrar com e-mail
                          </motion.button>
                        </Rise>
                        {message}
                        <Rise>
                          <p className="mt-3 text-center text-[15px] text-label-2">
                            Não tem uma conta?{' '}
                            <button type="button" onClick={toSignup} className={link}>
                              Criar conta
                            </button>
                          </p>
                        </Rise>
                      </>
                    ) : mode === 'forgot' ? (
                      <Rise className="mt-7 lg:mt-10">
                        <motion.div key={shake} {...shaking}>
                          <Field
                            icon={<Mail className="size-[19px]" />}
                            type="email"
                            inputMode="email"
                            autoComplete="email"
                            autoCapitalize="none"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="E-mail"
                          />
                        </motion.div>
                        {message}
                        <button type="submit" disabled={busy} className={clsx(primary, 'mt-1')}>
                          {busy ? <Loader2 className="size-5 animate-spin" /> : 'Enviar link'}
                        </button>
                      </Rise>
                    ) : (
                      <>
                        <Rise className="mt-7 lg:mt-10">
                          <motion.div key={shake} {...shaking} className="space-y-2.5">
                            {mode === 'signup' && (
                              <Field icon={<User className="size-[19px]" />} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome" autoComplete="name" />
                            )}
                            {mode !== 'reset' && (
                              <Field
                                icon={<Mail className="size-[19px]" />}
                                type="email"
                                inputMode="email"
                                autoComplete="email"
                                autoCapitalize="none"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="E-mail"
                                {...emailProps}
                              />
                            )}
                            <AnimatePresence initial={false}>
                              {domains.length > 0 && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.2, ease }}
                                  className="no-scrollbar -mx-6 overflow-x-auto px-6 lg:mx-0 lg:px-0"
                                >
                                  <div className="flex gap-1.5 py-0.5">
                                    {domains.map((d) => (
                                      <motion.button
                                        key={d}
                                        layout
                                        type="button"
                                        whileTap={{ scale: 0.94 }}
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => pickDomain(d)}
                                        className="h-8 shrink-0 rounded-full bg-tint/10 px-3 text-[13px] font-medium text-tint"
                                      >
                                        @{d}
                                      </motion.button>
                                    ))}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                            <Field
                              icon={<Lock className="size-[19px]" />}
                              type={show ? 'text' : 'password'}
                              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                              value={pass}
                              onChange={(e) => setPass(e.target.value)}
                              placeholder={mode === 'reset' ? 'Nova senha' : 'Senha'}
                              ref={passRef}
                              trailing={
                                <button
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => setShow((s) => !s)}
                                  aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
                                  className="-mr-1.5 grid place-items-center rounded-lg p-1.5 text-label-3 transition-colors hover:text-label"
                                >
                                  {show ? <EyeOff className="size-[19px]" /> : <Eye className="size-[19px]" />}
                                </button>
                              }
                            />
                            <AnimatePresence initial={false}>
                              {strength > 0 && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.2, ease }}
                                  className="flex items-center gap-2.5 px-1"
                                >
                                  <div className="flex flex-1 gap-1">
                                    {[1, 2, 3, 4].map((n) => (
                                      <span key={n} className="h-1 flex-1 overflow-hidden rounded-full bg-fill">
                                        <motion.span
                                          className="block h-full rounded-full"
                                          initial={false}
                                          animate={{ scaleX: n <= strength ? 1 : 0, backgroundColor: STRENGTH[strength].color }}
                                          style={{ originX: 0 }}
                                          transition={{ duration: 0.3, ease }}
                                        />
                                      </span>
                                    ))}
                                  </div>
                                  <span className="w-[74px] text-right text-[12px] font-medium" style={{ color: STRENGTH[strength].color }}>
                                    {STRENGTH[strength].label}
                                  </span>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </motion.div>
                        </Rise>

                        {mode === 'login' && (
                          <Rise className="mt-3.5 flex items-center justify-between px-1 text-[13.5px]">
                            <label className="flex cursor-pointer items-center gap-2 text-label-2">
                              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="peer sr-only" />
                              <span className="grid size-[18px] place-items-center rounded-[5px] ring-[1.5px] ring-label-3 transition-colors peer-checked:bg-tint peer-checked:ring-tint peer-focus-visible:ring-2">
                                {remember && <Check className="size-3 text-white" strokeWidth={3.5} />}
                              </span>
                              Manter conectado
                            </label>
                            <button type="button" onClick={() => go('forgot')} className="font-medium text-tint">
                              Esqueceu a senha?
                            </button>
                          </Rise>
                        )}

                        {message}

                        <Rise>
                          <motion.button ref={submitRef} type="submit" disabled={busy || googleBusy || done} whileTap={{ scale: 0.99 }} className={clsx(primary, 'mt-1')}>
                            {busy ? (
                              <Loader2 className="size-5 animate-spin" />
                            ) : done ? (
                              <span className="flex items-center gap-2">
                                <Check className="size-[18px]" strokeWidth={3} /> Tudo certo
                              </span>
                            ) : (
                              <span className="flex items-center gap-2">
                                {mode === 'signup' ? 'Criar conta' : mode === 'reset' ? 'Salvar nova senha' : 'Entrar'}
                                <ArrowRight className="hidden size-4 lg:block" />
                              </span>
                            )}
                          </motion.button>
                        </Rise>

                        {/* criando a conta, o Google continua valendo (as respostas já ficaram guardadas) */}
                        {mode === 'signup' && (
                          <>
                            <Rise className="my-4 flex items-center gap-3 text-[13px] text-label-3">
                              <span className="h-px flex-1 bg-separator" /> ou <span className="h-px flex-1 bg-separator" />
                            </Rise>
                            <Rise>{google}</Rise>
                          </>
                        )}

                        {(mode === 'login' || mode === 'signup') && (
                          <Rise>
                            <p className="mt-6 text-center text-[15px] text-label-2">
                              {mode === 'login' ? 'Não tem uma conta? ' : 'Já tem conta? '}
                              <button type="button" onClick={mode === 'login' ? toSignup : () => go('start')} className={link}>
                                {mode === 'login' ? 'Criar conta' : 'Entrar'}
                              </button>
                            </p>
                          </Rise>
                        )}
                      </>
                    )}
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </motion.form>
        </div>
        <ThemeToggle />
      </div>

      {desktop && <Showcase />}
    </div>
  )
}
