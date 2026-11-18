import { Link } from 'react-router-dom'
import { brl, dateTime } from '../../lib/format'
import { partySize, peopleLabel, rsvpTotals } from '../../lib/rsvpStats'
import { ATTENDANCE_LABEL, Badge, ErrorBox, Loading, Panel, Stat, TargetBars, fetchEvents, fetchItems, fetchRsvps, layetteSummary, rpc, useLoad } from './common'

interface DiaperStat {
  event_id: string
  slug: string
  city: string
  theme_primary: string
  sizes: { diaper_size: string; target_percentage: number; chosen: number; current_percentage: number; is_recommended: boolean }[]
}

export default function Dashboard() {
  const { data, error, loading } = useLoad(async () => {
    const [events, rsvps, items, diapers] = await Promise.all([fetchEvents(), fetchRsvps(), fetchItems(), rpc<DiaperStat[]>('admin_diaper_stats')])
    return { events, rsvps, items, diapers }
  })
  if (loading && !data) return <Loading />
  if (error) return <ErrorBox>{error}</ErrorBox>
  if (!data) return null
  const { events, rsvps, items, diapers } = data
  const tot = rsvpTotals(rsvps)
  const lay = layetteSummary(items)
  const eventName = (id: string) => events.find((e) => e.id === id)?.city ?? '—'

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Famílias confirmadas" value={tot.families} hint={`${tot.responses} respostas no total`} />
        <Stat label="Pessoas confirmadas" value={tot.people} hint="responsáveis + acompanhantes" />
        <Stat label="Acompanhantes" value={tot.companions} hint="das famílias confirmadas" />
        <Stat label="Famílias indecisas" value={tot.maybeFamilies} hint={tot.maybeFamilies ? `até ${peopleLabel(tot.maybePeople)}` : undefined} />
        <Stat label="Famílias ausentes" value={tot.declinedFamilies} />
        <Stat label="Escolhas de fralda" value={tot.diaperChoices} hint="1 por família confirmada" />
      </div>

      <p className="-mt-2 text-xs text-ink/65">
        Cada resposta representa uma família. A fralda é uma escolha por família confirmada; os acompanhantes não mudam a distribuição de tamanhos.
      </p>

      <div className="grid gap-5 lg:grid-cols-2">
        {events.map((ev) => {
          const t = rsvpTotals(rsvps.filter((x) => x.event_id === ev.id))
          const d = diapers.find((x) => x.event_id === ev.id)
          return (
            <Panel
              key={ev.id}
              title={
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ background: ev.theme_primary }} aria-hidden="true" />
                  {ev.city}
                </span>
              }
              actions={<Badge tone={ev.rsvp_open ? 'good' : 'muted'}>{ev.rsvp_open ? 'Confirmações abertas' : 'Confirmações encerradas'}</Badge>}
            >
              <div className="mb-4 grid grid-cols-3 gap-2">
                <Stat label="Famílias" value={t.families} hint="confirmadas" />
                <Stat label="Pessoas" value={t.people} hint={ev.expected_guests ? `de ~${ev.expected_guests} estimadas` : `${t.companions} acompanhantes`} />
                <Stat label="Fraldas" value={t.diaperChoices} hint="1 por família" />
              </div>
              <p className="mb-4 text-sm text-ink/80">
                {t.companions} acompanhantes · {t.maybeFamilies} famílias indecisas · {t.declinedFamilies} ausentes
              </p>
              {d && (
                <TargetBars
                  color={ev.theme_primary}
                  rows={d.sizes.map((s) => ({ label: s.diaper_size, value: s.chosen, pct: Number(s.current_percentage), target: Number(s.target_percentage), highlight: s.is_recommended }))}
                />
              )}
            </Panel>
          )
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Panel title="Últimas respostas" actions={<Link to="/admin/convidados" className="text-sm text-primary-strong underline">Ver todos</Link>}>
          {rsvps.length === 0 ? (
            <p className="text-sm text-ink/70">Ainda não há respostas.</p>
          ) : (
            <ul className="divide-y divide-ink/10">
              {rsvps.slice(0, 8).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <span className="font-normal">
                    {r.guest_name}
                    {r.companions_count > 0 && <span className="text-ink/60"> +{r.companions_count}</span>}
                  </span>
                  <span className="flex items-center gap-2 text-ink/70">
                    <Badge tone={r.attendance === 'yes' ? 'good' : r.attendance === 'maybe' ? 'warn' : 'muted'}>{ATTENDANCE_LABEL[r.attendance]}</Badge>
                    {r.attendance === 'yes' && <Badge>{peopleLabel(partySize(r))}</Badge>}
                    {r.diaper_size && <Badge tone="primary">{r.diaper_size}</Badge>}
                    {eventName(r.event_id)} · {dateTime(r.updated_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Enxoval da Bonnie" actions={<Link to="/admin/enxoval" className="text-sm text-primary-strong underline">Abrir</Link>}>
          {items.length === 0 ? (
            <p className="text-sm">
              Nenhum item ainda. <Link to="/admin/importar" className="text-primary-strong underline">Importe a planilha</Link>.
            </p>
          ) : (
            <>
              <div className="mb-1 flex justify-between text-sm">
                <span>Conclusão</span>
                <span className="tabular-nums">{lay.pct}%</span>
              </div>
              <div className="h-3 rounded-full bg-ink/5" role="progressbar" aria-valuenow={lay.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Conclusão do enxoval">
                <div className="h-full rounded-full bg-primary" style={{ width: `${lay.pct}%` }} />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Stat label="Completos" value={lay.complete} />
                <Stat label="Pendentes" value={lay.pending + lay.partial} hint={`${lay.partial} parcialmente`} />
                <Stat label="Valor estimado restante" value={brl(lay.remaining)} hint={lay.unpricedPending ? `${lay.unpricedPending} pendentes sem preço` : undefined} />
                <Stat label="Já gasto" value={brl(lay.spent)} />
              </div>
            </>
          )}
        </Panel>
      </div>
    </div>
  )
}
