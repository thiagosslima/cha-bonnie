import { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { friendlyError } from '../../lib/errors'
import { brl, qty } from '../../lib/format'
import { buildImportPlan, buildPayload, planStats, type ImportPlan, type PlannedItem } from '../../lib/layetteImport'
import { readWorkbook } from '../../lib/readWorkbook'
import { Button } from '../../components/ui'
import { Badge, ErrorBox, Panel, Stat, rpc } from './common'

type Filter = 'issues' | 'all' | 'duplicates' | 'ambiguous' | 'quantity' | 'create'

export default function ImportLayette() {
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [existing, setExisting] = useState<Set<string>>(new Set())
  const [fileName, setFileName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null)
  const [filter, setFilter] = useState<Filter>('issues')
  const [, force] = useState(0)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setErr(null)
    setResult(null)
    setBusy(true)
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Arquivo muito grande (máx. 10 MB).')
      const sheets = await readWorkbook(await file.arrayBuffer())
      const p = buildImportPlan(sheets)
      if (p.items.length === 0) throw new Error('Não encontramos itens nessa planilha.')
      const { data, error } = await supabase.from('layette_items').select('import_key').not('import_key', 'is', null)
      if (error) throw new Error(error.message)
      setExisting(new Set(data.map((d) => d.import_key as string)))
      setPlan(p)
      setFileName(file.name)
    } catch (e) {
      setErr(e instanceof Error && !e.message.match(/^[A-Z_]+$/) ? e.message : friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const stats = useMemo(() => (plan ? planStats(plan, existing) : null), [plan, existing, force]) // eslint-disable-line react-hooks/exhaustive-deps
  const update = (it: PlannedItem, patch: Partial<PlannedItem>) => {
    Object.assign(it, patch)
    force((n) => n + 1)
  }

  const commit = async () => {
    if (!plan) return
    const payload = buildPayload(plan, existing)
    if (!window.confirm(`Criar ${payload.length} itens no enxoval? Itens já importados não são alterados.`)) return
    setBusy(true)
    setErr(null)
    try {
      const r = await rpc<{ created: number; skipped: number }>('admin_import_layette', { p_items: payload })
      setResult(r)
      setPlan(null)
    } catch (e) {
      setErr(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const visible = (plan?.items ?? []).filter((i) => {
    if (filter === 'all') return true
    if (filter === 'duplicates') return !!i.duplicate_of
    if (filter === 'ambiguous') return i.acquisition_ambiguous
    if (filter === 'quantity') return i.issues.some((x) => x.kind === 'quantity' || x.kind === 'missing_quantity')
    if (filter === 'create') return i.decision === 'create' && !existing.has(i.import_key)
    return i.issues.length > 0
  })

  return (
    <div className="grid gap-5">
      <Panel title="Importar planilha do enxoval">
        <p className="mb-4 text-sm text-ink/80">
          Envie o arquivo <strong className="font-medium">Enxoval Bonnie e Mamãe.xlsx</strong>. Nada é gravado até você revisar e confirmar. A importação não apaga
          nem altera itens existentes: só cria os que ainda não foram importados.
        </p>
        <label className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full bg-primary-strong px-6 text-white">
          <input type="file" accept=".xlsx" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} disabled={busy} />
          {busy ? 'Lendo…' : 'Escolher arquivo .xlsx'}
        </label>
        {fileName && <span className="ml-3 text-sm text-ink/70">{fileName}</span>}
        {err && (
          <div className="mt-4">
            <ErrorBox>{err}</ErrorBox>
          </div>
        )}
        {result && (
          <div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900" role="status">
            Importação concluída: {result.created} itens criados{result.skipped ? `, ${result.skipped} já existiam` : ''}. Veja em Enxoval → “Precisam de revisão”.
          </div>
        )}
      </Panel>

      {plan && stats && (
        <>
          <Panel title="Revisão">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
              <Stat label="Encontrados" value={stats.found} />
              <Stat label="Serão criados" value={stats.toCreate} />
              <Stat label="Já importados" value={stats.alreadyImported} />
              <Stat label="Possíveis duplicados" value={stats.possibleDuplicates} hint={`${stats.linked} vinculados`} />
              <Stat label="Inconsistências" value={stats.inconsistencies} />
              <Stat label="Normalizar qtd." value={stats.needsNormalization} />
              <Stat label="Com preço" value={stats.withPrices} />
              <Stat label="Ganhei/Emprestado" value={stats.ambiguous} hint="confirmar" />
            </div>
            <p className="mt-3 text-xs text-ink/65">
              Abas ignoradas (não são listas de itens): {plan.ignoredSheets.join(', ')}. Resumo recontado linha a linha: {plan.spreadsheetSummary.items} itens, {plan.spreadsheetSummary.acquired}{' '}
              marcados como adquiridos (sem contar a aba Saúde).
            </p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {(
                [
                  ['issues', 'Com alertas'],
                  ['duplicates', 'Duplicados'],
                  ['ambiguous', 'Ganhei/Emprestado'],
                  ['quantity', 'Quantidades'],
                  ['create', 'Serão criados'],
                  ['all', 'Todos'],
                ] as [Filter, string][]
              ).map(([k, l]) => (
                <button key={k} onClick={() => setFilter(k)} className={`min-h-9 rounded-full px-3 text-sm ${filter === k ? 'bg-primary-strong text-white' : 'bg-ink/5'}`}>
                  {l}
                </button>
              ))}
            </div>
          </Panel>

          <Panel title={`Itens (${visible.length})`}>
            <ul className="divide-y divide-ink/10">
              {visible.map((it) => {
                const already = existing.has(it.import_key)
                return (
                  <li key={it.import_key} className="grid gap-2 py-3 text-sm md:grid-cols-[1fr_auto]">
                    <div>
                      <p className="font-normal">
                        {it.name} <span className="text-ink/60">· {it.sheet}{it.subcategory ? ` / ${it.subcategory}` : ''} · linha {it.row}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-ink/70">
                        Planilha: “{it.original_quantity_text ?? '—'}” → {qty(it.desired_quantity)} {it.unit} · comprado {qty(it.purchased)} · ganho {qty(it.received)}
                        {it.reference_price !== null && ` · ref. ${brl(it.reference_price)}`}
                        {it.amount_paid !== null && ` · pago ${brl(it.amount_paid)}`}
                        {!it.is_gift_eligible && ` · fora das sugestões (${it.eligibility_reason})`}
                      </p>
                      {it.issues.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-xs text-amber-800">
                          {it.issues.map((x, i) => (
                            <li key={i}>• {x.message}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="flex flex-wrap items-start gap-2">
                      {already ? (
                        <Badge tone="muted">já importado</Badge>
                      ) : (
                        <>
                          {it.desired_quantity !== null && it.quantity_range && (
                            <label className="flex items-center gap-1 text-xs">
                              Qtd.
                              <input
                                type="number"
                                min={1}
                                step="any"
                                className="w-16 rounded-lg border border-ink/20 px-2 py-1"
                                value={it.desired_quantity}
                                onChange={(e) => update(it, { desired_quantity: Number(e.target.value) || it.desired_quantity })}
                              />
                            </label>
                          )}
                          {it.acquisition_ambiguous && (
                            <select className="rounded-lg border border-ink/20 px-2 py-1 text-xs" value={it.acquisition} onChange={(e) => update(it, { acquisition: e.target.value as PlannedItem['acquisition'] })} aria-label="Ganhei ou emprestado">
                              <option value="received">Ganhei</option>
                              <option value="borrowed">Emprestado</option>
                            </select>
                          )}
                          {it.duplicate_of ? (
                            <select className="rounded-lg border border-ink/20 px-2 py-1 text-xs" value={it.decision} onChange={(e) => update(it, { decision: e.target.value as PlannedItem['decision'] })} aria-label="Decisão">
                              <option value="link">Vincular a “{it.duplicate_of.name}”</option>
                              <option value="create">Criar separado</option>
                              <option value="skip">Não importar</option>
                            </select>
                          ) : (
                            <label className="flex items-center gap-1 text-xs">
                              <input type="checkbox" checked={it.decision === 'create'} onChange={(e) => update(it, { decision: e.target.checked ? 'create' : 'skip' })} /> importar
                            </label>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </Panel>

          <div className="sticky bottom-3 z-10 flex justify-end">
            <Button loading={busy} onClick={commit} disabled={stats.toCreate === 0} className="shadow-xl">
              Confirmar importação ({stats.toCreate} itens)
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
