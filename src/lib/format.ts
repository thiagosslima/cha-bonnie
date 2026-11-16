const WEEKDAYS = ['DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO']
const MONTHS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ']
const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

function parts(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return { y, m, d, wd: date.getUTCDay() }
}

export function dateBlock(iso: string) {
  const p = parts(iso)
  return { weekday: WEEKDAYS[p.wd], day: String(p.d).padStart(2, '0'), month: MONTHS[p.m - 1] }
}

export function longDate(iso: string) {
  const p = parts(iso)
  return `${WEEKDAYS[p.wd].toLowerCase()}, ${p.d} de ${MONTHS_LONG[p.m - 1]} de ${p.y}`
}

export function shortDate(iso: string) {
  const p = parts(iso)
  return `${String(p.d).padStart(2, '0')} de ${MONTHS_LONG[p.m - 1]}`
}

export function timeLabel(hhmm: string) {
  const [h, m] = hhmm.split(':')
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`
}

export function dateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
}

export function brl(v: number | string | null | undefined) {
  if (v === null || v === undefined || v === '') return '—'
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function qty(v: number | string | null | undefined) {
  if (v === null || v === undefined) return '—'
  return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

export function mapsUrl(ev: { maps_url: string | null; address_line1: string; address_line2: string | null }) {
  return ev.maps_url ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${ev.address_line1}, ${ev.address_line2 ?? ''}`)}`
}

/** Arquivo .ics para "Adicionar à agenda" (horário de Brasília, duração estimada de 4h). */
export function icsFor(ev: { title: string; event_date: string; event_time: string; venue: string; venue_detail: string | null; address_line1: string; address_line2: string | null; slug: string }) {
  const d = ev.event_date.replace(/-/g, '')
  const [h, m] = ev.event_time.split(':').map(Number)
  const pad = (n: number) => String(n).padStart(2, '0')
  const start = `${d}T${pad(h)}${pad(m)}00`
  const end = `${d}T${pad(Math.min(h + 4, 23))}${pad(m)}00`
  const loc = [ev.venue, ev.venue_detail, ev.address_line1, ev.address_line2].filter(Boolean).join(' - ').replace(/,/g, '\\,')
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cha da Bonnie//PT-BR', 'BEGIN:VEVENT',
    `UID:cha-bonnie-${ev.slug}@bonnie`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;TZID=America/Sao_Paulo:${start}`, `DTEND;TZID=America/Sao_Paulo:${end}`,
    `SUMMARY:${ev.title}`, `LOCATION:${loc}`, 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')
}
