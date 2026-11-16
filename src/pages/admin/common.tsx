import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { friendlyError } from '../../lib/errors'
import { Spinner } from '../../components/ui'

export interface ItemRow {
  id: string
  category: string
  subcategory: string | null
  name: string
  description: string | null
  original_quantity_text: string | null
  desired_quantity: number | null
  unit: string
  estimated_unit_price: number | null
  reference_price: number | null
  priority: 'alta' | 'media' | 'baixa'
  is_gift_eligible: boolean
  is_discarded: boolean
  image_url: string | null
  reference_url: string | null
  notes: string | null
  also_in_lists: string[]
  needs_review: boolean
  review_notes: string | null
  sort_order: number
  purchased_quantity: number
  received_quantity: number
  borrowed_quantity: number
  covered_quantity: number
  pending_quantity: number | null
  status: 'nao_adquirido' | 'parcial' | 'completo' | 'descartado'
  price_tier: 'barato' | 'medio' | 'caro' | null
  amount_paid_total: number
  updated_at: string
  created_at: string
}

export interface RsvpRow {
  id: string
  event_id: string
  guest_name: string
  guest_name_normalized: string
  attendance: 'yes' | 'maybe' | 'no'
  diaper_size: 'RN' | 'P' | 'M' | 'G' | 'XG' | null
  created_at: string
  updated_at: string
}

export interface EventRow {
  id: string
  slug: string
  city: string
  state: string
  title: string
  event_date: string
  event_time: string
  venue: string
  venue_detail: string | null
  address_line1: string
  address_line2: string | null
  maps_url: string | null
  theme_primary: string
  theme_soft: string
  heart_emoji: string
  welcome_message: string
  msg_confirmed: string
  msg_maybe: string
  msg_declined: string
  rsvp_open: boolean
  is_active: boolean
  expected_guests: number | null
  sort_order: number
}

export const RSVP_COLS = 'id,event_id,guest_name,guest_name_normalized,attendance,diaper_size,created_at,updated_at'

export const STATUS_LABEL: Record<ItemRow['status'], string> = {
  nao_adquirido: 'Não adquirido',
  parcial: 'Parcialmente adquirido',
  completo: 'Completo',
  descartado: 'Descartado',
}
export const ATTENDANCE_LABEL = { yes: 'Confirmado', maybe: 'Ainda não sabe', no: 'Não poderá ir' } as const
export const TIER_LABEL = { barato: 'Barato', medio: 'Médio', caro: 'Caro' } as const
export const PRIORITY_LABEL = { alta: 'Alta', media: 'Média', baixa: 'Baixa' } as const

export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const ref = useRef(loader)
  ref.current = loader
  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setData(await ref.current())
      setError(null)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setLoading(false)
    }
  }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void reload(), deps)
  return { data, error, loading, reload, setData }
}

export async function fetchItems(): Promise<ItemRow[]> {
  const { data, error } = await supabase.from('layette_item_totals').select('*').order('sort_order').order('name')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    ...r,
    desired_quantity: r.desired_quantity === null ? null : Number(r.desired_quantity),
    estimated_unit_price: r.estimated_unit_price === null ? null : Number(r.estimated_unit_price),
    reference_price: r.reference_price === null ? null : Number(r.reference_price),
    purchased_quantity: Number(r.purchased_quantity),
    received_quantity: Number(r.received_quantity),
    borrowed_quantity: Number(r.borrowed_quantity),
    covered_quantity: Number(r.covered_quantity),
    pending_quantity: r.pending_quantity === null ? null : Number(r.pending_quantity),
    amount_paid_total: Number(r.amount_paid_total),
  })) as ItemRow[]
}

export async function fetchEvents(): Promise<EventRow[]> {
  const { data, error } = await supabase.from('events').select('*').order('sort_order')
  if (error) throw new Error(error.message)
  return (data ?? []).map((e) => ({ ...e, event_time: String(e.event_time).slice(0, 5) })) as EventRow[]
}

export async function fetchRsvps(): Promise<RsvpRow[]> {
  const { data, error } = await supabase.from('rsvps').select(RSVP_COLS).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as RsvpRow[]
}

