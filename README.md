# NEO — Personal OS

Personal productivity / CEO operating system deployed as a static GitHub Pages app with Supabase as the backend.

## Production architecture

```text
GitHub Pages
  index.html
  styles.css
  js/
    app.js        UI + application logic
    state.js      local state shape / helpers
    levels.js     XP and levels
    supabase.js   auth + cloud hydration/sync
    config.js     Supabase public configuration

Supabase
  auth
  days
  tasks
  projects
  ideas
  proof
  reviews
  finance_snapshots
  body_logs
  daily_logs
  meal_plans
  meal_recipes
```

## Main modules

- Dzisiaj — Top 3, capacity, timeblocks and unscheduled work
- Kalendarz — planner / timeblocking
- Zadania — all tasks
- Finanse / BFI
- Projekty — project workspaces with Overview / Kanban / List / Timeline
- Task Workspace — notes, deadline, URL, checklist / subtasks
- Ciało
- Posiłki — meal planning synced with the main calendar
- Dowody
- Przeglądy
- Schowek pomysłów

## Deploy

GitHub Pages should deploy:

- branch: `main`
- folder: `/root`

No build step is required.

## Supabase

Public project configuration lives in `js/config.js`.

Database migrations are kept only in:

```text
supabase/migrations/
  001_task_details.sql
  002_meal_planner.sql
```

Do not add old patch SQL files back into the repository.

## Important rules for future edits

1. Do not paste generated JavaScript as escaped text containing literal `\\n`.
2. Before deploy, run:
   `node --check js/app.js`
   `node --check js/supabase.js`
3. A new optional module must never make `hydrateCloud()` fail for the entire app if its optional table is missing.
4. Do not duplicate old patch files in the repo. Modify the current source and keep a migration only when the database schema changes.
5. Do not put Supabase service-role or other private keys in this repository. `config.js` uses only the public/publishable client key.
