// Feedback tátil leve (Android/Chrome). No iOS o Safari ignora silenciosamente.
// Antes do primeiro toque o Chrome bloqueia a vibração (e reclama no console): nem tenta.
export const haptic = (style: 'light' | 'medium' | 'success' = 'light') => {
  try {
    if ((navigator as { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive === false) return
    navigator.vibrate?.(style === 'success' ? [10, 40, 10] : style === 'medium' ? 14 : 6)
  } catch {
    /* sem suporte */
  }
}
