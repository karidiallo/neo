-- Replace YOUR_AUTH_USER_UUID before running.

insert into public.marlon_identity(owner_user_id, name, role_label, active)
values ('YOUR_AUTH_USER_UUID'::uuid, 'Marlon', 'AI PM / CEO Assistant', true)
on conflict (owner_user_id)
do update set name = excluded.name, role_label = excluded.role_label, active = true, updated_at = now();

insert into public.marlon_permissions(
  owner_user_id, read_dashboard, manage_tasks, manage_projects,
  change_capacity, add_logs, read_finance, write_finance_mode, delete_task_mode
)
values (
  'YOUR_AUTH_USER_UUID'::uuid, true, true, true, true, true, true, 'confirm', 'confirm'
)
on conflict (owner_user_id)
do update set
  read_dashboard = excluded.read_dashboard,
  manage_tasks = excluded.manage_tasks,
  manage_projects = excluded.manage_projects,
  change_capacity = excluded.change_capacity,
  add_logs = excluded.add_logs,
  read_finance = excluded.read_finance,
  write_finance_mode = excluded.write_finance_mode,
  delete_task_mode = excluded.delete_task_mode,
  updated_at = now();