export function layetteSummary(items: ItemRow[]) {
  const active = items.filter((i) => !i.is_discarded)
  const complete = active.filter((i) => i.status === 'completo').length
  const partial = active.filter((i) => i.status === 'parcial').length
  const pending = active.filter((i) => i.status === 'nao_adquirido').length
  const priced = active.filter((i) => i.pending_quantity && i.estimated_unit_price !== null)
  const remaining = priced.reduce((s, i) => s + (i.pending_quantity ?? 0) * (i.estimated_unit_price ?? 0), 0)
  const unpricedPending = active.filter((i) => (i.pending_quantity ?? 1) > 0 && i.status !== 'completo' && i.estimated_unit_price === null).length
  return {
    total: items.length,
    active: active.length,
    complete,
    partial,
    pending,
    discarded: items.length - active.length,
    pct: active.length ? Math.round((complete / active.length) * 1000) / 10 : 0,
    remaining,
    unpricedPending,
    spent: items.reduce((s, i) => s + i.amount_paid_total, 0),
  }
}

// ---------------------------------------------------------------------------
// UI básica do painel
// ---------------------------------------------------------------------------
export function Panel({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-3xl bg-white p-4 shadow-[0_1px_2px_rgb(0_0_0/0.05),0_10px_30px_-18px_rgb(60_50_70/0.35)] sm:p-6 ${className}`}>
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="text-lg font-medium text-ink">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-white px-4 py-3">
      <div className="text-xs font-normal uppercase tracking-wide break-words text-ink/65 [overflow-wrap:anywhere]">{label}</div>
      <div className="mt-1 text-2xl font-medium tabular-nums text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink/65">{hint}</div>}
    </div>
  )
}

export function Loading() {
  return (
    <div className="flex justify-center py-16 text-primary-strong" role="status">
      <Spinner className="h-7 w-7" />
      <span className="sr-only">Carregando…</span>
    </div>
  )
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800">
      {children}
    </div>
  )
}

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return
    const t = setTimeout(onDone, 3200)
    return () => clearTimeout(t)
  }, [message, onDone])
  if (!message) return null
  return (
    <div role="status" className="fixed inset-x-0 bottom-5 z-50 mx-auto w-fit max-w-[92vw] rounded-full bg-ink px-5 py-3 text-sm text-white shadow-lg">
      {message}
    </div>
  )
}

export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className={`m-auto max-h-[90dvh] w-[calc(100vw-1.5rem)] ${wide ? 'max-w-3xl' : 'max-w-lg'} overflow-y-auto rounded-3xl p-0 text-ink shadow-2xl backdrop:bg-ink/40`}
    >
      {open && (
        <div className="p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-lg font-medium">{title}</h2>
            <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full hover:bg-ink/5" aria-label="Fechar">
              ✕
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  )
}

export const inputCls =
  'block w-full rounded-xl border border-ink/20 bg-white px-3 py-2.5 text-[0.95rem] font-normal text-ink outline-none focus:border-primary focus:ring-4 focus:ring-primary-100'

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-normal text-ink/80">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink/60">{hint}</span>}
    </label>
  )
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'primary' | 'good' | 'warn' | 'muted'; children: ReactNode }) {
  const cls = {
    neutral: 'bg-ink/5 text-ink',
    primary: 'bg-primary-50 text-primary-strong',
    good: 'bg-emerald-50 text-emerald-800',
    warn: 'bg-amber-50 text-amber-800',
    muted: 'bg-ink/5 text-ink/60',
  }[tone]
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-normal ${cls}`}>{children}</span>
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v)
    // Evita injeção de fórmula ao abrir no Excel
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
    return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  const csv = '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Barras horizontais de uma série: atual vs meta (marcador). Rótulos em texto, sem depender de cor. */
export function TargetBars({ rows, color }: { rows: { label: string; value: number; pct: number; target: number; highlight?: boolean }[]; color: string }) {
  const max = Math.max(50, ...rows.map((r) => Math.max(r.pct, r.target))) * 1.1
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[2.5rem_1fr_6.5rem] items-center gap-3 text-sm" title={`${r.label}: ${r.value} escolha(s), ${r.pct}% (meta ${r.target}%)`}>
          <span className="font-medium">{r.label}</span>
          <div className="relative h-5 rounded-md bg-ink/5">
            <div className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: `${(r.pct / max) * 100}%`, background: color }} />
            <div className="absolute -inset-y-1 w-0.5 bg-ink" style={{ left: `${(r.target / max) * 100}%` }} aria-hidden="true" />
          </div>
          <span className="tabular-nums text-ink/80">
            {r.value} · {r.pct}%<span className="text-ink/55"> / {r.target}%</span>
            {r.highlight && <span className="ml-1" aria-label="recomendado agora">★</span>}
          </span>
        </div>
      ))}
      <p className="pt-1 text-xs text-ink/60">Barra: distribuição atual. Traço preto: meta. ★ tamanho recomendado agora.</p>
    </div>
  )
}
