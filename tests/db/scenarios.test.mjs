// Testes de integração do banco (PostgreSQL real + stub mínimo do Supabase).
// Executar: npm run test:db   (requer Postgres local; ver README)
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ADMIN_ID, OTHER_USER_ID, admin, anon, as, connect, errorCode, newToken, resetDb, seedAdmin, submit, uuid } from './helpers.mjs'

const payload = JSON.parse(readFileSync(new URL('../fixtures/import-payload.json', import.meta.url)))
let c

before(async () => {
  resetDb()
  c = await connect()
  await seedAdmin(c)
})
after(async () => c && (await c.end()))

const diaperRec = async (slug) => (await anon(c, 'select public.get_diaper_recommendation($1) r', [slug])).rows[0].r
const suggestions = async () => (await admin(c, 'select public.admin_gift_suggestions() r')).rows[0].r
const publicSuggestions = async () => (await anon(c, 'select public.get_gift_suggestions() r')).rows[0].r
const comboOf = (list) => list.map((s) => s.name).sort().join('|')
const item = async (name) => (await admin(c, 'select * from public.layette_item_totals where name = $1 order by sort_order limit 1', [name])).rows[0]
const move = (id, type, qty, extra = {}) =>
  admin(c, 'select public.admin_record_movement($1,$2,$3,$4,$5,$6,$7) r', [id, type, qty, extra.bucket ?? null, extra.notes ?? null, extra.amount ?? null, extra.req ?? null])

