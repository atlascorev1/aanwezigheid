// Phone app: views, saving and the file exchange with the Mac. Logic shared with the tests is in sync.js.
import * as store from "./db.js";
import {
  ALERT_THRESHOLD, FORMAT_MAC, STATUSES, absenceDates, alertKey, buildPhoneFile, checkFile, coachFor, lessonKey,
  lessonLabel, longDate, mergeMacFile, messageContext, nextLessonNumber, nowIso, periodFor, renderMessage, teamsUrl,
  todayIso,
} from "./sync.js";

const view = document.getElementById("view");
let flashes = [];
let dirty = false;      // unsaved changes on the lesson page
let downloadUrl = null; // fallback link for "Stuur naar Mac"

// ---------- helpers ----------

const ESC = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"};
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

function flash(text, kind = "success") {
  flashes.push({text, kind});
}

function flashHtml() {
  const html = flashes.map((f) => `<div class="flash flash-${f.kind}" role="status">${esc(f.text)}</div>`).join("");
  flashes = [];
  return html;
}

function shortStamp(iso) {
  return iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)} ${iso.slice(11, 16)}` : "";
}

function byName(a, b) {
  return a.name.localeCompare(b.name, "nl", {sensitivity: "base"});
}

async function loadAll() {
  const [classes, students, periods, lessons, attendance, alerts, meta] = await Promise.all(
    ["classes", "students", "periods", "lessons", "attendance", "alerts", "meta"].map((s) => store.getAll(s)));
  const m = Object.fromEntries(meta.map((r) => [r.key, r.value]));
  const subjects = m.subjects || [];
  const subjectsById = Object.fromEntries(subjects.map((x) => [x.id, x]));
  return {classes, students, periods, lessons, attendance, alerts, meta: m, subjects, subjectsById};
}

function unsentCount(lessons, alerts, lastSentAt) {
  const changed = (x) => x.phone_changed_at && (!lastSentAt || x.phone_changed_at > lastSentAt);
  return {lessons: lessons.filter(changed).length, alerts: alerts.filter(changed).length};
}

// A lesson with a subject is addressed by subject + number (s, l); an old one by its name (n).
function lessonHash(l) {
  const base = `#/les?c=${l.class_id}&d=${l.lesson_date}`;
  return l.subject_id != null ? `${base}&s=${l.subject_id}&l=${l.lesson_number}` : `${base}&n=${encodeURIComponent(l.lesson_name)}`;
}

// ---------- views ----------

