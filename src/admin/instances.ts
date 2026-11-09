import { create } from 'zustand'
import { listInstances, type Instance } from './evolution'

// Lista de instâncias compartilhada entre a visão geral e a página do WhatsApp.
interface State {
  list: Instance[]
  loading: boolean
  error: string
  loadedAt: number
  refresh: () => Promise<void>
}

export const useInstances = create<State>()((set, get) => ({
  list: [],
  loading: false,
  error: '',
  loadedAt: 0,
  refresh: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      set({ list: await listInstances(), error: '', loadedAt: Date.now() })
    } catch (e) {
      set({ error: (e as Error).message })
    } finally {
      set({ loading: false })
    }
  },
}))
