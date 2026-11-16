import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { friendlyError } from '../../lib/errors'
import { newRequestId } from '../../lib/storage'
import { brl, dateTime, qty } from '../../lib/format'
import { Button } from '../../components/ui'
import {
  Badge, ErrorBox, Field, Loading, Modal, PRIORITY_LABEL, Panel, STATUS_LABEL, Stat, TIER_LABEL, Toast, fetchItems, inputCls, layetteSummary, rpc, useLoad,
  type ItemRow,
} from './common'

type Action = { kind: 'purchase' | 'gift' | 'correct' | 'discard' | 'restore'; item: ItemRow }

export default function Layette() {
  const { data: items, error, loading, reload } = useLoad(fetchItems)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [status, setStatus] = useState('pendentes')
  const [action, setAction] = useState<Action | null>(null)
  const [detail, setDetail] = useState<ItemRow | 'new' | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const categories = useMemo(() => [...new Set((items ?? []).map((i) => i.category))], [items])
  const filtered = useMemo(() => {
    const nq = q.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    return (items ?? []).filter((i) => {
      if (cat && i.category !== cat) return false
      if (nq && !`${i.name} ${i.subcategory ?? ''}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(nq)) return false
      if (status === 'pendentes') return i.status === 'nao_adquirido' || i.status === 'parcial'
      if (status === 'revisar') return i.needs_review
      if (status === 'presente') return i.is_gift_eligible && !i.is_discarded && i.status !== 'completo'
      return !status || i.status === status
    })
  }, [items, q, cat, status])

  if (loading && !items) return <Loading />
  if (error) return <ErrorBox>{error}</ErrorBox>
  if (!items) return null
  const s = layetteSummary(items)
  const done = (msg: string) => {
    setAction(null)
    setDetail(null)
    setToast(msg)
    reload()
  }

  if (items.length === 0)
    return (
      <Panel title="Enxoval da Bonnie">
        <p>
          Ainda não há itens. <Link className="text-primary-strong underline" to="/admin/importar">Importe a planilha</Link> ou{' '}
          <button className="text-primary-strong underline" onClick={() => setDetail('new')}>cadastre um item</button>.
        </p>
        <ItemModal item={detail} onClose={() => setDetail(null)} onSaved={done} categories={categories} />
      </Panel>
    )

  const grouped = categories.map((c) => [c, filtered.filter((i) => i.category === c)] as const).filter(([, l]) => l.length)

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Itens" value={s.total} />
        <Stat label="Completos" value={s.complete} />
        <Stat label="Parciais" value={s.partial} />
        <Stat label="Pendentes" value={s.pending} />
        <Stat label="Descartados" value={s.discarded} />
        <Stat label="Conclusão" value={`${s.pct}%`} hint="completos / itens ativos" />
        <Stat label="Restante estimado" value={brl(s.remaining)} hint={`${s.unpricedPending} sem preço`} />
      </div>

      <Panel
        title="Enxoval da Bonnie"
        actions={
          <Button variant="outline" className="min-h-10 text-sm" onClick={() => setDetail('new')}>
            + Novo item
          </Button>
        }
      >
        <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <input className={inputCls} placeholder="Buscar item" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar item" />
          <select className={inputCls} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoria">
            <option value="">Todas as categorias</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
            <option value="pendentes">Pendentes (não adquiridos + parciais)</option>
            <option value="">Todos</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
            <option value="presente">Elegíveis para presente</option>
            <option value="revisar">Precisam de revisão</option>
          </select>
        </div>

        {grouped.length === 0 && <p className="py-6 text-center text-sm text-ink/60">Nenhum item com esses filtros.</p>}
        <div className="space-y-6">
          {grouped.map(([c, list]) => (
            <section key={c}>
              <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-ink/70">
                {c} <span className="font-normal">({list.length})</span>
              </h3>
              <ul className="divide-y divide-ink/10 rounded-2xl border border-ink/10">
                {list.map((i) => (
                  <li key={i.id} className={`flex flex-col gap-2 p-3 sm:flex-row sm:items-center ${i.is_discarded ? 'opacity-60' : ''}`}>
                    <button className="min-w-0 flex-1 text-left" onClick={() => setDetail(i)}>
                      <span className="block font-normal text-ink">
                        {i.name}
                        {i.subcategory && <span className="text-ink/60"> · {i.subcategory}</span>}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink/70">
                        <Badge tone={i.status === 'completo' ? 'good' : i.status === 'parcial' ? 'warn' : i.status === 'descartado' ? 'muted' : 'neutral'}>{STATUS_LABEL[i.status]}</Badge>
                        <span className="tabular-nums">
                          {qty(i.covered_quantity)}/{qty(i.desired_quantity)} {i.unit}
                          {i.pending_quantity ? ` · faltam ${qty(i.pending_quantity)}` : ''}
                        </span>
                        {i.borrowed_quantity > 0 && <Badge tone="primary">{qty(i.borrowed_quantity)} emprestado</Badge>}
                        {i.estimated_unit_price !== null && <span>· {brl(i.estimated_unit_price)}/un.</span>}
                        {i.needs_review && <Badge tone="warn">revisar</Badge>}
                        {!i.is_gift_eligible && <Badge tone="muted">fora das sugestões</Badge>}
                        {i.also_in_lists.length > 0 && <Badge tone="muted">também em: {i.also_in_lists.join(', ')}</Badge>}
                      </span>
                    </button>
                    <div className="flex flex-wrap gap-1.5">
                      {i.is_discarded ? (
                        <QuickBtn onClick={() => setAction({ kind: 'restore', item: i })}>Restaurar item</QuickBtn>
                      ) : (
                        <>
                          <QuickBtn onClick={() => setAction({ kind: 'purchase', item: i })}>Comprei</QuickBtn>
                          <QuickBtn onClick={() => setAction({ kind: 'gift', item: i })}>Ganhei</QuickBtn>
                          <QuickBtn onClick={() => setAction({ kind: 'correct', item: i })}>Corrigir quantidade</QuickBtn>
                          <QuickBtn onClick={() => setAction({ kind: 'discard', item: i })}>Não precisamos mais</QuickBtn>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Panel>

      <ActionModal action={action} onClose={() => setAction(null)} onDone={done} />
      <ItemModal item={detail} onClose={() => setDetail(null)} onSaved={done} categories={categories} />
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}

function QuickBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="min-h-9 rounded-full border border-ink/15 px-3 text-xs font-normal text-ink hover:border-primary hover:bg-primary-50">
      {children}
    </button>
  )
}

function ActionModal({ action, onClose, onDone }: { action: Action | null; onClose: () => void; onDone: (msg: string) => void }) {
  const [state, setState] = useState({ key: '', type: 'purchase', quantity: '1', amount: '', notes: '', mode: 'bucket', bucket: 'purchased', desired: '', requestId: '' })
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const key = action ? `${action.kind}:${action.item.id}` : ''
  if (action && state.key !== key) {
    setState({
      key,
      type: action.kind === 'gift' ? 'gift' : 'purchase',
      quantity: '1',
      amount: '',
      notes: '',
      mode: 'bucket',
      bucket: 'purchased',
      desired: action.item.desired_quantity === null ? '' : String(action.item.desired_quantity),
      requestId: newRequestId(), // mesmo id em reenvios = sem duplicar
    })
    setErr(null)
  }
  if (!action) return <Modal open={false} title="" onClose={onClose}>{null}</Modal>
  const it = action.item
  const n = (v: string) => Number(v.replace(',', '.'))

  const run = async () => {
    setSaving(true)
    setErr(null)
    try {
      if (action.kind === 'purchase' || action.kind === 'gift') {
        if (!(n(state.quantity) > 0)) throw new Error('QUANTITY_INVALID')
        await rpc('admin_record_movement', {
          p_item_id: it.id, p_type: state.type, p_quantity: n(state.quantity), p_bucket: null,
          p_notes: state.notes || null, p_amount_paid: state.type === 'purchase' && state.amount ? n(state.amount) : null, p_client_request_id: state.requestId,
        })
        onDone(`${it.name}: registrado`)
      } else if (action.kind === 'correct') {
        if (state.mode === 'desired') {
          await rpc('admin_set_desired_quantity', { p_item_id: it.id, p_desired: state.desired ? n(state.desired) : null, p_notes: state.notes || null, p_client_request_id: state.requestId })
        } else {
          if (!n(state.quantity)) throw new Error('QUANTITY_INVALID')
          await rpc('admin_record_movement', {
            p_item_id: it.id, p_type: 'correction', p_quantity: n(state.quantity), p_bucket: state.bucket,
            p_notes: state.notes || null, p_amount_paid: null, p_client_request_id: state.requestId,
          })
        }
        onDone(`${it.name}: quantidade corrigida`)
      } else {
        await rpc('admin_set_discarded', { p_item_id: it.id, p_discarded: action.kind === 'discard', p_notes: state.notes || null, p_client_request_id: state.requestId })
        onDone(action.kind === 'discard' ? `${it.name} saiu da lista` : `${it.name} restaurado`)
      }
    } catch (e) {
      setErr(friendlyError(e))
    } finally {
      setSaving(false)
    }
  }

  const titles = { purchase: 'Comprei', gift: 'Ganhei', correct: 'Corrigir quantidade', discard: 'Não precisamos mais', restore: 'Restaurar item' }
  return (
    <Modal open title={`${titles[action.kind]} · ${it.name}`} onClose={onClose}>
      <p className="mb-4 text-sm text-ink/75">
        Hoje: {qty(it.purchased_quantity)} comprado · {qty(it.received_quantity)} ganho · {qty(it.borrowed_quantity)} emprestado · desejado {qty(it.desired_quantity)} {it.unit}
        {it.original_quantity_text && ` (planilha: "${it.original_quantity_text}")`}
      </p>
      <div className="space-y-3">
        {(action.kind === 'purchase' || action.kind === 'gift') && (
          <>
            <Field label="Tipo">
              <select className={inputCls} value={state.type} onChange={(e) => setState({ ...state, type: e.target.value })}>
                <option value="purchase">Comprei</option>
                <option value="gift">Ganhei (presente)</option>
                <option value="borrow">Recebi emprestado</option>
                <option value="return_borrowed">Devolvi item emprestado</option>
              </select>
            </Field>
            <Field label={`Quantidade (${it.unit})`}>
              <input className={inputCls} inputMode="decimal" value={state.quantity} onChange={(e) => setState({ ...state, quantity: e.target.value })} />
            </Field>
            {state.type === 'purchase' && (
              <Field label="Valor pago no total (opcional)">
                <input className={inputCls} inputMode="decimal" placeholder="R$" value={state.amount} onChange={(e) => setState({ ...state, amount: e.target.value })} />
              </Field>
            )}
          </>
        )}
        {action.kind === 'correct' && (
          <>
            <fieldset className="flex flex-wrap gap-3 text-sm">
              <legend className="sr-only">O que corrigir</legend>
              <label className="flex items-center gap-2">
                <input type="radio" checked={state.mode === 'bucket'} onChange={() => setState({ ...state, mode: 'bucket' })} /> Comprado / ganho / emprestado
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={state.mode === 'desired'} onChange={() => setState({ ...state, mode: 'desired' })} /> Quantidade desejada
              </label>
            </fieldset>
            {state.mode === 'desired' ? (
              <Field label={`Quantidade desejada (${it.unit})`} hint="Deixe vazio se ainda não estiver definida.">
                <input className={inputCls} inputMode="decimal" value={state.desired} onChange={(e) => setState({ ...state, desired: e.target.value })} />
              </Field>
            ) : (
              <>
                <Field label="Em qual quantidade">
                  <select className={inputCls} value={state.bucket} onChange={(e) => setState({ ...state, bucket: e.target.value })}>
                    <option value="purchased">Comprado</option>
                    <option value="received">Ganho</option>
                    <option value="borrowed">Emprestado</option>
                  </select>
                </Field>
                <Field label="Ajuste (use negativo para diminuir)" hint="Ex.: -1 se registrou uma unidade a mais.">
                  <input className={inputCls} inputMode="text" value={state.quantity} onChange={(e) => setState({ ...state, quantity: e.target.value })} />
                </Field>
              </>
            )}
          </>
        )}
        <Field label="Observação (opcional)">
          <input className={inputCls} maxLength={500} value={state.notes} onChange={(e) => setState({ ...state, notes: e.target.value })} />
        </Field>
        {err && <ErrorBox>{err}</ErrorBox>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={saving} onClick={run}>
            Confirmar
          </Button>
        </div>
      </div>
    </Modal>
  )
}

interface Movement {
  id: string
  movement_type: string
  bucket: string | null
  quantity: number
  unit: string | null
  amount_paid: number | null
  previous_value: number | null
  new_value: number | null
  reverses_movement_id: string | null
  notes: string | null
  created_by_name: string | null
  created_at: string
}
const MOV_LABEL: Record<string, string> = {
  import: 'Importado', purchase: 'Comprei', gift: 'Ganhei', borrow: 'Emprestado', return_borrowed: 'Devolvido', correction: 'Correção',
  desired_change: 'Qtd. desejada', discard: 'Não precisamos mais', restore: 'Restaurado', reversal: 'Desfeito',
}
const BUCKET_LABEL: Record<string, string> = { purchased: 'comprado', received: 'ganho', borrowed: 'emprestado' }

const emptyItem = (categories: string[]): Partial<ItemRow> => ({
  category: categories[0] ?? 'Bebê', subcategory: '', name: '', description: '', desired_quantity: 1, unit: 'unidade',
  estimated_unit_price: null, priority: 'media', is_gift_eligible: true, image_url: '', reference_url: '', notes: '',
})

function ItemModal({ item, onClose, onSaved, categories }: { item: ItemRow | 'new' | null; onClose: () => void; onSaved: (m: string) => void; categories: string[] }) {
  const isNew = item === 'new'
  const [form, setForm] = useState<Partial<ItemRow> & { _key?: string }>({})
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const key = item === 'new' ? 'new' : item?.id
  const { data: history, reload } = useLoad(async () => {
    if (!item || item === 'new') return [] as Movement[]
    const { data, error } = await supabase.from('layette_movements').select('*').eq('layette_item_id', item.id).order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return data as Movement[]
  }, [key])
  if (item && form._key !== key) {
    setForm({ ...(isNew ? emptyItem(categories) : (item as ItemRow)), _key: key })
    setErr(null)
  }
  const reversed = new Set((history ?? []).map((h) => h.reverses_movement_id).filter(Boolean))

  const save = async () => {
    setSaving(true)
    setErr(null)
    const priceStr = form.estimated_unit_price as unknown as string | number | null
    const fields = {
      category: form.category?.trim(),
      subcategory: form.subcategory?.trim() || null,
      name: form.name?.trim(),
      description: form.description?.trim() || null,
      unit: form.unit?.trim() || 'unidade',
      estimated_unit_price: priceStr === null || priceStr === '' ? null : Number(String(priceStr).replace(',', '.')),
      priority: form.priority,
      is_gift_eligible: form.is_gift_eligible,
      image_url: form.image_url?.trim() || null,
      reference_url: form.reference_url?.trim() || null,
      notes: form.notes?.trim() || null,
      needs_review: isNew ? false : form.needs_review,
    }
    if (!fields.name || !fields.category) {
      setSaving(false)
      return setErr('Nome e categoria são obrigatórios.')
    }
    if (fields.image_url && !/^https:\/\//i.test(fields.image_url)) {
      setSaving(false)
      return setErr('A imagem precisa ser um link https://')
    }
    const res = isNew
      ? await supabase.from('layette_items').insert({ ...fields, desired_quantity: Number(form.desired_quantity) || null }).select('id')
      : await supabase.from('layette_items').update(fields).eq('id', (item as ItemRow).id).select('id')
    setSaving(false)
    if (res.error) return setErr(`${friendlyError(res.error)} (${res.error.message})`)
    onSaved(isNew ? 'Item criado' : 'Item atualizado')
  }

  const undo = async (m: Movement) => {
    if (!window.confirm('Desfazer esta movimentação? Ela continua no histórico, com a reversão registrada.')) return
    try {
      await rpc('admin_reverse_movement', { p_movement_id: m.id, p_notes: null })
      reload()
    } catch (e) {
      setErr(friendlyError(e))
    }
  }

  const f = (k: keyof ItemRow) => ({
    value: (form[k] as string | number | null | undefined) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value }),
  })

  return (
    <Modal open={!!item} title={isNew ? 'Novo item' : (item as ItemRow | null)?.name ?? ''} onClose={onClose} wide>
      {item && (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-3">
            {!isNew && (item as ItemRow).review_notes && (
              <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                <strong className="font-medium">Notas da importação:</strong> {(item as ItemRow).review_notes}
                <label className="mt-2 flex items-center gap-2">
                  <input type="checkbox" checked={!form.needs_review} onChange={(e) => setForm({ ...form, needs_review: !e.target.checked })} /> Revisado
                </label>
              </div>
            )}
            <Field label="Nome">
              <input className={inputCls} {...f('name')} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Categoria">
                <input className={inputCls} list="cats" {...f('category')} />
                <datalist id="cats">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Field>
              <Field label="Subcategoria">
                <input className={inputCls} {...f('subcategory')} />
              </Field>
            </div>
            <Field label="Descrição para os convidados" hint="Aparece no cartão de sugestão.">
              <input className={inputCls} maxLength={140} {...f('description')} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              {isNew ? (
                <Field label="Qtd. desejada">
                  <input className={inputCls} inputMode="decimal" {...f('desired_quantity')} />
                </Field>
              ) : (
                <Field label="Qtd. desejada" hint="Altere em “Corrigir quantidade”.">
                  <input className={`${inputCls} bg-ink/5`} readOnly value={`${qty((item as ItemRow).desired_quantity)}`} />
                </Field>
              )}
              <Field label="Unidade">
                <input className={inputCls} {...f('unit')} readOnly={!isNew} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Preço unitário estimado (R$)" hint={!isNew && (item as ItemRow).reference_price ? `Referência da planilha: ${brl((item as ItemRow).reference_price)}` : 'Usado para a faixa de preço.'}>
                <input className={inputCls} inputMode="decimal" {...f('estimated_unit_price')} />
              </Field>
              <Field label="Prioridade">
                <select className={inputCls} {...f('priority')}>
                  {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.is_gift_eligible} onChange={(e) => setForm({ ...form, is_gift_eligible: e.target.checked })} /> Pode aparecer nas sugestões de presente
            </label>
            <Field label="Imagem (link https, opcional)">
              <input className={inputCls} {...f('image_url')} />
            </Field>
            <Field label="Link de referência">
              <input className={inputCls} {...f('reference_url')} />
            </Field>
            <Field label="Observações">
              <textarea className={inputCls} rows={3} {...f('notes')} />
            </Field>
            {err && <ErrorBox>{err}</ErrorBox>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Fechar
              </Button>
              <Button loading={saving} onClick={save}>
                Salvar
              </Button>
            </div>
          </div>
          {!isNew && (
            <div>
              <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-ink/70">Histórico</h3>
              {(item as ItemRow).price_tier && (
                <p className="mb-2 text-sm">
                  Faixa atual: <Badge tone="primary">{TIER_LABEL[(item as ItemRow).price_tier!]}</Badge>
                </p>
              )}
              <ol className="space-y-2">
                {(history ?? []).map((m) => (
                  <li key={m.id} className="rounded-xl border border-ink/10 p-2.5 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <span>
                        <strong className="font-medium">{MOV_LABEL[m.movement_type] ?? m.movement_type}</strong>{' '}
                        {m.bucket && (
                          <span className="tabular-nums">
                            {Number(m.quantity) > 0 ? '+' : ''}
                            {qty(m.quantity)} {m.unit} {BUCKET_LABEL[m.bucket]}
                          </span>
                        )}
                        {m.movement_type === 'desired_change' && (
                          <span className="tabular-nums">
                            {qty(m.previous_value)} → {qty(m.new_value)}
                          </span>
                        )}
                        {m.amount_paid !== null && <span> · {brl(m.amount_paid)}</span>}
                      </span>
                      {m.bucket && m.movement_type !== 'reversal' && !reversed.has(m.id) && (
                        <button className="shrink-0 rounded-full px-2 py-0.5 text-xs text-primary-strong hover:bg-primary-50" onClick={() => undo(m)}>
                          Desfazer
                        </button>
                      )}
                      {reversed.has(m.id) && <Badge tone="muted">desfeito</Badge>}
                    </div>
                    <div className="mt-0.5 text-xs text-ink/60">
                      {dateTime(m.created_at)} · {m.created_by_name ?? 'sistema'}
                      {m.notes && ` · ${m.notes}`}
                    </div>
                  </li>
                ))}
                {history && history.length === 0 && <li className="text-sm text-ink/60">Sem movimentações.</li>}
              </ol>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
