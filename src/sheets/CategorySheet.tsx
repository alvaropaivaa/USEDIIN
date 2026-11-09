import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Archive, ArchiveRestore, Check, ChevronDown, ChevronRight, ListFilter, Plus, RotateCcw, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { monthKey } from '../lib/dates'
import { money } from '../lib/format'
import { haptic } from '../lib/haptics'
import { categoryIcons, iconKeys, palette, suggestIcon } from '../lib/categories'
import { budgetLabel, budgetTone, byCategory, monthRange, type BudgetTone, type CatType, type Category } from '../lib/ledger'
import { emptyFilter, useData, useUI } from '../lib/store'
import { Sheet, toast } from '../components/sheet'
import { CategoryIcon, useFinance } from '../components/finance'
import { Button, Empty, MoneyField, Progress, Section, SectionHeader, Segmented, SelectField, TextField, spring } from '../components/ui'

// ─── Peças usadas também em Orçamento e Metas ────────────────

const pillCls: Record<BudgetTone | 'gray', string> = {
  green: 'bg-tint/12 text-green',
  orange: 'bg-orange/15 text-orange',
  red: 'bg-red/10 text-red',
  gray: 'bg-fill text-label-2',
}

/** Selo de situação com o laranja de "em atenção" (o Badge padrão não tem laranja). */
export function StatusPill({ tone, children }: { tone: BudgetTone | 'gray'; children: ReactNode }) {
  return <span className={clsx('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', pillCls[tone])}>{children}</span>
}

export const toneText: Record<BudgetTone, string> = { green: 'text-green', orange: 'text-orange', red: 'text-red' }

/** Bolinhas de cor (categorias, contas e metas). */
export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Cor" className="grid grid-cols-8 gap-2.5 px-4 py-3.5">
      {palette.map((c) => {
        const on = c === value
        return (
          <motion.button
            key={c}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={c}
            whileTap={{ scale: 0.88 }}
            onClick={() => (haptic(), onChange(c))}
            className={clsx('grid aspect-square place-items-center rounded-full ring-offset-2 ring-offset-surface transition-shadow', on && 'ring-2')}
            style={{ background: c, ['--tw-ring-color' as string]: c }}
          >
            {on && <Check className="size-4 text-white" strokeWidth={3} />}
          </motion.button>
        )
      })}
    </div>
  )
}

