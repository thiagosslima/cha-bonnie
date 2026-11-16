import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { friendlyError, errorCode } from '../../lib/errors'
import { draftStore, newEditToken, newRequestId, tokenStore } from '../../lib/storage'
import { DIAPER_SIZES, type Attendance, type DiaperRecommendation, type DiaperSize, type MyRsvp, type PublicEvent } from '../../lib/types'
import { BackButton, Button, Card, DateBlock, InviteTitle, Notice, Page, Spinner, Steps, useEventTheme } from '../../components/ui'
import { CalendarLink, EventSummary, GiftSuggestions, MapsLink, VenueBlock } from './parts'

type Step = 'invite' | 'name' | 'attendance' | 'diaper' | 'done'
interface Draft {
  step: Step
  name: string
  attendance: Attendance | null
  diaper: DiaperSize | null
  token: string
  requestId: string
}

const freshDraft = (): Draft => ({ step: 'invite', name: '', attendance: null, diaper: null, token: newEditToken(), requestId: newRequestId() })

export default function InvitePage() {
  const { slug = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const fromHome = Boolean((location.state as { from?: string } | null)?.from === 'home')

  const [ev, setEv] = useState<PublicEvent | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraftState] = useState<Draft>(() => draftStore.get<Draft>(slug) ?? freshDraft())
  const [saved, setSaved] = useState<MyRsvp | null>(null)
  const [editToken, setEditToken] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rec, setRec] = useState<DiaperRecommendation | null>(null)
  const headingRef = useRef<HTMLDivElement>(null)

  useEventTheme(ev?.theme_primary, ev?.theme_soft)

  const setDraft = useCallback(
    (patch: Partial<Draft>) =>
      setDraftState((d) => {
        const next = { ...d, ...patch }
        draftStore.set(slug, next)
        return next
      }),
    [slug],
  )

  // Carrega o evento e uma resposta já existente neste aparelho (ou via link ?r=)
  useEffect(() => {
    let alive = true
    const params = new URLSearchParams(location.search)
    const fromLink = params.get('r')
    if (fromLink) {
      tokenStore.set(slug, fromLink)
      window.history.replaceState(null, '', window.location.pathname)
    }
    ;(async () => {
      try {
        const e = await api.event(slug)
        if (!alive) return
        setEv(e)
        document.title = `Chá de bebê da Bonnie · ${e.city}`
        const token = tokenStore.get(slug)
        if (token) {
          try {
            const mine = await api.myRsvp(token)
            if (!alive) return
            setSaved(mine)
            setEditToken(token)
            setDraftState((d) => ({ ...d, step: 'done' }))
          } catch (err) {
            if (errorCode(err) === 'RSVP_NOT_FOUND' || errorCode(err) === 'INVALID_TOKEN') tokenStore.clear(slug)
          }
        }
      } catch (err) {
        if (alive) setLoadError(errorCode(err) === 'EVENT_NOT_FOUND' ? 'not_found' : friendlyError(err))
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  // Move o foco para o topo de cada etapa (leitores de tela e teclado)
  useEffect(() => {
    if (draft.step !== 'invite') headingRef.current?.focus()
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setError(null)
  }, [draft.step])

  // Recomendação de fralda: sempre atualizada ao entrar na etapa
  useEffect(() => {
    if (draft.step !== 'diaper') return
    let alive = true
    api
      .diaperRecommendation(slug)
      .then((r) => alive && setRec(r))
      .catch(() => alive && setRec({ recommended: null, sizes: DIAPER_SIZES }))
    return () => {
      alive = false
    }
  }, [draft.step, slug])

  const go = (step: Step) => setDraft({ step })

  async function submit() {
    if (!draft.attendance) return setError('Escolha uma das opções.')
    if (draft.attendance === 'yes' && !draft.diaper) return setError('Escolha o tamanho da fralda para confirmar 💜')
    setSubmitting(true)
    setError(null)
    const payload = { name: draft.name, attendance: draft.attendance, diaper: draft.attendance === 'yes' ? draft.diaper : null }
    try {
      let result: MyRsvp
      if (editing && editToken) {
        result = await api.updateRsvp({ token: editToken, ...payload })
      } else {
        result = await api.submitRsvp({ slug, token: draft.token, requestId: draft.requestId, ...payload })
        // Se uma tentativa anterior chegou ao servidor com outros dados, atualiza.
        if (result.attendance !== payload.attendance || result.diaper_size !== payload.diaper || result.guest_name !== payload.name.trim().replace(/\s+/g, ' ')) {
          result = await api.updateRsvp({ token: draft.token, ...payload })
        }
        tokenStore.set(slug, draft.token)
        setEditToken(draft.token)
      }
      setSaved(result)
      setEditing(false)
      draftStore.clear(slug)
      setDraftState({ ...freshDraft(), step: 'done' })
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSubmitting(false)
    }
  }

  function startEdit() {
    if (!saved) return
    setEditing(true)
    setDraft({ step: 'name', name: saved.guest_name, attendance: saved.attendance, diaper: saved.diaper_size })
  }

  if (loadError) {
    return (
      <Page>
        <Card className="text-center">
          <InviteTitle />
          <p className="mt-6">{loadError === 'not_found' ? 'Não encontramos esse convite.' : loadError}</p>
          <div className="mt-6">
            <Button variant="outline" onClick={() => navigate('/')}>
              Ver os chás de bebê
            </Button>
          </div>
        </Card>
      </Page>
    )
  }

  if (!ev) {
    return (
      <Page>
        <div className="flex min-h-[60dvh] items-center justify-center text-primary-strong" role="status">
          <Spinner className="h-8 w-8" />
          <span className="sr-only">Carregando convite…</span>
        </div>
      </Page>
    )
  }

  const stepIndex = { invite: 0, name: 1, attendance: 2, diaper: 3, done: 4 }[draft.step]
  const totalSteps = draft.attendance === 'yes' ? 3 : 2

  return (
    <Page>
      <Card className="anim-rise">
        {draft.step === 'invite' && (
          <div className="text-center">
            <InviteTitle />
            <p className="mx-auto mt-5 max-w-[30rem] text-[1.08rem] leading-[1.4] sm:text-[1.2rem]">{ev.welcome_message}</p>
            <div className="mt-8">
              <DateBlock date={ev.event_date} time={ev.event_time} />
              <p className="sr-only">
                {ev.city}: {new Date(ev.event_date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}, às {ev.event_time}
              </p>
            </div>
            <div className="mt-8">
              <VenueBlock ev={ev} />
            </div>
            <div className="mt-5">
              <MapsLink ev={ev} />
            </div>
            <div className="mt-8 flex flex-col items-center gap-3">
              {ev.rsvp_open ? (
                <Button className="w-full max-w-xs" onClick={() => go('name')}>
                  {fromHome ? 'Confirmar presença' : 'Confirmar minha presença'}
                </Button>
              ) : (
                <Notice>As confirmações por aqui foram encerradas. Qualquer coisa, fale com o Thiago ou a Rafa 💜</Notice>
              )}
              {fromHome && <BackButton label="Escolher outra cidade" onClick={() => navigate('/', { state: { step: 'city' } })} />}
            </div>
          </div>
        )}

        {draft.step !== 'invite' && draft.step !== 'done' && (
          <div className="mb-6 flex items-center justify-between">
            <BackButton onClick={() => go(draft.step === 'name' ? (editing ? 'done' : 'invite') : draft.step === 'attendance' ? 'name' : 'attendance')} />
            <Steps current={stepIndex} total={totalSteps} />
            <span className="w-16" aria-hidden="true" />
          </div>
        )}

        {draft.step === 'name' && (
          <NameStep
            headingRef={headingRef}
            value={draft.name}
            onChange={(name) => setDraft({ name })}
            onNext={() => go('attendance')}
            city={ev.city}
          />
        )}

        {draft.step === 'attendance' && (
          <AttendanceStep
            headingRef={headingRef}
            heart={ev.heart_emoji}
            value={draft.attendance}
            onChange={(attendance) => setDraft({ attendance })}
            onNext={() => (draft.attendance === 'yes' ? go('diaper') : submit())}
            submitting={submitting}
            error={error}
          />
        )}

        {draft.step === 'diaper' && (
          <DiaperStep
            headingRef={headingRef}
            heart={ev.heart_emoji}
            rec={rec}
            value={draft.diaper}
            onChange={(diaper) => setDraft({ diaper })}
            onSubmit={submit}
            submitting={submitting}
            error={error}
            editing={editing}
          />
        )}

        {draft.step === 'done' && saved && (
          <DoneStep headingRef={headingRef} ev={ev} saved={saved} token={editToken} onEdit={startEdit} />
        )}
      </Card>
    </Page>
  )
}

// ---------------------------------------------------------------------------

function StepHeading({ headingRef, children, sub }: { headingRef: React.RefObject<HTMLDivElement | null>; children: React.ReactNode; sub?: string }) {
  return (
    <div ref={headingRef} tabIndex={-1} className="text-center outline-none">
      <h1 className="text-[1.6rem] font-normal leading-tight text-ink sm:text-3xl">{children}</h1>
      {sub && <p className="mt-2 text-[0.98rem] text-ink/80">{sub}</p>}
    </div>
  )
}

function NameStep(p: { headingRef: React.RefObject<HTMLDivElement | null>; value: string; onChange: (v: string) => void; onNext: () => void; city: string }) {
  const id = useId()
  const [touched, setTouched] = useState(false)
  const clean = p.value.trim().replace(/\s+/g, ' ')
  const invalid = clean.length < 2 || !/\p{L}/u.test(clean)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!invalid) p.onNext()
  }
  return (
    <form onSubmit={submit} noValidate className="anim-rise">
      <StepHeading headingRef={p.headingRef} sub={`Chá de bebê em ${p.city}`}>
        Qual é o seu nome completo?
      </StepHeading>
      <div className="mt-7">
        <label htmlFor={id} className="mb-2 block text-sm font-normal text-ink/80">
          Nome completo
        </label>
        <input
          id={id}
          value={p.value}
          onChange={(e) => p.onChange(e.target.value)}
          onBlur={() => setTouched(true)}
          autoComplete="name"
          autoCapitalize="words"
          enterKeyHint="next"
          maxLength={120}
          required
          aria-invalid={touched && invalid}
          aria-describedby={touched && invalid ? `${id}-err` : undefined}
          className="block w-full rounded-2xl border border-ink/20 bg-white px-4 py-3.5 text-lg font-normal text-ink outline-none transition placeholder:text-ink/40 focus:border-primary focus:ring-4 focus:ring-primary-100"
          placeholder="Ex.: Maria da Silva"
        />
        {touched && invalid && (
          <p id={`${id}-err`} role="alert" className="mt-2 text-sm text-red-700">
            Conta pra gente o seu nome completo 💜
          </p>
        )}
      </div>
      <Button type="submit" className="mt-7 w-full">
        Continuar
      </Button>
    </form>
  )
}

function AttendanceStep(p: {
  headingRef: React.RefObject<HTMLDivElement | null>
  heart: string
  value: Attendance | null
  onChange: (v: Attendance) => void
  onNext: () => void
  submitting: boolean
  error: string | null
}) {
  const options: { v: Attendance; label: string }[] = [
    { v: 'yes', label: `Com certeza, estarei lá! ${p.heart}` },
    { v: 'maybe', label: 'Ainda não sei 🤔' },
    { v: 'no', label: 'Infelizmente não poderei 😢' },
  ]
  return (
    <div className="anim-rise">
      <StepHeading headingRef={p.headingRef}>Podemos contar com você?</StepHeading>
      <fieldset className="mt-7">
        <legend className="sr-only">Sua presença</legend>
        <div className="grid gap-3">
          {options.map((o) => {
            const checked = p.value === o.v
            return (
              <label
                key={o.v}
                className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-3 text-[1.05rem] font-normal transition ${
                  checked ? 'anim-pop border-primary bg-primary-50 text-ink' : 'border-ink/12 bg-white hover:border-primary-200'
                }`}
              >
                <input type="radio" name="attendance" value={o.v} checked={checked} onChange={() => p.onChange(o.v)} className="peer sr-only" />
                <span
                  aria-hidden="true"
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 peer-focus-visible:ring-4 peer-focus-visible:ring-primary-200 ${checked ? 'border-primary-strong bg-primary-strong' : 'border-ink/30'}`}
                >
                  {checked && (
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-white">
                      <path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                {o.label}
              </label>
            )
          })}
        </div>
      </fieldset>
      {p.error && (
        <div className="mt-4">
          <Notice tone="error">{p.error}</Notice>
        </div>
      )}
      <Button className="mt-7 w-full" disabled={!p.value} loading={p.submitting} onClick={p.onNext}>
        {p.value === 'yes' || !p.value ? 'Continuar' : 'Enviar resposta'}
      </Button>
    </div>
  )
}

function DiaperStep(p: {
  headingRef: React.RefObject<HTMLDivElement | null>
  heart: string
  rec: DiaperRecommendation | null
  value: DiaperSize | null
  onChange: (v: DiaperSize) => void
  onSubmit: () => void
  submitting: boolean
  error: string | null
  editing: boolean
}) {
  const sizes = p.rec?.sizes?.length ? p.rec.sizes : DIAPER_SIZES
  return (
    <div className="anim-rise">
      <StepHeading headingRef={p.headingRef} sub="A marca fica à sua escolha.">
        Qual tamanho de fralda você vai levar?
      </StepHeading>
      {!p.rec ? (
        <div className="mt-8 flex justify-center text-primary-strong" role="status">
          <Spinner className="h-6 w-6" />
          <span className="sr-only">Carregando tamanhos…</span>
        </div>
      ) : (
        <fieldset className="mt-7">
          <legend className="sr-only">Tamanho da fralda</legend>
          <div className="grid grid-cols-5 gap-2 sm:gap-3">
            {sizes.map((s) => {
              const checked = p.value === s
              const recommended = p.rec?.recommended === s
              return (
                <label
                  key={s}
                  className={`relative flex aspect-square cursor-pointer flex-col items-center justify-center rounded-2xl border-2 text-xl font-medium transition sm:text-2xl ${
                    checked ? 'anim-pop border-primary-strong bg-primary-strong text-white' : recommended ? 'border-primary bg-primary-50 text-primary-strong' : 'border-ink/12 bg-white text-ink hover:border-primary-200'
                  }`}
                >
                  <input type="radio" name="diaper" value={s} checked={checked} onChange={() => p.onChange(s)} className="peer sr-only" />
                  <span className="pointer-events-none absolute inset-0 rounded-2xl peer-focus-visible:ring-4 peer-focus-visible:ring-primary-200" aria-hidden="true" />
                  {s}
                  {recommended && (
                    <span className={`absolute -top-2 rounded-full px-1.5 text-[0.6rem] font-medium uppercase tracking-wide ${checked ? 'bg-white text-primary-strong' : 'bg-primary-strong text-white'}`}>
                      ★<span className="sr-only"> tamanho mais necessário</span>
                    </span>
                  )}
                </label>
              )
            })}
          </div>
          {p.rec?.recommended && (
            <p className="mt-4 rounded-2xl bg-primary-50 px-4 py-3 text-center text-[0.95rem] text-ink">
              <strong className="font-medium text-primary-strong">Tamanho {p.rec.recommended} ★</strong>
              <br />
              Estamos precisando um pouquinho mais desse tamanho! {p.heart}
            </p>
          )}
        </fieldset>
      )}
      {p.error && (
        <div className="mt-4">
          <Notice tone="error">{p.error}</Notice>
        </div>
      )}
      <Button className="mt-7 w-full" disabled={!p.value} loading={p.submitting} onClick={p.onSubmit}>
        {p.editing ? 'Salvar alteração' : 'Confirmar presença'}
      </Button>
      {!p.value && p.rec && <p className="mt-2 text-center text-xs text-ink/65">Escolha um tamanho para confirmar.</p>}
    </div>
  )
}

function DoneStep({ headingRef, ev, saved, token, onEdit }: { headingRef: React.RefObject<HTMLDivElement | null>; ev: PublicEvent; saved: MyRsvp; token: string | null; onEdit: () => void }) {
  const msg = saved.attendance === 'yes' ? ev.msg_confirmed : saved.attendance === 'maybe' ? ev.msg_maybe : ev.msg_declined
  const [title, ...rest] = msg.split(/\n\s*\n/)
  const [copied, setCopied] = useState(false)
  const editUrl = token ? `${window.location.origin}/${ev.slug}?r=${token}` : null
  const copy = async () => {
    if (!editUrl) return
    try {
      await navigator.clipboard.writeText(editUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      window.prompt('Copie o seu link:', editUrl)
    }
  }
  return (
    <div className="anim-rise text-center">
      <div className="mx-auto w-44">
        <InviteTitle as="h2" />
      </div>
      <div ref={headingRef} tabIndex={-1} className="mt-5 outline-none" aria-live="polite">
        <h1 className="text-[1.75rem] font-normal text-primary-strong">{title}</h1>
        {rest.map((para, i) => (
          <p key={i} className="mx-auto mt-3 max-w-md text-[1.05rem] leading-relaxed">
            {para}
          </p>
        ))}
      </div>

      {saved.attendance !== 'no' && (
        <div className="mt-6">
          <EventSummary ev={ev} />
        </div>
      )}

      {saved.attendance === 'yes' && saved.diaper_size && (
        <div className="mt-4 flex items-center justify-center gap-3 rounded-2xl border border-primary-200 px-4 py-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary-strong text-lg font-medium text-white">{saved.diaper_size}</span>
          <span className="text-left text-[0.98rem]">
            Sua fraldinha: <strong className="font-medium">tamanho {saved.diaper_size}</strong>
            <br />
            <span className="text-sm text-ink/70">A marca é você quem escolhe.</span>
          </span>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {saved.attendance !== 'no' && <MapsLink ev={ev} />}
        {saved.attendance === 'yes' && <CalendarLink ev={ev} />}
      </div>

      {saved.attendance !== 'no' && <GiftSuggestions />}

      <div className="mt-8 rounded-2xl bg-soft px-4 py-4 text-sm">
        <p>
          Respondido como <strong className="font-medium">{saved.guest_name}</strong>. Mudou algo? Você pode alterar sua resposta quando quiser.
        </p>
        <div className="mt-3 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
          {ev.rsvp_open && (
            <Button variant="outline" className="w-full sm:w-auto" onClick={onEdit}>
              Alterar minha resposta
            </Button>
          )}
          {editUrl && (
            <Button variant="ghost" className="w-full sm:w-auto" onClick={copy} aria-live="polite">
              {copied ? 'Link copiado ✓' : 'Copiar meu link de alteração'}
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-ink/65">Guarde o link para alterar sua resposta de outro celular. Ele é só seu.</p>
      </div>
    </div>
  )
}
