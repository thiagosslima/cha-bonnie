-- =====================================================================
-- Funções: fluxo público do convidado, fraldas, sugestões e enxoval
-- Erros usam códigos estáveis (ex.: NAME_REQUIRED) traduzidos no frontend.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Auxiliares privados
-- ---------------------------------------------------------------------
create or replace function private.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.rate_limit(p_scope text, p_limit integer, p_window interval)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_headers json;
  v_ip text;
  v_bucket text;
  v_window timestamptz;
  v_hits integer;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_headers := null;
  end;
  v_ip := coalesce(
    split_part(v_headers ->> 'x-forwarded-for', ',', 1),
    v_headers ->> 'x-real-ip',
    v_headers ->> 'cf-connecting-ip',
    'unknown'
  );
  v_bucket := p_scope || ':' || encode(extensions.digest(btrim(v_ip), 'sha256'), 'hex');
  v_window := to_timestamp(floor(extract(epoch from now()) / extract(epoch from p_window)) * extract(epoch from p_window));

  insert into private.rate_limits (bucket, window_start, hits)
  values (v_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = private.rate_limits.hits + 1
  returning hits into v_hits;

  if random() < 0.02 then
    delete from private.rate_limits where window_start < now() - interval '2 days';
  end if;

  if v_hits > p_limit then
    raise exception 'RATE_LIMITED';
  end if;
end;
$$;

create or replace function private.token_hash(p_token text)
returns bytea
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,128}$' then
    raise exception 'INVALID_TOKEN';
  end if;
  return extensions.digest(p_token, 'sha256');
end;
$$;

create or replace function private.clean_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if v = '' then
    raise exception 'NAME_REQUIRED';
  end if;
  if length(v) < 2 or length(v) > 120 or v ~ '[[:cntrl:]<>]' or v !~ '[[:alpha:]]' then
    raise exception 'NAME_INVALID';
  end if;
  return v;
end;
$$;

create or replace function private.public_event_json(e public.events)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id, 'slug', e.slug, 'city', e.city, 'state', e.state, 'title', e.title,
    'event_date', e.event_date, 'event_time', to_char(e.event_time, 'HH24:MI'),
    'venue', e.venue, 'venue_detail', e.venue_detail,
    'address_line1', e.address_line1, 'address_line2', e.address_line2,
    'maps_url', e.maps_url, 'theme_primary', e.theme_primary, 'theme_soft', e.theme_soft, 'heart_emoji', e.heart_emoji,
    'welcome_message', e.welcome_message, 'msg_confirmed', e.msg_confirmed,
    'msg_maybe', e.msg_maybe, 'msg_declined', e.msg_declined, 'rsvp_open', e.rsvp_open
  );
$$;

