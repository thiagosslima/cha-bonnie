import pg from 'pg'
import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
export const conn = {
  host: process.env.PGHOST ?? '/tmp',
  port: Number(process.env.PGPORT ?? 54329),
  user: 'postgres',
  database: process.env.PGDATABASE_TEST ?? 'bonnie_test',
}

export function resetDb() {
  execFileSync('bash', [here + 'reset-local.sh'], { stdio: 'pipe' })
}

export const ADMIN_ID = '00000000-0000-4000-8000-00000000a001'
export const OTHER_USER_ID = '00000000-0000-4000-8000-00000000b002'

export async function connect() {
  const c = new pg.Client(conn)
  await c.connect()
  return c
}

export async function seedAdmin(c) {
  await c.query(`insert into auth.users (id, email) values ($1, 'thiago@example.com'), ($2, 'intruso@example.com') on conflict do nothing`, [ADMIN_ID, OTHER_USER_ID])
  await c.query(`insert into public.admin_users (user_id, display_name) values ($1, 'Thiago') on conflict do nothing`, [ADMIN_ID])
}

/** Executa SQL como um papel do Supabase (anon/authenticated), simulando a API. */
export async function as(c, role, sql, params = [], { sub = null, ip = '203.0.113.10' } = {}) {
  await c.query('begin')
  try {
    await c.query(`select set_config('role', $1, true)`, [role])
    await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub ?? ''])
    await c.query(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'x-forwarded-for': ip })])
    const r = await c.query(sql, params)
    await c.query('commit')
    return r
  } catch (e) {
    await c.query('rollback')
    throw e
  }
}

export const anon = (c, sql, params, opts) => as(c, 'anon', sql, params, opts)
export const admin = (c, sql, params, opts) => as(c, 'authenticated', sql, params, { sub: ADMIN_ID, ...opts })

export const newToken = () => randomBytes(32).toString('base64url')
export const uuid = () => randomUUID()

export async function submit(c, slug, name, attendance, diaper, opts = {}) {
  const token = opts.token ?? newToken()
  const req = opts.req ?? uuid()
  const r =
    opts.companions === undefined
      ? await anon(c, 'select public.submit_rsvp($1,$2,$3,$4,$5,$6) as r', [slug, name, attendance, diaper, token, req], opts)
      : await anon(c, 'select public.submit_rsvp($1,$2,$3,$4,$5,$6,$7) as r', [slug, name, attendance, diaper, token, req, opts.companions], opts)
  return { token, req, rsvp: r.rows[0].r }
}

export async function errorCode(promise) {
  try {
    await promise
  } catch (e) {
    return e.message
  }
  return null
}
