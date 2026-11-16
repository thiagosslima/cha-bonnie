/**
 * Importação da planilha "Enxoval Bonnie e Mamãe.xlsx".
 *
 * Função pura: recebe as abas já lidas (linhas de células primitivas) e devolve
 * um plano de importação para revisão administrativa. Nada é gravado aqui.
 */

export type Cell = string | number | boolean | Date | null
export interface SheetData {
  name: string
  rows: Cell[][]
}

export type Bucket = 'purchased' | 'received' | 'borrowed'
export type Priority = 'alta' | 'media' | 'baixa'

export interface ImportMovement {
  bucket: Bucket
  quantity: number
  amount_paid?: number | null
  notes?: string
}

export interface ImportIssue {
  kind: 'quantity' | 'inconsistency' | 'ambiguous_acquisition' | 'duplicate' | 'missing_quantity'
  message: string
}

export interface DuplicateCandidate {
  key: string
  name: string
  sheet: string
  score: number
}

export interface PlannedItem {
  import_key: string
  sheet: string
  row: number
  category: string
  subcategory: string | null
  name: string
  original_quantity_text: string | null
  desired_quantity: number | null
  quantity_range: [number, number] | null
  unit: string
  original_status: string | null
  purchased: number
  received: number
  /** Para "Ganhei/Emprestado": como registrar a quantidade recebida. */
  acquisition: 'received' | 'borrowed'
  acquisition_ambiguous: boolean
  amount_paid: number | null
  reference_price: number | null
  estimated_unit_price: number | null
  reference_url: string | null
  notes: string | null
  priority: Priority
  priority_reason: string | null
  is_gift_eligible: boolean
  eligibility_reason: string | null
  issues: ImportIssue[]
  duplicate_of: DuplicateCandidate | null
  /** link = não cria item, apenas marca o item principal como "também na lista X". */
  decision: 'create' | 'link' | 'skip'
  sort_order: number
}

export interface SpreadsheetSummary {
  items: number
  acquired: number
}

export interface ImportPlan {
  items: PlannedItem[]
  spreadsheetSummary: SpreadsheetSummary
  ignoredSheets: string[]
}

// ---------------------------------------------------------------------------
// utilidades
// ---------------------------------------------------------------------------
export function norm(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function str(v: Cell): string | null {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  return s === '' ? null : s
}

function num(v: Cell): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const s = str(v)
  if (!s || s === '-') return 0
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function money(v: Cell): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v * 100) / 100
  const s = str(v)
  if (!s) return null
  const n = Number(s.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

const UNIT_MAP: Record<string, string> = {
  pacote: 'pacote', pacotes: 'pacote', 'pacote pequeno': 'pacote', 'pacotes pequenos': 'pacote',
  caixa: 'caixa', caixas: 'caixa', kit: 'kit', kits: 'kit', troca: 'troca', trocas: 'troca',
  peca: 'peça', pecas: 'peça', par: 'par', pares: 'par', unidade: 'unidade', unidades: 'unidade',
}

export interface ParsedQuantity {
  quantity: number | null
  range: [number, number] | null
  unit: string
  unitNote: string | null
  text: string | null
}

export function parseQuantity(v: Cell): ParsedQuantity {
  if (typeof v === 'number') {
    return { quantity: v > 0 ? v : null, range: null, unit: 'unidade', unitNote: null, text: String(v) }
  }
  const text = str(v)
  if (!text || text === '-') return { quantity: null, range: null, unit: 'unidade', unitNote: null, text }
  const n = (s: string) => Number(s.replace(',', '.'))
  const unitOf = (rest: string) => {
    const r = norm(rest)
    if (!r) return { unit: 'unidade', note: null as string | null }
    if (UNIT_MAP[r]) return { unit: UNIT_MAP[r], note: r.includes('pequeno') ? rest.trim() : null }
    const first = r.split(' ')[0]
    if (UNIT_MAP[first]) return { unit: UNIT_MAP[first], note: rest.trim() }
    return { unit: rest.trim().slice(0, 30), note: null }
  }
  const range = text.match(/^(\d+(?:[.,]\d+)?)\s*(?:a|-|até|ou)\s*(\d+(?:[.,]\d+)?)\s*(.*)$/i)
  if (range) {
    const lo = n(range[1])
    const hi = n(range[2])
    const u = unitOf(range[3])
    return { quantity: lo > 0 ? lo : null, range: [lo, hi], unit: u.unit, unitNote: u.note, text }
  }
  const single = text.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/)
  if (single) {
    const q = n(single[1])
    const u = unitOf(single[2])
    return { quantity: q > 0 ? q : null, range: null, unit: u.unit, unitNote: u.note, text }
  }
  return { quantity: null, range: null, unit: 'unidade', unitNote: null, text }
}