async function homeView() {
  const s = await loadAll();
  const lastSent = s.meta.lastSentAt || null;
  const unsent = unsentCount(s.lessons, s.alerts, lastSent);
  const classes = s.classes.filter((c) => c.active).sort(byName);
  const studentsById = Object.fromEntries(s.students.map((x) => [x.id, x]));
  const classesById = Object.fromEntries(s.classes.map((c) => [c.id, c]));
  const openAlerts = s.alerts.filter((a) => !a.seen_at && studentsById[a.student_id])
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  const classItems = classes.map((c) => {
    const count = s.students.filter((x) => x.class_id === c.id && x.active).length;
    const last = s.lessons.filter((l) => l.class_id === c.id).map((l) => l.lesson_date).sort().pop();
    return `<li><a class="list-link" href="#/klas/${c.id}">
      <span class="student-name">${esc(c.name)}</span>
      <span class="muted small">${count} studenten${last ? `, laatste les ${esc(longDate(last))}` : ""}</span></a></li>`;
  }).join("");

  const alertItems = openAlerts.map((a) => {
    const st = studentsById[a.student_id];
    const cls = classesById[st.class_id];
    const subject = a.subject_id != null ? s.subjectsById[a.subject_id] : null;
    return `<li class="alert-row"><div><span class="student-name">${esc(st.name)}</span>
        <span class="pill pill-absent">${a.absent_count}e keer</span>
        <div class="muted small">${esc(cls ? cls.name : "")}${subject ? `, ${esc(subject.name)}` : ""}, ${esc(a.period_name)}</div></div>
      <button type="button" data-seen="${a.student_id}|${esc(a.period_key)}">Gezien</button></li>`;
  }).join("");

  const empty = !s.classes.length ? `
    <section class="card">
      <h2>Nog geen gegevens</h2>
      <p>Open op de Mac de pagina <strong>Telefoon</strong>, kies <strong>Exporteer naar telefoon</strong> en stuur het bestand
      met AirDrop naar deze iPhone. Kies daarna hieronder <strong>Importeer van Mac</strong>.</p>
    </section>` : "";

  view.innerHTML = `
    <header class="page-header"><h1>Aanwezigheid</h1></header>
    ${flashHtml()}
    ${empty}
    ${alertItems ? `<section class="card"><h2>Aandacht</h2><ul class="plain-list">${alertItems}</ul></section>` : ""}
    ${classItems ? `<section class="card"><h2>Klassen</h2><ul class="plain-list">${classItems}</ul></section>` : ""}
    <section class="card">
      <h2>Mac</h2>
      <p class="muted small">${!s.lessons.length ? "Nog niets om te sturen."
        : unsent.lessons ? `${unsent.lessons} ${unsent.lessons === 1 ? "les" : "lessen"} nog niet naar de Mac gestuurd.`
        : "Alles is naar de Mac gestuurd."}
        ${lastSent ? `Laatst verstuurd ${esc(shortStamp(lastSent))}.` : ""}
        ${s.meta.lastImportAt ? `Laatst geïmporteerd ${esc(shortStamp(s.meta.lastImportAt))}.` : ""}</p>
      <div class="stack">
        ${s.lessons.length ? `<button type="button" class="primary large" id="send">Stuur naar Mac</button>` : ""}
        <label class="button large file-button ${s.lessons.length ? "" : "primary"}">Importeer van Mac
          <input type="file" id="import" accept="application/json,.json"></label>
        <div id="download"></div>
        ${s.lessons.length ? `<button type="button" class="link-button" id="send-all">Alles opnieuw sturen</button>` : ""}
      </div>
    </section>
    <p class="muted small footnote" id="storage-note"></p>`;

  view.querySelectorAll("[data-seen]").forEach((btn) => btn.addEventListener("click", async () => {
    const [sid, key] = btn.dataset.seen.split("|");
    const alert = await store.get("alerts", [Number(sid), key]);
    if (alert) {
      const now = nowIso();
      await store.write({alerts: [{...alert, seen_at: now, phone_changed_at: now}]});
    }
    render();
  }));
  // No lessons yet (fresh install): only the import is offered.
  document.getElementById("send")?.addEventListener("click", () => sendToMac(false));
  document.getElementById("send-all")?.addEventListener("click", () => sendToMac(true));
  document.getElementById("import").addEventListener("change", (e) => importFromMac(e.target.files[0]));
  showStorageNote();
}

async function classView(classId) {
  const s = await loadAll();
  const cls = s.classes.find((c) => c.id === classId);
  if (!cls) return notFound("Klas niet gevonden.");
  const lastSent = s.meta.lastSentAt || null;
  const names = [...new Set(s.meta.lessonNames || [])];
  const subjects = s.subjects.filter((x) => x.active).sort(byName);
  const recent = s.lessons.filter((l) => l.class_id === classId)
    .sort((a, b) => (a.lesson_date < b.lesson_date ? 1 : a.lesson_date > b.lesson_date ? -1 : 0)).slice(0, 15);

  const rows = recent.map((l) => {
    const absent = s.attendance.filter((a) => a.lesson_key === l.key && a.status === "absent").length;
    const unsent = l.phone_changed_at && (!lastSent || l.phone_changed_at > lastSent);
    return `<li><a class="list-link" href="${lessonHash(l)}">
      <span class="student-name">${esc(lessonLabel(l, s.subjectsById))}</span>
      <span class="muted small">${esc(longDate(l.lesson_date))}
        ${absent ? `<span class="pill pill-absent">${absent} niet aanwezig</span>` : ""}
        ${unsent ? `<span class="badge">niet verstuurd</span>` : ""}</span></a></li>`;
  }).join("");

  view.innerHTML = `
    <a class="back" href="#/">Klassen</a>
    <header class="page-header"><h1>${esc(cls.name)}</h1></header>
    ${flashHtml()}
    <section class="card">
      <h2>Les openen</h2>
      <form id="open-lesson" class="stack">
        <div class="field"><label for="lesson-date">Datum</label>
          <input type="date" id="lesson-date" value="${todayIso()}" required></div>
        ${subjects.length ? `
        <div class="field"><label for="lesson-subject">Vak</label>
          <select id="lesson-subject" required>
            ${subjects.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("")}
          </select></div>
        <div class="field"><label for="lesson-number">Les</label>
          <input type="number" id="lesson-number" inputmode="numeric" min="1" max="999" required></div>` : `
        <div class="field"><label for="lesson-name">Lesnaam</label>
          <input type="text" id="lesson-name" list="lesson-names" autocomplete="off" required>
          <datalist id="lesson-names">${names.map((n) => `<option value="${esc(n)}">`).join("")}</datalist></div>`}
        <button class="primary large" type="submit">Les openen</button>
      </form>
    </section>
    ${rows ? `<section class="card"><h2>Recente lessen</h2><ul class="plain-list">${rows}</ul></section>` : ""}`;

  const subjectSelect = document.getElementById("lesson-subject");
  const numberInput = document.getElementById("lesson-number");
  // The next free number for this class and subject, like the Mac; Rens can still change it.
  const suggest = () => { numberInput.value = nextLessonNumber(s.lessons, classId, Number(subjectSelect.value)); };
  if (subjectSelect) {
    subjectSelect.addEventListener("change", suggest);
    suggest();
  }
  document.getElementById("open-lesson").addEventListener("submit", (e) => {
    e.preventDefault();
    const date = document.getElementById("lesson-date").value;
    if (!date) return;
    if (subjectSelect) {
      const number = Number(numberInput.value);
      if (number >= 1) location.hash = lessonHash({class_id: classId, lesson_date: date, subject_id: Number(subjectSelect.value), lesson_number: number});
      return;
    }
    const name = document.getElementById("lesson-name").value.trim();
    if (name) location.hash = lessonHash({class_id: classId, lesson_date: date, subject_id: null, lesson_name: name});
  });
}

