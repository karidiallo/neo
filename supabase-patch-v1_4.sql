-- Personal OS v1.4 planner patch
-- Run once in Supabase SQL Editor.
-- Safe to run even if v1.2 was already applied.

alter table public.tasks
  alter column estimate_minutes drop not null;

alter table public.tasks
  add column if not exists scheduled_minutes integer;

alter table public.days
  add column if not exists current_energy smallint
    check (current_energy between 1 and 10),
  add column if not exists capacity_updated_at timestamptz;

create table if not exists public.daily_logs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  section text not null,
  title text not null,
  note text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists daily_logs_user_day_idx
  on public.daily_logs(user_id, day, created_at desc);

alter table public.daily_logs enable row level security;
grant select, insert, update, delete on public.daily_logs to authenticated;

drop policy if exists "own daily_logs select" on public.daily_logs;
drop policy if exists "own daily_logs insert" on public.daily_logs;
drop policy if exists "own daily_logs update" on public.daily_logs;
drop policy if exists "own daily_logs delete" on public.daily_logs;

create policy "own daily_logs select" on public.daily_logs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own daily_logs insert" on public.daily_logs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own daily_logs update" on public.daily_logs
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "own daily_logs delete" on public.daily_logs
  for delete to authenticated using ((select auth.uid()) = user_id);
