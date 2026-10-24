# Phone app (PWA)

Home-screen web app for taking attendance on Rens's iPhone, offline. The data lives in IndexedDB on the phone and
goes to the Mac as a JSON file over AirDrop. No server, no account, no network calls apart from loading the app files.

## Files

| File | Role |
|---|---|
| `index.html` | Shell; strict CSP (`'self'` only) |
| `app.js` | Views (classes, lesson, Teams links, alerts) and the file exchange |
| `sync.js` | Pure logic shared with the tests: dates, messages, periods, absence count, merge rules, file formats |
| `db.js` | IndexedDB wrapper and `navigator.storage.persist()` |
| `sw.js` | Offline cache (cache-first, same origin only) |
| `manifest.webmanifest`, `icons/` | Add to Home Screen; icons are written by `py -I tools\make_phone_icons.py` |
| `tests/sync.test.js` | `node --test src/PhoneApp/tests/sync.test.js` (Node's built-in runner, no packages) |

The Mac side is `src/AttendanceApp/phone_sync.py` (page **Telefoon** in the Flask app).

## Flow

1. Mac: **Telefoon → Exporteer naar telefoon** downloads `aanwezigheid-naar-telefoon-<date>.json`. Rens AirDrops it
   to the iPhone and taps **Importeer van Mac** in the app.
2. Phone: class → date → subject (Vak) → lesson number (the next free number is filled in) → everyone starts on
   Aanwezig → tap the exceptions → **Opslaan**. Without any subjects on the Mac, the app asks for a free lesson name
   instead. Absent students get Teams links (student, and the coach from the 3rd absence in a period and subject).
   Rens taps Verzenden in Teams himself.
3. Phone: **Stuur naar Mac** builds a file of everything changed since the last send and opens the iOS Share sheet
   (AirDrop to the Mac). Without `navigator.share` support it shows a download link instead.
4. Mac: **Telefoon → Importeren** merges the file (a backup is made first) and shows counts,
   e.g. "12 lessen, 3 gewijzigd, 1 nieuw".

## File formats (version 2)

Mac → phone, `format: "attendance-mac"`: `classes`, `students`, `periods`, `subjects` (`id`, `name`, `active`),
`lesson_names`, `templates` (the three Teams texts, resolved), `lessons` of the current school year (1 Aug – 31 Jul)
each with `subject_id`, `lesson_number` and its `attendance`, and `alerts` with `subject_id`.

Phone → Mac, `format: "attendance-phone"`: `device_id`, `since` (last send, or null for everything), and only the
`lessons` and `alerts` changed on the phone after `since`. Each lesson carries `subject_id`, `lesson_number`,
`lesson_name` and all its attendance records.

Version 2 adds subjects. The phone reads Mac files of version 1 and 2 and sends version 2; the Mac reads phone files
of version 1 and 2. `subject_id: null` is a lesson from before subjects ("not yet assigned"); its `lesson_name` is the
old free name. A subject lesson has `lesson_name` "Les N". Alert keys are `period_key` + `-s<subject_id>`
(e.g. `p3-s2`); old lessons keep the plain period key.

Timestamps are local time without a zone, `YYYY-MM-DDTHH:MM:SS`, the same as `now_iso()` on the Mac.

## Merge rules (identical in `sync.js` and `phone_sync.py`)

- Same class + date + subject + lesson number = same lesson; a lesson without a subject: same class + date + lesson
  name (case-insensitive). Phone key: `class|date|s<subject>|<number>` or `class|date|<name lowercased>`.
- Absences are counted per student, period and subject; lessons without a subject count together as one group.
- If the phone uses a lesson number that the class already has on another date (the phone's copy was out of date),
  the Mac gives the lesson the next free number. After the next Mac export the phone then shows both its own copy
  and the renumbered one; send first, then import from the Mac, to keep that rare case away.
- Per student record the newest `updated_at` wins; a tie keeps what is there. The phone only gives a record a new
  `updated_at` when its status or note really changed, so an untouched row never overrules a newer Mac edit.
- `teams_opened_at` / `coach_teams_opened_at` keep the latest time that is set.
- Alerts (student + period): highest count, first `created_at`, seen once seen on either side.
- On the phone, a Mac file replaces classes, students, periods, templates and lesson names; lessons, attendance and
  alerts are merged.
- Importing the same file twice changes nothing on either side.
- The Mac skips records of unknown students or classes and counts them as "overgeslagen".
- After a phone import the Mac recomputes the 3rd-absence alerts for every new or changed lesson, in date order.

## Local development

```powershell
cd "C:\Users\BasdeBruinGPProducts\OneDrive - GP Products B.V\Bureaublad\Attendence"
py -I -m http.server 8765 --bind 127.0.0.1 --directory src\PhoneApp
```

Open http://localhost:8765/ (service workers work on `localhost` without HTTPS). In `src/` the cache name is
`aanwezigheid-dev`; clear site data in the browser to pick up changes.

## Build

`py -I tools\make_builder.py` also writes `dist\PhoneApp\`: the app files without `tests/` and this README, with
`"dev"` in `sw.js` replaced by a hash of the files, so every new version gets a new cache and the app shows
"Nieuwe versie beschikbaar — Vernieuwen". The build stops if any `.json`, `.db`, `.csv` or `.xlsx` file would end up
in `dist\PhoneApp\`: student data must never be published.

## Publishing on GitHub Pages (Rens's account)

Only with Bas's explicit OK. Code only; there is never student data in these files.

1. Rens creates a **public** repository on github.com, e.g. `aanwezigheid` (free Pages needs public).
2. **Add file → Upload files**: drag in the *contents* of `dist\PhoneApp\` (not the folder itself), commit to `main`.
3. **Settings → Pages**: Source "Deploy from a branch", branch `main`, folder `/ (root)`. After a minute the app is at
   `https://<rens-username>.github.io/aanwezigheid/`.
4. On the iPhone: open that address in Safari, **Deel → Zet op beginscherm**, open the app once while online.
   Then import the Mac file.
5. Set `PHONE_APP_URL` in `src/AttendanceApp/phone_sync.py` to that address and rebuild, so the Telefoon page shows it.
6. Updates: rebuild, upload the changed files again (overwrite). The app offers "Vernieuwen" the next time it is
   opened online.

All paths are relative, so the app works under the `/aanwezigheid/` subpath.

## Alternative: fully offline, served by the Mac

The Mac serves `PhoneApp` over HTTPS on the local network with a certificate Rens trusts on the iPhone.

How: create a small own certificate authority and a server certificate for `<mac-name>.local` (e.g. with `openssl`,
which macOS ships), serve the folder with Python's `http.server` wrapped in `ssl`, AirDrop the CA certificate to the
iPhone, install the profile, and turn it on under Settings → General → About → Certificate Trust Settings.

| | GitHub Pages | Mac-served HTTPS |
|---|---|---|
| Third party | GitHub hosts the code (no data) | None |
| Setup | Rens: repo + upload, once | Certificate authority, server certificate, profile install and trust on the iPhone |
| Network exposure | None on the Mac | A server listening on the local network while it runs; others on that Wi-Fi can reach it |
| Install and updates | Any network | Phone and Mac on the same Wi-Fi, server running |
| Certificate | Managed by GitHub | iOS accepts at most 825 days; renew before it expires |
| Risk to the phone data | Low: the address never changes | The data belongs to the origin `https://<mac-name>.local:<port>`; if the Mac name or port changes, the app starts empty (send to Mac first) |

Both keep the attendance data on the phone and the Mac only; the hosting choice only decides where the code comes from.

