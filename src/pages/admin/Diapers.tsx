import { useState } from 'react'
import { friendlyError } from '../../lib/errors'
import { DIAPER_SIZES } from '../../lib/types'
import { Button } from '../../components/ui'
import { ErrorBox, Loading, Panel, Stat, TargetBars, Toast, inputCls, rpc, useLoad } from './common'

interface SizeStat {
  diaper_size: string
  target_percentage: number
  chosen: number
  current_percentage: number
  is_recommended: boolean
}
interface EventStat {
  event_id: string
  slug: string
  city: string
  theme_primary: string
  sizes: SizeStat[]
}

export default function Diapers() {
  const { data, error, loading, reload } = useLoad(() => rpc<EventStat[]>('admin_diaper_stats'))
  const [toast, setToast] = useState<string | null>(null)
  if (loading && !data) return <Loading />
  if (error) return <ErrorBox>{error}</ErrorBox>
  if (!data) return null

  const total = (e: EventStat) => e.sizes.reduce((s, x) => s + x.chosen, 0)
  const all = DIAPER_SIZES.map((size) => {
    const chosen = data.reduce((s, e) => s + (e.sizes.find((x) => x.diaper_size === size)?.chosen ?? 0), 0)
    return { size, chosen }
  })
  const grand = all.reduce((s, x) => s + x.chosen, 0)

  return (
    <div className="grid gap-5">
      <Panel title="Consolidado (as duas cidades)">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          <Stat label="Total" value={grand} hint="escolhas de confirmados" />
          {all.map((a) => (
            <Stat key={a.size} label={a.size} value={a.chosen} hint={grand ? `${Math.round((a.chosen / grand) * 1000) / 10}%` : '—'} />
          ))}
        </div>
        <p className="mt-3 text-xs text-ink/65">
          Cada confirmação conta como uma escolha de tamanho (não como número de pacotes). Só respostas “Confirmado” entram na conta.
        </p>
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">
        {data.map((e) => (
          <Panel key={e.event_id} title={`${e.city} · ${total(e)} escolhas`}>
            <TargetBars
              color={e.theme_primary}
              rows={e.sizes.map((s) => ({ label: s.diaper_size, value: s.chosen, pct: Number(s.current_percentage), target: Number(s.target_percentage), highlight: s.is_recommended }))}
            />
            <Targets
              event={e}
              onSaved={() => {
                setToast(`Metas de ${e.city} salvas`)
                reload()
              }}
            />
          </Panel>
        ))}
      </div>
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}

function Targets({ event, onSaved }: { event: EventStat; onSaved: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(event.sizes.map((s) => [s.diaper_size, String(Number(s.target_percentage))])))
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const sum = Object.values(vals).reduce((s, v) => s + (Number(v.replace(',', '.')) || 0), 0)
  const save = async () => {
    setSaving(true)
    setErr(null)
    try {
      await rpc('admin_set_diaper_targets', {
        p_event_id: event.event_id,
        p_targets: Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, Number(v.replace(',', '.')) || 0])),
      })
      onSaved()
    } catch (e) {
      setErr(friendlyError(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <details className="mt-5 rounded-2xl bg-soft p-4">
      <summary className="cursor-pointer text-sm font-normal">Ajustar metas (%)</summary>
      <div className="mt-3 grid grid-cols-5 gap-2">
        {DIAPER_SIZES.map((s) => (
          <label key={s} className="text-center text-sm">
            <span className="mb-1 block font-medium">{s}</span>
            <input className={`${inputCls} text-center`} inputMode="decimal" value={vals[s] ?? '0'} onChange={(e) => setVals({ ...vals, [s]: e.target.value })} aria-label={`Meta ${s} em %`} />
          </label>
        ))}
      </div>
      <p className={`mt-2 text-sm ${Math.abs(sum - 100) > 0.01 ? 'text-red-700' : 'text-ink/70'}`}>Soma: {Math.round(sum * 100) / 100}% (precisa ser 100%)</p>
      {err && (
        <div className="mt-2">
          <ErrorBox>{err}</ErrorBox>
        </div>
      )}
      <Button className="mt-3 min-h-10 text-sm" loading={saving} disabled={Math.abs(sum - 100) > 0.01} onClick={save}>
        Salvar metas
      </Button>
    </details>
  )
}