async function lessonView(params) {
  const classId = Number(params.get("c"));
  const date = params.get("d") || "";
  const subjectId = params.has("s") ? Number(params.get("s")) : null;
  const number = subjectId != null ? Number(params.get("l")) : null;
  const name = subjectId != null ? `Les ${number}` : (params.get("n") || "").trim();
  const s = await loadAll();
  const cls = s.classes.find((c) => c.id === classId);
  const validSubject = subjectId == null || (s.subjectsById[subjectId] && Number.isInteger(number) && number >= 1);
  if (!cls || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !name || !validSubject) return notFound("Les niet gevonden.");

  const key = lessonKey(classId, date, name, subjectId, number);
  const saved = s.lessons.find((l) => l.key === key);
  const lesson = saved || {key, class_id: classId, lesson_date: date, lesson_name: name, subject_id: subjectId, lesson_number: number};
  const label = lessonLabel(lesson, s.subjectsById);
  const records = Object.fromEntries(s.attendance.filter((a) => a.lesson_key === key).map((a) => [a.student_id, a]));
  const students = s.students
    .filter((x) => x.class_id === classId && (x.active || records[x.id]))
    .sort(byName);
  const prefill = !Object.keys(records).length;
  const period = periodFor(s.periods, date);
  const lessonsByKey = Object.fromEntries(s.lessons.map((l) => [l.key, l]));
  const templates = s.meta.templates || {};

  const absentees = students.filter((x) => records[x.id] && records[x.id].status === "absent").map((x) => {
    const dates = absenceDates(s.attendance.filter((a) => a.student_id === x.id), lessonsByKey, lesson, period);
    const coach = coachFor(x, cls);
    const ctx = messageContext(x, cls, lesson, period, dates, coach.name, todayIso(), s.subjectsById);
    const repeat = dates.length >= ALERT_THRESHOLD;
    return {
      student: x, record: records[x.id], count: dates.length, repeat, coach,
      studentUrl: x.email ? teamsUrl(x.email, renderMessage(templates[repeat ? "template_repeat" : "template_absent"] || "", ctx)) : "",
      coachUrl: repeat && coach.email ? teamsUrl(coach.email, renderMessage(templates.template_coach || "", ctx)) : "",
    };
  });

  const teams = absentees.map((r) => `
    <li>
      <div class="student-name">${esc(r.student.name)}
        ${r.repeat ? `<span class="pill pill-absent">${r.count}e keer</span>`
          : `<span class="muted small">${r.count}e keer in ${esc(period.name)}</span>`}</div>
      <div class="teams-actions">
        ${r.studentUrl ? `<a class="button teams-link" target="_blank" rel="noopener" href="${esc(r.studentUrl)}"
            data-open="teams_opened_at" data-student="${r.student.id}">Bericht aan student</a>
            <span class="muted small opened">${r.record.teams_opened_at ? `geopend op ${esc(shortStamp(r.record.teams_opened_at))}` : ""}</span>`
          : `<span class="muted small">Geen e-mail bekend.</span>`}
        ${r.repeat ? (r.coachUrl ? `<a class="button teams-link" target="_blank" rel="noopener" href="${esc(r.coachUrl)}"
            data-open="coach_teams_opened_at" data-student="${r.student.id}">Bericht aan coach${r.coach.name ? ` (${esc(r.coach.name)})` : ""}</a>
            <span class="muted small opened">${r.record.coach_teams_opened_at ? `geopend op ${esc(shortStamp(r.record.coach_teams_opened_at))}` : ""}</span>`
          : `<span class="muted small">Geen coach bekend.</span>`) : ""}
      </div>
    </li>`).join("");

  const rows = students.map((x) => {
    const rec = records[x.id];
    const current = rec ? rec.status : (prefill ? "present" : "");
    const options = Object.entries(STATUSES).map(([k, label]) => `
      <label class="status-option status-${k}">
        <input type="radio" name="status_${x.id}" value="${k}" ${current === k ? "checked" : ""}>
        <span>${label}</span></label>`).join("");
    return `<li class="student-row" data-student="${x.id}">
      <div class="student-name">${esc(x.name)}${x.active ? "" : ` <span class="badge">inactief</span>`}</div>
      <div class="status-grid">${options}</div>
      <input class="note-input ${current === "other" ? "" : "hidden"}" type="text" name="note_${x.id}"
        value="${esc(rec ? rec.note : "")}" aria-label="Notitie bij ${esc(x.name)}" placeholder="Notitie, bijvoorbeeld tandarts">
    </li>`;
  }).join("");

  view.innerHTML = `
    <a class="back" href="#/klas/${classId}">${esc(cls.name)}</a>
    <header class="page-header"><h1>${esc(label)}</h1>
      <p class="muted">${esc(cls.name)}, ${esc(longDate(date))}, ${esc(period.name)}</p></header>
    ${flashHtml()}
    ${teams ? `<section class="card"><h2>Teams-berichten</h2>
      <p class="muted small">Opent Teams met het bericht al ingevuld. Controleer de tekst en tik in Teams op Verzenden.</p>
      <ul class="teams-list">${teams}</ul></section>` : ""}
    ${prefill && students.length ? `<div class="notice">Nieuwe les: iedereen staat op <strong>Aanwezig</strong>.
      Tik alleen de uitzonderingen aan en sla op. Zolang je niet opslaat, is er niets bewaard.</div>` : ""}
    <form id="attendance-form">
      ${students.length ? `<ul class="plain-list students">${rows}</ul>`
        : `<p class="empty">Geen studenten in deze klas. Voeg ze op de Mac toe en importeer opnieuw.</p>`}
      <div class="savebar">
        <button type="button" id="set-all-present">Iedereen aanwezig</button>
        <button class="primary large" type="submit">Opslaan</button>
      </div>
    </form>`;

  const form = document.getElementById("attendance-form");
  form.addEventListener("change", (e) => {
    dirty = true;
    if (e.target.type === "radio") {
      const note = form.querySelector(`[name="note_${e.target.name.slice(7)}"]`);
      note.classList.toggle("hidden", e.target.value !== "other");
    }
  });
  document.getElementById("set-all-present").addEventListener("click", () => {
    form.querySelectorAll('input[value="present"]').forEach((r) => { r.checked = true; });
    form.querySelectorAll(".note-input").forEach((n) => n.classList.add("hidden"));
    dirty = true;
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    saveLesson(form, lesson, students, records, s);
  });
  view.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", () => {
    markOpened(key, Number(a.dataset.student), a.dataset.open, a);
  }));
}

