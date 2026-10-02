-- NEO v2 — Task Detail / Checklist patch
-- Run once in Supabase SQL Editor.
-- Safe to run again.

alter table public.tasks
  add column if not exists notes text,
  add column if not exists due_date date,
  add column if not exists link_url text,
  add column if not exists checklist jsonb not null default '[]'::jsonb;

-- Optional sanity check:
-- select id, title, notes, due_date, link_url, checklist from public.tasks limit 20;
