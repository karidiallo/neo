# Personal OS v1.4 — true timeblock planner

Repo-ready MVP: Vanilla JS + Supabase + GitHub Pages.

## Struktura

- `index.html` — szkielet aplikacji
- `styles.css` — cały design
- `js/app.js` — UI i flow
- `js/state.js` — lokalny state / fallback
- `js/levels.js` — XP + levele finansowe
- `js/supabase.js` — auth + synchronizacja
- `js/config.js` — Project URL i Publishable key
- `supabase-schema.sql` — schema bazy
- `.nojekyll` — prosty deploy na GitHub Pages

## Deploy na GitHub Pages

1. Utwórz repo `personal-os`.
2. Wrzuć CAŁĄ zawartość tego folderu do root repo.
3. GitHub → Settings → Pages.
4. Source: `Deploy from a branch`.
5. Branch: `main`, folder: `/(root)`.
6. Zapisz.
7. Skopiuj adres GitHub Pages.

## Supabase Auth

W Supabase → Authentication → URL Configuration:

- `Site URL`: Twój pełny URL GitHub Pages, np. `https://login.github.io/personal-os/`
- `Redirect URLs`: dodaj ten sam URL.

Potem wejdź na stronę, wpisz email, kliknij Magic Link.

## Po pierwszym udanym logowaniu

W `js/config.js` możesz zmienić:

```js
export const ALLOW_SIGNUP = false;
```

Wtedy nowe konta nie będą tworzone automatycznie.

## Level system

XP:
- P1: +35
- P2: +20
- P3: +10
- `Ruch finansowy`: dodatkowo +10 XP

Level pokazuje **symboliczny / aspiracyjny etap finansowy**, a nie realny stan konta.
Realne `cash` jest pokazywane obok osobno z zakładki Finanse.


## v1.1 changes

- Password login is primary; Magic Link is fallback.
- Use `Konto / hasło` inside the app once to set your password.
- Supabase sync is debounced and only writes changed sections instead of every table after every edit.
- Task categories now include:
  - Personal OS / mój progress
  - Ogólne / kilka obszarów
  - Money / BFI
  - DigitalMap
  - NeneFL
  - Ciało / zdrowie
  - Życie / administracja
  - Nauka
  - własna kategoria
- Duration can be unknown, 15m–3h, or custom with minutes/hours and no 90-minute cap.

### Required DB patch

Run `supabase-patch-v1_1.sql` once in Supabase SQL Editor before using "Nie wiem" duration.


## v1.2 — explicit save + daily logs + mid-day capacity

- Editable sections now use explicit **Zapisz** buttons instead of sending every keystroke to Supabase.
- Every save creates a timestamped entry in `daily_logs`.
- `Dzisiaj`, `Finanse`, `Ciało`, and `Projekty` show today's history at the bottom.
- Hero has **Zmień tempo dnia**:
  - Pełny
  - Standardowy
  - Minimalny
  - optional current energy 1–10
  - optional reason/note
- Morning briefing is preserved; a mid-day capacity change does not erase it.

### Required database patch

Run `supabase-patch-v1_2.sql` once in Supabase SQL Editor before deploying this version.


## Auth fix

- Uses Supabase `INITIAL_SESSION` instead of calling `getSession()` and then loading again.
- `onAuthStateChange` callback stays synchronous; database work is deferred with `setTimeout`.
- `PASSWORD_RECOVERY` automatically opens the password form.
- First Magic-Link sign-in prompts to set a password; successful password setup stores `password_set` in user metadata.
- Token refreshes no longer re-download the entire Personal OS state.


## v1.3 auth flow

First time / after reset:
1. Open app.
2. Enter email.
3. One Magic Link is sent.
4. Click it.
5. App shows only `Ustaw hasło`.
6. Password is saved with Supabase `updateUser`.
7. Dashboard opens.

Next time:
- active session → dashboard immediately;
- signed out → email + password login.

The app stores a local `passwordReady` profile to choose the correct signed-out screen.
The durable `password_set: true` marker is also stored in Supabase Auth user metadata.

No extra SQL is required for this auth change.


## v1.4 planner

The day calendar is now a real timeblock planner:

- drag an unscheduled task onto the day timeline;
- drag an already scheduled block to another time;
- resize a block from its bottom handle;
- block duration is stored separately as `scheduled_minutes`;
- exact scheduling modal supports any date, start time and custom duration;
- complete task from calendar, unscheduled list or Tasks view;
- unschedule from Tasks view or the timeblock modal;
- task estimate and scheduled block length are separate values.

### Database

Run `supabase-patch-v1_4.sql` once before deploying this version.
It is idempotent and includes the earlier v1.2 schema additions too.
