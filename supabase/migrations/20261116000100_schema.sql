-- =====================================================================
-- Chá de bebê da Bonnie — esquema principal
-- Compatível com Supabase (PostgreSQL 15+). Execute em ordem.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;

-- Funções auxiliares ficam em um schema NÃO exposto pela API.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.attendance_status as enum ('yes', 'maybe', 'no');
create type public.diaper_size as enum ('RN', 'P', 'M', 'G', 'XG');
create type public.item_priority as enum ('alta', 'media', 'baixa');
create type public.movement_type as enum (
  'import',          -- quantidade trazida da planilha na importação inicial
  'purchase',        -- "Comprei"
  'gift',            -- "Ganhei"
  'borrow',          -- recebemos emprestado
  'return_borrowed', -- devolvemos um item emprestado
  'correction',      -- "Corrigir quantidade" (ajuste com sinal em um balde)
  'desired_change',  -- alteração da quantidade desejada
  'discard',         -- "Não precisamos mais"
  'restore',         -- "Restaurar item"
  'reversal'         -- desfaz uma movimentação anterior
);

-- ---------------------------------------------------------------------
-- Administradores
-- ---------------------------------------------------------------------
create table public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Admin',
  role text not null default 'admin' check (role in ('admin')),
  created_at timestamptz not null default now()
);

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admin_users a where a.user_id = auth.uid());
$$;
revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to anon, authenticated;

create or replace function private.normalize_text(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, ''))), '\s+', ' ', 'g');
$$;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Eventos
-- ---------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  city text not null check (length(city) between 2 and 80),
  state text not null default 'SP',
  title text not null default 'Chá de bebê da Bonnie',
  event_date date not null,
  event_time time not null,
  venue text not null,
  venue_detail text,
  address_line1 text not null,
  address_line2 text,
  maps_url text check (maps_url is null or maps_url ~* '^https://'),
  theme_primary text not null check (theme_primary ~ '^#[0-9a-fA-F]{6}$'),
  theme_soft text not null check (theme_soft ~ '^#[0-9a-fA-F]{6}$'),
  heart_emoji text not null default '💜' check (length(heart_emoji) between 1 and 8),
  welcome_message text not null,
  msg_confirmed text not null,
  msg_maybe text not null,
  msg_declined text not null,
  rsvp_open boolean not null default true,
  is_active boolean not null default true,
  -- Preparado para acompanhantes no futuro. Desativado por padrão: o fluxo
  -- atual registra uma confirmação por pessoa.
  allow_companions boolean not null default false,
  expected_guests integer check (expected_guests is null or expected_guests >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger events_touch before update on public.events
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------
-- Confirmações
-- ---------------------------------------------------------------------
create table public.rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  guest_name text not null check (length(guest_name) between 2 and 120),
  guest_name_normalized text not null,
  attendance public.attendance_status not null,
  diaper_size public.diaper_size,
  party_size smallint not null default 1 check (party_size between 1 and 10),
  edit_token_hash bytea not null unique,
  client_request_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Quem confirmou precisa ter fralda; quem não confirmou não conta fralda.
  constraint rsvp_diaper_consistency check ((attendance = 'yes') = (diaper_size is not null))
);
create index rsvps_event_idx on public.rsvps (event_id, attendance);
create index rsvps_name_idx on public.rsvps (event_id, guest_name_normalized);

create or replace function private.rsvp_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.guest_name := regexp_replace(btrim(new.guest_name), '\s+', ' ', 'g');
  new.guest_name_normalized := private.normalize_text(new.guest_name);
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
create trigger rsvps_normalize before insert or update on public.rsvps
  for each row execute function private.rsvp_normalize();

-- ---------------------------------------------------------------------
-- Metas de fraldas
-- ---------------------------------------------------------------------
create table public.diaper_targets (
  event_id uuid not null references public.events (id) on delete cascade,
  diaper_size public.diaper_size not null,
  target_percentage numeric(5, 2) not null check (target_percentage between 0 and 100),
  primary key (event_id, diaper_size)
);

