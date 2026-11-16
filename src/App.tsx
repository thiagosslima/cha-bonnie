import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { isConfigured } from './lib/supabase'
import HomePage from './pages/guest/HomePage'
import InvitePage from './pages/guest/InvitePage'
import { Card, InviteTitle, Page, Spinner } from './components/ui'

const AdminApp = lazy(() => import('./pages/admin/AdminApp'))

function NotConfigured() {
  return (
    <Page>
      <Card className="text-center">
        <InviteTitle />
        <p className="mt-6 font-normal">Quase lá! Falta configurar a conexão com o banco de dados.</p>
        <p className="mt-2 text-sm">
          Defina <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> (veja o README) e publique novamente.
        </p>
      </Card>
    </Page>
  )
}

const Loading = () => (
  <div className="flex min-h-dvh items-center justify-center text-primary-strong" role="status">
    <Spinner className="h-8 w-8" />
    <span className="sr-only">Carregando…</span>
  </div>
)

export default function App() {
  if (!isConfigured) return <NotConfigured />
  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/admin/*" element={<AdminApp />} />
          <Route path="/:slug" element={<InvitePage />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
