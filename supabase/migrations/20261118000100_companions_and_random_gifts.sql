-- =====================================================================
-- Acompanhantes por família + sorteio das sugestões de presentes
--
-- Segura para rodar em produção:
--   * não apaga confirmações; registros antigos ficam com 0 acompanhantes;
--   * a fralda continua sendo uma escolha por confirmação (família), e a
--     distribuição de tamanhos (private.diaper_distribution) não muda;
--   * o sorteio das sugestões é só leitura (nada é reservado ou gravado).
-- Execute depois das três migrações iniciais.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Acompanhantes
-- ---------------------------------------------------------------------
-- Cada confirmação representa uma família/grupo. companions_count guarda só
-- os acompanhantes (sem contar quem respondeu): total = 1 + companions_count.
alter table public.rsvps
  add column if not exists companions_count smallint not null default 0;

alter table public.rsvps drop constraint if exists rsvps_companions_count_check;
alter table public.rsvps
  add constraint rsvps_companions_count_check check (companions_count between 0 and 20);

-- party_size (preparado no esquema inicial, nunca usado pelo site) é
-- substituído por companions_count. Se algum registro tiver party_size > 1,
-- o valor é preservado como acompanhantes antes de remover a coluna.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'rsvps' and column_name = 'party_size') then
    update public.rsvps set companions_count = least(party_size - 1, 20) where party_size > 1;
    alter table public.rsvps drop column party_size;
  end if;
end $$;

-- O painel lê as colunas permitidas (o hash do token continua inacessível).
grant select (companions_count) on public.rsvps to authenticated;

-- O campo passa a ser exibido nos convites (pode ser desligado por evento no painel).
alter table public.events alter column allow_companions set default true;
update public.events set allow_companions = true where not allow_companions;

create or replace function private.clean_companions(p integer)
returns smallint
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p is null or p < 0 or p > 20 then
    raise exception 'COMPANIONS_INVALID';
  end if;
  return p::smallint;
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
    'msg_maybe', e.msg_maybe, 'msg_declined', e.msg_declined, 'rsvp_open', e.rsvp_open,
    'allow_companions', e.allow_companions
  );
$$;

create or replace function private.rsvp_public_json(r public.rsvps)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'guest_name', r.guest_name, 'attendance', r.attendance, 'diaper_size', r.diaper_size,
    'companions_count', r.companions_count,
    'event_slug', (select slug from public.events where id = r.event_id),
    'created_at', r.created_at, 'updated_at', r.updated_at
  );
$$;

-- Novas assinaturas com p_companions (opcional). As antigas são removidas
-- para não haver ambiguidade; chamadas sem o parâmetro continuam funcionando.
drop function if exists public.submit_rsvp(text, text, public.attendance_status, public.diaper_size, text, uuid);
drop function if exists public.update_my_rsvp(text, text, public.attendance_status, public.diaper_size);