describe('Convite e confirmação', () => {
  test('eventos públicos trazem dados corretos e nenhum dado interno', async () => {
    const ev = (await anon(c, 'select public.get_public_events() r')).rows[0].r
    assert.equal(ev.length, 2)
    const g = ev.find((e) => e.slug === 'guarulhos')
    assert.equal(g.event_date, '2026-12-05')
    assert.equal(g.event_time, '16:00')
    assert.equal(g.theme_primary, '#C0A4ED')
    const i = ev.find((e) => e.slug === 'indaiatuba')
    assert.equal(i.event_date, '2026-11-28')
    assert.equal(i.event_time, '15:00')
    assert.equal(i.address_line1, 'Rua Christiano Seleguin, 530')
    assert.equal(i.expected_guests, undefined)
  })

  test('1. convidado confirma em Guarulhos', async () => {
    const rec = await diaperRec('guarulhos')
    assert.equal(rec.recommended, 'M')
    const { rsvp } = await submit(c, 'guarulhos', '  Ana   Paula Souza ', 'yes', 'M')
    assert.deepEqual([rsvp.guest_name, rsvp.attendance, rsvp.diaper_size, rsvp.event_slug], ['Ana Paula Souza', 'yes', 'M', 'guarulhos'])
    assert.equal((await diaperRec('guarulhos')).recommended, 'G')
  })

  test('2. convidado confirma em Indaiatuba (contagem separada por cidade)', async () => {
    assert.equal((await diaperRec('indaiatuba')).recommended, 'M')
    const { rsvp } = await submit(c, 'indaiatuba', 'Carlos Lima', 'yes', 'P')
    assert.equal(rsvp.event_slug, 'indaiatuba')
  })

  test('3. convidado indeciso não precisa de fralda', async () => {
    const { rsvp } = await submit(c, 'guarulhos', 'Beatriz Indecisa', 'maybe', 'G')
    assert.equal(rsvp.attendance, 'maybe')
    assert.equal(rsvp.diaper_size, null, 'fralda enviada por engano é descartada')
  })

  test('4. convidado que não poderá comparecer', async () => {
    const { rsvp } = await submit(c, 'indaiatuba', 'Diego Ausente', 'no', null)
    assert.equal(rsvp.attendance, 'no')
  })

  test('5. confirmar sem fralda é bloqueado', async () => {
    assert.equal(await errorCode(submit(c, 'guarulhos', 'Sem Fralda', 'yes', null)), 'DIAPER_REQUIRED')
    assert.equal(await errorCode(submit(c, 'guarulhos', '   ', 'no', null)), 'NAME_REQUIRED')
    assert.equal(await errorCode(submit(c, 'guarulhos', '<script>', 'no', null)), 'NAME_INVALID')
    assert.equal(await errorCode(submit(c, 'nao-existe', 'Fulano', 'no', null)), 'EVENT_NOT_FOUND')
  })

  test('6. convidado altera o tamanho da fralda com o link secreto', async () => {
    const { token } = await submit(c, 'guarulhos', 'Elisa Troca', 'yes', 'P')
    const r = (await anon(c, 'select public.update_my_rsvp($1,$2,$3,$4) r', [token, 'Elisa Troca', 'yes', 'XG'])).rows[0].r
    assert.equal(r.diaper_size, 'XG')
    const again = (await anon(c, 'select public.get_my_rsvp($1) r', [token])).rows[0].r
    assert.equal(again.diaper_size, 'XG')
  })

  test('7. convidado desiste: fralda sai da contagem; volta: precisa escolher fralda', async () => {
    const before = (await admin(c, 'select public.admin_diaper_stats() r')).rows[0].r
    const g = (s) => s.find((e) => e.slug === 'guarulhos').sizes.find((x) => x.diaper_size === 'G').chosen
    const { token } = await submit(c, 'guarulhos', 'Fábio Desiste', 'yes', 'G')
    const mid = (await admin(c, 'select public.admin_diaper_stats() r')).rows[0].r
    assert.equal(g(mid), g(before) + 1)
    await anon(c, 'select public.update_my_rsvp($1,$2,$3,$4)', [token, null, 'no', 'G'])
    const end = (await admin(c, 'select public.admin_diaper_stats() r')).rows[0].r
    assert.equal(g(end), g(before))
    assert.equal(await errorCode(anon(c, 'select public.update_my_rsvp($1,$2,$3,$4)', [token, null, 'yes', null])), 'DIAPER_REQUIRED')
  })

  test('cliques repetidos não duplicam a confirmação', async () => {
    const token = newToken()
    const req = uuid()
    const clients = await Promise.all([1, 2, 3].map(() => connect()))
    const results = await Promise.all(clients.map((cc) => submit(cc, 'guarulhos', 'Gabi Clique Duplo', 'yes', 'M', { token, req }).catch((e) => e)))
    await Promise.all(clients.map((cc) => cc.end()))
    assert.ok(results.every((r) => !(r instanceof Error)), 'todas as repetições respondem com sucesso')
    await submit(c, 'guarulhos', 'Gabi Clique Duplo', 'yes', 'M', { token, req })
    const n = (await admin(c, `select count(*)::int n from public.rsvps where guest_name = 'Gabi Clique Duplo'`)).rows[0].n
    assert.equal(n, 1)
    // mesma requisição com outro token não sequestra o registro
    assert.equal(await errorCode(submit(c, 'guarulhos', 'Outro', 'no', null, { token: newToken(), req })), 'INVALID_REQUEST')
  })

  test('distribuição incremental segue as metas', async () => {
    await c.query('delete from public.rsvps where event_id = (select id from public.events where slug = $1)', ['indaiatuba'])
    const picks = []
    for (let i = 0; i < 20; i++) {
      const rec = (await diaperRec('indaiatuba')).recommended
      picks.push(rec)
      await submit(c, 'indaiatuba', `Convidada ${i + 1}`, 'yes', rec, { ip: `198.51.100.${i}` })
    }
    const count = (s) => picks.filter((p) => p === s).length
    // 20 escolhas × (5,15,35,30,15)% = 1, 3, 7, 6, 3
    assert.deepEqual(['RN', 'P', 'M', 'G', 'XG'].map(count), [1, 3, 7, 6, 3])
  })

  test('19. convidado não acessa dados de outra pessoa', async () => {
    assert.equal(await errorCode(anon(c, 'select * from public.rsvps')), 'permission denied for table rsvps')
    assert.equal(await errorCode(anon(c, 'select public.get_my_rsvp($1)', [newToken()])), 'RSVP_NOT_FOUND')
    assert.equal(await errorCode(anon(c, 'select public.get_my_rsvp($1)', ['curto'])), 'INVALID_TOKEN')
    assert.equal(await errorCode(anon(c, 'select public.update_my_rsvp($1,$2,$3,$4)', [newToken(), 'X', 'no', null])), 'RSVP_NOT_FOUND')
    const rec = await diaperRec('guarulhos')
    assert.deepEqual(Object.keys(rec).sort(), ['recommended', 'sizes'])
  })

  test('limite de requisições por IP', async () => {
    let code = null
    for (let i = 0; i < 35 && !code; i++) code = await errorCode(submit(c, 'guarulhos', `Robô ${i}`, 'no', null, { ip: '192.0.2.99' }))
    assert.equal(code, 'RATE_LIMITED')
  })
})

