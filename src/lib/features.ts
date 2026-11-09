// Plano básico, sem IA: o chat do app funciona no modo simples (regras locais: lança, dá baixa no que
// caiu ou foi pago, corrige, apaga e responde o básico). Foto, PDF, áudio transcrito pela IA e o
// assistente no WhatsApp ficam de fora.
// Para ligar a IA, defina VITE_IA=on no build (precisa da função assistente publicada no Supabase).
export const aiEnabled = import.meta.env.VITE_IA === 'on'
