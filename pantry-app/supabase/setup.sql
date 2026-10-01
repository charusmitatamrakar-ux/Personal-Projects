-- =====================================================================
--  Pantry app – database setup
--
--  HOW TO USE: paste this whole file into Supabase → SQL Editor → Run.
--
--  BEFORE you run it, change the two email addresses in STEP 1 below
--  to the emails you and your husband will log in with.
--
--  It is safe to run this file again later (for example after changing
--  the emails); it will not delete any of your pantry data.
-- =====================================================================


-- ---------------------------------------------------------------------
-- STEP 1: Who is allowed to use the app
-- Only people whose email is in this list can see or change anything.
-- ---------------------------------------------------------------------
create table if not exists public.household_members (
  email text primary key
);

insert into public.household_members (email) values
  ('your-email@example.com'),        -- ← change to your email
  ('husbands-email@example.com')     -- ← change to your husband's email
on conflict (email) do nothing;


-- Helper used by all the security rules below: "is the logged-in person
-- on the household list?"
create or replace function public.is_household_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members
    where lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;


-- ---------------------------------------------------------------------
-- STEP 2: Tables
-- ---------------------------------------------------------------------

-- Where things are stored (Pantry shelf, Fridge, ...)
create table if not exists public.locations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);
create unique index if not exists locations_name_unique
  on public.locations (lower(name));

-- The food items themselves
create table if not exists public.items (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) > 0),
  quantity     numeric not null default 1 check (quantity >= 0),
  unit         text not null default '',
  location_id  uuid references public.locations (id) on delete set null,
  date_added   date not null default current_date,
  low_level    numeric check (low_level >= 0),    -- used in phase 3
  need_to_buy  boolean not null default false,    -- used in phase 3
  added_by     text default (auth.jwt() ->> 'email'),
  updated_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Remembers the usual unit and location for each item name (phase 2)
create table if not exists public.item_memory (
  name_key     text primary key,        -- lower-case name, for matching
  name         text not null,           -- name as you typed it
  unit         text not null default '',
  location_id  uuid references public.locations (id) on delete set null,
  updated_at   timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- STEP 3: Automatic bookkeeping
-- ---------------------------------------------------------------------

-- Record who last changed an item, and when.
create or replace function public.items_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.jwt() ->> 'email';
  return new;
end;
$$;

drop trigger if exists items_touch on public.items;
create trigger items_touch
  before insert or update on public.items
  for each row execute function public.items_touch();

-- Every time an item is saved, remember its unit and location.
create or replace function public.items_remember()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.item_memory (name_key, name, unit, location_id, updated_at)
  values (lower(trim(new.name)), trim(new.name), new.unit, new.location_id, now())
  on conflict (name_key) do update
    set name        = excluded.name,
        unit        = excluded.unit,
        location_id = excluded.location_id,
        updated_at  = now();
  return new;
end;
$$;

drop trigger if exists items_remember on public.items;
create trigger items_remember
  after insert or update of name, unit, location_id on public.items
  for each row execute function public.items_remember();


-- ---------------------------------------------------------------------
-- STEP 4: Security rules – only household members get access
-- ---------------------------------------------------------------------
alter table public.household_members enable row level security;
alter table public.locations         enable row level security;
alter table public.items             enable row level security;
alter table public.item_memory       enable row level security;
-- (household_members has no rules at all, so nobody can read it from the app)

drop policy if exists "household full access" on public.locations;
create policy "household full access" on public.locations
  for all to authenticated
  using (public.is_household_member())
  with check (public.is_household_member());

drop policy if exists "household full access" on public.items;
create policy "household full access" on public.items
  for all to authenticated
  using (public.is_household_member())
  with check (public.is_household_member());

drop policy if exists "household can read" on public.item_memory;
create policy "household can read" on public.item_memory
  for select to authenticated
  using (public.is_household_member());


-- ---------------------------------------------------------------------
-- STEP 5: Live sync between phones
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'items') then
    alter publication supabase_realtime add table public.items;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'locations') then
    alter publication supabase_realtime add table public.locations;
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- STEP 6: Starter storage locations (you can rename/remove them in the app)
-- ---------------------------------------------------------------------
insert into public.locations (name, sort_order)
select v.name, v.sort_order
from (values ('Pantry shelf', 1), ('Fridge', 2), ('Freezer', 3), ('Basement', 4))
     as v(name, sort_order)
where not exists (select 1 from public.locations);

-- Done! You should see "Success. No rows returned".
