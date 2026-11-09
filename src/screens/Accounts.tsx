import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, CreditCard, Plus, Wallet } from 'lucide-react'
import clsx from 'clsx'
import { money } from '../lib/format'
import { haptic } from '../lib/haptics'
import { cardUsage, invoice, invoiceFor, type Card, type Transaction } from '../lib/ledger'
import { useData, useUI } from '../lib/store'
import { useFinance } from '../components/finance'
import { Button, Empty, Hero, IconButton, Money, Screen, Section, SectionHeader, StatCard, spring } from '../components/ui'
import { AccountRow, CardTile } from '../sheets/AccountSheets'

/**
 * Quanto falta pagar nas faturas até a atual (as fechadas e vencidas ainda sem pagamento contam);
 * parcelas de compras que caem em faturas futuras ficam de fora.
 */
function openInvoicesTotal(cards: Card[], txs: Transaction[], ref: string) {
  let total = 0
  for (const card of cards) {
    const current = invoiceFor(card, ref)
    const keys = new Set(txs.filter((t) => t.cardId === card.id && t.invoice && t.invoice <= current).map((t) => t.invoice!))
    for (const key of keys) total += invoice(card, key, txs, ref).open
  }
  return Math.round(total * 100) / 100
}

/** Bloco recolhível com o que foi arquivado. */
function Archived({ count, label = 'Arquivados', children }: { count: number; label?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  if (!count) return null
  return (
    <div className="mb-6">
      <button onClick={() => (haptic(), setOpen((o) => !o))} className="mb-2.5 flex items-center gap-1 px-1 text-[13px] font-semibold text-label-2">
        {label} ({count})
        <ChevronDown className={clsx('size-4 transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring} className="overflow-hidden">
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function Accounts() {
  const f = useFinance()
  const defaultAccount = useData((s) => s.settings.defaultAccount)
  const { openAccount, openCard } = useUI()

  const active = f.accounts.filter((a) => !a.archived)
  const archived = f.accounts.filter((a) => a.archived)
  const cards = f.cards.filter((c) => !c.archived)
  const oldCards = f.cards.filter((c) => c.archived)
  const counted = active.filter((a) => !a.hidden).length
  const openInvoices = openInvoicesTotal(cards, f.transactions, f.ref)
  const available = cards.reduce((s, c) => s + cardUsage(c, f.transactions).available, 0)

  return (
    <Screen
      title="Contas e cartões"
      subtitle="Saldos, limites e faturas em um só lugar."
      trailing={
        <>
          <IconButton label="Nova conta" onClick={() => openAccount(true)}>
            <Plus className="size-[18px]" strokeWidth={2.5} />
          </IconButton>
          <IconButton label="Novo cartão" onClick={() => openCard(true)}>
            <CreditCard className="size-[18px]" strokeWidth={2.2} />
          </IconButton>
        </>
      }
    >
      <div className="lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start lg:gap-5">
        <Hero
          label="Saldo total"
          icon={<Wallet className="size-6" strokeWidth={2} />}
          caption={counted ? `Soma das contas ativas · ${counted} ${counted === 1 ? 'conta' : 'contas'}` : 'Soma das contas ativas'}
        >
          <Money value={f.total} />
        </Hero>
        <div className="mb-6 grid grid-cols-2 gap-3 lg:mb-5 lg:h-[calc(100%-20px)]">
          <StatCard label="Faturas abertas" value={money(openInvoices)} hint={cards.length ? `${cards.length} ${cards.length === 1 ? 'cartão' : 'cartões'}` : 'nenhum cartão'} />
          <StatCard label="Limite disponível" value={money(available)} tone={available < 0 ? 'red' : undefined} hint="nos cartões ativos" />
        </div>
      </div>

      {/* computador: contas à esquerda, cartões à direita */}
      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-8">
        <div>
          {active.length === 0 ? (
            <>
              <SectionHeader>Minhas contas</SectionHeader>
              <div className="mb-6 rounded-[22px] bg-surface pb-5 shadow-card">
                <Empty art="nuvem" title="Nenhuma conta bancária" text="Adicione sua primeira conta bancária para começar a organizar suas finanças." />
                <div className="px-5">
                  <Button onClick={() => openAccount(true)}>
                    <Plus className="size-[18px]" /> Adicionar conta
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <Section header="Minhas contas" action="Nova" onAction={() => openAccount(true)}>
              {active.map((a) => (
                <AccountRow key={a.id} account={a} balance={f.bal.get(a.id) ?? 0} isDefault={defaultAccount === a.id} onClick={() => openAccount(true, a.id)} />
              ))}
            </Section>
          )}
          <Archived count={archived.length} label="Arquivadas">
            <Section>
              {archived.map((a) => (
                <AccountRow key={a.id} account={a} balance={f.bal.get(a.id) ?? 0} onClick={() => openAccount(true, a.id)} />
              ))}
            </Section>
          </Archived>
        </div>

        <div>
          <SectionHeader action={cards.length ? 'Novo' : undefined} onAction={() => openCard(true)}>
            Cartões de crédito
          </SectionHeader>
          {cards.length === 0 ? (
            <div className="mb-6 rounded-[22px] bg-surface pb-5 shadow-card">
              <Empty icon={<CreditCard className="size-9" strokeWidth={1.5} />} title="Nenhum cartão" text="Cadastre o cartão para lançar compras, parcelas e acompanhar a fatura." />
              <div className="px-5">
                <Button onClick={() => openCard(true)}>
                  <Plus className="size-[18px]" /> Adicionar cartão
                </Button>
              </div>
            </div>
          ) : (
            <div className="mb-6 lg:space-y-3">
              {cards.map((c, k) => (
                <motion.div key={c.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: Math.min(k, 6) * 0.04 }}>
                  <CardTile card={c} txs={f.transactions} day={f.ref} onClick={() => openCard(true, c.id)} />
                </motion.div>
              ))}
            </div>
          )}
          <Archived count={oldCards.length}>
            <div className="lg:space-y-3">
              {oldCards.map((c) => (
                <CardTile key={c.id} card={c} txs={f.transactions} day={f.ref} onClick={() => openCard(true, c.id)} />
              ))}
            </div>
          </Archived>
        </div>
      </div>
    </Screen>
  )
}
