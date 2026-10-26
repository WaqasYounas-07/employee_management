# Employee Management System — Backend

Django + DRF backend for employee records and **camera-based attendance**:
a camera at the door recognises enrolled employees and marks them present
automatically.

## How attendance works

```
Camera  ──POST frame──►  /api/cameras/ingest/  (X-Camera-Key)
                               │
                               ├─► recognition engine → embedding
                               ├─► match against enrolled face templates
                               ├─► RecognitionEvent  (always written: full audit trail)
                               └─► Attendance        (check-in / check-out)
```

Every frame produces a `RecognitionEvent`, even when nobody matches, so a
missed recognition at the gate can be investigated afterwards.

### The rules

| Situation | Result |
|---|---|
| First sighting of the day | Check in |
| Arrival within the shift's grace period | `present` |
| Arrival after grace | `late`, with minutes recorded |
| Another sighting within 5 min | Ignored as a duplicate |
| Sighting within 60 min of check-in | Not a check-out (stepping outside) |
| Later sighting | Check out; the last one of the day wins |
| Worked hours below the shift's half-day mark | `half_day` |
| Worked hours above full-day | Overtime recorded |
| Overnight shift crossing midnight | Counted as one day, the day the shift started |
| Never seen all day | `absent` via the end-of-day sweep |
| Holiday / approved leave | `holiday` / `on_leave`, never `absent` |

Cooldown and the minimum check-out gap are configurable
(`ATTENDANCE_DUPLICATE_COOLDOWN_MINUTES`, `ATTENDANCE_MIN_CHECKOUT_MINUTES`).

## Face recognition engine

The recognition model is pluggable — the rest of the system only ever talks to
`BaseEngine` in `app/services/recognition.py`.

| Engine | When it is used |
|---|---|
| `OpenCVSFaceEngine` | OpenCV's YuNet detector + SFace recogniser, 128-d, cosine distance. **The default production engine.** Ships as ONNX, so it needs no compiler. |
| `FaceRecognitionEngine` | dlib's 128-d ResNet, if you prefer it. Needs `cmake` and a C++ toolchain. |
| `HashEngine` | A deterministic development stub. **Not face recognition** — refuses to load when `DEBUG=False` unless `FACE_ALLOW_STUB=1`. |

The OpenCV engine needs two model files in `backend/src/models/`:

```bash
mkdir -p backend/src/models && cd backend/src/models
curl -LO https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
curl -LO https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx
```

`FACE_ENGINE=auto` picks the best available engine on restart. Templates record
which engine produced them and are only compared within that engine, so stub
templates never pollute real matching — **re-enrol everyone after switching**,
since the vectors are not interchangeable.

Set `FACE_ENGINE=stub` to pin the stub deliberately (the test suite does this,
because synthetic images are not real faces and a real model rightly rejects
them).

## Setup

```bash
cd backend/src
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

cp .env.example .env            # then edit DJANGO_SECRET_KEY
python manage.py migrate
python manage.py seed_demo      # admin@company.com / admin12345
python manage.py runserver
```

API at `http://localhost:8000/api/`, admin at `/admin/`.

> Change the seeded admin password before exposing the server.

## Wiring up a camera

1. Create the camera: `POST /api/cameras/` (admin only).
2. Read its key: `GET /api/cameras/{id}/key/`.
3. Have the camera or edge worker post frames:

```bash
curl -X POST http://localhost:8000/api/cameras/ingest/ \
  -H "X-Camera-Key: <key>" \
  -F "image=@frame.jpg"
```

Cameras authenticate with a per-device key, not a user token — there is nobody
at the door to log in. Keys are rotatable: `POST /api/cameras/{id}/rotate-key/`.

Response, one entry per detected face:

```json
{"camera": "Main Gate", "faces": 1, "results": [{
  "decision": "matched", "confidence": 0.91,
  "employee": {"id": 5, "code": "EMP001", "name": "Ayesha Khan"},
  "attendance_action": "check_in", "message": "Checked in at 09:05."
}]}
```