/** Grade de ícones: o escolhido fica invertido (fundo escuro) e `suggested` ganha o selo "Sugerido". */
export function IconPicker({ value, onChange, suggested }: { value: string; onChange: (k: string) => void; color?: string; suggested?: string }) {
  return (
    <div role="radiogroup" aria-label="Ícone" className="grid grid-cols-6 gap-2.5 px-4 py-3.5 min-[400px]:grid-cols-7 lg:grid-cols-8">
      {iconKeys.map((k) => {
        const Icon = categoryIcons[k]
        const on = k === value
        return (
          <motion.button
            key={k}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={k}
            title={k === suggested ? 'Sugerido' : k}
            whileTap={{ scale: 0.88 }}
            onClick={() => (haptic(), onChange(k))}
            className={clsx('relative grid aspect-square place-items-center rounded-full transition-colors', on ? 'bg-label text-bg' : 'bg-fill text-label hover:bg-fill-2')}
          >
            <Icon className="size-[19px]" strokeWidth={1.75} aria-hidden />
            {k === suggested && <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-full bg-tint px-1 text-[8px] font-bold leading-[13px] text-white">Sugerido</span>}
          </motion.button>
        )
      })}
    </div>
  )
}

const parseKeywords = (text: string) => [...new Set(text.split(',').map((w) => w.trim()).filter(Boolean))]

/** Palavras-chave em chips, logo abaixo do campo. */
function KeywordChips({ text }: { text: string }) {
  const list = parseKeywords(text)
  if (!list.length) return null
  return (
    <div className="-mt-4 mb-6 flex flex-wrap gap-1.5 px-1">
      {list.map((w) => (
        <span key={w} className="rounded-full bg-surface px-2.5 py-1 text-[12px] font-medium text-label-2 shadow-card">
          {w}
        </span>
      ))}
    </div>
  )
}

// ─── Painel da categoria ─────────────────────────────────────

interface Form {
  type: CatType
  name: string
  parentId: string
  color: string
  icon: string
  /** O ícone foi escolhido à mão (a sugestão pelo nome não troca mais). */
  iconTouched: boolean
  keywords: string
  budget: number
}

export default function CategorySheet() {
  const { open, id, type: presetType, parentId: presetParent } = useUI((s) => s.category)
  const { openCategory, setTxFilter, setTab } = useUI()
  const { addCategory, updateCategory, removeCategory, setBudget } = useData()
  const categories = useData((s) => s.categories)
  const found = categories.find((c) => c.id === id)
  // ao fechar depois de excluir, o painel continua mostrando a categoria até sumir
  const [last, setLast] = useState<Category>()
  useEffect(() => {
    if (found) setLast(found)
  }, [found])
  const category = found ?? (!open && id ? last : undefined)
  const f = useFinance()

  const [form, setForm] = useState<Form>({ type: 'despesa', name: '', parentId: '', color: palette[0], icon: 'outros', iconTouched: false, keywords: '', budget: 0 })
  const [step, setStep] = useState<null | 'excluir'>(null)
  const [moveTo, setMoveTo] = useState('')
  const set = (p: Partial<Form>) => setForm((s) => ({ ...s, ...p }))

  // reinicia a cada abertura (nova ou outra categoria)
  useEffect(() => {
    if (!open) return
    setStep(null)
    setMoveTo('')
    if (category) {
      set({ type: category.type, name: category.name, parentId: category.parentId ?? '', color: category.color, icon: category.icon, iconTouched: true, keywords: (category.keywords ?? []).join(', '), budget: category.budget ?? 0 })
    } else {
      const parent = categories.find((c) => c.id === presetParent)
      set({ type: parent?.type ?? presetType ?? 'despesa', name: '', parentId: parent?.id ?? '', color: parent?.color ?? palette[categories.length % palette.length], icon: parent?.icon ?? 'outros', iconTouched: false, keywords: '', budget: 0 })
    }
  }, [open, id]) // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => openCategory(false, { id, type: presetType, parentId: presetParent })
  const reopen = (opts: { id?: string; type?: CatType; parentId?: string }) => {
    close()
    setTimeout(() => openCategory(true, opts), 300)
  }

  const mains = categories.filter((c) => c.type === form.type && !c.parentId && !c.archived && c.id !== id)
  const parent = categories.find((c) => c.id === form.parentId)
  const color = parent?.color ?? form.color
  const suggested = suggestIcon(form.name)
  // nome novo puxa o ícone sugerido até a pessoa escolher outro
  useEffect(() => {
    if (!form.iconTouched && suggested) set({ icon: suggested })
  }, [suggested]) // eslint-disable-line react-hooks/exhaustive-deps

  // gasto (ou recebido) no mês atual
  const month = monthKey(f.ref)
  const spentMap = useMemo(() => {
    const { from, to } = monthRange(month)
    return byCategory(f.transactions, f.cardsIdx, f.categories, form.type, from, to)
  }, [f.transactions, f.cardsIdx, f.categories, form.type, month])

  const valid = form.name.trim().length >= 2
  const keywords = parseKeywords(form.keywords)
  const fields = {
    name: form.name.trim(),
    color,
    icon: form.icon,
    keywords: keywords.length ? keywords : undefined,
  }

  const create = () => {
    if (!valid) return toast('Digite o nome da categoria')
    addCategory({ type: form.type, ...fields, ...(form.parentId ? { parentId: form.parentId } : {}), ...(form.type === 'despesa' && form.budget > 0 ? { budget: form.budget } : {}) })
    toast(form.parentId ? 'Subcategoria criada' : 'Categoria criada')
    close()
  }

  const dirty =
    !!found &&
    !!category &&
    (fields.name !== category.name || color !== category.color || form.icon !== category.icon || keywords.join(',') !== (category.keywords ?? []).join(',') || form.budget !== (category.budget ?? 0))

  const save = () => {
    if (!category) return
    // nome apagado: o resto das mudanças vale e o nome antigo fica
    updateCategory(category.id, { ...fields, name: valid ? fields.name : category.name })
    if (category.type === 'despesa' && form.budget !== (category.budget ?? 0)) setBudget(category.id, form.budget)
    toast('Salvo')
  }

  const editFields = (
    <>
      <Section header={category ? 'Editar' : undefined}>
        <TextField label="Nome" value={form.name} onChange={(name) => set({ name })} placeholder={form.parentId ? 'Ex.: Delivery' : 'Ex.: Alimentação'} />
        {!category && (
          <SelectField
            label="Subcategoria de"
            value={form.parentId}
            onChange={(parentId) => set({ parentId })}
            placeholder="Nenhuma (principal)"
            options={mains.map((c) => ({ value: c.id, label: c.name }))}
          />
        )}
      </Section>

      {!parent ? (
        <>
          <SectionHeader>Cor</SectionHeader>
          <div className="mb-6 overflow-hidden rounded-[22px] bg-surface shadow-card">
            <ColorPicker value={form.color} onChange={(c) => set({ color: c })} />
          </div>
        </>
      ) : (
        <p className="-mt-3 mb-6 px-1 text-[12px] text-label-2">Subcategorias usam a cor de {parent.name}.</p>
      )}

      <SectionHeader>Ícone</SectionHeader>
      <div className="mb-6 overflow-hidden rounded-[22px] bg-surface shadow-card">
        <IconPicker value={form.icon} onChange={(icon) => set({ icon, iconTouched: true })} color={color} suggested={suggested} />
      </div>

      <Section footer="Separe por vírgula. Lançamentos com essas palavras na descrição já vêm com esta categoria sugerida.">
        <TextField label="Palavras-chave" value={form.keywords} onChange={(keywords) => set({ keywords })} placeholder="ifood, pizza, lanche" />
      </Section>
      <KeywordChips text={form.keywords} />

      {form.type === 'despesa' && (
        <Section footer="Digite zero para desativar o limite e os avisos.">
          <MoneyField label="Limite mensal" value={form.budget} onChange={(budget) => set({ budget })} />
        </Section>
      )}
    </>
  )

  return (
    <Sheet open={open} onOpenChange={(o) => !o && (dirty && save(), close())} title={category ? (category.parentId ? 'Subcategoria' : 'Categoria') : form.parentId ? 'Nova subcategoria' : 'Nova categoria'}>
      {!category ? (
        <>
          <Segmented
            value={form.type}
            onChange={(type) => set({ type, parentId: '' })}
            options={[
              { value: 'despesa', label: 'Despesa' },
              { value: 'receita', label: 'Receita' },
            ]}
          />
          <div className="mb-6 flex flex-col items-center">
            <CategoryIcon category={{ icon: form.icon, color }} size={64} />
            <p className="mt-2 text-[17px] font-semibold">{form.name.trim() || 'Nova categoria'}</p>
            {parent && <p className="text-[12px] text-label-2">Subcategoria de {parent.name}</p>}
          </div>
          {editFields}
          <Button onClick={create} className={valid ? '' : 'pointer-events-none opacity-40'}>
            <Plus className="size-[18px]" /> {form.parentId ? 'Criar subcategoria' : 'Criar categoria'}
          </Button>
        </>
      ) : (
        <CategoryDetail
          category={category}
          spent={spentMap}
          form={form}
          onReopen={reopen}
          onTransactions={() => {
            setTxFilter({ ...emptyFilter, categoryId: category.id })
            setTab('transactions')
            close()
          }}
        >
          {editFields}
          <AnimatePresence initial={false}>
            {dirty && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring} className="overflow-hidden">
                <Button onClick={save} className={clsx('mb-6', !valid && 'pointer-events-none opacity-40')}>
                  <Check className="size-[18px]" /> Salvar alterações
                </Button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mb-3 grid grid-cols-1 gap-3">
            <Button
              variant="tinted"
              onClick={() => {
                updateCategory(category.id, { archived: !category.archived })
                toast(category.archived ? 'Categoria restaurada' : 'Categoria arquivada')
              }}
            >
              {category.archived ? <ArchiveRestore className="size-[18px]" /> : <Archive className="size-[18px]" />} {category.archived ? 'Restaurar' : 'Arquivar'}
            </Button>
          </div>
          {step === 'excluir' ? (
            <DeleteStep category={category} moveTo={moveTo} setMoveTo={setMoveTo} onCancel={() => setStep(null)} onConfirm={() => (removeCategory(category.id, moveTo || undefined), toast('Categoria excluída'), close())} />
          ) : (
            <Button variant="danger" onClick={() => setStep('excluir')}>
              <Trash2 className="size-[18px]" /> Excluir {category.parentId ? 'subcategoria' : 'categoria'}
            </Button>
          )}
        </CategoryDetail>
      )}
    </Sheet>
  )
}

/** Cabeçalho, gasto do mês, subcategorias e atalhos de uma categoria existente. */
function CategoryDetail({ category, spent, form, onReopen, onTransactions, children }: {
  category: Category
  spent: Map<string, number>
  form: Form
  onReopen: (opts: { id?: string; type?: CatType; parentId?: string }) => void
  onTransactions: () => void
  children: ReactNode
}) {
  const categories = useData((s) => s.categories)
  const alert = useData((s) => s.settings.budgetAlert)
  const parent = categories.find((c) => c.id === category.parentId)
  const subs = categories.filter((c) => c.parentId === category.id)
  const amount = spent.get(category.id) ?? 0
  const limit = form.budget
  const ratio = limit > 0 ? amount / limit : 0
  const tone = budgetTone(ratio, alert)
  const expense = category.type === 'despesa'

  return (
    <>
      <div className="mb-5 flex flex-col items-center text-center">
        <CategoryIcon category={{ icon: form.icon, color: parent?.color ?? form.color }} size={64} />
        <p className="mt-3 text-[20px] font-semibold">{form.name.trim() || category.name}</p>
        <p className="text-[13px] text-label-2">
          {expense ? 'Despesa' : 'Receita'}
          {parent ? ` · Subcategoria de ${parent.name}` : subs.length ? ` · ${subs.length} ${subs.length === 1 ? 'subcategoria' : 'subcategorias'}` : ''}
          {category.archived ? ' · Arquivada' : ''}
        </p>
      </div>

      <div className="mb-5 rounded-[22px] bg-surface p-4 shadow-card">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[13px] text-label-2">{expense ? 'Gasto neste mês' : 'Recebido neste mês'}</span>
          {expense && limit > 0 && <StatusPill tone={tone}>{budgetLabel[tone]}</StatusPill>}
        </div>
        <p className={clsx('tabular text-[24px] font-semibold tracking-[-0.02em]', expense && limit > 0 && toneText[tone])}>{money(amount)}</p>
        {expense && limit > 0 ? (
          <>
            <Progress value={ratio} tone={tone} className="mt-2" />
            <p className="tabular mt-2 text-[12px] text-label-2">
              {Math.round(ratio * 100)}% de {money(limit)} · {amount <= limit ? `restam ${money(limit - amount)}` : `passou ${money(amount - limit)}`}
            </p>
          </>
        ) : (
          expense && <p className="mt-1 text-[12px] text-label-2">Sem limite mensal. Defina um valor abaixo para acompanhar.</p>
        )}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3">
        <Button variant="tinted" onClick={onTransactions}>
          <ListFilter className="size-[18px]" /> Ver lançamentos
        </Button>
      </div>

      {!category.parentId && (
        <Section header="Subcategorias">
          {subs.map((s) => (
            <motion.button
              key={s.id}
              whileTap={{ backgroundColor: 'var(--fill)' }}
              onClick={() => (haptic(), onReopen({ id: s.id }))}
              className={clsx('relative flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-fill/50', s.archived && 'opacity-50')}
            >
              <CategoryIcon category={s} size={32} />
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{s.name}</span>
              <span className="tabular shrink-0 text-[14px] font-semibold">{money(spent.get(s.id) ?? 0)}</span>
              <ChevronRight className="size-4 shrink-0 text-label-3" strokeWidth={2.5} />
            </motion.button>
          ))}
          <motion.button
            whileTap={{ backgroundColor: 'var(--fill)' }}
            onClick={() => (haptic(), onReopen({ type: category.type, parentId: category.id }))}
            className="relative flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] font-semibold text-tint"
          >
            <Plus className="size-[18px]" /> Nova subcategoria
          </motion.button>
        </Section>
      )}

      {children}
    </>
  )
}

/** Etapa de exclusão: escolhe para onde vão os lançamentos. */
function DeleteStep({ category, moveTo, setMoveTo, onCancel, onConfirm }: { category: Category; moveTo: string; setMoveTo: (v: string) => void; onCancel: () => void; onConfirm: () => void }) {
  const categories = useData((s) => s.categories)
  const transactions = useData((s) => s.transactions)
  const gone = new Set([category.id, ...categories.filter((c) => c.parentId === category.id).map((c) => c.id)])
  const count = transactions.filter((t) => t.categoryId && gone.has(t.categoryId)).length
  const others = categories.filter((c) => c.type === category.type && !gone.has(c.id) && !c.archived)
  const names = new Map(categories.map((c) => [c.id, c.name]))
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
      <Section
        header="Excluir"
        footer={
          count
            ? `${count} ${count === 1 ? 'lançamento usa' : 'lançamentos usam'} esta categoria${gone.size > 1 ? ' ou as subcategorias dela' : ''}. Escolha para onde eles vão.`
            : 'Nenhum lançamento usa esta categoria.'
        }
      >
        {count > 0 && (
          <SelectField
            label="Mover os lançamentos para"
            value={moveTo}
            onChange={setMoveTo}
            placeholder="Sem categoria"
            options={others.map((c) => ({ value: c.id, label: c.parentId ? `${names.get(c.parentId) ?? ''} › ${c.name}` : c.name }))}
          />
        )}
      </Section>
      <Button variant="danger" className="bg-red/10" onClick={onConfirm}>
        <Trash2 className="size-[18px]" /> Excluir de vez
      </Button>
      <Button variant="plain" className="mt-1" onClick={onCancel}>
        Cancelar
      </Button>
    </motion.div>
  )
}

