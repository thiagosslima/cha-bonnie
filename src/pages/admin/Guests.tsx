import { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { friendlyError } from '../../lib/errors'
import { dateTime } from '../../lib/format'
import { DIAPER_SIZES } from '../../lib/types'
import { Button } from '../../components/ui'
import {
  ATTENDANCE_LABEL, Badge, ErrorBox, Field, Loading, Modal, Panel, RSVP_COLS, Toast, downloadCsv, fetchEvents, fetchRsvps, inputCls, useLoad,
  type RsvpRow,
} from './common'

export default function Guests() {
  const { data, error, loading, reload } = useLoad(async () => ({ events: await fetchEvents(), rsvps: await fetchRsvps() }))
  const [q, setQ] = useState('')
  const [city, setCity] = useState('')
  const [att, setAtt] = useState('')
  const [onlyDup, setOnlyDup] = useState(false)
  const [editing, setEditing] = useState<RsvpRow | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const dupKeys = useMemo(() => {
    const count = new Map<string, number>()
    data?.rsvps.forEach((r) => count.set(`${r.event_id}|${r.guest_name_normalized}`, (count.get(`${r.event_id}|${r.guest_name_normalized}`) ?? 0) + 1))
    return new Set([...count].filter(([, n]) => n > 1).map(([k]) => k))
  }, [data])

  const rows = useMemo(() => {
    if (!data) return []
    const nq = q.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
    return data.rsvps.filter(
      (r) =>
        (!nq || r.guest_name_normalized.includes(nq)) &&
        (!city || r.event_id === city) &&
        (!att || r.attendance === att) &&
        (!onlyDup || dupKeys.has(`${r.event_id}|${r.guest_name_normalized}`)),
    )
  }, [data, q, city, att, onlyDup, dupKeys])

  if (loading && !data) return <Loading />
  if (error) return <ErrorBox>{error}</ErrorBox>
  if (!data) return null
  const cityOf = (id: string) => data.events.find((e) => e.id === id)?.city ?? '—'

  const exportCsv = () =>
    downloadCsv(`convidados-bonnie-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['Nome', 'Cidade', 'Resposta', 'Fralda', 'Respondido em', 'Atualizado em'],
      ...rows.map((r) => [r.guest_name, cityOf(r.event_id), ATTENDANCE_LABEL[r.attendance], r.diaper_size ?? '', dateTime(r.created_at), dateTime(r.updated_at)]),
    ])

  const remove = async (r: RsvpRow) => {
    if (!window.confirm(`Excluir a resposta de ${r.guest_name}? Isso não pode ser desfeito (fica registrado na auditoria).`)) return
    const { error } = await supabase.from('rsvps').delete().eq('id', r.id)
    if (error) return setToast(friendlyError(error))
    setToast('Resposta excluída')
    reload()
  }

  return (
    <Panel
      title={`Convidados (${rows.length})`}
      actions={
        <Button variant="outline" className="min-h-10 text-sm" onClick={exportCsv}>
          Exportar CSV (Excel)
        </Button>
      }
    >
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <input className={inputCls} placeholder="Buscar por nome" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar por nome" />
        <select className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} aria-label="Cidade">
          <option value="">Todas as cidades</option>
          {data.events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.city}
            </option>
          ))}
        </select>
        <select className={inputCls} value={att} onChange={(e) => setAtt(e.target.value)} aria-label="Resposta">
          <option value="">Todas as respostas</option>
          {Object.entries(ATTENDANCE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 px-2 text-sm">
          <input type="checkbox" checked={onlyDup} onChange={(e) => setOnlyDup(e.target.checked)} /> Possíveis duplicados ({dupKeys.size})
        </label>
      </div>

      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-ink/65">
            <tr>
              <th className="py-2 pr-3 font-normal">Nome</th>
              <th className="py-2 pr-3 font-normal">Cidade</th>
              <th className="py-2 pr-3 font-normal">Resposta</th>
              <th className="py-2 pr-3 font-normal">Fralda</th>
              <th className="py-2 pr-3 font-normal">Respondido</th>
              <th className="py-2 pr-3 font-normal">Atualizado</th>
              <th className="py-2 font-normal"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/10">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="py-2.5 pr-3 font-normal">
                  {r.guest_name}
                  {dupKeys.has(`${r.event_id}|${r.guest_name_normalized}`) && (
                    <span className="ml-2">
                      <Badge tone="warn">possível duplicado</Badge>
                    </span>
                  )}
                </td>
                <td className="py-2.5 pr-3">{cityOf(r.event_id)}</td>
                <td className="py-2.5 pr-3">
                  <Badge tone={r.attendance === 'yes' ? 'good' : r.attendance === 'maybe' ? 'warn' : 'muted'}>{ATTENDANCE_LABEL[r.attendance]}</Badge>
                </td>
                <td className="py-2.5 pr-3">{r.diaper_size ?? '—'}</td>
                <td className="py-2.5 pr-3 tabular-nums">{dateTime(r.created_at)}</td>
                <td className="py-2.5 pr-3 tabular-nums">{dateTime(r.updated_at)}</td>
                <td className="py-2.5 text-right whitespace-nowrap">
                  <button className="rounded-full px-3 py-1.5 text-primary-strong hover:bg-primary-50" onClick={() => setEditing(r)}>
                    Editar
                  </button>
                  <button className="rounded-full px-3 py-1.5 text-red-700 hover:bg-red-50" onClick={() => remove(r)}>
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-ink/60">
                  Nenhuma resposta encontrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <EditRsvp
        row={editing}
        events={data.events.map((e) => ({ id: e.id, city: e.city }))}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          setToast('Resposta atualizada')
          reload()
        }}
      />
      <Toast message={toast} onDone={() => setToast(null)} />
    </Panel>
  )
}

function EditRsvp({ row, events, onClose, onSaved }: { row: RsvpRow | null; events: { id: string; city: string }[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<RsvpRow | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  if (row && form?.id !== row.id) {
    setForm(row)
    setErr(null)
  }
  const save = async () => {
    if (!form) return
    if (form.attendance === 'yes' && !form.diaper_size) return setErr('Quem confirmou precisa ter um tamanho de fralda.')
    setSaving(true)
    const { error } = await supabase
      .from('rsvps')
      .update({
        guest_name: form.guest_name,
        event_id: form.event_id,
        attendance: form.attendance,
        diaper_size: form.attendance === 'yes' ? form.diaper_size : null,
      })
      .eq('id', form.id)
      .select(RSVP_COLS)
    setSaving(false)
    if (error) return setErr(friendlyError(error) + ` (${error.message})`)
    onSaved()
  }
  return (
    <Modal open={!!row} title="Editar resposta" onClose={onClose}>
      {form && (
        <div className="space-y-3">
          <Field label="Nome">
            <input className={inputCls} value={form.guest_name} onChange={(e) => setForm({ ...form, guest_name: e.target.value })} />
          </Field>
          <Field label="Cidade">
            <select className={inputCls} value={form.event_id} onChange={(e) => setForm({ ...form, event_id: e.target.value })}>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.city}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Resposta">
            <select className={inputCls} value={form.attendance} onChange={(e) => setForm({ ...form, attendance: e.target.value as RsvpRow['attendance'] })}>
              {Object.entries(ATTENDANCE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          {form.attendance === 'yes' && (
            <Field label="Fralda">
              <select className={inputCls} value={form.diaper_size ?? ''} onChange={(e) => setForm({ ...form, diaper_size: (e.target.value || null) as RsvpRow['diaper_size'] })}>
                <option value="">Escolha…</option>
                {DIAPER_SIZES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
          )}
          {err && <ErrorBox>{err}</ErrorBox>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button loading={saving} onClick={save}>
              Salvar
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
