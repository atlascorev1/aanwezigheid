// Pure logic shared by the phone app and its tests: no DOM, no IndexedDB.
// Mirrors the Flask app (src/AttendanceApp/app.py and phone_sync.py); keep both sides in step.

export const FORMAT_MAC = "attendance-mac";
export const FORMAT_PHONE = "attendance-phone";
// Version 2 adds subjects: subject_id + lesson_number per lesson, subject_id per alert.
export const FORMAT_VERSION = 2;
export const MAC_VERSIONS = [1, 2]; // Mac exports the phone still reads

export const STATUSES = {
  present: "Aanwezig",
  absent: "Niet aanwezig",
  reported_absent: "Afgemeld",
  other: "Anders",
};

export const ALERT_THRESHOLD = 3;

const DAYS = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];
const MONTHS = ["januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december"];
const ORDINALS = {1: "eerste", 2: "tweede", 3: "derde", 4: "vierde", 5: "vijfde", 6: "zesde",
  7: "zevende", 8: "achtste", 9: "negende", 10: "tiende"};

// ---------- dates and text ----------

const pad = (n) => String(n).padStart(2, "0");

// Same shape as now_iso() on the Mac: local time, no zone, seconds.
export function nowIso(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function todayIso(d = new Date()) {
  return nowIso(d).slice(0, 10);
}

function parseIso(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Monday = 0, like Python's weekday().
function weekday(d) {
  return (d.getDay() + 6) % 7;
}

export function longDate(iso) {
  const d = parseIso(iso);
  return `${DAYS[weekday(d)]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function shortDate(iso) {
  const d = parseIso(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
}

export function joinNl(items) {
  if (items.length <= 1) return items.join("");
  return items.slice(0, -1).join(", ") + " en " + items[items.length - 1];
}

export function firstName(full) {
  const parts = (full || "").split(/\s+/).filter(Boolean);
  return parts.length ? parts[0] : "";
}

export function ordinal(n) {
  return ORDINALS[n] || `${n}e`;
}

// Python str.format_map with unknown keys kept as "{key}".
export function renderMessage(template, context) {
  return template.replace(/\{\{|\}\}|\{(\w+)\}/g, (match, key) => {
    if (match === "{{") return "{";
    if (match === "}}") return "}";
    return Object.prototype.hasOwnProperty.call(context, key) ? String(context[key]) : match;
  });
}

// urllib.parse.quote: encodeURIComponent leaves !'()* alone, quote does not.
function quote(text, safe = "") {
  let out = encodeURIComponent(text).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  if (safe.includes("@")) out = out.replace(/%40/g, "@");
  return out;
}

export function teamsUrl(email, text) {
  return `https://teams.microsoft.com/l/chat/0/0?users=${quote(email, "@")}&message=${quote(text)}`;
}

// ---------- periods and absences ----------

export function schoolYearBounds(iso) {
  const d = parseIso(iso);
  const startYear = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
  return {start: `${startYear}-08-01`, end: `${startYear + 1}-07-31`, startYear};
}

// Same keys and names as period_for() on the Mac.
export function periodFor(periods, iso) {
  const match = periods
    .filter((p) => p.start_date <= iso && p.end_date >= iso)
    .sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0))[0];
  if (match) return {key: `p${match.id}`, name: match.name, start: match.start_date, end: match.end_date};
  const sy = schoolYearBounds(iso);
  return {key: `sy${sy.startYear}`, name: `schooljaar ${sy.startYear}-${sy.startYear + 1}`, start: sy.start, end: sy.end};
}

// Same lesson as on the Mac: class + date + subject + lesson number; a lesson without a subject (from before
// subjects existed) is class + date + name, case-insensitive.
export function lessonKey(classId, lessonDate, lessonName, subjectId = null, lessonNumber = null) {
  if (subjectId != null) return `${classId}|${lessonDate}|s${subjectId}|${lessonNumber}`;
  return `${classId}|${lessonDate}|${(lessonName || "").trim().toLowerCase()}`;
}

export function keyOf(l) {
  return lessonKey(l.class_id, l.lesson_date, l.lesson_name, l.subject_id ?? null, l.lesson_number ?? null);
}

// "Wiskunde – Les 3", or the old free name (LABEL_SQL on the Mac).
export function lessonLabel(lesson, subjectsById) {
  if (lesson.subject_id == null) return lesson.lesson_name;
  const subject = subjectsById[lesson.subject_id];
  return `${subject ? subject.name : "Vak"} – Les ${lesson.lesson_number}`;
}