const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'para', 'com', 'a', 'o', 'em', 'p', 'se', 'ou', 'tipo'])
function tokens(name: string): string[] {
  return norm(name.replace(/[()]/g, ' '))
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(' ')
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t))
}

function similarity(a: string, b: string): number {
  const ta = new Set(tokens(a))
  const tb = new Set(tokens(b))
  if (!ta.size || !tb.size) return 0
  let inter = 0
  ta.forEach((t) => tb.has(t) && inter++)
  const jaccard = inter / (ta.size + tb.size - inter)
  const containment = inter / Math.min(ta.size, tb.size)
  return Math.max(jaccard, containment * 0.85)
}

// ---------------------------------------------------------------------------
// regras padrão (todas revisáveis no painel)
// ---------------------------------------------------------------------------
function eligibility(sheet: string, sub: string | null, name: string, desired: number | null): [boolean, string | null] {
  const s = norm(sheet)
  const sb = norm(sub)
  const n = norm(name)
  if (desired === null) return [false, 'Sem quantidade definida']
  if (/^fraldas? (rn|p|m|g|xg)\b/.test(n)) return [false, 'Fraldas já entram pela confirmação de presença']
  if (s.includes('saude')) return [false, 'Medicamento: melhor seguir orientação do pediatra']
  if (s.includes('pos-parto') || s.includes('pos parto')) return [false, 'Item pessoal da mamãe']
  if (s.includes('mala')) {
    if (sb.includes('documento') || sb.includes('acompanhante')) return [false, 'Item pessoal da mala']
    if (sb.includes('mamae')) return [false, 'Item pessoal da mamãe']
  }
  if (/tinta|parede/.test(n)) return [false, 'Item da reforma do quarto']
  return [true, null]
}

function priorityFor(sub: string | null, name: string, notes: string | null): [Priority, string | null] {
  const all = norm(`${sub ?? ''} ${name} ${notes ?? ''}`)
  if (/opcional|talvez|guardar para depois|uso futuro|apos 6 meses/.test(all)) return ['baixa', 'Marcado como opcional/uso futuro na planilha']
  return ['media', null]
}

// ---------------------------------------------------------------------------
// leitura das abas
// ---------------------------------------------------------------------------
const HEADER_ALIASES: Record<string, string> = {
  categoria: 'category', item: 'item', 'qtd. sugerida': 'qty', comprado: 'status',
  'qtd. comprei': 'bought', 'qtd. ganhei': 'got', 'onde comprar': 'where',
  'ultima data vista': 'seen', 'preco p/comparacao': 'refprice', 'valor (r$)': 'paid', observacoes: 'notes',
}

export function isIgnoredSheet(name: string): boolean {
  const n = norm(name)
  return n.includes('resumo') || n.includes('planejamento')
}

function isUrl(s: string | null): boolean {
  return !!s && /^https?:\/\//i.test(s)
}

