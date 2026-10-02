
-- Personal OS / Supabase schema
-- Run once in Supabase Dashboard -> SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.user_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  xp integer not null default 0,
  streak integer not null default 0,
  last_review_date date,
  updated_at timestamptz not null default now()
);

create table if not exists public.days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  interview_completed boolean not null default false,
  feeling text,
  energy smallint check (energy between 1 and 10),
  sleep_hours numeric(4,1),
  sleep_quality smallint check (sleep_quality between 1 and 10),
  overload smallint check (overload between 1 and 10),
  available_hours numeric(4,1),
  capacity_score numeric(4,2),
  capacity_percent smallint,
  day_mode text check (day_mode in ('full','standard','survival')),
  day_label text,
  day_copy text,
  top1 text,
  top2 text,
  top3 text,
  money_move text,
  ate boolean not null default false,
  drank_water boolean not null default false,
  moved boolean not null default false,
  money_action boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, day)
);

create table if not exists public.tasks (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  category text not null,
  priority text not null check (priority in ('P1','P2','P3')),
  estimate_minutes integer not null default 30,
  actual_minutes integer,
  scheduled_at timestamptz,
  completed_at timestamptz,
  status text not null default 'unscheduled'
    check (status in ('unscheduled','scheduled','done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_user_scheduled_idx
  on public.tasks(user_id, scheduled_at);

create table if not exists public.projects (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  status text not null default 'Aktywny',
  next_action text,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.ideas (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  category text,
  status text not null default 'Zaparkowany',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.proof (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  text text not null,
  source text,
  created_at timestamptz not null default now()
);

create index if not exists proof_user_day_idx
  on public.proof(user_id, day desc);

create table if not exists public.reviews (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  done text,
  learn text,
  tomorrow text,
  created_at timestamptz not null default now()
);

create table if not exists public.finance_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  cash text,
  protected text,
  incoming text,
  bills text,
  revenue_today text,
  revenue_month text,
  updated_at timestamptz not null default now(),
  unique(user_id, day)
);

create table if not exists public.body_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  steps integer,
  weight numeric(6,2),
  water numeric(5,2),
  sleep numeric(4,1),
  workout boolean not null default false,
  updated_at timestamptz not null default now(),
  unique(user_id, day)
);

-- Enable RLS.
alter table public.user_stats enable row level security;
alter table public.days enable row level security;
alter table public.tasks enable row level security;
alter table public.projects enable row level security;
alter table public.ideas enable row level security;
alter table public.proof enable row level security;
alter table public.reviews enable row level security;
alter table public.finance_snapshots enable row level security;
alter table public.body_logs enable row level security;

-- Authenticated browser users may access these tables, but RLS below
-- restricts every row to the logged-in user's own user_id.
grant select, insert, update, delete on
  public.user_stats,
  public.days,
  public.tasks,
  public.projects,
  public.ideas,
  public.proof,
  public.reviews,
  public.finance_snapshots,
  public.body_logs
to authenticated;

-- Policies: one user can only see/write their own rows.
drop policy if exists "own user_stats select" on public.user_stats;
drop policy if exists "own user_stats insert" on public.user_stats;
drop policy if exists "own user_stats update" on public.user_stats;
drop policy if exists "own user_stats delete" on public.user_stats;

create policy "own user_stats select" on public.user_stats
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own user_stats insert" on public.user_stats
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own user_stats update" on public.user_stats
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "own user_stats delete" on public.user_stats
  for delete to authenticated using ((select auth.uid()) = user_id);

do $$
declare
  t text;
begin
  foreach t in array array['days','tasks','projects','ideas','proof','reviews','finance_snapshots','body_logs']
  loop
    execute format('drop policy if exists "own %s select" on public.%I', t, t);
    execute format('drop policy if exists "own %s insert" on public.%I', t, t);
    execute format('drop policy if exists "own %s update" on public.%I', t, t);
    execute format('drop policy if exists "own %s delete" on public.%I', t, t);

    execute format(
      'create policy "own %s select" on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      t, t
    );
    execute format(
      'create policy "own %s insert" on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
      t, t
    );
    execute format(
      'create policy "own %s update" on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      t, t
    );
    execute format(
      'create policy "own %s delete" on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',
      t, t
    );
  end loop;
end $$;
