// O banco visto pelo assistente (chave de serviço: ignora o RLS, então cada consulta filtra
// pela pessoa certa). Tabelas: whatsapp_links, whatsapp_log, records, profiles, user_settings.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { LogEntry, LogRecord, RecordRow } from './data.ts'
import type { Store } from './flow.ts'
import type { Transaction } from './ledger.ts'

const chunks = <T>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size))

const fail = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what}: ${error.message}`)
}

export function supabaseStore(db: SupabaseClient): Store {
  return {
    async claim(row) {
      const { error } = await db.from('whatsapp_log').insert(row)
      // 23505 = msg_id repetido: o provedor reenviou a mesma mensagem
      if (error?.code === '23505') return false
      fail('whatsapp_log', error)
      return true
    },

    async finish(msgId, patch) {
      const { error } = await db.from('whatsapp_log').update(patch).eq('msg_id', msgId)
      fail('whatsapp_log', error)
    },

    async linkByPhone(phones) {
      const { data, error } = await db.from('whatsapp_links').select('user_id, phone').in('phone', phones).limit(1).maybeSingle()
      fail('whatsapp_links', error)
      return data
    },

    async linkByCode(codes) {
      const { data, error } = await db.from('whatsapp_links').select('user_id, phone').in('code', codes).gt('code_expires', new Date().toISOString()).limit(1).maybeSingle()
      fail('whatsapp_links', error)
      return data
    },

    async link(userId, phone, variants) {
      // o mesmo celular (com ou sem o 9) não fica ligado a duas contas
      const off = await db.from('whatsapp_links').update({ phone: null, linked_at: null, updated_at: new Date().toISOString() }).in('phone', variants).neq('user_id', userId)
      fail('whatsapp_links', off.error)
      const now = new Date().toISOString()
      const { error } = await db.from('whatsapp_links').update({ phone, linked_at: now, code: null, code_expires: null, updated_at: now }).eq('user_id', userId)
      fail('whatsapp_links', error)
    },

    async profile(userId) {
      const { data, error } = await db.from('profiles').select('blocked, expires_at, name').eq('id', userId).maybeSingle()
      fail('profiles', error)
      return data
    },

    async settings(userId) {
      const { data, error } = await db.from('user_settings').select('settings').eq('user_id', userId).maybeSingle()
      fail('user_settings', error)
      return data?.settings ?? null
    },

    async records(userId, kinds) {
      // o Supabase devolve no máximo 1000 linhas por consulta: página por página
      const page = async (from: number, out: RecordRow[]): Promise<RecordRow[]> => {
        const { data, error } = await db
          .from('records')
          .select('kind, id, data')
          .eq('user_id', userId)
          .in('kind', [...kinds])
          .order('kind')
          .order('id')
          .range(from, from + 999)
        fail('records', error)
        const all = [...out, ...((data ?? []) as RecordRow[])]
        return !data || data.length < 1000 ? all : page(from + 1000, all)
      }
      return page(0, [])
    },

    async recent(userId, limit, exceptMsgId) {
      const { data, error } = await db
        .from('whatsapp_log')
        .select('id, input, reply, records, undone, created_at')
        .eq('user_id', userId)
        .neq('msg_id', exceptMsgId)
        .order('created_at', { ascending: false })
        .limit(limit)
      fail('whatsapp_log', error)
      return ((data ?? []) as (Omit<LogEntry, 'records'> & { records: unknown })[]).map((r) => ({ ...r, records: Array.isArray(r.records) ? (r.records as LogRecord[]) : [] }))
    },

    async upsert(userId, txs: Transaction[]) {
      const now = new Date().toISOString()
      const results = await Promise.all(chunks(txs, 400).map((part) => db.from('records').upsert(part.map((t) => ({ user_id: userId, kind: 'transactions', id: t.id, data: t, updated_at: now })))))
      for (const r of results) fail('records', r.error)
    },

    async remove(userId, ids) {
      const results = await Promise.all(chunks(ids, 200).map((part) => db.from('records').delete().eq('user_id', userId).eq('kind', 'transactions').in('id', part)))
      for (const r of results) fail('records', r.error)
    },

    async markUndone(logId) {
      const { error } = await db.from('whatsapp_log').update({ undone: true }).eq('id', logId)
      fail('whatsapp_log', error)
    },
  }
}