describe('Acompanhantes e fralda por família', () => {
  const ip = (n) => ({ ip: `198.51.100.${200 + n}` })
  const stats = async (slug) => (await admin(c, 'select public.admin_diaper_stats() r')).rows[0].r.find((e) => e.slug === slug).sizes
  const chosen = (sizes, size) => sizes.find((x) => x.diaper_size === size).chosen
  const totalChosen = (sizes) => sizes.reduce((s, x) => s + x.chosen, 0)
  const update = (token, attendance, diaper, companions = null) =>
    anon(c, 'select public.update_my_rsvp($1,$2,$3,$4,$5) r', [token, null, attendance, diaper, companions]).then((r) => r.rows[0].r)

  test('registros existentes ficam com 0 acompanhantes; party_size foi substituído', async () => {
    const cols = (await c.query(`select column_name from information_schema.columns where table_schema='public' and table_name='rsvps'`)).rows.map((r) => r.column_name)
    assert.ok(cols.includes('companions_count'))
    assert.ok(!cols.includes('party_size'))
    const n = (await admin(c, 'select count(*)::int n from public.rsvps where companions_count <> 0')).rows[0].n
    assert.equal(n, 0, 'confirmações anteriores (sem o campo) contam 0 acompanhantes')
    const ev = (await anon(c, `select public.get_public_event('guarulhos') r`)).rows[0].r
    assert.equal(ev.allow_companions, true)
  })

  test('1, 2 e 3. sem acompanhantes, com um e com vários: uma fralda por família', async () => {
    const before = await stats('guarulhos')
    const solo = await submit(c, 'guarulhos', 'Helena Sozinha', 'yes', 'M', ip(1)) // chamada antiga, sem o parâmetro
    const dupla = await submit(c, 'guarulhos', 'Igor Com Um', 'yes', 'M', { ...ip(2), companions: 1 })
    const familia = await submit(c, 'guarulhos', 'Joana Família', 'yes', 'M', { ...ip(3), companions: 3 })
    assert.deepEqual([solo, dupla, familia].map((x) => x.rsvp.companions_count), [0, 1, 3])
    const after = await stats('guarulhos')
    assert.equal(chosen(after, 'M'), chosen(before, 'M') + 3, '3 famílias = 3 fraldas, não 7')
    assert.equal(totalChosen(after), totalChosen(before) + 3)
    const t = (
      await admin(
        c,
        `select count(*)::int families, sum(1 + companions_count)::int people, sum(companions_count)::int companions
           from public.rsvps where guest_name in ('Helena Sozinha', 'Igor Com Um', 'Joana Família')`,
      )
    ).rows[0]
    assert.deepEqual(t, { families: 3, people: 7, companions: 4 })
  })

  test('4. alterar acompanhantes não muda a distribuição nem a recomendação', async () => {
    const { token } = await submit(c, 'guarulhos', 'Karla Muda', 'yes', 'G', { ...ip(4), companions: 1 })
    const before = await stats('guarulhos')
    const recBefore = await diaperRec('guarulhos')
    const r = await update(token, 'yes', 'G', 5)
    assert.equal(r.companions_count, 5)
    assert.deepEqual(await stats('guarulhos'), before)
    assert.deepEqual(await diaperRec('guarulhos'), recBefore)
    // sem informar acompanhantes (versão antiga do site), o valor é mantido
    assert.equal((await update(token, 'yes', 'G')).companions_count, 5)
    assert.equal((await anon(c, 'select public.get_my_rsvp($1) r', [token])).rows[0].r.companions_count, 5)
    assert.equal(await errorCode(update(token, 'yes', 'G', -1)), 'COMPANIONS_INVALID')
    assert.equal(await errorCode(update(token, 'yes', 'G', 21)), 'COMPANIONS_INVALID')
    assert.equal(await errorCode(submit(c, 'guarulhos', 'Muitos Demais', 'yes', 'G', { ...ip(5), companions: 50 })), 'COMPANIONS_INVALID')
    // o painel também respeita o limite
    assert.match(await errorCode(admin(c, `update public.rsvps set companions_count = 99 where guest_name = 'Karla Muda'`)), /companions_count_check/)
  })

  test('5. confirmado → ausente: a fralda deixa de contar', async () => {
    const { token } = await submit(c, 'guarulhos', 'Lucas Desiste', 'yes', 'XG', { ...ip(6), companions: 2 })
    const mid = await stats('guarulhos')
    const r = await update(token, 'no', 'XG')
    assert.equal(r.diaper_size, null)
    const end = await stats('guarulhos')
    assert.equal(chosen(end, 'XG'), chosen(mid, 'XG') - 1)
    assert.equal(totalChosen(end), totalChosen(mid) - 1)
    const maybe = await update(token, 'maybe', 'XG')
    assert.equal(maybe.diaper_size, null)
    assert.equal(totalChosen(await stats('guarulhos')), totalChosen(mid) - 1)
  })

  test('6. indeciso → confirmado: exige fralda e passa a contar uma vez', async () => {
    const { token, rsvp } = await submit(c, 'guarulhos', 'Marina Indecisa', 'maybe', null, { ...ip(7), companions: 2 })
    assert.equal(rsvp.diaper_size, null)
    const before = await stats('guarulhos')
    assert.equal(await errorCode(update(token, 'yes', null)), 'DIAPER_REQUIRED')
    const r = await update(token, 'yes', 'P')
    assert.deepEqual([r.attendance, r.diaper_size, r.companions_count], ['yes', 'P', 2])
    assert.equal(chosen(await stats('guarulhos'), 'P'), chosen(before, 'P') + 1)
    // repetir a mesma alteração não duplica a escolha
    await update(token, 'yes', 'P')
    assert.equal(chosen(await stats('guarulhos'), 'P'), chosen(before, 'P') + 1)
  })

  test('evento com a pergunta desligada ignora acompanhantes', async () => {
    await admin(c, `update public.events set allow_companions = false where slug = 'indaiatuba'`)
    const { token, rsvp } = await submit(c, 'indaiatuba', 'Nina Sem Pergunta', 'yes', 'M', { ...ip(8), companions: 4 })
    assert.equal(rsvp.companions_count, 0)
    assert.equal((await update(token, 'yes', 'M', 3)).companions_count, 0)
    await admin(c, `update public.events set allow_companions = true where slug = 'indaiatuba'`)
    assert.equal((await update(token, 'yes', 'M', 3)).companions_count, 3)
  })
})