function notFound(text) {
  view.innerHTML = `<a class="back" href="#/">Klassen</a><p class="empty">${esc(text)}</p>`;
}

// ---------- saving ----------

async function saveLesson(form, lesson, students, records, s) {
  const now = nowIso();
  const missing = [];
  const rows = [];
  for (const x of students) {
    const picked = form.querySelector(`input[name="status_${x.id}"]:checked`);
    if (!picked) {
      if (x.active) missing.push(x.name);
      continue;
    }
    const status = picked.value;
    const note = status === "other" ? form.querySelector(`[name="note_${x.id}"]`).value.trim() : "";
    const old = records[x.id];
    // Only a real change gets a new updated_at, so an untouched row never overrules a newer edit on the Mac.
    if (old && old.status === status && (old.note || "") === note) continue;
    rows.push({...(old || {teams_opened_at: null, coach_teams_opened_at: null}),
      lesson_key: lesson.key, student_id: x.id, status, note, updated_at: now});
  }
  if (missing.length) {
    flash("Niet alle actieve studenten hebben een status: " + missing.join(", "), "error");
    return render();
  }

  const isNew = !lesson.created_at;
  const lessonRow = {
    key: lesson.key, class_id: lesson.class_id, lesson_date: lesson.lesson_date, lesson_name: lesson.lesson_name,
    subject_id: lesson.subject_id ?? null, lesson_number: lesson.lesson_number ?? null,
    created_at: lesson.created_at || now,
    updated_at: rows.length || isNew ? now : lesson.updated_at,
    phone_changed_at: rows.length || isNew ? now : lesson.phone_changed_at || null,
  };

  // 3rd-absence alerts, as on the Mac: every absent student in this lesson, counted per period.
  const attendance = s.attendance.filter((a) => a.lesson_key !== lesson.key)
    .concat(students.map((x) => rows.find((r) => r.student_id === x.id) || records[x.id]).filter(Boolean));
  const lessonsByKey = Object.fromEntries(s.lessons.map((l) => [l.key, l]));
  lessonsByKey[lesson.key] = lessonRow;
  const period = periodFor(s.periods, lesson.lesson_date);
  const key = alertKey(period, lessonRow.subject_id);
  const subject = lessonRow.subject_id != null ? s.subjectsById[lessonRow.subject_id] : null;
  const alertRows = [];
  const warnings = [];
  for (const a of attendance.filter((r) => r.lesson_key === lesson.key && r.status === "absent")) {
    const count = absenceDates(attendance.filter((r) => r.student_id === a.student_id), lessonsByKey, lessonRow, period).length;
    if (count < ALERT_THRESHOLD) continue;
    const existing = s.alerts.find((al) => al.student_id === a.student_id && al.period_key === key);
    if (existing) {
      if (count > existing.absent_count) alertRows.push({...existing, absent_count: count, phone_changed_at: now});
    } else {
      alertRows.push({student_id: a.student_id, period_key: key, period_name: period.name, subject_id: lessonRow.subject_id,
        absent_count: count, created_at: now, seen_at: null, teams_opened_at: null, phone_changed_at: now});
      const st = students.find((x) => x.id === a.student_id);
      const where = subject ? `bij ${subject.name} in ${period.name}` : `in ${period.name}`;
      warnings.push(`Let op: ${st ? st.name : "student"} is nu ${count}× afwezig ${where}.`);
    }
  }

  await store.write({lessons: [lessonRow], attendance: rows, alerts: alertRows});
  dirty = false;
  flash("Aanwezigheid opgeslagen.");
  warnings.forEach((w) => flash(w, "warning"));
  render();
}