-- ---------------------------------------------------------------------
-- Distribuição de fraldas
-- Alocação incremental determinística: para a próxima escolha, o tamanho
-- recomendado é o que mais aproxima a distribuição atual da desejada,
-- isto é, o de maior déficit  meta% × (n+1) − escolhidos.
-- Empates: maior meta, depois a ordem natural RN → XG.
-- ---------------------------------------------------------------------
create or replace function private.diaper_distribution(p_event_id uuid)
returns table (
  diaper_size public.diaper_size,
  target_percentage numeric,
  chosen integer,
  current_percentage numeric,
  deficit numeric,
  is_recommended boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with sizes as (
    select s::public.diaper_size as size from unnest(enum_range(null::public.diaper_size)) s
  ),
  t as (
    select sz.size, coalesce(dt.target_percentage, 0) as pct
    from sizes sz
    left join public.diaper_targets dt on dt.event_id = p_event_id and dt.diaper_size = sz.size
  ),
  tot as (select nullif(sum(pct), 0) as total_pct from t),
  c as (
    select r.diaper_size as size, count(*)::int as n
    from public.rsvps r
    where r.event_id = p_event_id and r.attendance = 'yes' and r.diaper_size is not null
    group by r.diaper_size
  ),
  n as (select coalesce(sum(n), 0)::int as total from c),
  calc as (
    select t.size, t.pct, coalesce(c.n, 0) as chosen,
           case when n.total = 0 then 0 else round(coalesce(c.n, 0) * 100.0 / n.total, 1) end as cur,
           (t.pct / coalesce(tot.total_pct, 1)) * (n.total + 1) - coalesce(c.n, 0) as deficit
    from t
    left join c on c.size = t.size
    cross join n
    cross join tot
  ),
  best as (
    select size from calc where pct > 0
    order by deficit desc, pct desc, size asc
    limit 1
  )
  select calc.size, calc.pct, calc.chosen, calc.cur, round(calc.deficit, 4), coalesce(calc.size = best.size, false)
  from calc left join best on true
  order by calc.size;
$$;

-- ---------------------------------------------------------------------
-- Sugestões de presentes (núcleo compartilhado entre convite e painel)
-- ---------------------------------------------------------------------
create or replace function private.gift_candidates()
returns table (
  id uuid, name text, description text, category text, subcategory text, image_url text,
  price_tier text, estimated_unit_price numeric, pending_quantity numeric, unit text,
  priority public.item_priority, score numeric, first_word text, group_key text
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.name, t.description, t.category, t.subcategory, t.image_url, t.price_tier,
         t.estimated_unit_price, t.pending_quantity, t.unit, t.priority,
         (case t.priority when 'alta' then 300 when 'media' then 200 else 100 end)
           + least(t.pending_quantity / t.desired_quantity, 1) * 40
           + case when t.estimated_unit_price is not null then 15 else 0 end
           - t.sort_order * 0.0001,
         split_part(private.normalize_text(t.name), ' ', 1),
         coalesce(t.subcategory, t.category)
  from public.layette_item_totals t
  where not t.is_discarded
    and t.is_gift_eligible
    and t.desired_quantity is not null
    and t.pending_quantity > 0;
$$;

-- Seleciona preferencialmente uma sugestão barata, uma média e uma mais cara.
-- Regras: respeita fixações válidas; evita itens parecidos (mesma palavra
-- inicial ou mesmo grupo); se a faixa não tem itens, usa outra faixa e, por
-- fim, itens ainda sem preço. Nunca inventa itens: se houver menos
-- candidatos, devolve menos sugestões.
create or replace function private.gift_suggestions()
returns table (
  slot smallint,
  item_id uuid,
  name text,
  description text,
  category text,
  subcategory text,
  image_url text,
  price_tier text,
  estimated_unit_price numeric,
  pending_quantity numeric,
  unit text,
  priority public.item_priority,
  pinned boolean,
  reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_count integer := 3;
  v_unpriced boolean := true;
  v_tiers text[] := array['barato', 'medio', 'caro'];
  v_label jsonb := '{"barato":"barata","medio":"de preço médio","caro":"mais cara"}';
  v_item uuid[] := array[null, null, null, null, null, null]::uuid[];
  v_reason text[] := array[null, null, null, null, null, null]::text[];
  v_pinned boolean[] := array[false, false, false, false, false, false];
  v_groups text[] := '{}';
  v_words text[] := '{}';
  v_slot integer;
  v_pass integer;
  v_target text;
  rec record;
begin
  select s.recommendation_count, s.include_unpriced_fallback into v_count, v_unpriced
  from public.gift_recommendation_settings s where s.id = 1;
  v_count := least(coalesce(v_count, 3), 6);
  v_unpriced := coalesce(v_unpriced, true);

  -- Passo 1: fixações manuais válidas (item pendente, elegível, não descartado)
  for v_slot in 1 .. v_count loop
    select c.* into rec
    from public.gift_recommendation_pins p
    join private.gift_candidates() c on c.id = p.layette_item_id
    where p.display_order = v_slot;
    if found then
      v_item[v_slot] := rec.id;
      v_pinned[v_slot] := true;
      v_reason[v_slot] := 'Fixado manualmente pelos administradores.';
      v_groups := v_groups || rec.group_key;
      v_words := v_words || rec.first_word;
    end if;
  end loop;

  -- Passo 2: cada posição recebe o melhor item da sua faixa (barato, médio, caro)
  -- Passo 3: posições ainda vazias usam a faixa vizinha, itens sem preço e, por fim, a faixa oposta
  for v_pass in 2 .. 3 loop
    for v_slot in 1 .. v_count loop
      continue when v_item[v_slot] is not null;
      v_target := v_tiers[((v_slot - 1) % 3) + 1];
      select c.* into rec from private.gift_candidates() c
      where not (c.id = any (array_remove(v_item, null)))
        and not exists (select 1 from public.gift_recommendation_pins p where p.layette_item_id = c.id)
        and case when v_pass = 2 then c.price_tier = v_target
                 else (c.price_tier is not null or v_unpriced) end
      order by
               -- faixa vizinha primeiro; depois itens sem preço; por último a faixa oposta
               case
                 when c.price_tier is null then 2
                 when abs(array_position(v_tiers, c.price_tier) - array_position(v_tiers, v_target)) <= 1 then 1
                 else 3
               end asc,
               (c.first_word = any (v_words)) asc,
               (c.group_key = any (v_groups)) asc,
               c.score desc, c.name asc, c.id asc
      limit 1;
      if found then
        v_item[v_slot] := rec.id;
        v_groups := v_groups || rec.group_key;
        v_words := v_words || rec.first_word;
        v_reason[v_slot] := case when v_pass = 2 then
            format('Sugestão %s: prioridade %s, faltam %s %s.', v_label ->> v_target, case rec.priority when 'alta' then 'alta' when 'media' then 'média' else 'baixa' end,
                   trim(to_char(rec.pending_quantity, 'FM999990.##')), rec.unit)
          else
            format('Não há item elegível na faixa %s; usando %s (prioridade %s, faltam %s %s).', v_label ->> v_target,
                   coalesce('uma sugestão ' || (v_label ->> rec.price_tier), 'um item ainda sem preço cadastrado'),
                   case rec.priority when 'alta' then 'alta' when 'media' then 'média' else 'baixa' end, trim(to_char(rec.pending_quantity, 'FM999990.##')), rec.unit)
          end;
      end if;
    end loop;
  end loop;

  return query
  select s.n::smallint, c.id, c.name, c.description, c.category, c.subcategory, c.image_url, c.price_tier,
         c.estimated_unit_price, c.pending_quantity, c.unit, c.priority, v_pinned[s.n], v_reason[s.n]
  from generate_series(1, v_count) as s(n)
  join private.gift_candidates() c on c.id = v_item[s.n]
  order by s.n;
end;
$$;

-- =====================================================================
-- RPCs PÚBLICAS (convidados, papel anon)
-- =====================================================================

create or replace function public.get_public_events()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.public_event_json(e) order by e.sort_order, e.event_date), '[]'::jsonb)
  from public.events e
  where e.is_active;
$$;

create or replace function public.get_public_event(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.events;
begin
  select * into e from public.events where slug = lower(p_slug) and is_active;
  if not found then
    raise exception 'EVENT_NOT_FOUND';
  end if;
  return private.public_event_json(e);
end;
$$;

create or replace function public.get_diaper_recommendation(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event uuid;
  v_rec text;
begin
  select id into v_event from public.events where slug = lower(p_slug) and is_active;
  if v_event is null then
    raise exception 'EVENT_NOT_FOUND';
  end if;
  select d.diaper_size::text into v_rec from private.diaper_distribution(v_event) d where d.is_recommended;
  -- Não expõe contagens nem dados de outros convidados.
  return jsonb_build_object('recommended', v_rec,
    'sizes', (select jsonb_agg(d.diaper_size::text order by d.diaper_size)
              from private.diaper_distribution(v_event) d where d.target_percentage > 0));
end;
$$;

create or replace function private.rsvp_public_json(r public.rsvps)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'guest_name', r.guest_name, 'attendance', r.attendance, 'diaper_size', r.diaper_size,
    'event_slug', (select slug from public.events where id = r.event_id),
    'created_at', r.created_at, 'updated_at', r.updated_at
  );
$$;

-- O token é gerado no navegador (crypto.getRandomValues, 256 bits) e o banco
-- guarda apenas o hash SHA-256. Repetir a mesma requisição (clique duplo,
-- reenvio após falha de rede) devolve o mesmo registro, sem duplicar.
create or replace function public.submit_rsvp(
  p_slug text,
  p_guest_name text,
  p_attendance public.attendance_status,
  p_diaper_size public.diaper_size,
  p_edit_token text,
  p_client_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_name text;
  v_hash bytea;
  v_row public.rsvps;
begin
  if p_client_request_id is null then
    raise exception 'INVALID_REQUEST';
  end if;
  v_hash := private.token_hash(p_edit_token);

  select * into v_row from public.rsvps where client_request_id = p_client_request_id;
  if found then
    if v_row.edit_token_hash <> v_hash then
      raise exception 'INVALID_REQUEST';
    end if;
    return private.rsvp_public_json(v_row);
  end if;

  perform private.rate_limit('submit', 30, interval '1 hour');

  select * into v_event from public.events where slug = lower(p_slug) and is_active;
  if not found then
    raise exception 'EVENT_NOT_FOUND';
  end if;
  if not v_event.rsvp_open then
    raise exception 'RSVP_CLOSED';
  end if;

  v_name := private.clean_name(p_guest_name);
  if p_attendance is null then
    raise exception 'ATTENDANCE_REQUIRED';
  end if;
  if p_attendance = 'yes' and p_diaper_size is null then
    raise exception 'DIAPER_REQUIRED';
  end if;

  insert into public.rsvps (event_id, guest_name, guest_name_normalized, attendance, diaper_size, edit_token_hash, client_request_id)
  values (v_event.id, v_name, '', p_attendance,
          case when p_attendance = 'yes' then p_diaper_size end, v_hash, p_client_request_id)
  on conflict (client_request_id) do nothing
  returning * into v_row;

  if v_row.id is null then
    -- corrida entre duas requisições idênticas
    select * into v_row from public.rsvps where client_request_id = p_client_request_id and edit_token_hash = v_hash;
    if not found then
      raise exception 'INVALID_REQUEST';
    end if;
  end if;
  return private.rsvp_public_json(v_row);
exception
  when unique_violation then
    raise exception 'INVALID_REQUEST';
end;
$$;

create or replace function public.get_my_rsvp(p_edit_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.rsvps;
begin
  select * into v_row from public.rsvps where edit_token_hash = private.token_hash(p_edit_token);
  if not found then
    raise exception 'RSVP_NOT_FOUND';
  end if;
  return private.rsvp_public_json(v_row);
end;
$$;

create or replace function public.update_my_rsvp(
  p_edit_token text,
  p_guest_name text,
  p_attendance public.attendance_status,
  p_diaper_size public.diaper_size
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.rsvps;
  v_event public.events;
begin
  perform private.rate_limit('update', 60, interval '1 hour');
  select * into v_row from public.rsvps where edit_token_hash = private.token_hash(p_edit_token) for update;
  if not found then
    raise exception 'RSVP_NOT_FOUND';
  end if;
  select * into v_event from public.events where id = v_row.event_id;
  if not v_event.rsvp_open then
    raise exception 'RSVP_CLOSED';
  end if;
  if p_attendance is null then
    raise exception 'ATTENDANCE_REQUIRED';
  end if;
  if p_attendance = 'yes' and p_diaper_size is null then
    raise exception 'DIAPER_REQUIRED';
  end if;

  update public.rsvps
     set guest_name = private.clean_name(coalesce(p_guest_name, v_row.guest_name)),
         attendance = p_attendance,
         diaper_size = case when p_attendance = 'yes' then p_diaper_size end
   where id = v_row.id
  returning * into v_row;
  return private.rsvp_public_json(v_row);
end;
$$;

create or replace function public.get_gift_suggestions()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', g.name,
    -- Sem descrição cadastrada, mostra a faixa de idade apenas para roupinhas.
    'description', coalesce(g.description, case when g.category ilike '%roupa%' then g.subcategory end),
    'image_url', g.image_url,
    'price_tier', case when s.show_tier_to_guests then g.price_tier end
  ) order by case g.price_tier when 'barato' then 1 when 'medio' then 2 when 'caro' then 3 else 4 end, g.slot), '[]'::jsonb)
  from private.gift_suggestions() g
  left join public.gift_recommendation_settings s on s.id = 1;
$$;

-- =====================================================================
-- RPCs ADMINISTRATIVAS (exigem usuário em admin_users)
-- =====================================================================

create or replace function public.admin_diaper_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.require_admin();
  select jsonb_agg(jsonb_build_object(
    'event_id', e.id, 'slug', e.slug, 'city', e.city, 'theme_primary', e.theme_primary,
    'sizes', (select jsonb_agg(to_jsonb(d) order by d.diaper_size) from private.diaper_distribution(e.id) d)
  ) order by e.sort_order)
  into v
  from public.events e;
  return coalesce(v, '[]'::jsonb);
end;
$$;

create or replace function public.admin_set_diaper_targets(p_event_id uuid, p_targets jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sum numeric := 0;
  v_size public.diaper_size;
  v_val numeric;
begin
  perform private.require_admin();
  for v_size in select unnest(enum_range(null::public.diaper_size)) loop
    v_val := coalesce((p_targets ->> v_size::text)::numeric, 0);
    if v_val < 0 or v_val > 100 then
      raise exception 'TARGET_INVALID';
    end if;
    v_sum := v_sum + v_val;
  end loop;
  if abs(v_sum - 100) > 0.01 then
    raise exception 'TARGET_SUM_100';
  end if;
  for v_size in select unnest(enum_range(null::public.diaper_size)) loop
    insert into public.diaper_targets (event_id, diaper_size, target_percentage)
    values (p_event_id, v_size, coalesce((p_targets ->> v_size::text)::numeric, 0))
    on conflict (event_id, diaper_size) do update set target_percentage = excluded.target_percentage;
  end loop;
end;
$$;

create or replace function public.admin_gift_suggestions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(to_jsonb(g) order by g.slot) from private.gift_suggestions() g), '[]'::jsonb);
end;
$$;

create or replace function public.admin_set_gift_pin(p_slot smallint, p_item_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  delete from public.gift_recommendation_pins where display_order = p_slot;
  if p_item_id is not null then
    delete from public.gift_recommendation_pins where layette_item_id = p_item_id;
    insert into public.gift_recommendation_pins (display_order, layette_item_id) values (p_slot, p_item_id);
  end if;
end;
$$;

-- Registra uma movimentação de quantidade com bloqueio de linha (consistência)
-- e idempotência por client_request_id (cliques repetidos não duplicam).
create or replace function public.admin_record_movement(
  p_item_id uuid,
  p_type public.movement_type,
  p_quantity numeric,
  p_bucket text default null,
  p_notes text default null,
  p_amount_paid numeric default null,
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item public.layette_items;
  v_existing public.layette_movements;
  v_bucket text;
  v_qty numeric := p_quantity;
  v_tot record;
  v_name text;
  v_mov public.layette_movements;
begin
  perform private.require_admin();
  -- Bloqueia o item primeiro: requisições simultâneas são serializadas e a
  -- repetida enxerga a primeira já gravada (idempotência real).
  select * into v_item from public.layette_items where id = p_item_id for update;
  if not found then
    raise exception 'ITEM_NOT_FOUND';
  end if;
  if p_client_request_id is not null then
    select * into v_existing from public.layette_movements where client_request_id = p_client_request_id;
    if found then
      return to_jsonb(v_existing);
    end if;
  end if;
  if v_qty is null or v_qty = 0 or abs(v_qty) > 10000 then
    raise exception 'QUANTITY_INVALID';
  end if;

  case p_type
    when 'purchase' then v_bucket := 'purchased';
    when 'gift' then v_bucket := 'received';
    when 'borrow' then v_bucket := 'borrowed';
    when 'return_borrowed' then v_bucket := 'borrowed'; v_qty := -abs(v_qty);
    when 'correction' then
      v_bucket := p_bucket;
      if v_bucket not in ('purchased', 'received', 'borrowed') then
        raise exception 'BUCKET_INVALID';
      end if;
    else
      raise exception 'MOVEMENT_TYPE_INVALID';
  end case;
  if p_type in ('purchase', 'gift', 'borrow') and v_qty < 0 then
    raise exception 'QUANTITY_INVALID';
  end if;

  select purchased_quantity, received_quantity, borrowed_quantity into v_tot
  from public.layette_item_totals where id = p_item_id;
  if (v_bucket = 'purchased' and v_tot.purchased_quantity + v_qty < 0)
     or (v_bucket = 'received' and v_tot.received_quantity + v_qty < 0)
     or (v_bucket = 'borrowed' and v_tot.borrowed_quantity + v_qty < 0) then
    raise exception 'NEGATIVE_TOTAL';
  end if;

  select display_name into v_name from public.admin_users where user_id = auth.uid();
  insert into public.layette_movements (layette_item_id, movement_type, bucket, quantity, unit, amount_paid,
                                        notes, created_by, created_by_name, client_request_id)
  values (p_item_id, p_type, v_bucket, v_qty, v_item.unit, p_amount_paid,
          nullif(btrim(p_notes), ''), auth.uid(), v_name, p_client_request_id)
  returning * into v_mov;
  update public.layette_items set updated_at = now() where id = p_item_id;
  return to_jsonb(v_mov);
end;
$$;

create or replace function public.admin_set_desired_quantity(
  p_item_id uuid,
  p_desired numeric,
  p_notes text default null,
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item public.layette_items;
  v_mov public.layette_movements;
  v_name text;
begin
  perform private.require_admin();
  if p_desired is not null and (p_desired <= 0 or p_desired > 10000) then
    raise exception 'QUANTITY_INVALID';
  end if;
  select * into v_item from public.layette_items where id = p_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  if p_client_request_id is not null then
    select * into v_mov from public.layette_movements where client_request_id = p_client_request_id;
    if found then return to_jsonb(v_mov); end if;
  end if;
  select display_name into v_name from public.admin_users where user_id = auth.uid();
  insert into public.layette_movements (layette_item_id, movement_type, previous_value, new_value, unit, notes,
                                        created_by, created_by_name, client_request_id)
  values (p_item_id, 'desired_change', v_item.desired_quantity, p_desired, v_item.unit, nullif(btrim(p_notes), ''),
          auth.uid(), v_name, p_client_request_id)
  returning * into v_mov;
  update public.layette_items set desired_quantity = p_desired, needs_review = false where id = p_item_id;
  return to_jsonb(v_mov);
end;
$$;

create or replace function public.admin_set_discarded(
  p_item_id uuid,
  p_discarded boolean,
  p_notes text default null,
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item public.layette_items;
  v_mov public.layette_movements;
  v_name text;
begin
  perform private.require_admin();
  select * into v_item from public.layette_items where id = p_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  if p_client_request_id is not null then
    select * into v_mov from public.layette_movements where client_request_id = p_client_request_id;
    if found then return to_jsonb(v_mov); end if;
  end if;
  if v_item.is_discarded = p_discarded then
    raise exception 'NO_CHANGE';
  end if;
  select display_name into v_name from public.admin_users where user_id = auth.uid();
  insert into public.layette_movements (layette_item_id, movement_type, unit, notes, created_by, created_by_name, client_request_id)
  values (p_item_id, case when p_discarded then 'discard' else 'restore' end::public.movement_type, v_item.unit,
          nullif(btrim(p_notes), ''), auth.uid(), v_name, p_client_request_id)
  returning * into v_mov;
  update public.layette_items set is_discarded = p_discarded where id = p_item_id;
  return to_jsonb(v_mov);
end;
$$;

-- Desfaz uma movimentação de quantidade criando uma reversão (o original permanece no histórico).
create or replace function public.admin_reverse_movement(p_movement_id uuid, p_notes text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_orig public.layette_movements;
  v_tot record;
  v_mov public.layette_movements;
  v_name text;
begin
  perform private.require_admin();
  select * into v_orig from public.layette_movements where id = p_movement_id;
  if not found then raise exception 'MOVEMENT_NOT_FOUND'; end if;
  if v_orig.bucket is null or v_orig.movement_type = 'reversal' then
    raise exception 'MOVEMENT_NOT_REVERSIBLE';
  end if;
  if exists (select 1 from public.layette_movements where reverses_movement_id = p_movement_id) then
    raise exception 'ALREADY_REVERSED';
  end if;
  perform 1 from public.layette_items where id = v_orig.layette_item_id for update;
  select purchased_quantity, received_quantity, borrowed_quantity into v_tot
  from public.layette_item_totals where id = v_orig.layette_item_id;
  if (v_orig.bucket = 'purchased' and v_tot.purchased_quantity - v_orig.quantity < 0)
     or (v_orig.bucket = 'received' and v_tot.received_quantity - v_orig.quantity < 0)
     or (v_orig.bucket = 'borrowed' and v_tot.borrowed_quantity - v_orig.quantity < 0) then
    raise exception 'NEGATIVE_TOTAL';
  end if;
  select display_name into v_name from public.admin_users where user_id = auth.uid();
  insert into public.layette_movements (layette_item_id, movement_type, bucket, quantity, unit, amount_paid,
                                        reverses_movement_id, notes, created_by, created_by_name)
  values (v_orig.layette_item_id, 'reversal', v_orig.bucket, -v_orig.quantity, v_orig.unit, v_orig.amount_paid,
          v_orig.id, coalesce(nullif(btrim(p_notes), ''), 'Movimentação desfeita'), auth.uid(), v_name)
  returning * into v_mov;
  return to_jsonb(v_mov);
end;
$$;

-- Importação inicial não destrutiva: cria apenas itens cujo import_key ainda
-- não existe. Tudo ocorre em uma única transação.
create or replace function public.admin_import_layette(p_items jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_el jsonb;
  v_id uuid;
  v_created integer := 0;
  v_skipped integer := 0;
  v_mov jsonb;
  v_name text;
begin
  perform private.require_admin();
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 2000 then
    raise exception 'IMPORT_INVALID';
  end if;
  select display_name into v_name from public.admin_users where user_id = auth.uid();

  for v_el in select * from jsonb_array_elements(p_items) loop
    if coalesce(v_el ->> 'import_key', '') = '' or coalesce(v_el ->> 'name', '') = '' then
      raise exception 'IMPORT_INVALID';
    end if;
    insert into public.layette_items (
      import_key, category, subcategory, name, description, original_quantity_text, desired_quantity, unit,
      estimated_unit_price, reference_price, priority, is_gift_eligible, is_discarded, reference_url, notes,
      also_in_lists, needs_review, review_notes, sort_order)
    values (
      v_el ->> 'import_key', v_el ->> 'category', nullif(v_el ->> 'subcategory', ''), v_el ->> 'name',
      nullif(v_el ->> 'description', ''), nullif(v_el ->> 'original_quantity_text', ''),
      nullif(v_el ->> 'desired_quantity', '')::numeric, coalesce(nullif(v_el ->> 'unit', ''), 'unidade'),
      nullif(v_el ->> 'estimated_unit_price', '')::numeric, nullif(v_el ->> 'reference_price', '')::numeric,
      coalesce(nullif(v_el ->> 'priority', ''), 'media')::public.item_priority,
      coalesce((v_el ->> 'is_gift_eligible')::boolean, true), coalesce((v_el ->> 'is_discarded')::boolean, false),
      nullif(v_el ->> 'reference_url', ''), nullif(v_el ->> 'notes', ''),
      coalesce(array(select jsonb_array_elements_text(v_el -> 'also_in_lists')), '{}'),
      coalesce((v_el ->> 'needs_review')::boolean, false), nullif(v_el ->> 'review_notes', ''),
      coalesce((v_el ->> 'sort_order')::integer, 0))
    on conflict (import_key) do nothing
    returning id into v_id;

    if v_id is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_created := v_created + 1;

    for v_mov in select * from jsonb_array_elements(coalesce(v_el -> 'movements', '[]'::jsonb)) loop
      if (v_mov ->> 'bucket') not in ('purchased', 'received', 'borrowed') or (v_mov ->> 'quantity')::numeric <= 0 then
        raise exception 'IMPORT_INVALID';
      end if;
      insert into public.layette_movements (layette_item_id, movement_type, bucket, quantity, unit, amount_paid,
                                            notes, created_by, created_by_name)
      values (v_id, 'import', v_mov ->> 'bucket', (v_mov ->> 'quantity')::numeric,
              coalesce(nullif(v_el ->> 'unit', ''), 'unidade'), nullif(v_mov ->> 'amount_paid', '')::numeric,
              coalesce(v_mov ->> 'notes', 'Importado da planilha'), auth.uid(), v_name);
    end loop;
    v_id := null;
  end loop;

  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end;
$$;

-- ---------------------------------------------------------------------
-- Permissões das funções
-- ---------------------------------------------------------------------
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin() to anon, authenticated;

grant execute on function public.get_public_events() to anon, authenticated;
grant execute on function public.get_public_event(text) to anon, authenticated;
grant execute on function public.get_diaper_recommendation(text) to anon, authenticated;
grant execute on function public.submit_rsvp(text, text, public.attendance_status, public.diaper_size, text, uuid) to anon, authenticated;
grant execute on function public.get_my_rsvp(text) to anon, authenticated;
grant execute on function public.update_my_rsvp(text, text, public.attendance_status, public.diaper_size) to anon, authenticated;
grant execute on function public.get_gift_suggestions() to anon, authenticated;

grant execute on function public.admin_diaper_stats() to authenticated;
grant execute on function public.admin_set_diaper_targets(uuid, jsonb) to authenticated;
grant execute on function public.admin_gift_suggestions() to authenticated;
grant execute on function public.admin_set_gift_pin(smallint, uuid) to authenticated;
grant execute on function public.admin_record_movement(uuid, public.movement_type, numeric, text, text, numeric, uuid) to authenticated;
grant execute on function public.admin_set_desired_quantity(uuid, numeric, text, uuid) to authenticated;
grant execute on function public.admin_set_discarded(uuid, boolean, text, uuid) to authenticated;
grant execute on function public.admin_reverse_movement(uuid, text) to authenticated;
grant execute on function public.admin_import_layette(jsonb) to authenticated;

-- Trigger functions são chamadas pelo próprio banco; manter executáveis.
grant execute on function private.touch_updated_at(), private.rsvp_normalize(), private.forbid_change(), private.audit(),
  private.normalize_text(text) to anon, authenticated;
grant execute on function private.gift_candidates(), private.gift_suggestions(), private.diaper_distribution(uuid) to service_role;
