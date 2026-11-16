import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { friendlyError } from '../../lib/errors'
import { shortDate, timeLabel } from '../../lib/format'
import { themeVars } from '../../lib/theme'
import type { PublicEvent } from '../../lib/types'
import { BackButton, Button, Card, InviteTitle, Notice, Page, Spinner, useEventTheme } from '../../components/ui'

const DEFAULT_WELCOME =
  'Estamos muito felizes e ansiosos com a chegada da nossa princesa. E convidamos você para comemorar com a gente esse momento tão especial!'

export default function HomePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [step, setStep] = useState<'welcome' | 'city'>((location.state as { step?: 'city' } | null)?.step ?? 'welcome')
  const [events, setEvents] = useState<PublicEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEventTheme(null)

  useEffect(() => {
    document.title = 'Chá de bebê da Bonnie'
    api
      .events()
      .then(setEvents)
      .catch((e) => setError(friendlyError(e)))
  }, [])

  useEffect(() => {
    if (step === 'city') headingRef.current?.focus()
  }, [step])

  return (
    <Page>
      <Card className="anim-rise text-center" key={step}>
        {step === 'welcome' ? (
          <>
            <InviteTitle />
            <p className="mx-auto mt-5 max-w-[30rem] text-[1.08rem] leading-[1.4] sm:text-[1.2rem]">{events?.[0]?.welcome_message ?? DEFAULT_WELCOME}</p>
            <Button className="mt-8 w-full max-w-xs" onClick={() => setStep('city')}>
              Confirmar minha presença
            </Button>
          </>
        ) : (
          <>
            <div className="mb-4 flex justify-start">
              <BackButton onClick={() => setStep('welcome')} />
            </div>
            <h1 ref={headingRef} tabIndex={-1} className="text-[1.6rem] font-normal text-ink outline-none sm:text-3xl">
              Onde vamos nos encontrar?
            </h1>
            <p className="mt-2 text-ink/80">Escolha a cidade do seu chá de bebê.</p>
            {error && (
              <div className="mt-5">
                <Notice tone="error">{error}</Notice>
              </div>
            )}
            {!events && !error && (
              <div className="mt-8 flex justify-center text-primary-strong" role="status">
                <Spinner className="h-7 w-7" />
                <span className="sr-only">Carregando…</span>
              </div>
            )}
            <ul className="mt-6 grid gap-4">
              {events?.map((ev) => (
                <li key={ev.slug} style={themeVars(ev.theme_primary, ev.theme_soft) as unknown as CSSProperties}>
                  <button
                    type="button"
                    onClick={() => navigate(`/${ev.slug}`, { state: { from: 'home' } })}
                    className="group flex w-full items-center gap-4 rounded-3xl border-2 border-primary-200 bg-white p-4 text-left transition hover:border-primary hover:bg-primary-50 active:scale-[0.98]"
                  >
                    <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-primary-strong text-white" aria-hidden="true">
                      <span className="text-center leading-none">
                        <span className="block text-2xl font-medium">{ev.event_date.slice(8, 10)}</span>
                        <span className="block text-xs font-medium uppercase tracking-wider">{shortDate(ev.event_date).split(' de ')[1].slice(0, 3)}</span>
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xl font-medium text-primary-strong">{ev.city}</span>
                      <span className="block text-[0.98rem] text-ink">
                        {shortDate(ev.event_date)}, às {timeLabel(ev.event_time)}
                      </span>
                    </span>
                    <svg viewBox="0 0 20 20" className="h-5 w-5 text-primary-strong transition group-hover:translate-x-0.5" aria-hidden="true">
                      <path d="m7.5 4.5 5.5 5.5-5.5 5.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </Page>
  )
}