async function markOpened(key, studentId, column, link) {
  const rec = await store.get("attendance", [key, studentId]);
  const lesson = await store.get("lessons", key);
  if (!rec || !lesson) return;
  const now = nowIso();
  await store.write({attendance: [{...rec, [column]: now}], lessons: [{...lesson, phone_changed_at: now}]});
  const note = link.nextElementSibling;
  if (note && note.classList.contains("opened")) note.textContent = `geopend op ${shortStamp(now)}`;
}

// ---------- file exchange with the Mac ----------

async function sendToMac(everything) {
  const s = await loadAll();
  const since = everything ? null : s.meta.lastSentAt || null;
  const deviceId = s.meta.deviceId;
  const file = buildPhoneFile({deviceId, since, lessons: s.lessons, attendance: s.attendance, alerts: s.alerts});
  if (!file.lessons.length && !file.alerts.length) {
    flash("Er is niets nieuws om naar de Mac te sturen.", "warning");
    return render();
  }
  const name = `aanwezigheid-van-telefoon-${file.exported_at.slice(0, 16).replace(/[-:]/g, "").replace("T", "-")}.json`;
  const blob = new File([JSON.stringify(file, null, 1)], name, {type: "application/json"});
  const summary = `${file.lessons.length} ${file.lessons.length === 1 ? "les" : "lessen"}`;

  if (navigator.canShare && navigator.canShare({files: [blob]})) {
    try {
      await navigator.share({files: [blob], title: "Aanwezigheid naar Mac"});
      await store.setMeta({lastSentAt: file.exported_at});
      flash(`Verstuurd: ${summary}. Kies op de Mac Telefoon → Importeren.`);
      return render();
    } catch (err) {
      if (err && err.name === "AbortError") {
        flash("Niet verstuurd.", "warning");
        return render();
      }
      // Any other error: offer the download link below.
    }
  }

  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = URL.createObjectURL(blob);
  const box = document.getElementById("download");
  box.innerHTML = `<a class="button large" href="${downloadUrl}" download="${esc(name)}">Download bestand (${esc(summary)})</a>
    <p class="muted small">Delen werkt hier niet. Download het bestand en zet het via AirDrop of Bestanden op de Mac.</p>`;
  box.querySelector("a").addEventListener("click", async () => {
    await store.setMeta({lastSentAt: file.exported_at});
  });
}

