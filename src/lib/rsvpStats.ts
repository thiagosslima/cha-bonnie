import type { Attendance, DiaperSize } from './types'

/** Cada confirmação representa uma família/grupo: o responsável + acompanhantes. */
export interface RsvpLike {
  attendance: Attendance
  diaper_size: DiaperSize | null
  companions_count?: number | null
}

/** Total de pessoas da família: 1 (quem respondeu) + acompanhantes. */
export function partySize(r: Pick<RsvpLike, 'companions_count'>): number {
  return 1 + Math.max(0, Math.trunc(Number(r.companions_count ?? 0)) || 0)
}

export interface RsvpTotals {
  /** Respostas recebidas (uma por família). */
  responses: number
  /** Famílias que confirmaram presença. */
  families: number
  /** Pessoas confirmadas, incluindo acompanhantes. */
  people: number
  /** Acompanhantes das famílias confirmadas. */
  companions: number
  maybeFamilies: number
  maybePeople: number
  declinedFamilies: number
  /** Escolhas de fralda: uma por família confirmada, nunca por pessoa. */
  diaperChoices: number
}

export function rsvpTotals(rows: RsvpLike[]): RsvpTotals {
  const t: RsvpTotals = { responses: rows.length, families: 0, people: 0, companions: 0, maybeFamilies: 0, maybePeople: 0, declinedFamilies: 0, diaperChoices: 0 }
  for (const r of rows) {
    if (r.attendance === 'yes') {
      const size = partySize(r)
      t.families++
      t.people += size
      t.companions += size - 1
      if (r.diaper_size) t.diaperChoices++
    } else if (r.attendance === 'maybe') {
      t.maybeFamilies++
      t.maybePeople += partySize(r)
    } else {
      t.declinedFamilies++
    }
  }
  return t
}

/** "1 pessoa" / "4 pessoas". */
export function peopleLabel(n: number): string {
  return `${n} ${n === 1 ? 'pessoa' : 'pessoas'}`
}

/** "só você" / "você + 1 acompanhante" / "você + 3 acompanhantes". */
export function companionsLabel(companions: number): string {
  if (companions <= 0) return 'só você'
  return `você + ${companions} ${companions === 1 ? 'acompanhante' : 'acompanhantes'}`
}
