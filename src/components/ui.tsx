import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { DEFAULT_THEME, themeVars } from '../lib/theme'
import { dateBlock } from '../lib/format'

/** Aplica o tema da cidade no documento inteiro (fundo, foco, botões). */
export function useEventTheme(primary?: string | null, soft?: string | null) {
  useEffect(() => {
    const vars = primary ? themeVars(primary, soft ?? '#F8F5FA') : DEFAULT_THEME
    const root = document.documentElement
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v))
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars['--c-soft'])
  }, [primary, soft])
}

export function Bonnie({ className = '' }: { className?: string }) {
  return <span role="img" aria-label="Bonnie" className={`bonnie-lettering ${className}`} />
}

/** "Chá de bebê da" + lettering, na mesma composição do convite impresso. */
export function InviteTitle({ as: Tag = 'h1' }: { as?: 'h1' | 'h2' }) {
  return (
    <Tag className="relative mx-auto w-full max-w-[460px]" style={{ containerType: 'inline-size' }}>
      <span
        className="absolute font-light text-ink whitespace-nowrap"
        style={{ left: '23.6%', top: '2.6cqw', fontSize: '6.55cqw', lineHeight: 1, letterSpacing: '0.01em' }}
      >
        Chá de bebê da
      </span>
      <span className="sr-only"> </span>
      <Bonnie className="w-full" />
    </Tag>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`invite-card relative mx-auto w-full max-w-[560px] px-6 py-8 sm:px-10 sm:py-10 ${className}`}>{children}</section>
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'outline' | 'ghost'
  loading?: boolean
}
export function Button({ variant = 'primary', loading, className = '', children, disabled, ...rest }: BtnProps) {
  const base =
    'relative inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 py-3 text-[1.05rem] font-medium transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-55'
  const styles = {
    primary: 'bg-primary-strong text-white shadow-[0_8px_20px_-8px_var(--c-primary-strong)] hover:brightness-110',
    outline: 'border-2 border-primary-200 bg-white text-primary-strong hover:border-primary',
    ghost: 'text-primary-strong hover:bg-primary-50',
  }[variant]
  return (
    <button className={`${base} ${styles} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <Spinner />}
      <span className={loading ? 'opacity-90' : ''}>{children}</span>
    </button>
  )
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" fill="none" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  )
}

export function DateBlock({ date, time }: { date: string; time: string }) {
  const d = dateBlock(date)
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-5" aria-hidden="true">
      <div className="rule border-y py-2 text-center text-[clamp(1.25rem,5.6vw,2.15rem)] font-light tracking-wide text-primary-text">{d.weekday}</div>
      <div className="text-center leading-[0.95] text-primary-text">
        <div className="text-[clamp(1.6rem,7vw,2.6rem)] font-medium">{d.day}</div>
        <div className="text-[clamp(1.6rem,7vw,2.6rem)] font-medium">{d.month}</div>
      </div>
      <div className="rule border-y py-2 text-center text-[clamp(1.25rem,5.6vw,2.15rem)] font-light tracking-wide text-primary-text">
        ÀS {time}
      </div>
    </div>
  )
}

export function BackButton({ onClick, label = 'Voltar' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-normal text-ink/80 hover:text-primary-strong"
    >
      <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
        <path d="M12.5 4.5 7 10l5.5 5.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label}
    </button>
  )
}

/**
 * Seletor numérico com botões − e +, nas cores do tema da cidade.
 * Acessível: grupo rotulado, botões com nome e valor anunciado ao mudar.
 */
export function NumberStepper({
  value,
  onChange,
  min = 0,
  max = 99,
  label,
  labelId,
  describedBy,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  label: string
  labelId?: string
  describedBy?: string
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)))
  const btn =
    'grid h-12 w-12 shrink-0 place-items-center rounded-full border-2 border-primary-200 bg-white text-primary-strong transition hover:border-primary hover:bg-primary-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-primary-200 disabled:hover:bg-white'
  return (
    <div role="group" aria-labelledby={labelId} aria-label={labelId ? undefined : label} aria-describedby={describedBy} className="inline-flex items-center gap-4">
      <button type="button" className={btn} onClick={() => set(value - 1)} disabled={value <= min} aria-label={`Diminuir ${label.toLowerCase()}`}>
        <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
          <path d="M5 10h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <output aria-live="polite" className="min-w-[2.5ch] text-center text-[2rem] font-medium tabular-nums leading-none text-primary-strong" key={value}>
        <span className="anim-pop inline-block">{value}</span>
      </output>
      <button type="button" className={btn} onClick={() => set(value + 1)} disabled={value >= max} aria-label={`Aumentar ${label.toLowerCase()}`}>
        <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
          <path d="M5 10h10M10 5v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}

export function Steps({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={current} aria-label={`Etapa ${current} de ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-1.5 rounded-full transition-all ${i < current ? 'w-6 bg-primary' : 'w-1.5 bg-primary-200'}`} />
      ))}
    </div>
  )
}

export function Page({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-start px-4 py-8 sm:justify-center sm:py-14">
      {children}
      <footer className="mt-8 text-center text-xs text-ink/60">Com carinho, Thiago e Rafa 💕</footer>
    </main>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error'; children: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-2xl px-4 py-3 text-sm ${tone === 'error' ? 'bg-red-50 text-red-800' : 'bg-primary-50 text-ink'}`}
    >
      {children}
    </div>
  )
}
