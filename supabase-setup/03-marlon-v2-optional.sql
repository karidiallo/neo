-- Marlon API v2
-- ONLY Marlon: separate identity, permissions and audit trail.
-- Run after Personal OS v1.4 schema.

create extension if not exists pgcrypto;

create table if not exists public.marlon_identity (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null default 'Marlon',
  role_label text not null default 'AI PM / CEO Assistant',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marlon_permissions (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  read_dashboard boolean not null default true,
  manage_tasks boolean not null default true,
  manage_projects boolean not null default true,
  change_capacity boolean not null default true,
  add_logs boolean not null default true,
  read_finance boolean not null default true,
  write_finance_mode text not null default 'confirm'
    check (write_finance_mode in ('deny','confirm','allow')),
  delete_task_mode text not null default 'confirm'
    check (delete_task_mode in ('deny','confirm','allow')),
  updated_at timestamptz not null default now()
);

create table if not exists public.marlon_audit_log (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  marlon_id uuid not null references public.marlon_identity(id) on delete cascade,
  action text not null,
  entity_type text not null,
  entity_id text,
  summary text,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists marlon_audit_owner_time_idx
  on public.marlon_audit_log(owner_user_id, created_at desc);

alter table public.marlon_identity enable row level security;
alter table public.marlon_permissions enable row level security;
alter table public.marlon_audit_log enable row level security;

revoke all on public.marlon_identity from anon, authenticated;
revoke all on public.marlon_permissions from anon, authenticated;
revoke all on public.marlon_audit_log from anon, authenticated;

create or replace function public.marlon_complete_task_v2(
  p_owner_user_id uuid,
  p_marlon_id uuid,
  p_task_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tasks%rowtype;
  v_gain integer;
  v_now timestamptz := now();
  v_day date := (v_now at time zone 'Europe/Warsaw')::date;
  v_before jsonb;
  v_after jsonb;
begin
  select * into t
  from public.tasks
  where id = p_task_id and user_id = p_owner_user_id
  for update;

  if not found then
    raise exception 'task_not_found';
  end if;

  if t.status = 'done' then
    return jsonb_build_object('ok', true, 'already_done', true, 'task_id', t.id, 'xp_gained', 0);
  end if;

  v_before := to_jsonb(t);

  v_gain :=
    case t.priority when 'P1' then 35 when 'P2' then 20 else 10 end
    + case when t.category = 'money' then 10 else 0 end;

  update public.tasks
  set status = 'done', completed_at = v_now, updated_at = v_now
  where id = t.id and user_id = p_owner_user_id
  returning to_jsonb(public.tasks.*) into v_after;

  insert into public.user_stats(user_id, xp, streak, updated_at)
  values (p_owner_user_id, v_gain, 0, v_now)
  on conflict (user_id)
  do update set xp = public.user_stats.xp + excluded.xp, updated_at = v_now;

  insert into public.proof(id, user_id, day, text, source, created_at)
  values (gen_random_uuid(), p_owner_user_id, v_day, 'Ukończone: ' || t.title, 'marlon', v_now);

  insert into public.daily_logs(id, user_id, day, section, title, note, payload, created_at)
  values (
    gen_random_uuid(), p_owner_user_id, v_day, 'tasks', 'Marlon ukończył zadanie',
    t.title || ' · +' || v_gain || ' XP',
    jsonb_build_object('task_id', t.id, 'xp', v_gain, 'actor', 'marlon'), v_now
  );

  insert into public.marlon_audit_log(
    owner_user_id, marlon_id, action, entity_type, entity_id,
    summary, before_state, after_state, metadata, created_at
  )
  values (
    p_owner_user_id, p_marlon_id, 'complete_task', 'task', t.id::text,
    'Marlon ukończył task: ' || t.title, v_before, v_after,
    jsonb_build_object('xp_gained', v_gain), v_now
  );

  return jsonb_build_object(
    'ok', true, 'task_id', t.id, 'title', t.title,
    'xp_gained', v_gain, 'completed_at', v_now
  );
end;
$$;

revoke all on function public.marlon_complete_task_v2(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.marlon_complete_task_v2(uuid, uuid, uuid) to service_role;

create or replace function public.marlon_change_capacity_v2(
  p_owner_user_id uuid,
  p_marlon_id uuid,
  p_day date,
  p_mode text,
  p_energy integer default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text;
  v_copy text;
  v_now timestamptz := now();
  v_before jsonb;
  v_after jsonb;
begin
  if p_mode not in ('full','standard','survival') then raise exception 'invalid_capacity_mode'; end if;
  if p_energy is not null and (p_energy < 1 or p_energy > 10) then raise exception 'invalid_energy'; end if;

  select to_jsonb(d.*) into v_before from public.days d
  where d.user_id = p_owner_user_id and d.day = p_day;

  v_label := case p_mode
    when 'full' then 'Od teraz działasz w trybie pełnym.'
    when 'standard' then 'Od teraz działasz w trybie standardowym.'
    else 'Od teraz zwalniasz do trybu minimalnego.' end;

  v_copy := case p_mode
    when 'full' then 'Masz więcej zasobów na dalszą część dnia. Nadal pilnujemy priorytetów.'
    when 'standard' then 'Normalne tempo: 2–3 ważne wyniki i bez dokładania chaosu.'
    else 'Dalsza część dnia chroni zasoby: jedna ważna rzecz, podstawy i zero nadrabiania na siłę.' end;

  insert into public.days(user_id, day, day_mode, day_label, day_copy, current_energy, capacity_updated_at, updated_at)
  values(p_owner_user_id, p_day, p_mode, v_label, v_copy, p_energy, v_now, v_now)
  on conflict (user_id, day)
  do update set
    day_mode = excluded.day_mode,
    day_label = excluded.day_label,
    day_copy = excluded.day_copy,
    current_energy = excluded.current_energy,
    capacity_updated_at = excluded.capacity_updated_at,
    updated_at = excluded.updated_at;

  select to_jsonb(d.*) into v_after from public.days d
  where d.user_id = p_owner_user_id and d.day = p_day;

  insert into public.daily_logs(id, user_id, day, section, title, note, payload, created_at)
  values(
    gen_random_uuid(), p_owner_user_id, p_day, 'capacity',
    case p_mode when 'full' then 'Marlon zmienił tryb na Pełny'
      when 'standard' then 'Marlon zmienił tryb na Standardowy'
      else 'Marlon zmienił tryb na Minimalny' end,
    p_note, jsonb_build_object('mode', p_mode, 'energy', p_energy, 'actor', 'marlon'), v_now
  );

  insert into public.marlon_audit_log(
    owner_user_id, marlon_id, action, entity_type, entity_id,
    summary, before_state, after_state, metadata, created_at
  )
  values (
    p_owner_user_id, p_marlon_id, 'change_capacity', 'day', p_day::text,
    'Marlon zmienił tempo dnia', v_before, v_after,
    jsonb_build_object('mode', p_mode, 'energy', p_energy, 'note', p_note), v_now
  );

  return jsonb_build_object('ok', true, 'day', p_day, 'mode', p_mode, 'energy', p_energy, 'label', v_label, 'updated_at', v_now);
end;
$$;

revoke all on function public.marlon_change_capacity_v2(uuid, uuid, date, text, integer, text) from public, anon, authenticated;
grant execute on function public.marlon_change_capacity_v2(uuid, uuid, date, text, integer, text) to service_role;
