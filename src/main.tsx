import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { registerSW } from './lib/pwa'

// app instalável e notificações push
registerSW()

// aberto pela moldura de iPhone (iphone.html): reserva espaço da Dynamic Island e da barra inferior
const frame = new URLSearchParams(location.search).get('frame')
if (frame) document.documentElement.dataset.frame = frame

// painel do administrador em /admin (carregado à parte, não pesa no app)
const AdminApp = lazy(() => import('./admin/AdminApp'))
const isAdmin = location.pathname.replace(/\/+$/, '') === '/admin' || new URLSearchParams(location.search).has('admin')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdmin ? (
      <Suspense>
        <AdminApp />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
