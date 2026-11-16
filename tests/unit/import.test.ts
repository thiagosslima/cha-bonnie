import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readWorkbook } from '../../src/lib/readWorkbook'
import { buildImportPlan, buildPayload, parseQuantity, planStats } from '../../src/lib/layetteImport'

const file = readFileSync(new URL('../fixtures/Enxoval Bonnie e Mamãe.xlsx', import.meta.url))
const ab = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer

describe('parseQuantity', () => {
  it('preserva texto e normaliza formatos da planilha', () => {
    expect(parseQuantity('1')).toMatchObject({ quantity: 1, unit: 'unidade', range: null })
    expect(parseQuantity('3 a 5')).toMatchObject({ quantity: 3, range: [3, 5], unit: 'unidade', text: '3 a 5' })
    expect(parseQuantity('1 caixa')).toMatchObject({ quantity: 1, unit: 'caixa' })
    expect(parseQuantity('4 a 5 trocas')).toMatchObject({ quantity: 4, range: [4, 5], unit: 'troca' })
    expect(parseQuantity('2 a 3 pacotes')).toMatchObject({ quantity: 2, unit: 'pacote' })
    expect(parseQuantity('1 pacote pequeno')).toMatchObject({ quantity: 1, unit: 'pacote', unitNote: 'pacote pequeno' })
    expect(parseQuantity('-')).toMatchObject({ quantity: null })
    expect(parseQuantity(5)).toMatchObject({ quantity: 5, unit: 'unidade' })
  })
})

describe('importação da planilha real', async () => {
  const sheets = await readWorkbook(ab)
  const plan = buildImportPlan(sheets)
  const byName = (n: string, sheet?: string) => plan.items.find((i) => i.name === n && (!sheet || i.sheet === sheet))!

  it('ignora Resumo e Planejamento e reproduz o resumo da planilha', () => {
    expect(plan.ignoredSheets).toEqual(expect.arrayContaining(['Resumo', 'Planejamento de Compras']))
    // A aba Resumo informa 150 itens, mas a fórmula da Mala Maternidade começa em B7
    // e deixa de fora a primeira linha ("Mala/bolsa", linha 6). Contando linha a linha: 151.
    expect(plan.spreadsheetSummary).toEqual({ items: 151, acquired: 13 })
    expect(plan.items.find((i) => i.name === 'Mala/bolsa')?.row).toBe(6)
  })

  it('processa a aba Saúde com estrutura própria', () => {
    const colic = byName('Colic calm')
    expect(colic.category).toBe('Saúde')
    expect(colic.subcategory).toBe('Cólica')
    expect(colic.is_gift_eligible).toBe(false)
    expect(plan.items.filter((i) => i.sheet === 'Saúde')).toHaveLength(2)
  })

  it('reconhece itens adquiridos', () => {
    expect(byName('Berço (ou minicama/moisés)')).toMatchObject({ purchased: 1, amount_paid: 750 })
    expect(byName('Carrinho de bebê')).toMatchObject({ purchased: 1, amount_paid: 1889.9 })
    expect(byName('Banheira')).toMatchObject({ received: 1, acquisition_ambiguous: true })
    expect(byName('Sacos para armazenar leite materno')).toMatchObject({ received: 1, unit: 'caixa' })
    expect(byName('Escova para limpeza de mamadeira')).toMatchObject({ purchased: 1 })
  })

  it('usa preço de comparação como referência sem inventar preços', () => {
    expect(byName('Ninho').reference_price).toBe(358)
    expect(byName('Bodies manga longa').reference_price).toBeNull()
    const priced = plan.items.filter((i) => i.reference_price !== null).map((i) => i.name)
    expect(priced.sort()).toEqual(['Charutinho/swaddle', 'Luminária de led/abajur baixa intensidade', 'Mochia maternidade', 'Ninho'].sort())
  })

  it('sinaliza duplicidades da mala da maternidade', () => {
    const fraldasMala = byName('Fraldas RN', 'Mala Maternidade')
    expect(fraldasMala.duplicate_of?.name).toBe('Fraldas RN')
    expect(fraldasMala.decision).toBe('link')
    expect(byName('Lenços umedecidos', 'Mala Maternidade').decision).toBe('link')
    const stats = planStats(plan)
    expect(stats.possibleDuplicates).toBeGreaterThan(3)
  })

  it('gera payload sem itens vinculados e com movimentações iniciais', () => {
    const payload = buildPayload(plan)
    const keys = new Set(payload.map((p) => p.import_key))
    expect(keys.size).toBe(payload.length)
    expect(payload.find((p) => p.name === 'Fraldas RN' && p.category === 'Mala Maternidade')).toBeUndefined()
    const fr = payload.find((p) => p.name === 'Fraldas RN')!
    expect(fr.also_in_lists).toContain('Mala Maternidade')
    const berco = payload.find((p) => p.name.startsWith('Berço'))!
    expect(berco.movements).toEqual([{ bucket: 'purchased', quantity: 1, amount_paid: 750, notes: 'Importado da planilha (comprado)' }])
    // reimportar com as mesmas chaves não cria nada
    expect(buildPayload(plan, keys)).toHaveLength(0)
  })
})
