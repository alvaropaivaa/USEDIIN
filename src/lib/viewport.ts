// iOS 26 no app instalado na tela de início: a página recebe a altura da tela menos a faixa de cima
// (ex.: 812 de 874 pontos no iPhone 16 Pro) e o sistema pinta a sobra embaixo, onde a página não alcança
// (WebKit 301994, ainda aberto). Essa faixa já cobre a barra de gestos do iPhone, então a folga de baixo
// (--sab) sai: sem isso a barra inferior ficava alta demais, com a folga e a faixa somadas.

/** Altura que falta à página, em pontos, quando o bug acontece; 0 quando a página ocupa a tela toda. */
export function missingHeight(screenW: number, screenH: number, innerH: number, portrait: boolean) {
  if (!portrait) return 0
  const gap = Math.max(screenW, screenH) - innerH
  // de 20 a 90 pontos é a faixa do bug; mais que isso é o teclado aberto, menos é arredondamento
  return gap >= 20 && gap <= 90 ? gap : 0
}

export function fixStandaloneGap() {
  // `navigator.standalone` só existe no iPhone/iPad e só é true no app aberto pela tela de início
  if ((navigator as Navigator & { standalone?: boolean }).standalone !== true) return
  const root = document.documentElement
  const apply = () => {
    const portrait = window.matchMedia('(orientation: portrait)').matches
    if (missingHeight(screen.width, screen.height, window.innerHeight, portrait)) root.style.setProperty('--sab', '0px')
    else root.style.removeProperty('--sab')
  }
  apply()
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', apply)
}
