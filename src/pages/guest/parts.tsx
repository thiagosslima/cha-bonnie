import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { icsFor, longDate, mapsUrl, timeLabel } from '../../lib/format'
import { comboKey, drawAvoidingPrevious } from '../../lib/giftDraw'
import { companionsLabel, partySize, peopleLabel } from '../../lib/rsvpStats'
import type { GiftSuggestion, MyRsvp, PublicEvent } from '../../lib/types'

export function VenueBlock({ ev }: { ev: PublicEvent }) {
  return (
    <address className="not-italic text-center">
      <p className="text-[1.05rem] font-medium uppercase tracking-wide text-ink sm:text-lg">
        {ev.venue}
        {ev.venue_detail && (
          <>
            <span className="hidden sm:inline"> - </span>
            <br className="sm:hidden" />
            {ev.venue_detail}
          </>
        )}
      </p>
      <p className="mt-2 text-[1.02rem] font-light leading-snug text-ink sm:text-lg">
        {ev.address_line1}
        {ev.address_line2 && (
          <>
            <br />
            {ev.address_line2}
          </>
        )}
      </p>
    </address>
  )
}

export function MapsLink({ ev }: { ev: PublicEvent }) {
  return (
    <a
      href={mapsUrl(ev)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-primary-200 px-4 text-sm font-normal text-primary-strong transition hover:border-primary hover:bg-primary-50"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
        <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="12" cy="9.5" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
      </svg>
      Abrir no Google Maps
      <span className="sr-only">(abre em nova aba)</span>
    </a>
  )
}

export function EventSummary({ ev }: { ev: PublicEvent }) {
  return (
    <dl className="grid gap-2 rounded-2xl bg-soft px-4 py-4 text-left text-[0.95rem]">
      <div className="flex gap-3">
        <dt className="w-16 shrink-0 font-normal text-ink/70">Quando</dt>
        <dd className="font-normal">
          {longDate(ev.event_date)}, às {timeLabel(ev.event_time)}
        </dd>
      </div>
      <div className="flex gap-3">
        <dt className="w-16 shrink-0 font-normal text-ink/70">Onde</dt>
        <dd className="font-normal">
          {ev.venue}
          {ev.venue_detail ? ` - ${ev.venue_detail}` : ''}
          <br />
          <span className="font-light">
            {ev.address_line1}
            {ev.address_line2 ? `, ${ev.address_line2}` : ''}
          </span>
        </dd>
      </div>
    </dl>
  )
}

/** Resumo exibido depois de uma confirmação positiva. */
export function ConfirmationSummary({ ev, saved }: { ev: PublicEvent; saved: MyRsvp }) {
  const total = partySize(saved)
  const row = 'flex gap-3'
  const dt = 'w-[6.5rem] shrink-0 font-normal text-ink/70'
  return (
    <section aria-label="Resumo da sua confirmação" className="rounded-2xl border border-primary-200 bg-primary-50/60 px-4 py-4 text-left text-[0.95rem]">
      <dl className="grid gap-2.5">
        <div className={row}>
          <dt className={dt}>Responsável</dt>
          <dd className="min-w-0 font-medium [overflow-wrap:anywhere]">{saved.guest_name}</dd>
        </div>
        <div className={row}>
          <dt className={dt}>Cidade</dt>
          <dd className="font-normal">
            {ev.city}
            {ev.state ? ` - ${ev.state}` : ''}
          </dd>
        </div>
        <div className={row}>
          <dt className={dt}>Quando</dt>
          <dd className="font-normal">
            {longDate(ev.event_date)}, às {timeLabel(ev.event_time)}
          </dd>
        </div>
        <div className={row}>
          <dt className={dt}>Onde</dt>
          <dd className="font-normal">
            {ev.venue}
            {ev.venue_detail ? ` - ${ev.venue_detail}` : ''}
            <br />
            <span className="font-light">
              {ev.address_line1}
              {ev.address_line2 ? `, ${ev.address_line2}` : ''}
            </span>
          </dd>
        </div>
        <div className={row}>
          <dt className={dt}>Participantes</dt>
          <dd className="font-normal">
            <strong className="font-medium">{peopleLabel(total)}</strong>
            <span className="text-ink/70"> ({companionsLabel(total - 1)})</span>
          </dd>
        </div>
        {saved.diaper_size && (
          <div className={`${row} items-center`}>
            <dt className={dt}>Fralda</dt>
            <dd className="flex items-center gap-2.5 font-normal">
              <span className="grid h-9 min-w-9 place-items-center rounded-lg bg-primary-strong px-1.5 font-medium text-white">{saved.diaper_size}</span>
              <span>
                Tamanho {saved.diaper_size}
                <span className="block text-xs text-ink/70">Uma fraldinha por família. A marca é você quem escolhe.</span>
              </span>
            </dd>
          </div>
        )}
      </dl>
    </section>
  )
}

export function CalendarLink({ ev }: { ev: PublicEvent }) {
  const [href, setHref] = useState<string>()
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([icsFor(ev)], { type: 'text/calendar;charset=utf-8' }))
    setHref(url)
    return () => URL.revokeObjectURL(url)
  }, [ev])
  if (!href) return null
  return (
    <a
      href={href}
      download={`cha-da-bonnie-${ev.slug}.ics`}
      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-primary-200 px-4 text-sm font-normal text-primary-strong hover:border-primary hover:bg-primary-50"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
        <rect x="3.5" y="5" width="17" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
      Adicionar à agenda
    </a>
  )
}

