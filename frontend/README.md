# Employee Management System — Frontend

React dashboard for the camera-based attendance system. Employees are added
here, their faces enrolled from a webcam or a photo, and attendance appears
live as the door cameras recognise people.

## Stack

| | |
|---|---|
| React 19 + Vite 8 | app and build |
| Tailwind v4 | styling, theme tokens in CSS |
| shadcn/ui + Radix | accessible component primitives |
| TanStack Query | server state, caching, polling |
| React Router 7 | routing with role guards |
| Recharts | dashboard charts |
| Axios | API client with JWT refresh |

## Setup

```bash
cd frontend
npm install
cp .env.example .env     # point VITE_API_URL at the backend
npm run dev              # http://localhost:5173
```

The backend must be running on `http://localhost:8000`, and the Vite origin
must be in its `CORS_ALLOWED_ORIGINS` (it is by default).

```bash
npm run build    # production bundle into dist/
npm run lint
```

## Structure

```
src/
  components/
    ui/          shadcn primitives (button, dialog, table, select, …)
    layout/      app shell: two-column sidebar, topbar, theme toggle
    shared/      app-level pieces: DataTable, StatCard, StatusBadge, …
  features/
    auth/        login, auth context, session handling
    dashboard/   role-aware dashboard (staff view vs. own view)
    employees/   list, detail, add/edit form, face enrolment
    attendance/  live board, history, HR corrections
    cameras/     camera CRUD, device keys, recognition log
    leave/       requests and approvals
    settings/    departments, designations, shifts, leave types, holidays
  lib/           api client, constants, formatters
  hooks/         theme, debounce
  routes/        router and role guards
```

A feature folder owns its pages and dialogs; anything used by two features
moves to `components/shared`.

## Navigation

The sidebar is two columns: a narrow icon rail and a nav panel.

- The **rail** lists the sections; clicking one scrolls that group into view.
- The **panel** has a search box and grouped links. A group with sub-items
  collapses, and opens automatically when the current route is inside it.
- **Searching** filters links by label and force-opens any group holding a
  match, so a matched child is never hidden behind a collapsed parent.
- Both follow the signed-in role, so an employee never sees admin sections.

Settings sub-links carry the tab in the URL (`/settings?tab=shifts`), so the
page is linkable and shareable rather than always opening on the first tab.

## Boards

`/boards` lists the Kanban boards; `/boards/:id` is the board itself and
`/my-tasks` is everything assigned to the signed-in user across all boards.

Cards drag between columns with the native HTML5 drag events. A drop sends
one `move` call carrying the target column and the index it landed at; the
API turns that index into a rank, so nothing else is renumbered.

A card is only draggable when the viewer may move it -- `manage_tasks`, or
being assigned to that card. The board asks the same question the API
enforces, so a card never looks movable and then fails.

Opening a card gives details, comments and the activity trail in one dialog,
since they are all "what is going on with this card".

## Live camera (testing without hardware)

`/live` turns this device's webcam into a door camera. It captures a frame on
a timer and posts it to `/cameras/ingest/` with the chosen camera's device
key -- the same request a real camera makes, so no backend code is involved
in the difference.

Pick which camera to act as, press Start, and recognised people are checked in
or out against that camera. The overlay and the side panel show each outcome:
recognised, already marked, not recognised, unclear, or no face.

Needs HTTPS or `localhost` -- browsers only grant camera access on a secure
origin.

## Profiles

`features/employees/profile-view.jsx` renders one profile and is shared by
two routes, which differ only in whose id they load and what they offer:

| Route | Who | Actions |
|---|---|---|
| `/employees/:id` | HR and admins | Edit, Enrol face |
| `/my-profile` | the signed-in user | read-only |

It shows the header (avatar, status dot, enrolment badge), this month's
attendance stats, About, Employment, enrolled face templates, and the
attendance table. Salary is only rendered when the caller passes
`showSalary`, so it is not exposed by accident.

## How it talks to the backend

**Auth.** `POST /auth/login/` returns a JWT pair, kept in `localStorage`. The
Axios client attaches the access token and, on a 401, refreshes once and
replays the request. Concurrent 401s share a single refresh, so a dashboard
firing six queries does not trigger six refreshes. If the refresh fails the
session clears and the app returns to the login page.

**Permissions.** The sidebar, route guards and in-page actions all read from
the role permission matrix, which `/api/auth/me/` reports for the signed-in
user. `useAuth()` exposes a `permissions` set and `can('view_cameras')`.

Admins edit the matrix at `/permissions`. Changing a box there changes what
the role can actually do, because the API checks the same permission on every
request. Routes use `<RequirePermission permission="view_cameras">`, so a user
is never dropped onto a page that would only 403.

This is presentation only — the backend enforces the same rules. Typing an
admin URL as an employee redirects to the dashboard, and the API would refuse
it regardless.

Because `/dashboard/` is staff-only, employees get a different dashboard built
from endpoints they may actually read (`features/dashboard/index.jsx` picks).

**Live data.** The dashboard, today's attendance and the recognition log poll
every 30 seconds, so the board reflects the door without a refresh.

## Face enrolment

`EnrollFaceDialog` captures from the webcam (with a framing guide, since the
backend rejects a face too small in frame) or takes an uploaded photo. It
stays open after a successful enrolment to encourage several shots from
different angles — the match rate at the door depends on it.

The backend's rejections are surfaced verbatim: no face found, more than one
face, too small, or already enrolled to another employee. Raw embeddings are
never sent to the browser.

## Theming

Theme tokens are HSL triples on `:root` and `.dark` in `src/index.css`, mapped
into Tailwind with `@theme inline`. To rebrand, change `--primary` there;
every component follows. The toggle offers light, dark and system, and the
choice persists per browser.

## Notes

- `npm run build` splits per route, so the first load does not carry Recharts
  or pages a given role never opens.
- `eslint.config.js` registers `react-hooks` directly: the plugin's presets in
  this version ship a malformed `plugins` object that flat config rejects.