`decision` is one of `matched`, `no_match`, `low_confidence`, `no_face`,
`duplicate`, `error`.

## Enrolling a face

```bash
curl -X POST http://localhost:8000/api/employees/5/enroll-face/ \
  -H "Authorization: Bearer <token>" -F "image=@photo.jpg"
```

Enroll several photos per employee, from different angles and lighting — the
match rate at the door depends on it. The system refuses a photo that already
belongs to someone else, and refuses one where the face is too small to encode.

Raw embeddings are never returned by the API: they are biometric data.

## API

Auth: `POST /api/auth/login/` returns a JWT; send `Authorization: Bearer <access>`.

| Area | Endpoints |
|---|---|
| Auth | `auth/login`, `auth/refresh`, `auth/me`, `auth/register`, `auth/change-password` |
| Org | `departments`, `designations`, `shifts`, `holidays` |
| Employees | `employees` (+ `{id}/enroll-face`, `{id}/attendance`, `{id}/face-templates`) |
| Faces | `face-templates` (+ `{id}/deactivate`) |
| Cameras | `cameras` (+ `{id}/key`, `{id}/rotate-key`, `{id}/events`), `cameras/ingest` |
| Audit | `recognition-events` |
| Attendance | `attendance` (+ `today`, `matrix`, `mark-absentees`) |
| Leave | `leave-types`, `leave-requests` (+ `{id}/review`, `{id}/cancel`) |
| Reports | `dashboard`, `reports/attendance` |

### Roles

| Role | Can do |
|---|---|
| `admin` | Everything, including cameras and user accounts |
| `hr` | Manage employees, enrol faces, correct attendance |
| `manager` | View their own reports' records, review leave |
| `employee` | View only their own record, attendance and leave |

Permissions are decided by `role`, not by Django's `is_superuser`. A superuser
is always given the `admin` role -- both by `createsuperuser` and by a later
promotion -- so the two can never disagree. To change somebody's role, edit
the user in `/admin/` or:

```python
python manage.py shell
>>> from app.models import User
>>> u = User.objects.get(email='someone@company.com')
>>> u.role = User.Role.HR
>>> u.save()
```

### `GET /api/attendance/matrix/`

Attendance pivoted to employees x days, for the calendar grid. The paginated
list returns one record per row, so drawing a month for a whole team would
take many pages; this returns the range already pivoted, in one request.

```
?start=2026-10-01&end=2026-10-31&department=2&search=ayesha
```

Capped at 92 days. A day with no record is absent from `days` entirely --
nothing was recorded, which is not the same as a recorded absence; only the
end-of-day sweep decides that. Rows cover everyone the caller may see, so
somebody absent all month still appears.

```json
{
  "days": [{"date": "2026-10-01", "weekday": "Thu", "day": 1,
            "is_weekend": false, "is_holiday": false, "is_future": false}],
  "rows": [{
    "employee": {"id": 1, "code": "EMP001", "name": "Ayesha Khan", "photo": null,
                 "department": "Engineering", "designation": "Software Engineer"},
    "days": {"2026-10-01": {"status": "late", "check_in": "...", "check_out": "...",
                            "worked_hours": "8.50", "late_minutes": 45}},
    "summary": {"present": 18, "late": 3, "absent": 1, "half_day": 0, "on_leave": 2}
  }]
}
```

## Role permissions

What each role may do is **data, not hardcoded rules**: a `RolePermission`
row per (role, permission), edited from the Permissions page.

`GET /api/permissions/` returns the matrix plus the labels and grouping the
page renders. `POST` applies a batch of `{role, permission, granted}` changes
in one transaction.

Every endpoint checks the matrix through `HasPermission.of('...')`, so
unticking a box genuinely blocks the request -- it does not merely hide a
link in the UI. `/api/auth/me/` reports the caller's permissions so the
frontend can render accordingly, but that is a convenience: the API enforces
them independently.

