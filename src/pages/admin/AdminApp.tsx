import { useEffect, useState, type FormEvent } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { Bonnie, Button, useEventTheme } from '../../components/ui'
import { ErrorBox, Field, Loading, inputCls } from './common'
import Dashboard from './Dashboard'
import Guests from './Guests'
import Diapers from './Diapers'
import Layette from './Layette'
import Suggestions from './Suggestions'
import EventsAdmin from './EventsAdmin'
import ImportLayette from './ImportLayette'

const NAV = [
  ['', 'Painel'],
  ['convidados', 'Convidados'],
  ['fraldas', 'Fraldas'],
  ['enxoval', 'Enxoval'],
  ['sugestoes', 'Sugestões'],
  ['eventos', 'Eventos'],
  ['importar', 'Importar'],
] as const

export default function AdminApp() {
  useEventTheme('#C0A4ED', '#F8F5FA')
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)

  useEffect(() => {
    document.title = 'Painel · Chá da Bonnie'
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return setIsAdmin(null)
    supabase
      .from('admin_users')
      .select('user_id')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => setIsAdmin(Boolean(data)))
  }, [session])

  if (session === undefined) return <Loading />
  if (!session) return <Login />
  if (isAdmin === null) return <Loading />
  if (!isAdmin)
    return (
      <Shell>
        <div className="mx-auto max-w-md rounded-3xl bg-white p-6 text-center">
          <p>Esta conta ({session.user.email}) não tem acesso ao painel.</p>
          <Button variant="outline" className="mt-4" onClick={() => supabase.auth.signOut()}>
            Sair
          </Button>
        </div>
      </Shell>
    )

  return (
    <Shell email={session.user.email}>
      <nav aria-label="Seções do painel" className="-mx-4 mb-5 overflow-x-auto px-4">
        <ul className="flex w-max gap-1.5">
          {NAV.map(([path, label]) => (
            <li key={path}>
              <NavLink
                end={path === ''}
                to={`/admin/${path}`}
                className={({ isActive }) =>
                  `inline-flex min-h-10 items-center rounded-full px-4 text-sm font-normal transition ${isActive ? 'bg-primary-strong text-white' : 'bg-white text-ink hover:bg-primary-50'}`
                }
              >
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="convidados" element={<Guests />} />
        <Route path="fraldas" element={<Diapers />} />
        <Route path="enxoval" element={<Layette />} />
        <Route path="sugestoes" element={<Suggestions />} />
        <Route path="eventos" element={<EventsAdmin />} />
        <Route path="importar" element={<ImportLayette />} />
      </Routes>
    </Shell>
  )
}

function Shell({ children, email }: { children: React.ReactNode; email?: string }) {
  return (
    <div className="min-h-dvh bg-soft/90">
      <header className="sticky top-0 z-20 border-b border-ink/10 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Bonnie className="w-24" />
            <span className="text-sm text-ink/70">painel</span>
          </div>
          {email && (
            <div className="flex items-center gap-2 text-sm">
              <span className="hidden text-ink/70 sm:inline">{email}</span>
              <Button variant="ghost" className="min-h-10 px-3 text-sm" onClick={() => supabase.auth.signOut()}>
                Sair
              </Button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-5">{children}</main>
    </div>
  )
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setLoading(false)
    if (error) setError('E-mail ou senha incorretos.')
  }
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={submit} className="invite-card w-full max-w-sm space-y-4 p-7">
        <Bonnie className="mx-auto w-40" />
        <h1 className="text-center text-xl font-normal">Painel dos papais</h1>
        <Field label="E-mail">
          <input className={inputCls} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Senha">
          <input className={inputCls} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <ErrorBox>{error}</ErrorBox>}
        <Button type="submit" className="w-full" loading={loading}>
          Entrar
        </Button>
      </form>
    </main>
  )
}