export function buildImportPlan(sheets: SheetData[]): ImportPlan {
  const items: PlannedItem[] = []
  const ignoredSheets: string[] = []
  let sort = 0
  const summary: SpreadsheetSummary = { items: 0, acquired: 0 }

  for (const sheet of sheets) {
    if (isIgnoredSheet(sheet.name)) {
      ignoredSheets.push(sheet.name)
      continue
    }
    const headerIdx = sheet.rows.findIndex((r) => r.some((c) => norm(c) === 'item'))
    if (headerIdx < 0) {
      ignoredSheets.push(sheet.name)
      continue
    }
    const col: Record<string, number> = {}
    sheet.rows[headerIdx].forEach((c, i) => {
      const key = HEADER_ALIASES[norm(c)]
      if (key && col[key] === undefined) col[key] = i
    })
    const get = (r: Cell[], k: string): Cell => (col[k] === undefined ? null : (r[col[k]] ?? null))
    const isHealth = norm(sheet.name).includes('saude')
    let sub: string | null = null
    const seen = new Map<string, number>()

    for (let ri = headerIdx + 1; ri < sheet.rows.length; ri++) {
      const r = sheet.rows[ri]
      const cat = str(get(r, 'category'))
      const name = str(get(r, 'item'))
      if (!name) {
        if (cat) sub = cat
        continue
      }
      if (norm(name).startsWith('total')) continue

      const status = str(get(r, 'status'))
      if (!isHealth) {
        summary.items++
        if (status === 'Sim' || norm(status) === 'ganhei/emprestado') summary.acquired++
      }

      const q = parseQuantity(get(r, 'qty'))
      const issues: ImportIssue[] = []
      if (q.range) issues.push({ kind: 'quantity', message: `Intervalo "${q.text}": proposta inicial ${q.quantity} ${q.unit}. Revise.` })
      if (q.quantity === null)
        issues.push({ kind: 'missing_quantity', message: q.text ? `Quantidade "${q.text}" não é numérica.` : 'Sem quantidade sugerida na planilha.' })
      if (q.unitNote) issues.push({ kind: 'quantity', message: `Unidade normalizada para "${q.unit}" (original: "${q.unitNote}").` })

      let purchased = num(get(r, 'bought'))
      let received = num(get(r, 'got'))
      const st = norm(status)
      const ambiguous = st === 'ganhei/emprestado'
      if (st === 'sim' && purchased === 0 && received === 0) {
        purchased = q.quantity ?? 1
        issues.push({ kind: 'inconsistency', message: `Marcado "Sim" sem quantidade comprada: assumido ${purchased} ${q.unit}.` })
      }
      if (ambiguous && purchased === 0 && received === 0) {
        received = q.quantity ?? 1
        issues.push({ kind: 'inconsistency', message: `Marcado "Ganhei/Emprestado" sem quantidade: assumido ${received} ${q.unit}.` })
      }
      if ((st === 'nao' || st === '') && purchased + received > 0) {
        issues.push({ kind: 'inconsistency', message: `Status "${status ?? 'vazio'}", mas há quantidades registradas (comprei ${purchased}, ganhei ${received}). As quantidades foram mantidas.` })
      }
      if (ambiguous) issues.push({ kind: 'ambiguous_acquisition', message: 'A planilha diz "Ganhei/Emprestado". Confirme se foi presente ou empréstimo.' })

      const where = str(get(r, 'where'))
      const seenDate = get(r, 'seen')
      const refPrice = money(get(r, 'refprice'))
      const paidCell = money(get(r, isHealth ? 'paid' : 'paid'))
      const rawNotes = str(get(r, 'notes'))
      const noteParts = [rawNotes]
      if (where && !isUrl(where)) noteParts.push(`Onde comprar: ${where}`)
      if (refPrice && seenDate) noteParts.push(`Preço de referência visto em ${seenDate instanceof Date ? seenDate.toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : str(seenDate)}`)
      if (paidCell && purchased === 0) noteParts.push(`Valor registrado na planilha: R$ ${paidCell.toFixed(2).replace('.', ',')}`)
      const notes = noteParts.filter(Boolean).join(' · ') || null

      const [eligible, eligibilityReason] = eligibility(sheet.name, sub, name, q.quantity)
      const [priority, priorityReason] = priorityFor(sub, name, rawNotes)

      const baseKey = norm(`${sheet.name}|${sub ?? ''}|${name}`)
      const occ = (seen.get(baseKey) ?? 0) + 1
      seen.set(baseKey, occ)

      items.push({
        import_key: occ > 1 ? `${baseKey}#${occ}` : baseKey,
        sheet: sheet.name,
        row: ri + 1,
        category: sheet.name,
        subcategory: sub,
        name,
        original_quantity_text: q.text,
        desired_quantity: q.quantity,
        quantity_range: q.range,
        unit: q.unit,
        original_status: status,
        purchased,
        received,
        acquisition: 'received',
        acquisition_ambiguous: ambiguous,
        amount_paid: purchased > 0 ? paidCell : null,
        reference_price: refPrice,
        estimated_unit_price: refPrice,
        reference_url: isUrl(where) ? where : null,
        notes,
        priority,
        priority_reason: priorityReason,
        is_gift_eligible: eligible,
        eligibility_reason: eligibilityReason,
        issues,
        duplicate_of: null,
        decision: 'create',
        sort_order: ++sort,
      })
    }
  }

  detectDuplicates(items)
  return { items, spreadsheetSummary: summary, ignoredSheets }
}

