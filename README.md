# NEO v2 — Task Detail patch

## 1. Run this SQL once
Open Supabase → SQL Editor and run:
`supabase-task-detail-patch.sql`

It adds to `tasks`:
- notes
- due_date
- link_url
- checklist JSONB

## 2. Replace ONLY these files in `/neo`
- index.html
- styles.css
- js/app.js
- js/supabase.js

Do not replace config.js / state.js / levels.js.

## New behavior
Click a task in:
- Project Overview
- Project Board
- Project List
- global Tasks list
- Today's unscheduled list

Task Detail includes:
- editable title
- priority
- estimate
- deadline
- URL
- notes
- checklist/subtasks
- checklist completion progress
- reorder checklist items
- schedule / reschedule
- complete
- delete

Calendar blocks: double click opens Task Detail so drag/resize still works normally.
