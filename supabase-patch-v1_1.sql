-- Personal OS v1.1 patch
-- Run once in Supabase SQL Editor.
-- Allows task duration to be unknown (NULL).
alter table public.tasks
  alter column estimate_minutes drop not null;
