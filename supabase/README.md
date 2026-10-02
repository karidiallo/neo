# Supabase

The production app uses the Supabase project configured in `js/config.js`.

## Current migrations

### `001_task_details.sql`
Adds Task Workspace fields:
- notes
- due date
- URL
- checklist / subtasks

### `002_meal_planner.sql`
Adds:
- `meal_plans`
- `meal_recipes`
- RLS owner policies

Both migrations are idempotent.

If the current production database already contains these columns/tables, rerunning them is safe.
The dashboard is also defensive: missing meal tables no longer prevent the rest of Personal OS from loading.