describe('Painel protegido', () => {
  test('18. usuário não autenticado ou não-admin não acessa o painel', async () => {
    for (const t of ['events', 'layette_items', 'layette_movements', 'diaper_targets', 'audit_log']) {
      assert.match(await errorCode(anon(c, `select * from public.${t}`)), /permission denied/)
    }
    assert.equal(await errorCode(anon(c, 'select public.admin_diaper_stats()')), 'permission denied for function admin_diaper_stats')
    // autenticado, mas fora de admin_users
    const other = { sub: OTHER_USER_ID }
    assert.equal((await as(c, 'authenticated', 'select count(*)::int n from public.rsvps', [], other)).rows[0].n, 0)
    assert.equal(await errorCode(as(c, 'authenticated', 'select public.admin_diaper_stats()', [], other)), 'FORBIDDEN')
    assert.equal(await errorCode(as(c, 'authenticated', 'select public.admin_import_layette($1)', ['[]'], other)), 'FORBIDDEN')
    // admin nunca lê o hash do token
    assert.match(await errorCode(admin(c, 'select edit_token_hash from public.rsvps')), /permission denied/)
  })

  test('16. administrador altera o horário de um evento (refletido no convite)', async () => {
    await admin(c, `update public.events set event_time = '16:30' where slug = 'guarulhos'`)
    const ev = (await anon(c, `select public.get_public_event('guarulhos') r`)).rows[0].r
    assert.equal(ev.event_time, '16:30')
    const audit = (await admin(c, `select count(*)::int n from public.audit_log where table_name = 'events' and actor = $1`, [ADMIN_ID])).rows[0].n
    assert.ok(audit >= 1)
    await admin(c, `update public.events set event_time = '16:00' where slug = 'guarulhos'`)
  })

  test('metas de fralda precisam somar 100%', async () => {
    const id = (await admin(c, `select id from public.events where slug='guarulhos'`)).rows[0].id
    assert.equal(await errorCode(admin(c, 'select public.admin_set_diaper_targets($1,$2)', [id, { RN: 10, P: 10, M: 10, G: 10, XG: 10 }])), 'TARGET_SUM_100')
    await admin(c, 'select public.admin_set_diaper_targets($1,$2)', [id, { RN: 0, P: 20, M: 40, G: 30, XG: 10 }])
    await admin(c, 'select public.admin_set_diaper_targets($1,$2)', [id, { RN: 5, P: 15, M: 35, G: 30, XG: 15 }])
  })

  test('17. dados continuam salvos em uma nova conexão', async () => {
    const c2 = await connect()
    const n = (await as(c2, 'authenticated', 'select count(*)::int n from public.rsvps', [], { sub: ADMIN_ID })).rows[0].n
    await c2.end()
    assert.ok(n > 20)
  })
})

