-- 002_meal_planner.sql
-- Safe / idempotent. Required to persist the Posiłki module in Supabase.

create table if not exists public.meal_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid null references public.tasks(id) on delete set null,
  name text not null,
  meal_type text not null default 'Posiłek',
  meal_date date not null,
  meal_time time not null,
  ingredients text,
  recipe text,
  calories integer,
  protein numeric,
  prepared_at timestamptz,
  eaten_at timestamptz,
  xp_awarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meal_recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  meal_type text not null default 'Posiłek',
  ingredients text,
  recipe text,
  calories integer,
  protein numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.meal_plans enable row level security;
alter table public.meal_recipes enable row level security;

drop policy if exists "meal_plans_owner_all" on public.meal_plans;
create policy "meal_plans_owner_all"
on public.meal_plans
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "meal_recipes_owner_all" on public.meal_recipes;
create policy "meal_recipes_owner_all"
on public.meal_recipes
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists meal_plans_user_date_idx
  on public.meal_plans(user_id, meal_date);

create index if not exists meal_recipes_user_idx
  on public.meal_recipes(user_id);
