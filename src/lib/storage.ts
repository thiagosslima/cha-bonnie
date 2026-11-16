/** Token secreto de edição (256 bits) gerado no navegador. O banco guarda só o hash. */
export function newEditToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let s = ''
  bytes.forEach((b) => (s += String.fromCharCode(b)))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function newRequestId(): string {
  if (crypto.randomUUID) return crypto.randomUUID()
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// localStorage só guarda a "chave" do próprio convidado neste aparelho,
// por conveniência. O registro oficial fica no banco.
const tokenKey = (slug: string) => `bonnie:rsvp-token:${slug}`

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

export const tokenStore = {
  get: (slug: string) => safe(() => localStorage.getItem(tokenKey(slug)), null),
  set: (slug: string, token: string) => safe(() => localStorage.setItem(tokenKey(slug), token), undefined),
  clear: (slug: string) => safe(() => localStorage.removeItem(tokenKey(slug)), undefined),
}

/** Rascunho do formulário durante a sessão, para voltar etapas sem perder dados. */
export const draftStore = {
  get<T>(slug: string): T | null {
    return safe(() => JSON.parse(sessionStorage.getItem(`bonnie:draft:${slug}`) ?? 'null') as T | null, null)
  },
  set(slug: string, value: unknown) {
    safe(() => sessionStorage.setItem(`bonnie:draft:${slug}`, JSON.stringify(value)), undefined)
  },
  clear(slug: string) {
    safe(() => sessionStorage.removeItem(`bonnie:draft:${slug}`), undefined)
  },
}