function audience(it: PlannedItem): 'bebe' | 'mamae' | null {
  const s = norm(`${it.sheet} ${it.subcategory ?? ''}`)
  if (s.includes('mamae')) return 'mamae'
  if (s.includes('bebe')) return 'bebe'
  return null
}

/**
 * Itens da Mala Maternidade costumam repetir itens das outras listas. Quando
 * há correspondência forte com o mesmo público (bebê/mamãe), o padrão é
 * vincular (não criar outro item). Repetições exatas na mesma aba e
 * subcategoria também são sinalizadas.
 */
function detectDuplicates(items: PlannedItem[]) {
  const main = items.filter((i) => !norm(i.sheet).includes('mala'))
  for (const it of items) {
    // duplicata exata dentro da mesma aba/subcategoria
    if (it.import_key.includes('#')) {
      const first = items.find((o) => o.import_key === it.import_key.split('#')[0])
      if (first) {
        it.duplicate_of = { key: first.import_key, name: first.name, sheet: first.sheet, score: 1 }
        it.issues.push({ kind: 'duplicate', message: `Repetido na mesma lista (linha ${first.row}).` })
        it.decision = 'skip'
      }
      continue
    }
    if (!norm(it.sheet).includes('mala')) continue
    const aud = audience(it)
    let best: DuplicateCandidate | null = null
    let bestSameAudience = false
    for (const m of main) {
      let score = similarity(it.name, m.name)
      const same = aud !== null && audience(m) === aud
      if (same) score += 0.1
      if (score > (best?.score ?? 0)) {
        best = { key: m.import_key, name: m.name, sheet: m.sheet, score: Math.round(score * 100) / 100 }
        bestSameAudience = same
      }
    }
    if (best && best.score >= 0.6) {
      it.duplicate_of = best
      const strong = best.score >= 0.75 && bestSameAudience
      it.decision = strong ? 'link' : 'create'
      it.issues.push({
        kind: 'duplicate',
        message: strong
          ? `Parece ser o mesmo item de "${best.name}" (${best.sheet}). Por padrão será vinculado, sem contar duas vezes.`
          : `Pode corresponder a "${best.name}" (${best.sheet}). Por padrão será criado separado.`,
      })
      if (strong && (it.purchased > 0 || it.received > 0)) {
        it.issues.push({ kind: 'inconsistency', message: 'As quantidades desta linha da mala não serão somadas ao item vinculado, para evitar contagem dupla.' })
      }
    }
  }
}

