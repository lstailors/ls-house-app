-- =====================================================================
-- L&S House — Supabase Postgres migration
--
-- Mirrors backend/prisma/schema.prisma (SQLite dev) for production Postgres,
-- AND defines the Row Level Security (RLS) policies that enforce the
-- canonical role + location access rules at the database tier.
--
-- The rules below MUST match backend/src/lib/scope.ts exactly. The Hono
-- API performs the same filtering for defense in depth; RLS is the
-- authoritative source of truth in production.
--
-- Canonical rules:
--   super_admin   : full access, may switch location via JWT claim override
--   store_manager : own location only, includes financials
--   salesperson   : own location for alterations/customers/comms/deliveries READ;
--                   own custom orders only (created_by = self);
--                   ZERO access to sales_orders, invoices, financials views
--   driver        : deliveries where driver_id = self only;
--                   blocked from every other domain table
-- =====================================================================

-- ─── Extensions ─────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─── Enums ──────────────────────────────────────────────────────────────
do $$ begin
  create type user_role as enum ('super_admin', 'store_manager', 'salesperson', 'driver');
exception when duplicate_object then null; end $$;

do $$ begin
  create type garment_type as enum ('jacket','suit','trousers','vest','overcoat','shirt');
exception when duplicate_object then null; end $$;