-- ---------------------------------------------------------------------
-- Enxoval
-- ---------------------------------------------------------------------
create table public.layette_items (
  id uuid primary key default gen_random_uuid(),
  import_key text unique,
  category text not null check (length(category) between 1 and 80),
  subcategory text,
  name text not null check (length(name) between 1 and 200),
  description text,
  original_quantity_text text,
  desired_quantity numeric(10, 2) check (desired_quantity is null or desired_quantity > 0),
  unit text not null default 'unidade' check (length(unit) between 1 and 30),
  estimated_unit_price numeric(10, 2) check (estimated_unit_price is null or estimated_unit_price >= 0),
  reference_price numeric(10, 2) check (reference_price is null or reference_price >= 0),
  priority public.item_priority not null default 'media',
  is_gift_eligible boolean not null default true,
  is_discarded boolean not null default false,
  image_url text check (image_url is null or image_url ~* '^https://'),
  reference_url text,
  notes text,
  also_in_lists text[] not null default '{}',
  needs_review boolean not null default false,
  review_notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index layette_items_category_idx on public.layette_items (category, sort_order);
create trigger layette_items_touch before update on public.layette_items
  for each row execute function private.touch_updated_at();

create table public.layette_movements (
  id uuid primary key default gen_random_uuid(),
  layette_item_id uuid not null references public.layette_items (id) on delete restrict,
  movement_type public.movement_type not null,
  bucket text check (bucket in ('purchased', 'received', 'borrowed')),
  quantity numeric(10, 2) not null default 0,
  unit text,
  amount_paid numeric(10, 2) check (amount_paid is null or amount_paid >= 0),
  previous_value numeric(10, 2),
  new_value numeric(10, 2),
  reverses_movement_id uuid unique references public.layette_movements (id) on delete restrict,
  notes text check (notes is null or length(notes) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text,
  client_request_id uuid unique,
  created_at timestamptz not null default now(),
  constraint movement_bucket_required check (
    (movement_type in ('import', 'purchase', 'gift', 'borrow', 'return_borrowed', 'correction', 'reversal')) = (bucket is not null)
  )
);
create index layette_movements_item_idx on public.layette_movements (layette_item_id, created_at);

-- O histórico nunca é sobrescrito: bloqueia UPDATE/DELETE para todos.
create or replace function private.forbid_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'HISTORY_IMMUTABLE' using hint = 'Use uma movimentação de correção ou de reversão.';
end;
$$;
create trigger layette_movements_immutable before update or delete on public.layette_movements
  for each row execute function private.forbid_change();

-- ---------------------------------------------------------------------
-- Sugestões de presentes
-- ---------------------------------------------------------------------
create table public.gift_recommendation_settings (
  id smallint primary key default 1 check (id = 1),
  cheap_max_price numeric(10, 2) not null default 40 check (cheap_max_price > 0),
  medium_max_price numeric(10, 2) not null default 100,
  recommendation_count smallint not null default 3 check (recommendation_count between 1 and 6),
  show_tier_to_guests boolean not null default true,
  include_unpriced_fallback boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint price_order check (medium_max_price > cheap_max_price)
);
create trigger gift_settings_touch before update on public.gift_recommendation_settings
  for each row execute function private.touch_updated_at();

create table public.gift_recommendation_pins (
  display_order smallint primary key check (display_order between 1 and 6),
  layette_item_id uuid not null unique references public.layette_items (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Auditoria e limite de requisições
-- ---------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  table_name text not null,
  row_id text,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_table_idx on public.audit_log (table_name, created_at desc);

create table private.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);

create or replace function private.audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'edit_token_hash' end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'edit_token_hash' end;
begin
  if tg_op = 'UPDATE' and v_old = v_new then
    return new;
  end if;
  insert into public.audit_log (actor, table_name, row_id, action, old_data, new_data)
  values (auth.uid(), tg_table_name, coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'event_id', v_old ->> 'event_id'), tg_op, v_old, v_new);
  return coalesce(new, old);
end;
$$;

create trigger audit_events after insert or update or delete on public.events
  for each row execute function private.audit();
create trigger audit_rsvps after insert or update or delete on public.rsvps
  for each row execute function private.audit();
create trigger audit_targets after insert or update or delete on public.diaper_targets
  for each row execute function private.audit();
create trigger audit_items after insert or update or delete on public.layette_items
  for each row execute function private.audit();
create trigger audit_gift_settings after update on public.gift_recommendation_settings
  for each row execute function private.audit();
create trigger audit_pins after insert or update or delete on public.gift_recommendation_pins
  for each row execute function private.audit();

-- ---------------------------------------------------------------------
-- Visão consolidada do enxoval (respeita RLS: security_invoker)
-- ---------------------------------------------------------------------
create view public.layette_item_totals
with (security_invoker = true)
as
with sums as (
  select
    m.layette_item_id,
    coalesce(sum(m.quantity) filter (where m.bucket = 'purchased'), 0) as purchased,
    coalesce(sum(m.quantity) filter (where m.bucket = 'received'), 0) as received,
    coalesce(sum(m.quantity) filter (where m.bucket = 'borrowed'), 0) as borrowed,
    coalesce(sum(m.amount_paid * case when m.movement_type = 'reversal' then -1 else 1 end), 0) as amount_paid,
    max(m.created_at) as last_movement_at
  from public.layette_movements m
  group by m.layette_item_id
),
s as (select * from public.gift_recommendation_settings where id = 1)
select
  i.*,
  coalesce(x.purchased, 0)::numeric(10, 2) as purchased_quantity,
  coalesce(x.received, 0)::numeric(10, 2) as received_quantity,
  coalesce(x.borrowed, 0)::numeric(10, 2) as borrowed_quantity,
  (coalesce(x.purchased, 0) + coalesce(x.received, 0) + coalesce(x.borrowed, 0))::numeric(10, 2) as covered_quantity,
  case when i.desired_quantity is null then null
       else greatest(0, i.desired_quantity - coalesce(x.purchased, 0) - coalesce(x.received, 0) - coalesce(x.borrowed, 0))
  end::numeric(10, 2) as pending_quantity,
  case
    when i.is_discarded then 'descartado'
    when i.desired_quantity is not null
         and coalesce(x.purchased, 0) + coalesce(x.received, 0) + coalesce(x.borrowed, 0) >= i.desired_quantity then 'completo'
    when coalesce(x.purchased, 0) + coalesce(x.received, 0) + coalesce(x.borrowed, 0) > 0 then 'parcial'
    else 'nao_adquirido'
  end as status,
  case
    when i.estimated_unit_price is null then null
    when i.estimated_unit_price <= s.cheap_max_price then 'barato'
    when i.estimated_unit_price <= s.medium_max_price then 'medio'
    else 'caro'
  end as price_tier,
  coalesce(x.amount_paid, 0)::numeric(10, 2) as amount_paid_total,
  x.last_movement_at
from public.layette_items i
left join sums x on x.layette_item_id = i.id
left join s on true;

-- ---------------------------------------------------------------------
-- RLS: nada é público. Convidados só usam funções RPC específicas.
-- ---------------------------------------------------------------------
alter table public.admin_users enable row level security;
alter table public.events enable row level security;
alter table public.rsvps enable row level security;
alter table public.diaper_targets enable row level security;
alter table public.layette_items enable row level security;
alter table public.layette_movements enable row level security;
alter table public.gift_recommendation_settings enable row level security;
alter table public.gift_recommendation_pins enable row level security;
alter table public.audit_log enable row level security;

revoke all on all tables in schema public from anon;
revoke all on table private.rate_limits from public, anon, authenticated;

create policy admin_self_read on public.admin_users for select to authenticated
  using (user_id = auth.uid() or private.is_admin());

create policy admin_all_events on public.events for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy admin_all_rsvps on public.rsvps for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy admin_all_targets on public.diaper_targets for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy admin_all_items on public.layette_items for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
-- Movimentações: somente leitura via tabela; inserção apenas pelas funções.
create policy admin_read_movements on public.layette_movements for select to authenticated
  using (private.is_admin());
create policy admin_all_gift_settings on public.gift_recommendation_settings for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy admin_all_pins on public.gift_recommendation_pins for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy admin_read_audit on public.audit_log for select to authenticated
  using (private.is_admin());

grant select, insert, update, delete on public.events, public.rsvps, public.diaper_targets,
  public.layette_items, public.gift_recommendation_settings, public.gift_recommendation_pins to authenticated;
grant select on public.layette_movements, public.audit_log, public.admin_users, public.layette_item_totals to authenticated;
revoke insert, update, delete on public.layette_movements from authenticated;
-- O hash do token de edição nunca precisa sair do banco, nem para o painel.
revoke select on public.rsvps from authenticated;
grant select (id, event_id, guest_name, guest_name_normalized, attendance, diaper_size, party_size, created_at, updated_at)
  on public.rsvps to authenticated;