async function importFromMac(file) {
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (err) {
    flash("Dit bestand kan niet gelezen worden.", "error");
    return render();
  }
  const problem = checkFile(data, FORMAT_MAC);
  if (problem) {
    flash(problem, "error");
    return render();
  }
  const s = await loadAll();
  const {state, counts} = mergeMacFile(s, data);
  await store.write({
    classes: state.classes, students: state.students, periods: state.periods,
    lessons: state.lessons, attendance: state.attendance, alerts: state.alerts,
    meta: [
      {key: "templates", value: state.templates},
      {key: "subjects", value: state.subjects},
      {key: "lessonNames", value: state.lessonNames},
      {key: "lastImportAt", value: nowIso()},
      {key: "macExportedAt", value: data.exported_at || null},
    ],
  }, ["classes", "students", "periods", "lessons", "attendance", "alerts"]);
  const n = (v, one, many) => `${v} ${v === 1 ? one : many}`;
  flash(`Geïmporteerd: ${n(counts.classes, "klas", "klassen")}, ${n(counts.students, "student", "studenten")}, ` +
    `${n(counts.lessons, "les", "lessen")} (${counts.newLessons} nieuw, ${counts.changedLessons} gewijzigd).`);
  render();
}

// ---------- storage, routing, updates ----------

async function showStorageNote() {
  const el = document.getElementById("storage-note");
  if (!el) return;
  const persisted = await store.persist().catch(() => null);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  el.textContent = persisted
    ? "De gegevens staan alleen op deze iPhone en blijven bewaard."
    : standalone
      ? "De gegevens staan alleen op deze iPhone. Stuur ze regelmatig naar de Mac als back-up."
      : "Zet deze app op je beginscherm (Deel → Zet op beginscherm), anders kan iOS de gegevens wissen.";
}

function render() {
  const hash = location.hash || "#/";
  const [path, query] = hash.slice(1).split("?");
  const klas = path.match(/^\/klas\/(\d+)$/);
  window.scrollTo(0, 0);
  if (klas) return classView(Number(klas[1]));
  if (path === "/les") return lessonView(new URLSearchParams(query || ""));
  return homeView();
}

let lastHash = location.hash;
window.addEventListener("hashchange", () => {
  if (dirty && !confirm("Je wijzigingen zijn niet opgeslagen. Toch weggaan?")) {
    history.replaceState(null, "", lastHash || "#/");
    return;
  }
  dirty = false;
  lastHash = location.hash;
  render();
});

async function start() {
  if (!(await store.getMeta("deviceId"))) {
    const id = crypto.randomUUID ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    await store.setMeta({deviceId: id});
  }
  render();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").then((reg) => {
    const offer = (worker) => {
      const bar = document.getElementById("update");
      bar.hidden = false;
      bar.querySelector("button").onclick = () => worker.postMessage("skipWaiting");
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const worker = reg.installing;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) offer(worker);
      });
    });
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading || dirty) return;
    reloading = true;
    location.reload();
  });
}

start();

