import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { friendlyError } from '../../lib/errors'
import { brl, qty } from '../../lib/format'
import { Button } from '../../components/ui'
import { Badge, ErrorBox, Field, Loading, Modal, PRIORITY_LABEL, Panel, TIER_LABEL, Toast, fetchItems, inputCls, rpc, useLoad, type ItemRow } from './common'

interface Suggestion {
  slot: number
  item_id: string
  name: string
  description: string | null
  category: string
  subcategory: string | null
  image_url: string | null
  price_tier: 'barato' | 'medio' | 'caro' | null
  estimated_unit_price: number | null
  pending_quantity: number
  unit: string
  priority: 'alta' | 'media' | 'baixa'
  pinned: boolean
  reason: string
}
interface Settings {
  cheap_max_price: number
  medium_max_price: number
  recommendation_count: number
  show_tier_to_guests: boolean
  include_unpriced_fallback: boolean
}
const SLOT_TIER = ['barato', 'medio', 'caro'] as const
const GUEST_TIER = { barato: 'Mimo simples', medio: 'Mimo médio', caro: 'Mimo especial' }

export default function Suggestions() {
  const { data, error, loading, reload } = useLoad(async () => {
    const [sugs, items, settings] = await Promise.all([
      rpc<Suggestion[]>('admin_gift_suggestions', { p_random: true }),
      fetchItems(),
      supabase.from('gift_recommendation_settings').select('*').eq('id', 1).single(),
    ])
    if (settings.error) throw new Error(settings.error.message)
    return { sugs, items, settings: settings.data as Settings }
  })
  const [replacing, setReplacing] = useState<number | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  if (loading && !data) return <Loading />
  if (error) return <ErrorBox>{error}</ErrorBox>
  if (!data) return null
  const { sugs, items, settings } = data
  const candidates = items.filter((i) => i.is_gift_eligible && !i.is_discarded && (i.pending_quantity ?? 0) > 0)
  const pool = (t: ItemRow['price_tier']) => candidates.filter((i) => i.price_tier === t).length

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setErr(null)
    try {
      await fn()
      setToast(msg)
      reload()
    } catch (e) {
      setErr(friendlyError(e))
    }
  }
  const pin = (slot: number, id: string | null) => act(() => rpc('admin_set_gift_pin', { p_slot: slot, p_item_id: id }), id ? 'Sugestão fixada' : 'Fixação removida')
  const exclude = (id: string) =>
    act(async () => {
      const { error } = await supabase.from('layette_items').update({ is_gift_eligible: false }).eq('id', id).select('id')
      if (error) throw new Error(error.message)
    }, 'Item retirado das sugestões')

  return (
    <div className="grid gap-5">
      <Panel
        title="Sugestões do convite (exemplo de sorteio)"
        actions={
          <Button variant="outline" className="min-h-10 text-sm" loading={loading} onClick={reload}>
            Sortear de novo
          </Button>
        }
      >
        <p className="mb-2 text-sm text-ink/75">
          A cada visita, o convite sorteia uma sugestão barata, uma média e uma cara entre os itens elegíveis (prioridade alta tem mais chance).
          Posições fixadas não entram no sorteio. Itens completos, descartados ou fora das sugestões saem automaticamente. Nada é reservado por
          aparecer aqui.
        </p>
        <p className="mb-4 text-sm text-ink/75">
          {candidates.length} itens elegíveis: {pool('barato')} baratos · {pool('medio')} médios · {pool('caro')} caros · {pool(null)} sem preço.
        </p>
        {err && (
          <div className="mb-3">
            <ErrorBox>{err}</ErrorBox>
          </div>
        )}
        {sugs.length === 0 && <p className="text-sm">Nenhum item elegível agora: o convite não mostra a seção de sugestões.</p>}
        <div className="grid gap-4 lg:grid-cols-3">
          {sugs.map((s) => (
            <article key={s.slot} className="flex flex-col rounded-2xl border border-ink/10 p-4">
              <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
                <Badge>Posição {s.slot}: {TIER_LABEL[SLOT_TIER[(s.slot - 1) % 3]]}</Badge>
                {s.pinned && <Badge tone="primary">📌 fixada</Badge>}
              </div>
              <h3 className="font-medium">{s.name}</h3>
              <p className="text-sm text-ink/70">{s.subcategory ?? s.category}</p>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <dt className="text-ink/60">Faixa</dt>
                <dd>{s.price_tier ? `${TIER_LABEL[s.price_tier]} (${brl(s.estimated_unit_price)})` : 'Sem preço cadastrado'}</dd>
                <dt className="text-ink/60">Pendente</dt>
                <dd>
                  {qty(s.pending_quantity)} {s.unit}
                </dd>
                <dt className="text-ink/60">Prioridade</dt>
                <dd>{PRIORITY_LABEL[s.priority]}</dd>
              </dl>
              <p className="mt-3 rounded-xl bg-soft p-2.5 text-xs leading-relaxed">
                <strong className="font-medium">Por quê:</strong> {s.reason}
              </p>
              <div className="mt-auto flex flex-wrap gap-1.5 pt-4">
                {s.pinned ? (
                  <Button variant="outline" className="min-h-9 px-3 text-xs" onClick={() => pin(s.slot, null)}>
                    Desafixar
                  </Button>
                ) : (
                  <Button variant="outline" className="min-h-9 px-3 text-xs" onClick={() => pin(s.slot, s.item_id)}>
                    Fixar
                  </Button>
                )}
                <Button variant="outline" className="min-h-9 px-3 text-xs" onClick={() => setReplacing(s.slot)}>
                  Substituir
                </Button>
                <Button variant="ghost" className="min-h-9 px-3 text-xs" onClick={() => exclude(s.item_id)}>
                  Excluir das sugestões
                </Button>
              </div>
            </article>
          ))}
        </div>
      </Panel>

      <Panel title="Prévia como o convidado vê">
        <div className="mx-auto max-w-md">
          <ul className="grid gap-3">
            {sugs.map((g, i) => (
              <li key={g.slot} className="flex items-center gap-4 rounded-2xl border border-primary-100 bg-white p-3">
                <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-soft">
                  <img src={g.image_url ?? `/img/flores/${['f00', 'f03', 'f02'][i % 3]}.png`} alt="" className={g.image_url ? 'h-full w-full object-cover' : 'h-11 w-11 object-contain'} />
                </div>
                <div>
                  <p className="font-normal">{g.name}</p>
                  {(g.description ?? (/roupa/i.test(g.category) ? g.subcategory : null)) && <p className="text-sm text-ink/75">{g.description ?? g.subcategory}</p>}
                  {g.price_tier && settings.show_tier_to_guests && (
                    <span className="mt-1 inline-block rounded-full bg-primary-50 px-2.5 py-0.5 text-xs text-primary-strong">{GUEST_TIER[g.price_tier]}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Panel>

      <SettingsPanel settings={settings} onSaved={() => (setToast('Configurações salvas'), reload())} />

      <ReplaceModal
        slot={replacing}
        candidates={candidates}
        current={sugs.map((s) => s.item_id)}
        onClose={() => setReplacing(null)}
        onPick={(id) => {
          const slot = replacing!
          setReplacing(null)
          pin(slot, id)
        }}
      />
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}

function ReplaceModal({ slot, candidates, current, onClose, onPick }: { slot: number | null; candidates: ItemRow[]; current: string[]; onClose: () => void; onPick: (id: string) => void }) {
  const [q, setQ] = useState('')
  const tier = slot ? SLOT_TIER[(slot - 1) % 3] : null
  const list = candidates
    .filter((c) => !current.includes(c.id) && c.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.price_tier === tier) - Number(a.price_tier === tier) || a.name.localeCompare(b.name))
  return (
    <Modal open={slot !== null} title={`Substituir posição ${slot} (${tier ? TIER_LABEL[tier] : ''})`} onClose={onClose}>
      <input className={`${inputCls} mb-3`} placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar item" />
      <p className="mb-2 text-xs text-ink/65">O item escolhido fica fixado nesta posição até ficar completo ou ser desafixado.</p>
      <ul className="max-h-[50dvh] divide-y divide-ink/10 overflow-y-auto">
        {list.map((c) => (
          <li key={c.id}>
            <button className="flex w-full items-center justify-between gap-3 px-1 py-2.5 text-left text-sm hover:bg-primary-50" onClick={() => onPick(c.id)}>
              <span>
                {c.name} <span className="text-ink/60">· {c.subcategory ?? c.category}</span>
              </span>
              <span className="shrink-0 text-xs">{c.price_tier ? `${TIER_LABEL[c.price_tier]} · ${brl(c.estimated_unit_price)}` : 'sem preço'}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  )
}

function SettingsPanel({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const [s, setS] = useState(() => ({ ...settings, cheap_max_price: String(settings.cheap_max_price), medium_max_price: String(settings.medium_max_price) }))
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    setErr(null)
    const { error } = await supabase
      .from('gift_recommendation_settings')
      .update({
        cheap_max_price: Number(s.cheap_max_price.replace(',', '.')),
        medium_max_price: Number(s.medium_max_price.replace(',', '.')),
        recommendation_count: Number(s.recommendation_count),
        show_tier_to_guests: s.show_tier_to_guests,
        include_unpriced_fallback: s.include_unpriced_fallback,
      })
      .eq('id', 1)
      .select('id')
    setSaving(false)
    if (error) return setErr(error.message.includes('price_order') ? 'O limite médio precisa ser maior que o barato.' : friendlyError(error))
    onSaved()
  }
  return (
    <Panel title="Faixas de preço e regras">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Barato: até (R$)">
          <input className={inputCls} inputMode="decimal" value={s.cheap_max_price} onChange={(e) => setS({ ...s, cheap_max_price: e.target.value })} />
        </Field>
        <Field label="Médio: até (R$)" hint="Acima disso é caro.">
          <input className={inputCls} inputMode="decimal" value={s.medium_max_price} onChange={(e) => setS({ ...s, medium_max_price: e.target.value })} />
        </Field>
        <Field label="Quantidade de sugestões">
          <select className={inputCls} value={s.recommendation_count} onChange={(e) => setS({ ...s, recommendation_count: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-3 space-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={s.show_tier_to_guests} onChange={(e) => setS({ ...s, show_tier_to_guests: e.target.checked })} /> Mostrar a faixa (“Mimo simples/médio/especial”) aos convidados
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={s.include_unpriced_fallback} onChange={(e) => setS({ ...s, include_unpriced_fallback: e.target.checked })} /> Quando faltar item numa faixa, usar itens ainda sem preço cadastrado
        </label>
      </div>
      <p className="mt-3 text-xs text-ink/65">A faixa considera o preço unitário do item (uma toalha, não as cinco). Cadastre preços em Enxoval → item.</p>
      {err && (
        <div className="mt-3">
          <ErrorBox>{err}</ErrorBox>
        </div>
      )}
      <Button className="mt-4 min-h-10 text-sm" loading={saving} onClick={save}>
        Salvar
      </Button>
    </Panel>
  )
}
