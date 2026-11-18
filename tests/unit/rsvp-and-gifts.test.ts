import { describe, expect, it } from 'vitest'
import { companionsLabel, partySize, peopleLabel, rsvpTotals, type RsvpLike } from '../../src/lib/rsvpStats'
import { comboKey, drawAvoidingPrevious } from '../../src/lib/giftDraw'

describe('famílias, pessoas e fraldas', () => {
  it('total de participantes = 1 + acompanhantes', () => {
    expect(partySize({ companions_count: 0 })).toBe(1)
    expect(partySize({ companions_count: 3 })).toBe(4)
    expect(partySize({})).toBe(1) // registros antigos, sem a coluna
    expect(partySize({ companions_count: null })).toBe(1)
  })

  it('exemplo do briefing: 1 família, 4 pessoas, 3 acompanhantes, 1 fralda', () => {
    const t = rsvpTotals([{ attendance: 'yes', diaper_size: 'M', companions_count: 3 }])
    expect(t).toMatchObject({ families: 1, people: 4, companions: 3, diaperChoices: 1 })
  })

  it('fralda é por família; indecisos e ausentes não contam pessoas nem fraldas', () => {
    const rows: RsvpLike[] = [
      { attendance: 'yes', diaper_size: 'P', companions_count: 0 },
      { attendance: 'yes', diaper_size: 'M', companions_count: 1 },
      { attendance: 'yes', diaper_size: 'G', companions_count: 4 },
      { attendance: 'maybe', diaper_size: null, companions_count: 2 },
      { attendance: 'no', diaper_size: null, companions_count: 5 },
    ]
    expect(rsvpTotals(rows)).toEqual({
      responses: 5,
      families: 3,
      people: 1 + 2 + 5,
      companions: 0 + 1 + 4,
      maybeFamilies: 1,
      maybePeople: 3,
      declinedFamilies: 1,
      diaperChoices: 3,
    })
  })

  it('30 famílias com 85 pessoas: 30 escolhas de fralda', () => {
    // 25 famílias com 3 pessoas (2 acompanhantes) + 5 famílias com 2 pessoas (1 acompanhante) = 75 + 10 = 85
    const rows: RsvpLike[] = [
      ...Array.from({ length: 25 }, () => ({ attendance: 'yes' as const, diaper_size: 'M' as const, companions_count: 2 })),
      ...Array.from({ length: 5 }, () => ({ attendance: 'yes' as const, diaper_size: 'G' as const, companions_count: 1 })),
    ]
    expect(rsvpTotals(rows)).toMatchObject({ families: 30, people: 85, diaperChoices: 30 })
  })

  it('textos', () => {
    expect(peopleLabel(1)).toBe('1 pessoa')
    expect(peopleLabel(4)).toBe('4 pessoas')
    expect(companionsLabel(0)).toBe('só você')
    expect(companionsLabel(1)).toBe('você + 1 acompanhante')
    expect(companionsLabel(3)).toBe('você + 3 acompanhantes')
  })
})

describe('sorteio das sugestões no convite', () => {
  const combo = (...names: string[]) => names.map((name) => ({ name }))

  it('a combinação independe da ordem', () => {
    expect(comboKey(combo('A', 'B', 'C'))).toBe(comboKey(combo('C', 'A', 'B')))
    expect(comboKey(combo('A', 'B', 'C'))).not.toBe(comboKey(combo('A', 'B', 'D')))
  })

  it('sorteia de novo quando vem a mesma combinação da visita anterior', async () => {
    const draws = [combo('A', 'B', 'C'), combo('B', 'C', 'A'), combo('A', 'B', 'D')]
    let calls = 0
    const r = await drawAvoidingPrevious(async () => draws[calls++], comboKey(combo('A', 'B', 'C')))
    expect(calls).toBe(3)
    expect(comboKey(r)).toBe(comboKey(combo('A', 'B', 'D')))
  })

  it('sem alternativas, aceita a repetição depois de algumas tentativas', async () => {
    let calls = 0
    const r = await drawAvoidingPrevious(async () => (calls++, combo('A')), comboKey(combo('A')), 3)
    expect(calls).toBe(3)
    expect(r).toEqual(combo('A'))
  })

  it('primeira visita: um único sorteio', async () => {
    let calls = 0
    await drawAvoidingPrevious(async () => (calls++, combo('A', 'B')), null)
    expect(calls).toBe(1)
  })
})
