import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const root = import.meta.dirname

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))

/**
 * Service worker (src/sw.js): no build recebe a lista de arquivos para o app abrir sem internet
 * e uma versão nova a cada mudança; em desenvolvimento só cuida das notificações.
 */
function serviceWorker(): Plugin {
  const source = (files: string[], version: string, dev: boolean) =>
    readFileSync(join(root, 'src/sw.js'), 'utf8')
      .replaceAll('__VERSION__', JSON.stringify(version))
      .replaceAll('__PRECACHE__', JSON.stringify(files))
      .replaceAll('__DEV__', String(dev))

  return {
    name: 'jurospro-sw',
    configureServer(server) {
      server.middlewares.use('/sw.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(source([], 'dev', true))
      })
    },
    generateBundle(_options, bundle) {
      const publicFiles = walk(join(root, 'public')).map((f) => '/' + relative(join(root, 'public'), f).replaceAll('\\', '/'))
      // as logos dos bancos menos comuns ficam fora da instalação: o service worker guarda cada uma quando aparece
      const files = [...new Set(['/', '/index.html', ...publicFiles, ...Object.keys(bundle).map((f) => '/' + f)])].filter((f) => !f.endsWith('.map') && f !== '/sw.js' && !f.startsWith('/logos-bancos/'))
      // a versão muda quando muda qualquer arquivo publicado ou o próprio service worker
      const hash = createHash('sha256').update(files.join('\n')).update(readFileSync(join(root, 'src/sw.js')))
      for (const f of publicFiles) hash.update(readFileSync(join(root, 'public', f)))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: source(files, hash.digest('hex').slice(0, 12), false) })
    },
  }
}

// bibliotecas em pacotes próprios: mudam pouco, então o navegador reaproveita entre versões do app
// (o caminho pode vir com / ou \, conforme o sistema)
const vendor = (name: string, libs: string) => ({ name, test: new RegExp(String.raw`[\\/]node_modules[\\/](${libs})[\\/]`), priority: 10 })

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            vendor('react', 'react|react-dom|scheduler'),
            vendor('charts', String.raw`recharts|d3-[^\\/]+|victory-vendor|internmap|decimal\.js-light|es-toolkit|@reduxjs|react-redux|redux|reselect|immer|eventemitter3|tiny-invariant`),
            vendor('motion', 'motion|framer-motion|motion-dom|motion-utils|@number-flow|number-flow|esm-env'),
            vendor('supabase', '@supabase|tslib|isows|ws'),
            { name: 'vendor', test: /[\\/]node_modules[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
})