// ─── Lista para Configurações → Categorias ───────────────────

export function CategoryList({ onOpen }: { onOpen: (opts: { id?: string; type?: CatType; parentId?: string }) => void }) {
  const categories = useData((s) => s.categories)
  const resetCategories = useData((s) => s.resetCategories)
  const [type, setType] = useState<CatType>('despesa')
  const [expanded, setExpanded] = useState<string | null>(null)

  const ofType = categories.filter((c) => c.type === type)
  const mains = ofType.filter((c) => !c.parentId && !c.archived)
  const archived = ofType.filter((c) => c.archived)
  const subsOf = (id: string) => ofType.filter((c) => c.parentId === id && !c.archived)

  return (
    <>
      <Segmented
        value={type}
        onChange={(t) => (setType(t), setExpanded(null))}
        options={[
          { value: 'despesa', label: 'Despesas' },
          { value: 'receita', label: 'Receitas' },
        ]}
      />

      {mains.length === 0 ? (
        <div className="mb-6 rounded-[22px] bg-surface shadow-card">
          <Empty art="categorias" title="Nenhuma categoria" text="Crie uma categoria ou volte às categorias padrão." />
        </div>
      ) : (
        <Section footer="Toque para editar cor, ícone, palavras-chave e limite. A seta mostra as subcategorias.">
          {mains.map((c) => {
            const subs = subsOf(c.id)
            const open = expanded === c.id
            return (
              <div key={c.id} className="relative">
                <div className="flex min-h-14 items-center">
                  <motion.button
                    whileTap={{ backgroundColor: 'var(--fill)' }}
                    onClick={() => (haptic(), onOpen({ id: c.id }))}
                    className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 text-left transition-colors hover:bg-fill/50"
                  >
                    <CategoryIcon category={c} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold">{c.name}</span>
                      <span className="block truncate text-[12px] text-label-2">
                        {[subs.length ? `${subs.length} ${subs.length === 1 ? 'subcategoria' : 'subcategorias'}` : 'Sem subcategorias', c.budget ? `limite ${money(c.budget)}` : null].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </motion.button>
                  <button
                    aria-label={open ? `Recolher ${c.name}` : `Mostrar subcategorias de ${c.name}`}
                    aria-expanded={open}
                    onClick={() => (haptic(), setExpanded(open ? null : c.id))}
                    className="grid size-12 shrink-0 place-items-center text-label-3 transition-colors hover:text-label-2"
                  >
                    <ChevronDown className={clsx('size-[18px] transition-transform', open && 'rotate-180')} strokeWidth={2.5} />
                  </button>
                </div>
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring} className="overflow-hidden bg-fill/40">
                      {subs.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => (haptic(), onOpen({ id: s.id }))}
                          className="flex min-h-12 w-full items-center gap-3 py-2 pl-[60px] pr-4 text-left transition-colors hover:bg-fill/60"
                        >
                          <CategoryIcon category={s} size={28} />
                          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{s.name}</span>
                          {!!s.budget && <span className="tabular shrink-0 text-[12px] text-label-2">{money(s.budget)}</span>}
                          <ChevronRight className="size-4 shrink-0 text-label-3" strokeWidth={2.5} />
                        </button>
                      ))}
                      <button
                        onClick={() => (haptic(), onOpen({ type, parentId: c.id }))}
                        className="flex min-h-12 w-full items-center gap-2 py-2 pl-[60px] pr-4 text-left text-[14px] font-semibold text-tint"
                      >
                        <Plus className="size-4" /> Nova subcategoria
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}
        </Section>
      )}

      <Button onClick={() => onOpen({ type })} className="mb-6">
        <Plus className="size-[18px]" /> Nova categoria
      </Button>

      {archived.length > 0 && (
        <Section header="Arquivadas" footer="Não aparecem na escolha de categoria dos lançamentos novos.">
          {archived.map((c) => (
            <motion.button
              key={c.id}
              whileTap={{ backgroundColor: 'var(--fill)' }}
              onClick={() => (haptic(), onOpen({ id: c.id }))}
              className="relative flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left opacity-60 transition-colors hover:bg-fill/50"
            >
              <CategoryIcon category={c} />
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{c.name}</span>
              <ChevronRight className="size-4 shrink-0 text-label-3" strokeWidth={2.5} />
            </motion.button>
          ))}
        </Section>
      )}

      <Button
        variant="plain"
        onClick={() => {
          if (!confirm('Voltar às categorias padrão? Os limites por categoria serão removidos e lançamentos de categorias criadas por você ficam sem categoria.')) return
          resetCategories()
          toast('Categorias reiniciadas')
        }}
      >
        <RotateCcw className="size-4" /> Reiniciar categorias
      </Button>
    </>
  )
}