describe('Enxoval e sugestões', () => {
  test('importação cria itens e é idempotente', async () => {
    const r1 = (await admin(c, 'select public.admin_import_layette($1) r', [JSON.stringify(payload)])).rows[0].r
    assert.equal(r1.created, payload.length)
    const r2 = (await admin(c, 'select public.admin_import_layette($1) r', [JSON.stringify(payload)])).rows[0].r
    assert.deepEqual(r2, { created: 0, skipped: payload.length })
    const berco = await item('Berço (ou minicama/moisés)')
    assert.equal(berco.status, 'completo')
    assert.equal(Number(berco.amount_paid_total), 750)
  })

  test('itens já adquiridos não aparecem nas sugestões', async () => {
    const names = (await suggestions()).map((s) => s.name)
    for (const n of ['Berço (ou minicama/moisés)', 'Carrinho de bebê', 'Banheira', 'Bebê conforto']) assert.ok(!names.includes(n))
  })

  test('sugestões equilibram faixas e explicam faixa vazia sem inventar preço', async () => {
    const s = await suggestions()
    assert.equal(s.length, 3)
    assert.equal(s[0].price_tier, null) // não há item barato com preço na planilha
    assert.match(s[0].reason, /Não há item elegível na faixa barata/)
    assert.equal(s[1].price_tier, 'medio')
    assert.equal(s[1].name, 'Luminária de led/abajur baixa intensidade')
    assert.equal(s[2].price_tier, 'caro')
    const pub = await publicSuggestions()
    assert.deepEqual(Object.keys(pub[0]).sort(), ['description', 'image_url', 'name', 'price_tier'])
  })

  test('8, 9, 10 e 11. compra + presente completam o item, que sai das sugestões', async () => {
    const lum = await item('Luminária de led/abajur baixa intensidade')
    assert.equal(Number(lum.pending_quantity), 1)
    // toalha: exemplo do briefing (desejado 3, comprei 1, ganhei 1, falta 1)
    const toalha = await item('Toalha de banho com capuz')
    await admin(c, 'select public.admin_set_desired_quantity($1,$2,$3)', [toalha.id, 3, 'Exemplo'])
    await move(toalha.id, 'purchase', 1, { amount: 39.9 })
    await move(toalha.id, 'gift', 1)
    let t = await item('Toalha de banho com capuz')
    assert.deepEqual([t.purchased_quantity, t.received_quantity, t.pending_quantity, t.status].map(String), ['1.00', '1.00', '1.00', 'parcial'])
    await move(toalha.id, 'gift', 1, { notes: 'Presente da tia' })
    t = await item('Toalha de banho com capuz')
    assert.equal(t.status, 'completo')
    assert.equal(Number(t.pending_quantity), 0)

    await move(lum.id, 'gift', 1)
    const names = (await suggestions()).map((s) => s.name)
    assert.ok(!names.includes(lum.name))
    assert.ok(!names.includes('Toalha de banho com capuz'))
  })

  test('movimentação repetida (mesmo client_request_id) não é processada duas vezes', async () => {
    const meias = await item('Pares de meias')
    const req = uuid()
    const clients = await Promise.all([1, 2, 3].map(() => connect()))
    const results = await Promise.all(clients.map((cc) => admin(cc, 'select public.admin_record_movement($1,$2,$3,null,null,null,$4) r', [meias.id, 'purchase', 2, req]).catch((e) => e)))
    await Promise.all(clients.map((cc) => cc.end()))
    assert.ok(results.every((r) => !(r instanceof Error)), 'todas as repetições respondem com sucesso')
    assert.equal(new Set(results.map((r) => r.rows[0].r.id)).size, 1)
    await move(meias.id, 'purchase', 2, { req })
    assert.equal(Number((await item('Pares de meias')).purchased_quantity), 2)
  })

  test('histórico é imutável e correções são auditáveis', async () => {
    const meias = await item('Pares de meias')
    assert.equal(await errorCode(c.query('delete from public.layette_movements where layette_item_id = $1', [meias.id])), 'HISTORY_IMMUTABLE')
    assert.equal(await errorCode(move(meias.id, 'correction', -5, { bucket: 'purchased' })), 'NEGATIVE_TOTAL')
    await move(meias.id, 'correction', -1, { bucket: 'purchased', notes: 'Era só 1 par' })
    const ids = async (type) => (await admin(c, `select id from public.layette_movements where layette_item_id = $1 and movement_type = $2 order by created_at limit 1`, [meias.id, type])).rows[0].id
    await admin(c, 'select public.admin_reverse_movement($1, $2)', [await ids('correction'), 'Na verdade eram 2'])
    assert.equal(Number((await item('Pares de meias')).purchased_quantity), 2)
    const purchase = await ids('purchase')
    await admin(c, 'select public.admin_reverse_movement($1, $2)', [purchase, 'Lançado no item errado'])
    assert.equal(await errorCode(admin(c, 'select public.admin_reverse_movement($1, null)', [purchase])), 'ALREADY_REVERSED')
    assert.equal(Number((await item('Pares de meias')).purchased_quantity), 0)
    const hist = (await admin(c, 'select movement_type, quantity::float q, created_by_name from public.layette_movements where layette_item_id = $1 order by created_at', [meias.id])).rows
    assert.deepEqual(hist.map((h) => [h.movement_type, h.q]), [['purchase', 2], ['correction', -1], ['reversal', 1], ['reversal', -2]])
    assert.equal(hist[0].created_by_name, 'Thiago')
  })

  test('12 e 13. item descartado sai das sugestões e volta ao ser restaurado', async () => {
    const before = await suggestions()
    const caro = before.find((s) => s.price_tier === 'caro')
    await admin(c, 'select public.admin_set_discarded($1, true, $2)', [caro.item_id, 'Não precisamos mais'])
    assert.equal((await item(caro.name)).status, 'descartado')
    const mid = await suggestions()
    assert.ok(!mid.some((s) => s.item_id === caro.item_id))
    assert.equal(mid.find((s) => s.slot === 3).price_tier, 'caro', 'outro item caro ocupa o lugar')
    await admin(c, 'select public.admin_set_discarded($1, false, $2)', [caro.item_id, 'Mudamos de ideia'])
    assert.ok((await suggestions()).some((s) => s.item_id === caro.item_id))
  })

  test('14. sugestão de preço médio é substituída (fixação manual)', async () => {
    await admin(c, `update public.layette_items set estimated_unit_price = 59.9 where name in ('Almofada de amamentação', 'Babá eletrônica')`)
    await admin(c, `update public.layette_items set estimated_unit_price = 25 where name = 'Paninhos de boca'`)
    const s = await suggestions()
    assert.equal(s[0].name, 'Paninhos de boca')
    const medio = s.find((x) => x.slot === 2)
    const outro = medio.name === 'Babá eletrônica' ? 'Almofada de amamentação' : 'Babá eletrônica'
    const outroId = (await item(outro)).id
    await admin(c, 'select public.admin_set_gift_pin(2::smallint, $1)', [outroId])
    const s2 = await suggestions()
    assert.equal(s2[1].item_id, outroId)
    assert.equal(s2[1].pinned, true)
    // fixação deixa de valer quando o item fica completo
    await move(outroId, 'gift', 1)
    const s3 = await suggestions()
    assert.notEqual(s3[1].item_id, outroId)
    assert.equal(s3[1].pinned, false)
  })

  test('10, 11 e 12. sorteio: varia, equilibra faixas e nunca traz itens completos ou descartados', async () => {
    await admin(c, 'select public.admin_set_gift_pin(2::smallint, null)')
    // dá preço a alguns itens pendentes para haver alternativas em cada faixa
    const priced = async (price, offset) =>
      admin(
        c,
        `update public.layette_items set estimated_unit_price = $1 where id in (
           select id from public.layette_item_totals
            where is_gift_eligible and not is_discarded and pending_quantity > 0 and estimated_unit_price is null
            order by sort_order limit 4 offset $2)`,
        [price, offset],
      )
    await priced(20, 0)
    await priced(70, 0)
    await priced(180, 0)

    const draw = async () => (await admin(c, 'select public.admin_gift_suggestions(true) r')).rows[0].r
    const combos = new Set()
    const descartado = (await draw()).find((s) => s.price_tier === 'barato')
    await admin(c, 'select public.admin_set_discarded($1, true, null)', [descartado.item_id])
    for (let i = 0; i < 25; i++) {
      const s = await draw()
      assert.equal(s.length, 3)
      assert.deepEqual(s.map((x) => x.price_tier), ['barato', 'medio', 'caro'], 'uma barata, uma média e uma cara')
      assert.equal(new Set(s.map((x) => x.item_id)).size, 3, 'sem repetir produto na mesma seleção')
      assert.ok(!s.some((x) => x.item_id === descartado.item_id), 'descartado nunca aparece')
      const rows = (await admin(c, 'select status, pending_quantity::float p from public.layette_item_totals where id = any($1::uuid[])', [s.map((x) => x.item_id)])).rows
      assert.ok(rows.every((r) => r.status !== 'completo' && r.status !== 'descartado' && r.p > 0), 'só itens com quantidade pendente')
      combos.add(s.map((x) => x.item_id).sort().join())
    }
    assert.ok(combos.size > 1, `o sorteio varia (${combos.size} combinações)`)
    await admin(c, 'select public.admin_set_discarded($1, false, null)', [descartado.item_id])

    // convidado: a cada chamada um novo sorteio, sem expor dados internos e sem gravar nada
    const movesBefore = (await admin(c, 'select count(*)::int n from public.layette_movements')).rows[0].n
    const pub = new Set()
    for (let i = 0; i < 15; i++) pub.add(comboOf(await publicSuggestions()))
    assert.ok(pub.size > 1)
    assert.deepEqual(Object.keys((await publicSuggestions())[0]).sort(), ['description', 'image_url', 'name', 'price_tier'])
    assert.equal((await admin(c, 'select count(*)::int n from public.layette_movements')).rows[0].n, movesBefore, 'exibir não registra nada')

    // fixação continua valendo durante o sorteio
    const fixo = (await draw())[0]
    await admin(c, 'select public.admin_set_gift_pin(1::smallint, $1)', [fixo.item_id])
    for (let i = 0; i < 5; i++) assert.equal((await draw())[0].item_id, fixo.item_id)
    await admin(c, 'select public.admin_set_gift_pin(1::smallint, null)')

    // sem sorteio (padrão do painel antigo): continua determinístico
    assert.deepEqual(await suggestions(), await suggestions())
  })

  test('15. faixa sem itens elegíveis usa outra faixa; menos itens que posições', async () => {
    await admin(c, `update public.layette_items set is_gift_eligible = false where name <> 'Paninhos de boca'`)
    const s = await suggestions()
    assert.equal(s.length, 1)
    assert.equal(s[0].name, 'Paninhos de boca')
    await admin(c, `update public.layette_items set is_gift_eligible = false`)
    assert.deepEqual(await publicSuggestions(), [])
  })

  test('20. importação sinaliza e não duplica itens repetidos', async () => {
    const dup = [
      { import_key: 'teste|x|item a', category: 'Teste', name: 'Item A', desired_quantity: 1, movements: [] },
      { import_key: 'teste|x|item a', category: 'Teste', name: 'Item A', desired_quantity: 1, movements: [] },
    ]
    const r = (await admin(c, 'select public.admin_import_layette($1) r', [JSON.stringify(dup)])).rows[0].r
    assert.deepEqual(r, { created: 1, skipped: 1 })
  })
})