const FLOWERS = ['f00', 'f03', 'f02', 'f07', 'f09', 'f14']
const TIER_LABEL: Record<string, string> = { barato: 'Mimo simples', medio: 'Mimo médio', caro: 'Mimo especial' }

// Um sorteio por carregamento da página: as sugestões ficam estáveis enquanto
// o convidado navega (alterar resposta, voltar) e mudam ao atualizar a página.
const LAST_GIFTS_KEY = 'bonnie:last-gifts'
let giftDraw: Promise<GiftSuggestion[]> | null = null

function loadGiftSuggestions(): Promise<GiftSuggestion[]> {
  if (!giftDraw) {
    let previous: string | null = null
    try {
      previous = localStorage.getItem(LAST_GIFTS_KEY)
    } catch {
      /* armazenamento indisponível: só não evita repetição */
    }
    giftDraw = drawAvoidingPrevious(api.giftSuggestions, previous).then((g) => {
      try {
        if (g.length) localStorage.setItem(LAST_GIFTS_KEY, comboKey(g))
      } catch {
        /* idem */
      }
      return g
    })
    giftDraw.catch(() => (giftDraw = null))
  }
  return giftDraw
}

export function GiftSuggestions() {
  const [items, setItems] = useState<GiftSuggestion[] | null>(null)
  useEffect(() => {
    let alive = true
    loadGiftSuggestions()
      .then((g) => alive && setItems(g))
      .catch(() => alive && setItems([]))
    return () => {
      alive = false
    }
  }, [])
  if (!items || items.length === 0) return null
  return (
    <section aria-labelledby="mimos-title" className="anim-rise mt-8 border-t border-primary-100 pt-7 text-left">
      <h2 id="mimos-title" className="text-center text-xl font-normal text-ink">
        Um carinho a mais para a Bonnie 💕
      </h2>
      <p className="mx-auto mt-2 max-w-md text-center text-[0.95rem] leading-relaxed">
        Além das fraldinhas, se quiser trazer outro mimo, separamos algumas sugestões que ainda fazem parte do enxoval da nossa princesa.
      </p>
      <ul className="mt-5 grid gap-3">
        {items.map((g, i) => (
          <li key={g.name + i} className="flex items-center gap-4 rounded-2xl border border-primary-100 bg-white p-3 pr-4">
            <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-soft">
              {g.image_url ? (
                <img src={g.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
              ) : (
                <img src={`/img/flores/${FLOWERS[i % FLOWERS.length]}.png`} alt="" className="h-11 w-11 object-contain" />
              )}
            </div>
            <div className="min-w-0">
              <p className="font-normal leading-snug text-ink">{g.name}</p>
              {g.description && <p className="mt-0.5 text-sm leading-snug text-ink/75">{g.description}</p>}
              {g.price_tier && (
                <p className="mt-1 inline-block rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-normal text-primary-strong">{TIER_LABEL[g.price_tier]}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-center text-xs text-ink/65">São só sugestões: não precisa avisar nem reservar nada 😉</p>
    </section>
  )
}