Two rules keep the system recoverable:

- **The `admin` role always holds every permission** and cannot be edited.
  Otherwise an admin could revoke `manage_permissions` from every role and
  leave nobody able to put it back.
- **Defaults are seeded on first read** from `RolePermission.DEFAULT_MATRIX`,
  which mirrors the rules the system shipped with. Seeding only fills gaps,
  so running it again never undoes an edit.

Permissions fall into pages (`view_*`, which drive the sidebar and route
guards) and actions (`manage_employees`, `enrol_faces`,
`correct_attendance`, `approve_leave`, `manage_cameras`, `manage_settings`,
`manage_permissions`, `manage_users`).

A camera key authenticates a *device*, not a person, so it holds no role
permissions and is refused by every one of these checks.

## Testing without a door camera

The frontend has a **Live camera** page (`/live`) that turns a laptop webcam
into a door camera: it grabs a frame on a timer and posts it to this same
`/cameras/ingest/` endpoint with a camera's device key. Nothing in the backend
changes -- it is just another client of the door.

Pick which camera the laptop acts as, press Start, and attendance is recorded
against that camera using its entry/exit direction.

## Boards and tasks

The `tasks` app adds Kanban boards with assignment, in its own Django app
alongside `app`.

| Model | What it is |
|---|---|
| `Board` | A set of columns, optionally scoped to a department |
| `BoardColumn` | One lane, with an optional work-in-progress limit |
| `Task` | A card: title, priority, due date, labels, assignees |
| `TaskComment` | The conversation about a card |
| `TaskActivity` | An audit trail of moves, assignments and edits |

**The column is the source of truth.** Dropping a card in a column marked
`is_done_column` sets the task to `done` and stamps `completed_at`; dragging
it back out reopens it and clears that stamp. Reaching any working column
records `started_at`. Status is therefore never set twice by hand.

**Card order is a float.** Ranks are spaced `1000` apart, so dropping a card
between two others is their midpoint -- no other row is rewritten.

A new board is seeded with `To do`, `In progress` and `Done`, because a board
with no columns has nowhere to put a card.

### Endpoints

| Area | Endpoints |
|---|---|
| Boards | `boards` (+ `{id}/columns`, `{id}/reorder-columns`) |
| Columns | `board-columns` |
| Tasks | `tasks` (+ `{id}/move`, `{id}/assign`, `{id}/comments`, `{id}/activity`, `my-summary`) |

`GET /api/boards/{id}/` returns the whole board -- columns in order, each
with its cards -- deliberately unpaginated, since a board is useless one page
at a time. It accepts `search`, `assignee` and `priority` to narrow the cards
without changing the column layout.

### Who may do what

Four permissions, editable in the matrix like everything else:
`view_tasks`, `manage_boards`, `manage_tasks`, `assign_tasks`.

On top of those, **somebody assigned to a card may move, edit and comment on
it without holding `manage_tasks`** -- otherwise an employee could see their
own work on a board but never move it, which defeats the point. They still
cannot create, delete or reassign.

## Scheduled job

Mark everyone the cameras never saw:

```cron
0 23 * * *  cd /path/to/backend/src && venv/bin/python manage.py mark_absentees
```

## Tests

```bash
python manage.py test app
```

Covers the attendance rules (grace, duplicates, overnight shifts, half days,
absentee sweep), enrollment guards, camera authentication and ingestion, and
the role boundaries.

## Before production

- Set `DJANGO_SECRET_KEY` and `DJANGO_DEBUG=False`.
- Install `face-recognition`; leave `FACE_ALLOW_STUB=False` so the stub cannot
  run by accident.
- Switch `DB_ENGINE=postgres`.
- Replace the local-memory cache with Redis so the template cache is shared
  across workers.
- Serve `media/` from nginx or object storage, not Django.
- Face embeddings are biometric data — check your local retention obligations,
  and consider a retention policy on `RecognitionEvent.snapshot`.
