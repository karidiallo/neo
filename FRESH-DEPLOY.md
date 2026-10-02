# Personal OS — fresh deploy

## Known existing Supabase backend
Project URL:
https://ucvmmbyjxotvpsupvbxp.supabase.co

Project ref:
ucvmmbyjxotvpsupvbxp

Known previous GitHub Pages URL:
https://karidiallo.github.io/os/

## Recommended reset path

### Option A — keep the existing Supabase (recommended first)
1. Create a NEW GitHub repository.
2. Upload all app files from this package to the repository root.
3. Enable GitHub Pages from `main` / root.
4. In Supabase Authentication → URL Configuration:
   - Site URL = your NEW GitHub Pages URL
   - Redirect URL = the same URL
5. Open the app and test login.
6. Test task creation, scheduling, resize, moving and completion.

The app config already points to the known Supabase project. If you choose a new Supabase project,
replace the URL and publishable key in `js/config.js`.

### Option B — new Supabase from zero
Run in order:
1. `supabase-setup/01-base-schema.sql`
2. `supabase-setup/02-v1_4-planner-patch.sql`

Then update `js/config.js` with the NEW Supabase URL + publishable key.

Do NOT run Marlon files until the dashboard itself is working.

## Auth flow
First device / reset:
email → Magic Link → set password → dashboard.

Later:
active session → dashboard directly;
signed out → email + password.

## Core v1.4 behaviors
- task duration can be unknown/custom
- scheduled block duration is separate from task estimate
- drag task onto timeline
- move scheduled task
- resize timeblock
- complete from calendar/list
- unschedule task
- completion awards XP + adds Proof
- explicit save logs
- mid-day capacity changes preserve morning history

## Marlon
Only after the dashboard is stable:
- `03-marlon-v2-optional.sql`
- `04-create-marlon-optional.sql`
- Edge Function/API work
