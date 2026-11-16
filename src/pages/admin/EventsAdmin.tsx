import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { friendlyError } from '../../lib/errors'
import { contrast, shadeFor } from '../../lib/theme'
import { Button } from '../../components/ui'
import { ErrorBox, Field, Loading, Panel, Toast, fetchEvents, inputCls, useLoad, type EventRow } from './common'

export default function EventsAdmin() {
  const { data, error, loading, reload } = useLoad(fetchEvents)
  const [toast, setToast] = useState<string | null>(null)
  if (loading && !data) return <Loading />
  if (error) return <ErrorBox>{error}</ErrorBox>
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {data?.map((ev) => <EventForm key={ev.id} ev={ev} onSaved={() => (setToast(`${ev.city} atualizado`), reload())} />)}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}

function EventForm({ ev, onSaved }: { ev: EventRow; onSaved: () => void }) {
  const [f, setF] = useState<EventRow>(ev)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const bind = (k: keyof EventRow) => ({
    value: (f[k] as string | number | null) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }),
  })
  const save = async () => {
    setSaving(true)
    setErr(null)
    const { id, ...rest } = f
    void id
    const { error } = await supabase
      .from('events')
      .update({
        ...rest,
        venue_detail: rest.venue_detail || null,
        address_line2: rest.address_line2 || null,
        maps_url: rest.maps_url || null,
        expected_guests: rest.expected_guests === null || (rest.expected_guests as unknown) === '' ? null : Number(rest.expected_guests),
      })
      .eq('id', ev.id)
      .select('id')
    setSaving(false)
    if (error) return setErr(`${friendlyError(error)} (${error.message})`)
    onSaved()
  }
  const valid = /^#[0-9a-fA-F]{6}$/.test(f.theme_primary)
  return (
    <Panel title={ev.city}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Data">
            <input type="date" className={inputCls} {...bind('event_date')} />
          </Field>
          <Field label="Horário">
            <input type="time" className={inputCls} {...bind('event_time')} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Local">
            <input className={inputCls} {...bind('venue')} />
          </Field>
          <Field label="Complemento do local">
            <input className={inputCls} {...bind('venue_detail')} />
          </Field>
        </div>
        <Field label="Endereço (linha 1)">
          <input className={inputCls} {...bind('address_line1')} />
        </Field>
        <Field label="Endereço (linha 2)">
          <input className={inputCls} {...bind('address_line2')} />
        </Field>
        <Field label="Link do Google Maps" hint="Opcional: se vazio, o link é gerado pelo endereço.">
          <input className={inputCls} {...bind('maps_url')} />
        </Field>
        <Field label="Mensagem de boas-vindas">
          <textarea rows={3} className={inputCls} {...bind('welcome_message')} />
        </Field>
        <Field label="Mensagem final: confirmado" hint="A primeira linha vira o título. Separe parágrafos com uma linha em branco.">
          <textarea rows={4} className={inputCls} {...bind('msg_confirmed')} />
        </Field>
        <Field label="Mensagem final: ainda não sabe">
          <textarea rows={4} className={inputCls} {...bind('msg_maybe')} />
        </Field>
        <Field label="Mensagem final: não poderá ir">
          <textarea rows={3} className={inputCls} {...bind('msg_declined')} />
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Cor principal">
            <div className="flex items-center gap-2">
              <input type="color" className="h-11 w-11 shrink-0 rounded-lg border border-ink/20" value={valid ? f.theme_primary : '#C0A4ED'} onChange={(e) => setF({ ...f, theme_primary: e.target.value.toUpperCase() })} aria-label="Escolher cor" />
              <input className={inputCls} {...bind('theme_primary')} />
            </div>
          </Field>
          <Field label="Fundo secundário">
            <input className={inputCls} {...bind('theme_soft')} />
          </Field>
          <Field label="Emoji de coração">
            <input className={inputCls} {...bind('heart_emoji')} />
          </Field>
        </div>
        {valid && (
          <p className="text-xs text-ink/65">
            Botões usam automaticamente o tom {shadeFor(f.theme_primary, 4.6)} (contraste {contrast(shadeFor(f.theme_primary, 4.6), '#ffffff').toFixed(1)}:1 com texto branco).
          </p>
        )}
        <Field label="Convidados estimados">
          <input className={inputCls} inputMode="numeric" {...bind('expected_guests')} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.rsvp_open} onChange={(e) => setF({ ...f, rsvp_open: e.target.checked })} /> Confirmações abertas
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Evento visível no site
        </label>
        {err && <ErrorBox>{err}</ErrorBox>}
        <div className="flex items-center justify-between gap-2 pt-1">
          <a href={`/${ev.slug}`} target="_blank" rel="noreferrer" className="text-sm text-primary-strong underline">
            Abrir convite
          </a>
          <Button loading={saving} onClick={save}>
            Salvar
          </Button>
        </div>
      </div>
    </Panel>
  )
}