export function nextLessonNumber(lessons, classId, subjectId) {
  const used = lessons.filter((l) => l.class_id === classId && l.subject_id === subjectId).map((l) => l.lesson_number || 0);
  return (used.length ? Math.max(...used) : 0) + 1;
}

// alerts.period_key on the Mac: one alert per student, period and subject.
export function alertKey(period, subjectId) {
  return subjectId == null ? period.key : `${period.key}-s${subjectId}`;
}

// Order of lessons on one day: the Mac uses its row id; the phone uses created_at, then the key.
function lessonOrder(a, b) {
  if (a.lesson_date !== b.lesson_date) return a.lesson_date < b.lesson_date ? -1 : 1;
  const ca = a.created_at || "", cb = b.created_at || "";
  if (ca !== cb) return ca < cb ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

// Absence dates of a student in the period and the lesson's subject, up to and including this lesson
// (absence_dates() on the Mac). Lessons without a subject count together as one group.
// rows: attendance records of this student; lessonsByKey: key -> lesson.
export function absenceDates(rows, lessonsByKey, lesson, period) {
  const subject = lesson.subject_id ?? null;
  return rows
    .filter((r) => r.status === "absent")
    .map((r) => lessonsByKey[r.lesson_key])
    .filter((l) => l && (l.subject_id ?? null) === subject && l.lesson_date >= period.start && l.lesson_date <= period.end
      && lessonOrder(l, lesson) <= 0)
    .sort(lessonOrder)
    .map((l) => l.lesson_date);
}

export function coachFor(student, cls) {
  if (student.coach_name || student.coach_email) return {name: student.coach_name || "", email: student.coach_email || ""};
  return {name: cls.coach_name || "", email: cls.coach_email || ""};
}

export function messageContext(student, cls, lesson, period, dates, coachName, today = todayIso(), subjectsById = {}) {
  const subject = lesson.subject_id != null ? subjectsById[lesson.subject_id] : null;
  return {
    naam: firstName(student.name),
    student: student.name,
    wanneer: lesson.lesson_date === today ? "Vandaag" : `Op ${longDate(lesson.lesson_date)}`,
    les: lessonLabel(lesson, subjectsById),
    vak: subject ? subject.name : "",
    klas: cls.name,
    periode: period.name,
    keer: ordinal(dates.length),
    data: joinNl(dates.map(shortDate)),
    coach: firstName(coachName) || "coach",
  };
}

// ---------- merge rules (same as phone_sync.py) ----------

function maxSet(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a > b ? a : b;
}

// One attendance record: the newest updated_at wins; a tie keeps what is there.
// The "Teams opened" times keep the latest one that is set.
// Returns {row, changed}.
export function mergeAttendance(existing, incoming) {
  if (!existing) return {row: {...incoming}, changed: true};
  const row = {...existing};
  let changed = false;
  if ((incoming.updated_at || "") > (existing.updated_at || "")) {
    if (row.status !== incoming.status || (row.note || "") !== (incoming.note || "")) changed = true;
    row.status = incoming.status;
    row.note = incoming.note || "";
    row.updated_at = incoming.updated_at;
  }
  for (const col of ["teams_opened_at", "coach_teams_opened_at"]) {
    const merged = maxSet(existing[col], incoming[col]);
    if (merged !== (existing[col] || null)) changed = true;
    row[col] = merged;
  }
  return {row, changed};
}

// One alert (student + period): highest count, first created, seen once seen anywhere.
export function mergeAlert(existing, incoming) {
  if (!existing) return {row: {...incoming}, changed: true};
  const row = {...existing};
  row.absent_count = Math.max(existing.absent_count || 0, incoming.absent_count || 0);
  row.created_at = [existing.created_at, incoming.created_at].filter(Boolean).sort()[0] || existing.created_at;
  row.seen_at = maxSet(existing.seen_at, incoming.seen_at);
  row.teams_opened_at = maxSet(existing.teams_opened_at, incoming.teams_opened_at);
  const changed = ["absent_count", "created_at", "seen_at", "teams_opened_at"]
    .some((k) => (row[k] || null) !== (existing[k] || null));
  return {row, changed};
}

// ---------- file formats ----------

export function checkFile(data, expectedFormat) {
  if (!data || typeof data !== "object") return "Dit is geen geldig bestand.";
  if (data.format !== expectedFormat) {
    return expectedFormat === FORMAT_MAC
      ? "Dit is geen export van de Mac. Kies het bestand van Exporteer naar telefoon."
      : "Dit is geen bestand van de telefoon.";
  }
  const versions = expectedFormat === FORMAT_MAC ? MAC_VERSIONS : [FORMAT_VERSION];
  if (!versions.includes(data.version)) return `Onbekende versie (${data.version}). Werk de app bij.`;
  return null;
}

// The file "Stuur naar Mac" sends: every lesson and alert changed on the phone after `since`.
export function buildPhoneFile({deviceId, since, lessons, attendance, alerts, now = nowIso()}) {
  const changed = (x) => x.phone_changed_at && (!since || x.phone_changed_at > since);
  const rowsByLesson = {};
  for (const a of attendance) (rowsByLesson[a.lesson_key] ||= []).push(a);
  return {
    format: FORMAT_PHONE,
    version: FORMAT_VERSION,
    device_id: deviceId,
    exported_at: now,
    since: since || null,
    lessons: lessons.filter(changed).map((l) => ({
      class_id: l.class_id,
      lesson_date: l.lesson_date,
      lesson_name: l.lesson_name,
      subject_id: l.subject_id ?? null,
      lesson_number: l.lesson_number ?? null,
      created_at: l.created_at,
      updated_at: l.updated_at,
      attendance: (rowsByLesson[l.key] || []).map((a) => ({
        student_id: a.student_id,
        status: a.status,
        note: a.note || "",
        updated_at: a.updated_at,
        teams_opened_at: a.teams_opened_at || null,
        coach_teams_opened_at: a.coach_teams_opened_at || null,
      })),
    })),
    alerts: alerts.filter(changed).map((al) => ({
      student_id: al.student_id,
      period_key: al.period_key,
      period_name: al.period_name,
      subject_id: al.subject_id ?? null,
      absent_count: al.absent_count,
      created_at: al.created_at,
      seen_at: al.seen_at || null,
      teams_opened_at: al.teams_opened_at || null,
    })),
  };
}

// Merges a Mac export into the phone's current data. Master data (classes, students, periods,
// templates, lesson names) is replaced by the Mac's; lessons, attendance and alerts are merged,
// so changes on the phone that are newer survive. Returns the new state plus counts.
export function mergeMacFile(state, data) {
  const lessons = {}, attendance = {}, alerts = {};
  for (const l of state.lessons) lessons[l.key] = {...l};
  for (const a of state.attendance) attendance[`${a.lesson_key}#${a.student_id}`] = {...a};
  for (const al of state.alerts) alerts[`${al.student_id}#${al.period_key}`] = {...al};

  const counts = {lessons: 0, newLessons: 0, changedLessons: 0, alerts: 0};
  for (const inc of data.lessons || []) {
    counts.lessons++;
    const key = keyOf(inc);
    let changed = false;
    const existed = Boolean(lessons[key]);
    if (!existed) {
      lessons[key] = {key, class_id: inc.class_id, lesson_date: inc.lesson_date, lesson_name: inc.lesson_name,
        subject_id: inc.subject_id ?? null, lesson_number: inc.lesson_number ?? null,
        created_at: inc.created_at, updated_at: inc.updated_at, phone_changed_at: null};
      counts.newLessons++;
    } else {
      lessons[key].updated_at = maxSet(lessons[key].updated_at, inc.updated_at);
    }
    for (const a of inc.attendance || []) {
      if (!STATUSES[a.status]) continue;
      const id = `${key}#${a.student_id}`;
      const res = mergeAttendance(attendance[id], {...a, lesson_key: key});
      if (res.changed) changed = true;
      attendance[id] = {...res.row, lesson_key: key, student_id: a.student_id};
    }
    if (existed && changed) counts.changedLessons++;
  }
  for (const inc of data.alerts || []) {
    const id = `${inc.student_id}#${inc.period_key}`;
    const res = mergeAlert(alerts[id], inc);
    if (res.changed) counts.alerts++;
    alerts[id] = {...res.row, phone_changed_at: alerts[id] ? alerts[id].phone_changed_at || null : null};
  }

  return {
    state: {
      classes: data.classes || [],
      students: data.students || [],
      periods: data.periods || [],
      subjects: data.subjects || [],
      templates: data.templates || {},
      lessonNames: data.lesson_names || [],
      lessons: Object.values(lessons),
      attendance: Object.values(attendance),
      alerts: Object.values(alerts),
    },
    counts: {...counts, classes: (data.classes || []).length, students: (data.students || []).length},
  };
}