do $$ begin
  create type alteration_status as enum ('intake','in_progress','ready','picked_up','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type custom_order_status as enum ('quote','deposit_paid','in_production','ready','delivered','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type delivery_status as enum ('scheduled','out_for_delivery','delivered','failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type invoice_status as enum ('draft','sent','paid','void');
exception when duplicate_object then null; end $$;

do $$ begin
  create type comm_channel as enum ('call','sms');
exception when duplicate_object then null; end $$;

do $$ begin
  create type comm_direction as enum ('inbound','outbound');
exception when duplicate_object then null; end $$;

-- ─── Tables ─────────────────────────────────────────────────────────────

create table if not exists locations (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  address text,
  erpnext_company_or_branch text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  role user_role not null default 'salesperson',
  location_id text references locations(id),
  image text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists profiles_location_idx on profiles(location_id);
create index if not exists profiles_role_idx on profiles(role);

create table if not exists tailors (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  location_id text not null references locations(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tailors_location_idx on tailors(location_id);

create table if not exists customers (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  phone text not null,
  email text,
  location_id text not null references locations(id),
  created_by uuid not null references profiles(id),
  dossier_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customers_location_idx on customers(location_id);
create index if not exists customers_created_by_idx on customers(created_by);

create table if not exists alterations (
  id text primary key default gen_random_uuid()::text,
  customer_id text not null references customers(id),
  location_id text not null references locations(id),
  items_json jsonb not null default '[]'::jsonb,
  price numeric(12,2) not null default 0,
  status alteration_status not null default 'intake',
  tailor_id text references tailors(id),
  due_date timestamptz,
  notes text,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists alterations_location_idx on alterations(location_id);
create index if not exists alterations_customer_idx on alterations(customer_id);
create index if not exists alterations_created_by_idx on alterations(created_by);
create index if not exists alterations_status_idx on alterations(status);

create table if not exists custom_orders (
  id text primary key default gen_random_uuid()::text,
  customer_id text not null references customers(id),
  location_id text not null references locations(id),
  garment_type garment_type not null,
  quoted_price numeric(12,2) not null default 0,
  price_tbd boolean not null default false,
  deposit_amount numeric(12,2) not null default 0,
  status custom_order_status not null default 'quote',
  notes text,
  spec_json jsonb not null default '{}'::jsonb,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists custom_orders_location_idx on custom_orders(location_id);
create index if not exists custom_orders_customer_idx on custom_orders(customer_id);
create index if not exists custom_orders_created_by_idx on custom_orders(created_by);
create index if not exists custom_orders_status_idx on custom_orders(status);

create table if not exists sales_orders (
  id text primary key default gen_random_uuid()::text,
  custom_order_id text references custom_orders(id),
  location_id text not null references locations(id),
  erpnext_id text,
  status text not null default 'draft',
  total numeric(12,2) not null default 0,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sales_orders_location_idx on sales_orders(location_id);
create index if not exists sales_orders_custom_idx on sales_orders(custom_order_id);

create table if not exists invoices (
  id text primary key default gen_random_uuid()::text,
  sales_order_id text references sales_orders(id),
  location_id text not null references locations(id),
  erpnext_id text,
  status invoice_status not null default 'draft',
  total numeric(12,2) not null default 0,
  pdf_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists invoices_location_idx on invoices(location_id);

create table if not exists deliveries (
  id text primary key default gen_random_uuid()::text,
  order_ref text,
  custom_order_id text references custom_orders(id),
  customer_id text not null references customers(id),
  location_id text not null references locations(id),
  driver_id uuid references profiles(id),
  status delivery_status not null default 'scheduled',
  proof_of_delivery_url text,
  scheduled_at timestamptz,
  delivered_at timestamptz,
  address_line text,
  notes text,
  erpnext_synced boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists deliveries_location_idx on deliveries(location_id);
create index if not exists deliveries_driver_idx on deliveries(driver_id);
create index if not exists deliveries_customer_idx on deliveries(customer_id);
create index if not exists deliveries_status_idx on deliveries(status);

create table if not exists fabric_pricing (
  id text primary key default gen_random_uuid()::text,
  fabric_name text not null,
  mill text,
  composition text,
  weight text,
  season text,
  tier text,
  price numeric(12,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists style_library (
  id text primary key default gen_random_uuid()::text,
  category text not null,
  name text not null,
  description text,
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists style_library_category_idx on style_library(category);

create table if not exists communications (
  id text primary key default gen_random_uuid()::text,
  customer_id text not null references customers(id),
  location_id text not null references locations(id),
  channel comm_channel not null,
  direction comm_direction not null,
  transcript text,
  body text,
  created_at timestamptz not null default now()
);
create index if not exists communications_customer_idx on communications(customer_id);
create index if not exists communications_location_idx on communications(location_id);

-- =====================================================================
-- AUTH HELPERS
--
-- Resolve the current user's role and location from the `profiles` table.
-- Marked STABLE so Postgres can memoize within a statement.
-- =====================================================================

create or replace function auth_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function auth_location() returns text
language sql stable security definer set search_path = public as $$
  select location_id from profiles where id = auth.uid()
$$;

create or replace function is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth_role() = 'super_admin', false)
$$;

create or replace function is_store_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth_role() = 'store_manager', false)
$$;

create or replace function is_salesperson() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth_role() = 'salesperson', false)
$$;

create or replace function is_driver() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth_role() = 'driver', false)
$$;

create or replace function can_see_financials() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth_role() in ('super_admin','store_manager'), false)
$$;

-- =====================================================================
-- ENABLE RLS
-- =====================================================================
alter table locations       enable row level security;
alter table profiles        enable row level security;
alter table tailors         enable row level security;
alter table customers       enable row level security;
alter table alterations     enable row level security;
alter table custom_orders   enable row level security;
alter table sales_orders    enable row level security;
alter table invoices        enable row level security;
alter table deliveries      enable row level security;
alter table fabric_pricing  enable row level security;
alter table style_library   enable row level security;
alter table communications  enable row level security;

-- =====================================================================
-- LOCATIONS
-- super_admin: all rows (powers the switcher)
-- everyone else: only their own location row
-- write: super_admin only
-- =====================================================================
drop policy if exists "locations_read" on locations;
create policy "locations_read" on locations for select using (
  is_super_admin() or id = auth_location()
);

drop policy if exists "locations_write" on locations;
create policy "locations_write" on locations for all using (
  is_super_admin()
) with check (is_super_admin());

-- =====================================================================
-- PROFILES (users)
-- read: self + super_admin (manager may also read same-location for ops)
-- write: super_admin only (role/location changes); self may update own name/image
-- =====================================================================
drop policy if exists "profiles_read_self_or_admin" on profiles;
create policy "profiles_read_self_or_admin" on profiles for select using (
  id = auth.uid()
  or is_super_admin()
  or (is_store_manager() and location_id = auth_location())
);

drop policy if exists "profiles_write_self_limited" on profiles;
create policy "profiles_write_self_limited" on profiles for update using (
  id = auth.uid() or is_super_admin()
) with check (
  -- self may not elevate role or change location
  id = auth.uid() and role = (select role from profiles where id = auth.uid())
                  and location_id is not distinct from (select location_id from profiles where id = auth.uid())
  or is_super_admin()
);

drop policy if exists "profiles_insert_admin_only" on profiles;
create policy "profiles_insert_admin_only" on profiles for insert with check (
  is_super_admin()
);

-- =====================================================================
-- TAILORS
-- read: own location (super_admin: all)
-- write: super_admin only
-- =====================================================================
drop policy if exists "tailors_read" on tailors;
create policy "tailors_read" on tailors for select using (
  is_super_admin() or location_id = auth_location()
);

drop policy if exists "tailors_write" on tailors;
create policy "tailors_write" on tailors for all using (
  is_super_admin()
) with check (is_super_admin());

-- =====================================================================
-- CUSTOMERS
-- super_admin: all
-- store_manager + salesperson: own location
-- driver: blocked
-- =====================================================================
drop policy if exists "customers_read" on customers;
create policy "customers_read" on customers for select using (
  is_super_admin()
  or (not is_driver() and location_id = auth_location())
);

drop policy if exists "customers_write" on customers;
create policy "customers_write" on customers for all using (
  is_super_admin()
  or (not is_driver() and location_id = auth_location())
) with check (
  is_super_admin()
  or (not is_driver() and location_id = auth_location())
);

-- =====================================================================
-- ALTERATIONS
-- super_admin: all
-- store_manager + salesperson: own location (shared queue)
-- driver: blocked
-- =====================================================================
drop policy if exists "alterations_read" on alterations;
create policy "alterations_read" on alterations for select using (
  is_super_admin()
  or (not is_driver() and location_id = auth_location())
);

drop policy if exists "alterations_write" on alterations;
create policy "alterations_write" on alterations for all using (
  is_super_admin()
  or (not is_driver() and location_id = auth_location())
) with check (
  is_super_admin()
  or (not is_driver() and location_id = auth_location())
);

-- =====================================================================
-- CUSTOM ORDERS
-- super_admin: all
-- store_manager: own location (any order)
-- salesperson:  own location AND created_by = self (private book)
-- driver:       blocked
-- =====================================================================
drop policy if exists "custom_orders_read" on custom_orders;
create policy "custom_orders_read" on custom_orders for select using (
  is_super_admin()
  or (is_store_manager() and location_id = auth_location())
  or (is_salesperson() and location_id = auth_location() and created_by = auth.uid())
);

drop policy if exists "custom_orders_write" on custom_orders;
create policy "custom_orders_write" on custom_orders for all using (
  is_super_admin()
  or (is_store_manager() and location_id = auth_location())
  or (is_salesperson() and location_id = auth_location() and created_by = auth.uid())
) with check (
  is_super_admin()
  or (is_store_manager() and location_id = auth_location())
  or (is_salesperson() and location_id = auth_location() and created_by = auth.uid())
);

-- =====================================================================
-- SALES ORDERS (financials)
-- super_admin: all
-- store_manager: own location
-- salesperson + driver: BLOCKED
-- =====================================================================
drop policy if exists "sales_orders_read" on sales_orders;
create policy "sales_orders_read" on sales_orders for select using (
  is_super_admin()
  or (is_store_manager() and location_id = auth_location())
);

drop policy if exists "sales_orders_write" on sales_orders;
create policy "sales_orders_write" on sales_orders for all using (
  is_super_admin()
  or (is_store_manager() and location_id = auth_location())
) with check (
  is_super_admin()
  or (is_store_manager() and location_id = auth_location())
);

-- =====================================================================
-- INVOICES (financials)
-- super_admin: all
-- store_manager: own location
-- salesperson + driver: BLOCKED
-- =====================================================================
drop policy if exists "invoices_read" on invoices;
create policy "invoices_read" on invoices for select using (
  is_super_admin()
  or (is_store_manager() and location_id = auth_location())
);

drop policy if exists "invoices_write" on invoices;
create policy "invoices_write" on invoices for all using (
  is_super_admin()
  or (is_store_manager() and location_id = auth_location())
) with check (
  is_super_admin()
  or (is_store_manager() and location_id = auth_location())
);

-- =====================================================================
-- DELIVERIES
-- super_admin: all
-- store_manager + salesperson: own location (read)
-- driver: rows where driver_id = self (read + write)
--   - driver may NOT reassign driver_id (forced same in WITH CHECK)
-- salesperson: read-only
-- =====================================================================
drop policy if exists "deliveries_read" on deliveries;
create policy "deliveries_read" on deliveries for select using (
  is_super_admin()
  or (is_driver() and driver_id = auth.uid())
  or (not is_driver() and location_id = auth_location())
);

-- Update: drivers may update own row but must keep driver_id = self.
drop policy if exists "deliveries_update" on deliveries;
create policy "deliveries_update" on deliveries for update using (
  is_super_admin()
  or (is_store_manager() and location_id = auth_location())
  or (is_driver() and driver_id = auth.uid())
) with check (
  is_super_admin()
  or (is_store_manager() and location_id = auth_location())
  or (is_driver() and driver_id = auth.uid())
);

-- Insert + delete: managers + super_admin only.
drop policy if exists "deliveries_insert" on deliveries;
create policy "deliveries_insert" on deliveries for insert with check (
  is_super_admin()
  or (is_store_manager() and location_id = auth_location())
);

drop policy if exists "deliveries_delete" on deliveries;
create policy "deliveries_delete" on deliveries for delete using (
  is_super_admin()
  or (is_store_manager() and location_id = auth_location())
);

-- =====================================================================
-- COMMUNICATIONS
-- super_admin: all
-- store_manager + salesperson: own location
-- driver: blocked
-- =====================================================================
drop policy if exists "communications_read" on communications;
create policy "communications_read" on communications for select using (
  is_super_admin()
  or (not is_driver() and location_id = auth_location())
);

drop policy if exists "communications_write" on communications;
create policy "communications_write" on communications for all using (
  is_super_admin()
  or (not is_driver() and location_id = auth_location())
) with check (
  is_super_admin()
  or (not is_driver() and location_id = auth_location())
);

-- =====================================================================
-- FABRIC PRICING + STYLE LIBRARY (global reference)
-- read: any authenticated user
-- write: super_admin + store_manager
-- =====================================================================
drop policy if exists "fabric_pricing_read" on fabric_pricing;
create policy "fabric_pricing_read" on fabric_pricing for select using (
  auth.uid() is not null
);

drop policy if exists "fabric_pricing_write" on fabric_pricing;
create policy "fabric_pricing_write" on fabric_pricing for all using (
  is_super_admin() or is_store_manager()
) with check (is_super_admin() or is_store_manager());

drop policy if exists "style_library_read" on style_library;
create policy "style_library_read" on style_library for select using (
  auth.uid() is not null
);

drop policy if exists "style_library_write" on style_library;
create policy "style_library_write" on style_library for all using (
  is_super_admin() or is_store_manager()
) with check (is_super_admin() or is_store_manager());

-- =====================================================================
-- TIGHTEN DEFAULT GRANTS
--
-- Supabase grants anon + authenticated broad access by default; lock down
-- everything to authenticated only — the RLS policies above take it from there.
-- =====================================================================
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- =====================================================================
-- SELF-VERIFICATION (compile-time sanity)
--
-- These assertions document the rules so a reviewer can run the migration
-- in a sandbox with seeded data and confirm RLS rejects the right requests.
-- They are written as comments because they need a JWT context to evaluate.
--
-- 1) salesperson SELECT sales_orders  → 0 rows (RLS denies)
-- 2) salesperson SELECT invoices      → 0 rows (RLS denies)
-- 3) salesperson SELECT custom_orders → only WHERE created_by = self
-- 4) salesperson SELECT alterations   → all rows AT their location
-- 5) store_manager SELECT any         → only WHERE location_id = self.location_id
-- 6) driver SELECT deliveries         → only WHERE driver_id = self
-- 7) driver SELECT alterations        → 0 rows
-- 8) driver UPDATE delivery SET driver_id = other → REJECTED (WITH CHECK)
-- 9) super_admin SELECT any           → unrestricted
-- =====================================================================
