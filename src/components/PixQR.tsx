import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Copy } from 'lucide-react'
import { haptic } from '../lib/haptics'
import { moneyRaw } from '../lib/format'
import { toast } from './sheet'

/** QR Code do Pix + botão "copia e cola", para receber pessoalmente. */
export function PixQR({ code, amount }: { code: string; amount: number }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let alive = true
    QRCode.toDataURL(code, { margin: 1, width: 480, errorCorrectionLevel: 'M', color: { dark: '#0f1512', light: '#ffffff' } })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(''))
    return () => {
      alive = false
    }
  }, [code])

  return (
    <div className="mb-6 flex flex-col items-center rounded-[22px] bg-surface p-5 shadow-card">
      <p className="text-[13px] text-label-2">Pix no valor de</p>
      <p className="tabular text-[22px] font-semibold tracking-[-0.02em]">{moneyRaw(amount)}</p>
      {src && <img src={src} alt="QR Code Pix" className="my-4 size-52 rounded-[14px] bg-white p-2" />}
      <button
        onClick={async () => {
          haptic('medium')
          try {
            await navigator.clipboard.writeText(code)
            toast('Pix copiado')
          } catch {
            // sem permissão de área de transferência (ou fora de https)
            toast('Não deu para copiar')
          }
        }}
        className="flex items-center gap-2 rounded-full bg-fill px-4 py-2 text-[13px] font-semibold"
      >
        <Copy className="size-4" /> Copiar Pix copia e cola
      </button>
    </div>
  )
}