create or replace function public.submit_rsvp(
  p_slug text,
  p_guest_name text,
  p_attendance public.attendance_status,
  p_diaper_size public.diaper_size,
  p_edit_token text,
  p_client_request_id uuid,
  p_companions integer default 0
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
  v_companions smallint;
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
  -- Evento sem acompanhantes: o valor enviado é ignorado.
  v_companions := case when v_event.allow_companions then private.clean_companions(coalesce(p_companions, 0)) else 0 end;

  insert into public.rsvps (event_id, guest_name, guest_name_normalized, attendance, diaper_size, companions_count,
                            edit_token_hash, client_request_id)
  values (v_event.id, v_name, '', p_attendance,
          case when p_attendance = 'yes' then p_diaper_size end, v_companions, v_hash, p_client_request_id)
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

-- p_companions nulo mantém o valor atual (compatível com versões antigas do site).
create or replace function public.update_my_rsvp(
  p_edit_token text,
  p_guest_name text,
  p_attendance public.attendance_status,
  p_diaper_size public.diaper_size,
  p_companions integer default null
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
  v_companions smallint;
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
  v_companions := case
    when p_companions is null or not v_event.allow_companions then v_row.companions_count
    else private.clean_companions(p_companions)
  end;

  update public.rsvps
     set guest_name = private.clean_name(coalesce(p_guest_name, v_row.guest_name)),
         attendance = p_attendance,
         diaper_size = case when p_attendance = 'yes' then p_diaper_size end,
         companions_count = v_companions
   where id = v_row.id
  returning * into v_row;
  return private.rsvp_public_json(v_row);
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Sugestões de presentes sorteadas
-- ---------------------------------------------------------------------
-- p_random = true: dentro de cada faixa, o item é sorteado entre os elegíveis,
-- com peso pela prioridade (alta 4 × média 2 × baixa 1). As demais regras
-- continuam iguais: fixações primeiro, uma barata/média/cara, faixa vizinha
-- quando a faixa está vazia, sem itens parecidos e nunca itens completos,
-- descartados, fora das sugestões ou sem quantidade pendente.
-- p_random = false mantém a escolha determinística anterior.
drop function if exists private.gift_suggestions();

create or replace function private.gift_suggestions(p_random boolean default false)
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
volatile
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
  v_how text;
  rec record;
begin
  select s.recommendation_count, s.include_unpriced_fallback into v_count, v_unpriced
  from public.gift_recommendation_settings s where s.id = 1;
  v_count := least(coalesce(v_count, 3), 6);
  v_unpriced := coalesce(v_unpriced, true);
  v_how := case when p_random then 'Sorteada entre as sugestões' else 'Sugestão' end;

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

  -- Passo 2: cada posição recebe um item da sua faixa (barato, médio, caro)
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
               -- sorteio ponderado (Efraimidis–Spirakis): menor chave vence
               case when p_random
                    then -ln(1.0 - random()) / (case c.priority when 'alta' then 4 when 'media' then 2 else 1 end)
               end asc nulls last,
               c.score desc, c.name asc, c.id asc
      limit 1;
      if found then
        v_item[v_slot] := rec.id;
        v_groups := v_groups || rec.group_key;
        v_words := v_words || rec.first_word;
        v_reason[v_slot] := case when v_pass = 2 then
            format('%s %s: prioridade %s, faltam %s %s.', v_how, case when p_random then 'da faixa ' || (v_label ->> v_target) else v_label ->> v_target end,
                   case rec.priority when 'alta' then 'alta' when 'media' then 'média' else 'baixa' end,
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

-- Convidados: novo sorteio a cada chamada (o site chama uma vez por visita).
create or replace function public.get_gift_suggestions()
returns jsonb
language sql
volatile
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
  from private.gift_suggestions(true) g
  left join public.gift_recommendation_settings s on s.id = 1;
$$;

-- Painel: p_random = true mostra um exemplo de sorteio; sem argumento, a
-- seleção determinística (melhor item de cada faixa), como antes.
drop function if exists public.admin_gift_suggestions();
create or replace function public.admin_gift_suggestions(p_random boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(to_jsonb(g) order by g.slot) from private.gift_suggestions(coalesce(p_random, false)) g), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- Permissões (o Supabase concede EXECUTE a anon/authenticated por padrão
-- em funções novas do schema public: revogamos e liberamos só o necessário)
-- ---------------------------------------------------------------------
revoke all on function public.submit_rsvp(text, text, public.attendance_status, public.diaper_size, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.update_my_rsvp(text, text, public.attendance_status, public.diaper_size, integer) from public, anon, authenticated;
revoke all on function public.get_gift_suggestions() from public, anon, authenticated;
revoke all on function public.admin_gift_suggestions(boolean) from public, anon, authenticated;
revoke all on function private.gift_suggestions(boolean) from public, anon, authenticated;
revoke all on function private.clean_companions(integer) from public, anon, authenticated;

grant execute on function public.submit_rsvp(text, text, public.attendance_status, public.diaper_size, text, uuid, integer) to anon, authenticated;
grant execute on function public.update_my_rsvp(text, text, public.attendance_status, public.diaper_size, integer) to anon, authenticated;
grant execute on function public.get_gift_suggestions() to anon, authenticated;
grant execute on function public.admin_gift_suggestions(boolean) to authenticated;
grant execute on function private.gift_suggestions(boolean) to service_role;