// ---------------------------------------------------------------------------
// payload para a função admin_import_layette
// ---------------------------------------------------------------------------
export interface ImportPayloadItem {
  import_key: string
  category: string
  subcategory: string | null
  name: string
  original_quantity_text: string | null
  desired_quantity: number | null
  unit: string
  estimated_unit_price: number | null
  reference_price: number | null
  priority: Priority
  is_gift_eligible: boolean
  reference_url: string | null
  notes: string | null
  also_in_lists: string[]
  needs_review: boolean
  review_notes: string | null
  sort_order: number
  movements: ImportMovement[]
}

export function buildPayload(plan: ImportPlan, existingKeys: Set<string> = new Set()): ImportPayloadItem[] {
  const linked = new Map<string, string[]>()
  for (const it of plan.items) {
    if (it.decision === 'link' && it.duplicate_of) {
      const arr = linked.get(it.duplicate_of.key) ?? []
      if (!arr.includes(it.sheet)) arr.push(it.sheet)
      linked.set(it.duplicate_of.key, arr)
    }
  }
  return plan.items
    .filter((it) => it.decision === 'create' && !existingKeys.has(it.import_key))
    .map((it) => {
      const movements: ImportMovement[] = []
      if (it.purchased > 0)
        movements.push({ bucket: 'purchased', quantity: it.purchased, amount_paid: it.amount_paid, notes: 'Importado da planilha (comprado)' })
      if (it.received > 0)
        movements.push({
          bucket: it.acquisition === 'borrowed' ? 'borrowed' : 'received',
          quantity: it.received,
          notes: it.acquisition === 'borrowed' ? 'Importado da planilha (emprestado)' : 'Importado da planilha (ganhei)',
        })
      const review = it.issues.filter((i) => i.kind === 'quantity' || i.kind === 'missing_quantity' || i.kind === 'inconsistency')
      return {
        import_key: it.import_key,
        category: it.category,
        subcategory: it.subcategory,
        name: it.name,
        original_quantity_text: it.original_quantity_text,
        desired_quantity: it.desired_quantity,
        unit: it.unit,
        estimated_unit_price: it.estimated_unit_price,
        reference_price: it.reference_price,
        priority: it.priority,
        is_gift_eligible: it.is_gift_eligible,
        reference_url: it.reference_url,
        notes: it.notes,
        also_in_lists: linked.get(it.import_key) ?? [],
        needs_review: review.length > 0,
        review_notes: review.map((i) => i.message).join(' ') || null,
        sort_order: it.sort_order,
        movements,
      }
    })
}

export interface PlanStats {
  found: number
  toCreate: number
  linked: number
  skipped: number
  alreadyImported: number
  possibleDuplicates: number
  inconsistencies: number
  needsNormalization: number
  withPrices: number
  ambiguous: number
  giftEligible: number
}

export function planStats(plan: ImportPlan, existingKeys: Set<string> = new Set()): PlanStats {
  const its = plan.items
  return {
    found: its.length,
    toCreate: its.filter((i) => i.decision === 'create' && !existingKeys.has(i.import_key)).length,
    linked: its.filter((i) => i.decision === 'link').length,
    skipped: its.filter((i) => i.decision === 'skip').length,
    alreadyImported: its.filter((i) => existingKeys.has(i.import_key)).length,
    possibleDuplicates: its.filter((i) => i.duplicate_of).length,
    inconsistencies: its.filter((i) => i.issues.some((x) => x.kind === 'inconsistency')).length,
    needsNormalization: its.filter((i) => i.issues.some((x) => x.kind === 'quantity' || x.kind === 'missing_quantity')).length,
    withPrices: its.filter((i) => i.reference_price !== null || i.amount_paid !== null).length,
    ambiguous: its.filter((i) => i.acquisition_ambiguous).length,
    giftEligible: its.filter((i) => i.decision === 'create' && i.is_gift_eligible).length,
  }
}
