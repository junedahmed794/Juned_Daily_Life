'use strict';

/* =========================================================
   Juned Daily — tasks, habits, money and journal in one app.
   All data is stored on this device (localStorage).
   ========================================================= */

const KEY = 'daily-life-v1';

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); };
const today = () => dateKey();
const sum = list => list.reduce((s, e) => s + e.amount, 0);

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MOODS = ['😞', '😕', '😐', '🙂', '😄'];
const CATS = {
  out: ['Food', 'Groceries', 'Transport', 'Bills', 'Shopping', 'Health', 'Fun', 'Other'],
  in: ['Salary', 'Side income', 'Gift', 'Other'],
};
const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'PKR', 'BDT', 'AED', 'SAR', 'CAD', 'AUD', 'JPY', 'NGN'];
const TABS = { today: 'Today', tasks: 'Tasks', habits: 'Habits', money: 'Expense', office: 'Office', shop: 'Shop', journal: 'Journal', insights: 'Insights', review: 'Weekly review' };

function fmtDate(k) {
  const t = today();
  if (k === t) return 'Today';
  if (k === addDays(t, 1)) return 'Tomorrow';
  if (k === addDays(t, -1)) return 'Yesterday';
  return parseKey(k).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
const fmtLong = k => parseKey(k).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

function money(n) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: state.settings.currency }).format(n);
  } catch { return n.toFixed(2); }
}

function guessCurrency() {
  const region = (navigator.language || '').split('-')[1] || '';
  const map = { IN: 'INR', GB: 'GBP', PK: 'PKR', BD: 'BDT', AE: 'AED', SA: 'SAR', CA: 'CAD', AU: 'AUD', JP: 'JPY', NG: 'NGN',
    DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR' };
  return map[region.toUpperCase()] || 'USD';
}

// ---------- state ----------
const defaults = () => ({
  tasks: [], habits: [], expenses: [], journal: {}, budgets: {}, bills: [],
  office: { shifts: [], daysOff: [], tasks: [], meetings: [] },
  settings: {
    currency: guessCurrency(), workHours: 8, name: '', hiddenTabs: ['journal'], trackIncome: false,
    privacy: { lock: false, blur: false, autoLock: 'tab', pinHash: '', pinSalt: '', pinLen: 0, credId: '' },
    nudges: { morning: { on: true, time: '08:00' }, habits: { on: true, time: '19:00' }, evening: { on: true, time: '21:00' } },
  },
});

// Fill in anything missing from older saves or backups
const hydrate = data => ({
  ...defaults(), ...data,
  settings: {
    ...defaults().settings, ...(data.settings || {}),
    nudges: { ...defaults().settings.nudges, ...((data.settings || {}).nudges || {}) },
    privacy: { ...defaults().settings.privacy, ...((data.settings || {}).privacy || {}) },
  },
  office: { ...defaults().office, ...(data.office || {}) },
});

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      return hydrate(JSON.parse(raw));
    }
  } catch { /* fall through to defaults */ }
  return defaults();
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch { toast('Could not save — browser storage is unavailable'); }
  scheduleSync();
}

let state = load();
const ui = { tab: 'today', month: today().slice(0, 7), jdate: today(), day: today(), office: 'hours' };
try { const t = localStorage.getItem(KEY + ':tab'); if (TABS[t]) ui.tab = t; } catch { /* ignore */ }
{
  const linked = new URLSearchParams(location.search).get('tab');
  if (TABS[linked]) { ui.tab = linked; history.replaceState(null, '', location.pathname); }
}
let justToggled = null;   // gives the tick that was just tapped a little "pop"

// First name from Settings, for a personal touch ("Good evening, Sam")
const firstName = () => String(state.settings.name || '').trim().split(/\s+/)[0];
const withName = (text, sep = ', ') => (firstName() ? `${text}${sep}${firstName()}` : text);

// When a reminder has a date but no time: 9:00 AM, or the next hour if 9:00 has passed today
function defaultReminder(date) {
  const k = today(), h = new Date().getHours();
  if (date && date > k) return { date, time: '09:00' };
  if (h < 9) return { date: date || k, time: '09:00' };
  if (h < 22) return { date: date || k, time: `${pad(h + 1)}:00` };
  return { date: addDays(k, 1), time: '09:00' };
}

// ---------- tasks ----------
const REPEATS = { none: 'One-time', daily: 'Every day', weekdays: 'Weekdays (Mon–Fri)', weekly: 'Every week', monthly: 'Every month' };
const isRepeat = t => t.repeat in REPEATS && t.repeat !== 'none';

function dueOn(t, k) {
  const d = parseKey(k), dow = d.getDay();
  switch (t.repeat) {
    case 'daily': return true;
    case 'weekdays': return dow >= 1 && dow <= 5;
    case 'weekly': return dow === t.weekday;
    case 'monthly': return d.getDate() === Math.min(t.monthDay, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());
    default: return false;
  }
}

const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
function repeatLabel(t) {
  switch (t.repeat) {
    case 'daily': return '↻ Every day';
    case 'weekdays': return '↻ Weekdays';
    case 'weekly': return `↻ Every ${WEEKDAYS[t.weekday]}`;
    case 'monthly': return `↻ Monthly on the ${ordinal(t.monthDay)}`;
    default: return '';
  }
}
const fmtHM = hm => fmtTime(atTime(today(), hm));
const timeOptions = () => Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`)
  .map(hm => `<option value="${hm}">${fmtHM(hm)}</option>`).join('');

const isDone = (t, k = today()) => isRepeat(t) ? !!(t.doneDates && t.doneDates[k]) : !!t.done;

function todaysTasks() {
  const k = today();
  return state.tasks.filter(t => isRepeat(t)
    ? dueOn(t, k)
    : (!t.done && (!t.due || t.due <= k)) || (t.done && t.doneAt === k));
}

const sortTasks = list => [...list].sort((a, b) =>
  isDone(a) - isDone(b) || (a.due || '9999').localeCompare(b.due || '9999')
  || (a.time || '99:99').localeCompare(b.time || '99:99') || a.created - b.created);

function toggleTask(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  const k = today();
  if (isRepeat(t)) {
    t.doneDates = t.doneDates || {};
    if (t.doneDates[k]) delete t.doneDates[k]; else t.doneDates[k] = true;
  } else {
    t.done = !t.done;
    t.doneAt = t.done ? k : null;
  }
  save();
}

function taskRow(t, { check = true } = {}) {
  const k = today();
  const done = check && isDone(t, k);
  let meta = '';
  if (isRepeat(t)) meta = repeatLabel(t);
  else if (t.done && t.doneAt) meta = `Done ${fmtDate(t.doneAt).toLowerCase()}`;
  else if (t.due) meta = t.due < k ? `<span class="overdue">Overdue · ${fmtDate(t.due)}</span>` : fmtDate(t.due);
  if (t.time) meta += `${meta ? ' · ' : ''}🕘 ${fmtHM(t.time)}`;
  const bell = t.time && !(t.repeat === 'none' && t.done)
    ? `<button class="act bell ${t.remind ? 'on' : ''}" data-action="toggle-remind" data-id="${t.id}"
        aria-label="${t.remind ? 'Turn off reminder' : 'Turn on reminder'}" aria-pressed="${!!t.remind}">${t.remind ? ICONS.bell : ICONS.bellOff}</button>` : '';
  return `<li class="row ${done ? 'done' : ''}">
    <button class="check ${done ? 'on' : ''} ${check ? '' : 'ghost'}" data-action="toggle-task" data-id="${t.id}"
      aria-label="${done ? 'Mark not done' : 'Mark done'}: ${esc(t.title)}" ${check ? '' : 'tabindex="-1"'}></button>
    <div class="grow tap" data-action="edit-task" data-id="${t.id}"><div class="row-title">${esc(t.title)}</div>${meta ? `<div class="meta">${meta}</div>` : ''}</div>
    <div class="acts">${bell}<button class="act edit" data-action="edit-task" data-id="${t.id}" aria-label="Edit task">${ICONS.pencil}</button>
    <button class="act del" data-action="del-task" data-id="${t.id}" aria-label="Delete task">${ICONS.trash}</button></div>
  </li>`;
}

function openTaskEdit(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  // for repeating tasks the date sets which weekday / day of the month
  let date = t.due || '';
  if (!date && t.repeat === 'weekly') date = addDays(today(), (t.weekday - parseKey(today()).getDay() + 7) % 7);
  if (!date && t.repeat === 'monthly') { const d = parseKey(today()); date = dateKey(new Date(d.getFullYear(), d.getMonth() + (d.getDate() > t.monthDay ? 1 : 0), t.monthDay)); }
  const dlg = $('#sheet');
  dlg.classList.remove('full');
  dlg.innerHTML = `<form class="sheet" data-task-edit="${id}">
    <h2>✏️ Edit task</h2>
    <label class="lbl">Task<input name="title" value="${esc(t.title)}" maxlength="120" required></label>
    <div class="two">
      <label class="lbl">Date<input type="date" name="due" value="${date}"></label>
      <label class="lbl">Repeat<select name="repeat">${Object.entries(REPEATS).map(([v, l]) => `<option value="${v}" ${v === (t.repeat || 'none') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <label class="lbl">Time<select name="time"><option value="">🕘 No time</option>${timeOptions().replace(`value="${t.time}"`, `value="${t.time}" selected`)}</select></label>
    <label class="toggle" style="margin-top:12px"><input type="checkbox" name="remind" ${t.remind ? 'checked data-user-set="1"' : ''}><span>🔔 Remind me</span></label>
    <div class="btns spread" style="margin-top:18px">
      <button type="button" class="btn danger" data-action="del-task" data-id="${id}">Delete</button>
      <span class="btns"><button type="button" class="btn" data-action="close-sheet">Cancel</button><button class="btn primary">Save</button></span>
    </div>
  </form>`;
  if (!dlg.open) dlg.showModal();
}

const taskSection = (title, list, emptyMsg, opts) => `
  <h2 class="sec">${title}</h2>
  <div class="card"><ul class="list">
    ${list.length ? list.map(t => taskRow(t, opts)).join('') : `<li class="empty">${emptyMsg}</li>`}
  </ul></div>`;

// ---------- habits ----------
function streak(h) {
  let k = today();
  if (!h.log[k]) k = addDays(k, -1);
  let n = 0;
  while (h.log[k]) { n++; k = addDays(k, -1); }
  return n;
}

function last30(h) {
  let n = 0, k = today();
  for (let i = 0; i < 30; i++) { if (h.log[k]) n++; k = addDays(k, -1); }
  return n;
}

function habitCard(h) {
  const k = today();
  const days = Array.from({ length: 7 }, (_, i) => addDays(k, i - 6));
  const s = streak(h);
  return `<div class="card">
    <div class="habit-head">
      <span class="emoji">${esc(h.emoji || '✅')}</span>
      <div class="grow">
        <div class="row-title"><strong>${esc(h.name)}</strong></div>
        <div class="meta">${s ? `🔥 ${s}-day streak` : 'No streak yet'} · ${last30(h)}/30 days</div>
      </div>
      <button class="check big ${h.log[k] ? 'on' : ''}" data-action="toggle-habit" data-id="${h.id}" data-day="${k}"
        aria-label="Mark ${esc(h.name)} done today"></button>
    </div>
    <div class="week">
      ${days.map(d => `<button class="day ${h.log[d] ? 'on' : ''} ${d === k ? 'today' : ''}" data-action="toggle-habit"
        data-id="${h.id}" data-day="${d}" aria-label="${fmtLong(d)}">
        ${WEEKDAYS[parseKey(d).getDay()].slice(0, 1)}<small>${parseKey(d).getDate()}</small></button>`).join('')}
    </div>
    <button class="link danger" data-action="del-habit" data-id="${h.id}">Delete habit</button>
  </div>`;
}

// ---------- money ----------
const catOptions = (type, selected) =>
  CATS[type].map(c => `<option ${c === selected ? 'selected' : ''}>${c}</option>`).join('');

function parseAmount(v) {
  const n = parseFloat(String(v).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

// ---------- office ----------
const PRIORITY = { high: { label: 'High', rank: 0 }, med: { label: 'Medium', rank: 1 }, low: { label: 'Low', rank: 2 } };
const LEAVE = ['Annual leave', 'Sick', 'Public holiday', 'Day off'];
const fmtTime = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function fmtDur(min) {
  min = Math.max(0, Math.round(min));
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}h ${pad(m)}m` : `${m}m`;
}
const shiftMin = sh => Math.max(0, ((sh.end || Date.now()) - sh.start) / 6e4 - (sh.breakMin || 0));
const workMin = k => state.office.shifts.filter(sh => sh.date === k).reduce((t, sh) => t + shiftMin(sh), 0);
const openShift = () => state.office.shifts.find(sh => !sh.end);
const dayOff = k => state.office.daysOff.find(d => d.date === k);
const targetMin = () => (Number(state.settings.workHours) || 8) * 60;
const atTime = (k, hm) => { const [h, m] = hm.split(':').map(Number); const d = parseKey(k); d.setHours(h, m, 0, 0); return d.getTime(); };

function officeWeek(ws) {
  const we = addDays(ws, 6);
  const inWeek = k => !!k && k >= ws && k <= we;
  const perDay = Array.from({ length: 7 }, (_, i) => addDays(ws, i)).map(d => ({ date: d, min: workMin(d), off: dayOff(d) }));
  return {
    perDay,
    total: perDay.reduce((t, d) => t + d.min, 0),
    overtime: perDay.reduce((t, d) => t + Math.max(0, d.min - targetMin()), 0),
    daysWorked: perDay.filter(d => d.min > 0).length,
    daysOff: perDay.filter(d => d.off).length,
    tasksDone: state.office.tasks.filter(x => x.done && inWeek(x.doneAt)).length,
    meetings: state.office.meetings.filter(m => inWeek(m.date)).length,
  };
}

function officeHours() {
  const k = today(), open = openShift(), w = officeWeek(weekStart(k)), todayMin = workMin(k);
  const recent = [...state.office.shifts].sort((a, b) => b.start - a.start).slice(0, 10);
  const offs = [...state.office.daysOff].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  return `
  <div class="card clock">
    ${open
      ? `<div class="meta">Clocked in at ${fmtTime(open.start)}</div>
         <div class="big">${fmtDur(shiftMin(open))}</div>
         <button class="btn danger-fill block" data-action="clock-out">Clock out</button>`
      : `<div class="meta">${todayMin ? `Worked today: ${fmtDur(todayMin)}` : 'Not clocked in'}</div>
         <button class="btn primary block" data-action="clock-in">Clock in</button>`}
    <p class="meta hint">Taking a break? Clock out, then clock in again when you're back.</p>
  </div>

  <div class="stats">
    <div class="stat"><b>${fmtDur(todayMin)}</b><span>Today</span></div>
    <div class="stat"><b>${fmtDur(w.total)}</b><span>This week</span></div>
    <div class="stat"><b>${fmtDur(w.overtime)}</b><span>Overtime</span></div>
  </div>

  <h2 class="sec">This week</h2>
  <div class="card"><ul class="list">
    ${w.perDay.filter(d => d.date <= k).reverse().map(d => `<li class="row">
      <div class="grow"><div class="row-title">${fmtDate(d.date)}</div>${d.off ? `<div class="meta">🌴 ${esc(d.off.type)}</div>` : ''}</div>
      <span class="amt">${d.min ? fmtDur(d.min) : '—'}</span></li>`).join('')}
  </ul></div>

  <details class="card">
    <summary>➕ Add hours manually</summary>
    <form data-form="shift">
      <div class="two">
        <label class="lbl">Date<input type="date" name="date" value="${k}" required></label>
        <label class="lbl">Break (minutes)<input type="number" name="break" min="0" step="5" inputmode="numeric" placeholder="0"></label>
        <label class="lbl">Start<input type="time" name="start" value="09:00" required></label>
        <label class="lbl">End<input type="time" name="end" value="17:00" required></label>
      </div>
      <button class="btn primary block" style="margin-top:12px">Add hours</button>
    </form>
  </details>

  <details class="card">
    <summary>🌴 Log a day off</summary>
    <form data-form="dayoff">
      <div class="two">
        <label class="lbl">Date<input type="date" name="date" value="${k}" required></label>
        <label class="lbl">Type<select name="type">${LEAVE.map(l => `<option>${l}</option>`).join('')}</select></label>
      </div>
      <button class="btn primary block" style="margin-top:12px">Save day off</button>
    </form>
  </details>

  ${recent.length ? `<h2 class="sec">Recent entries</h2><div class="card"><ul class="list">${recent.map(sh => `<li class="row">
    <div class="grow"><div class="row-title">${fmtDate(sh.date)}</div>
      <div class="meta">${fmtTime(sh.start)} – ${sh.end ? fmtTime(sh.end) : 'now'}${sh.breakMin ? ` · ${sh.breakMin}m break` : ''}</div></div>
    <span class="amt">${fmtDur(shiftMin(sh))}</span>
    <button class="icon-btn" data-action="del-shift" data-id="${sh.id}" aria-label="Delete entry">×</button></li>`).join('')}</ul></div>` : ''}

  ${offs.length ? `<h2 class="sec">Days off</h2><div class="card"><ul class="list">${offs.map(o => `<li class="row">
    <div class="grow"><div class="row-title">${fmtDate(o.date)}</div><div class="meta">🌴 ${esc(o.type)}</div></div>
    <button class="icon-btn" data-action="del-dayoff" data-id="${o.id}" aria-label="Delete day off">×</button></li>`).join('')}</ul></div>` : ''}`;
}

function officeTaskRow(t) {
  const k = today();
  let due = '';
  if (t.done && t.doneAt) due = `Done ${fmtDate(t.doneAt).toLowerCase()}`;
  else if (t.due) due = t.due < k ? `<span class="overdue">Overdue · ${fmtDate(t.due)}</span>` : `Due ${fmtDate(t.due).toLowerCase()}`;
  const p = PRIORITY[t.priority] || PRIORITY.med;
  return `<li class="row ${t.done ? 'done' : ''}">
    <button class="check ${t.done ? 'on' : ''}" data-action="toggle-otask" data-id="${t.id}"
      aria-label="${t.done ? 'Mark not done' : 'Mark done'}: ${esc(t.title)}"></button>
    <div class="grow"><div class="row-title">${esc(t.title)}</div>
      <div class="meta"><span class="pri pri-${t.priority}">${p.label}</span>${due ? ` ${due}` : ''}</div></div>
    <button class="icon-btn" data-action="del-otask" data-id="${t.id}" aria-label="Delete task">×</button>
  </li>`;
}

function officeTasks() {
  const rank = t => (PRIORITY[t.priority] || PRIORITY.med).rank;
  const open = state.office.tasks.filter(t => !t.done)
    .sort((a, b) => rank(a) - rank(b) || (a.due || '9999').localeCompare(b.due || '9999') || a.created - b.created);
  const done = state.office.tasks.filter(t => t.done)
    .sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')).slice(0, 15);
  return `
  <form class="card add" data-form="otask">
    <input name="title" placeholder="Add a work task…" required autocomplete="off" aria-label="New work task">
    <div class="add-row">
      <select name="priority" aria-label="Priority">
        <option value="high">High priority</option><option value="med" selected>Medium</option><option value="low">Low</option>
      </select>
      <input type="date" name="due" aria-label="Deadline (optional)">
      <button class="btn primary">Add</button>
    </div>
  </form>
  <h2 class="sec">To do</h2>
  <div class="card"><ul class="list">${open.length ? open.map(officeTaskRow).join('') : '<li class="empty">No open work tasks 🎉</li>'}</ul></div>
  ${done.length ? `<h2 class="sec">Completed</h2><div class="card"><ul class="list">${done.map(officeTaskRow).join('')}</ul></div>` : ''}`;
}

function officeMeetings() {
  const ms = [...state.office.meetings].sort((a, b) =>
    b.date.localeCompare(a.date) || (b.time || '').localeCompare(a.time || '') || b.created - a.created);
  const pending = ms.flatMap(m => m.actions.filter(a => !a.done).map(a => ({ m, a })));
  const actionRow = (m, a, showMeeting) => `<li class="row ${a.done ? 'done' : ''}">
    <button class="check ${a.done ? 'on' : ''}" data-action="toggle-action" data-id="${m.id}" data-aid="${a.id}"
      aria-label="${a.done ? 'Mark not done' : 'Mark done'}: ${esc(a.text)}"></button>
    <div class="grow"><div class="row-title">${esc(a.text)}</div>${showMeeting ? `<div class="meta">${esc(m.title)} · ${fmtDate(m.date)}</div>` : ''}</div>
  </li>`;
  return `
  <details class="card" ${ms.length ? '' : 'open'}>
    <summary>➕ New meeting</summary>
    <form data-form="meeting">
      <label class="lbl">Title<input name="title" placeholder="e.g. Weekly team sync" required autocomplete="off"></label>
      <div class="two">
        <label class="lbl">Date<input type="date" name="date" value="${today()}" required></label>
        <label class="lbl">Time<input type="time" name="time"></label>
      </div>
      <label class="lbl">Notes<textarea name="notes" rows="4" placeholder="What was discussed? Decisions made?"></textarea></label>
      <label class="lbl">Action items <span class="meta">(one per line)</span><textarea name="actions" rows="3" placeholder="Send the report&#10;Book a follow-up for Friday"></textarea></label>
      <button class="btn primary block" style="margin-top:12px">Save meeting</button>
    </form>
  </details>

  ${pending.length ? `<h2 class="sec">Open action items</h2>
    <div class="card"><ul class="list">${pending.map(({ m, a }) => actionRow(m, a, true)).join('')}</ul></div>` : ''}

  ${ms.length ? `<h2 class="sec">Meetings</h2>${ms.map(m => `<div class="card">
    <div class="row-title"><strong>${esc(m.title)}</strong></div>
    <div class="meta">${fmtDate(m.date)}${m.time ? ` · ${m.time}` : ''}</div>
    ${m.notes ? `<p class="note">${esc(m.notes)}</p>` : ''}
    ${m.actions.length ? `<ul class="list">${m.actions.map(a => actionRow(m, a, false)).join('')}</ul>` : ''}
    <button class="link danger" data-action="del-meeting" data-id="${m.id}">Delete meeting</button>
  </div>`).join('')}` : '<p class="empty" style="text-align:center">No meetings logged yet.</p>'}`;
}

// ---------- weekly report (Excel) ----------
const weekStart = k => addDays(k, -((parseKey(k).getDay() + 6) % 7));   // weeks run Monday–Sunday
const createdKey = x => dateKey(new Date(x.created || 0));
const avg = list => list.length ? list.reduce((s, n) => s + n, 0) / list.length : null;
const excelDate = k => { const [y, m, d] = k.split('-').map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5; };
const fmtRange = (a, b) => `${parseKey(a).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${
  parseKey(b).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;

function weekStats(ws) {
  const t = today(), we = addDays(ws, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i)).filter(d => d <= t);
  const inWeek = d => d >= ws && d <= we;

  let oneOffDone = 0, routineDue = 0, routineDone = 0;
  for (const task of state.tasks) {
    if (isRepeat(task)) {
      for (const d of days) {
        if (d < createdKey(task) || !dueOn(task, d)) continue;
        routineDue++;
        if (task.doneDates && task.doneDates[d]) routineDone++;
      }
    } else if (task.done && task.doneAt && inWeek(task.doneAt)) oneOffDone++;
  }

  const habits = state.habits.map(h => {
    const possible = days.filter(d => d >= createdKey(h) || h.log[d]);
    const done = possible.filter(d => h.log[d]).length;
    return { label: `${h.emoji || ''} ${h.name}`.trim(), done, possible: possible.length, streak: streak(h) };
  });
  const hPossible = habits.reduce((s, h) => s + h.possible, 0);
  const hDone = habits.reduce((s, h) => s + h.done, 0);

  const money = state.expenses.filter(e => inWeek(e.date));
  const outs = money.filter(e => e.type === 'out');
  const spent = sum(outs), income = sum(money.filter(e => e.type === 'in'));
  const byCat = {};
  outs.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  const entries = days.map(d => state.journal[d]).filter(Boolean);
  const nums = f => entries.map(e => e[f]).filter(n => typeof n === 'number');

  const daily = days.map(d => ({
    date: d,
    tasks: state.tasks.filter(x => isRepeat(x) ? x.doneDates && x.doneDates[d] : x.done && x.doneAt === d).length,
    habits: state.habits.filter(h => h.log[d]).length,
    habitTotal: state.habits.filter(h => d >= createdKey(h) || h.log[d]).length,
    spent: sum(outs.filter(e => e.date === d)),
    work: workMin(d),
    mood: state.journal[d]?.mood,
    sleep: state.journal[d]?.sleep,
  }));

  return {
    ws, we, days, daily, habits, cats, spent, income, net: income - spent,
    tasksDone: oneOffDone + routineDone, routineDue, routineDone,
    routinePct: routineDue ? routineDone / routineDue : null,
    habitPct: hPossible ? hDone / hPossible : null,
    journalDays: entries.length,
    avgMood: avg(nums('mood')), avgSleep: avg(nums('sleep')), avgEnergy: avg(nums('energy')),
    office: officeWeek(ws),
  };
}

function firstDataDay() {
  const keys = [
    ...state.tasks.map(createdKey), ...state.habits.map(createdKey),
    ...state.habits.flatMap(h => Object.keys(h.log)),
    ...state.expenses.map(e => e.date), ...Object.keys(state.journal),
    ...state.office.shifts.map(sh => sh.date), ...state.office.daysOff.map(d => d.date),
    ...state.office.tasks.map(createdKey), ...state.office.meetings.map(m => m.date),
  ].filter(Boolean).sort();
  return keys[0] || today();
}

function moneyFormat() {
  let symbol = state.settings.currency, decimals = 2;
  try {
    const f = new Intl.NumberFormat('en', { style: 'currency', currency: state.settings.currency });
    symbol = f.formatToParts(0).find(p => p.type === 'currency').value;
    decimals = f.resolvedOptions().minimumFractionDigits;
  } catch { /* keep defaults */ }
  const num = decimals ? `#,##0.${'0'.repeat(decimals)}` : '#,##0';
  const sym = `"${symbol.replace(/"/g, '')}"`;
  return `${sym}${num};-${sym}${num}`;
}

function buildWeeklyReport(ws) {
  const S = STYLE;
  const s = weekStats(ws);
  const H = v => ({ v, s: S.header });
  const M = v => ({ v, s: S.money });
  const P = v => v === null ? '—' : { v, s: S.pct };
  const D1 = v => v === null ? '—' : { v, s: S.dec1 };

  const rows = [
    [{ v: 'Juned Daily — Weekly Summary', s: S.title }],
    [{ v: fmtRange(s.ws, s.we), s: S.bold }],
    [{ v: `Generated ${new Date().toLocaleString()}`, s: S.muted }],
    [],
    [H('Overview'), H('')],
    ['Tasks completed', s.tasksDone],
    ['Routines done', s.routineDue ? `${s.routineDone} of ${s.routineDue}` : '—'],
    ['Habit completion', P(s.habitPct)],
    ['Total spent', M(s.spent)],
    ...(state.settings.trackIncome ? [['Total income', M(s.income)], ['Net', { v: s.net, s: S.moneyBold }]] : []),
    ['Top spending category', s.cats.length ? s.cats[0][0] : '—'],
    ['Journal days', `${s.journalDays} of ${s.days.length}`],
    ['Average mood (1–5)', D1(s.avgMood)],
    ['Average sleep (hours)', D1(s.avgSleep)],
    ['Average energy (1–5)', D1(s.avgEnergy)],
    [],
    [H('Office'), H('')],
    ['Hours worked', D1(s.office.total / 60)],
    ['Overtime (hours)', D1(s.office.overtime / 60)],
    ['Days worked', s.office.daysWorked],
    ['Days off', s.office.daysOff],
    ['Work tasks completed', s.office.tasksDone],
    ['Meetings', s.office.meetings],
    [],
  ];
  if (s.habits.length) {
    rows.push([H('Habit'), H('Days done'), H('Out of'), H('Completion'), H('Current streak')]);
    s.habits.forEach(h => rows.push([h.label, h.done, h.possible, P(h.possible ? h.done / h.possible : null), h.streak]));
    rows.push([]);
  }
  if (s.cats.length) {
    rows.push([H('Spending category'), H('Amount'), H('Share')]);
    s.cats.forEach(([c, v]) => rows.push([c, M(v), P(s.spent ? v / s.spent : null)]));
    rows.push([]);
  }
  rows.push([H('Day'), H('Tasks done'), H('Habits done'), H('Spent'), H('Mood'), H('Sleep (h)'), H('Work (h)')]);
  s.daily.forEach(d => rows.push([
    parseKey(d.date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
    d.tasks, d.habitTotal ? `${d.habits} of ${d.habitTotal}` : '—', M(d.spent),
    d.mood ? `${d.mood} ${MOODS[d.mood - 1]}` : '—', typeof d.sleep === 'number' ? d.sleep : '—',
    d.work ? D1(d.work / 60) : '—',
  ]));

  // Weekly Tracker: one row per week, from the first week with data up to this one
  const inc = state.settings.trackIncome;
  const tracker = [[H('Week starting'), H('Week ending'), H('Tasks done'), H('Routines'), H('Habits'),
    H('Spent'), ...(inc ? [H('Income'), H('Net')] : []), H('Journal days'), H('Avg mood'), H('Avg sleep'),
    H('Work hours'), H('Overtime'), H('Work tasks'), H('Meetings')]];
  const lastWeek = weekStart(today());
  for (let w = weekStart(firstDataDay()); w <= lastWeek; w = addDays(w, 7)) {
    const x = weekStats(w);
    tracker.push([
      { v: excelDate(x.ws), s: S.date }, { v: excelDate(x.we), s: S.date },
      x.tasksDone, P(x.routinePct), P(x.habitPct),
      M(x.spent), ...(inc ? [M(x.income), M(x.net)] : []), x.journalDays, D1(x.avgMood), D1(x.avgSleep),
      D1(x.office.total / 60), D1(x.office.overtime / 60), x.office.tasksDone, x.office.meetings,
    ]);
  }

  return makeXlsx([
    { name: 'This Week', rows, widths: [26, 14, 12, 12, 15, 11, 10] },
    { name: 'Weekly Tracker', rows: tracker, widths: [15, 15, 11, 11, 10, 12, ...(inc ? [12, 12] : []), 13, 10, 10, 11, 10, 11, 10], freeze: 1 },
  ], { moneyFormat: moneyFormat() });
}

// The week whose report is waiting: this week on Sundays, or last week early in the week if it was missed.
function pendingReportWeek() {
  const k = today(), ws = weekStart(k), dow = (parseKey(k).getDay() + 6) % 7;
  const last = state.settings.lastReport || '';
  if (dow === 6 && last < ws) return ws;
  const prev = addDays(ws, -7);
  if (dow <= 2 && last < prev && firstDataDay() <= addDays(prev, 6)) return prev;
  return null;
}

async function exportReport(ws) {
  let blob;
  try { blob = buildWeeklyReport(ws); }
  catch { toast('Could not create the report'); return; }
  const ok = await shareOrDownload(blob, `juned-daily-week-${ws}.xlsx`);
  if (!ok) return;
  if ((state.settings.lastReport || '') < ws) { state.settings.lastReport = ws; save(); }
  render();
}

// iPhone: opens the share sheet (Save to Files, Mail…). Elsewhere: downloads the file.
async function shareOrDownload(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}

// ---------- views ----------
const views = {};

views.today = () => {
  const k = today();
  const tasks = sortTasks(todaysTasks());
  const doneN = tasks.filter(t => isDone(t)).length;
  const habitsDone = state.habits.filter(h => h.log[k]).length;
  const out = state.expenses.filter(e => e.type === 'out');
  const spentToday = sum(out.filter(e => e.date === k));
  const spentMonth = sum(out.filter(e => e.date.startsWith(k.slice(0, 7))));
  const j = state.journal[k] || {};
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return `
  <p class="greet">${esc(withName(greeting))} · ${fmtLong(k)}</p>
  ${(() => {
    const ws = pendingReportWeek();
    return ws ? `<section class="card report">
      <h2>📅 Your week in review is ready</h2>
      <p class="meta">${fmtRange(ws, addDays(ws, 6))} · highlights, comparisons and what’s coming up</p>
      <div class="btns"><button class="btn primary" data-action="open-review" data-week="${ws}">See your week</button>
      <button class="btn" data-action="report" data-week="${ws}">📊 Excel</button>
      <button class="btn" data-action="report-skip" data-week="${ws}">Not now</button></div>
    </section>` : '';
  })()}

  ${(() => {
    const p = dayProgress(), next = nextUp();
    return `<section class="card hero">
      <div class="hero-ring">${ringSvg(p.pct)}<div class="ring-label"><b>${Math.round(p.pct * 100)}%</b><span>done</span></div></div>
      <div class="grow">
        <div class="hero-msg">${dayMessage(p)}</div>
        <div class="meta">✅ ${p.tDone}/${p.tasks} tasks · 🔁 ${p.hDone}/${p.habits} habits</div>
        <div class="meta">💸 ${Privacy.pm(spentToday)} spent today${Privacy.masked() ? ' <button class="link eye" data-action="reveal" aria-label="Show amounts">👁</button>' : ''}</div>
        ${next ? `<div class="meta next-up">⏰ Next: <b>${esc(next.title)}</b> at ${fmtHM(next.time)}</div>` : ''}
        <button class="link" data-action="go" data-tab="insights">📊 Insights →</button>
      </div>
    </section>`;
  })()}

  <section class="card">
    <div class="card-head"><h2>Tasks</h2><button class="link" data-action="go" data-tab="tasks">All tasks →</button></div>
    ${PUSH_SERVER && tabShown('shop') && Shop.choresForMe() ? `<button class="link chores-link" data-action="open-chores">🏠 ${Shop.choresForMe()} chore${Shop.choresForMe() === 1 ? '' : 's'} for you →</button>` : ''}
    <ul class="list">${tasks.length ? tasks.map(t => taskRow(t)).join('') : '<li class="empty">No tasks for today.</li>'}</ul>
    <form class="quick" data-form="task">
      <input name="title" placeholder="Quick add a task…" required autocomplete="off" aria-label="New task">
      <button class="btn primary">Add</button>
    </form>
  </section>

  <section class="card">
    <div class="card-head"><h2>Habits</h2><button class="link" data-action="go" data-tab="habits">Manage →</button></div>
    ${state.habits.length
      ? `<div class="chips">${state.habits.map(h => `<button class="chip ${h.log[k] ? 'on' : ''}" data-action="toggle-habit"
          data-id="${h.id}" data-day="${k}">${esc(h.emoji || '✅')} ${esc(h.name)}</button>`).join('')}</div>`
      : '<p class="empty">No habits yet — add one in Habits.</p>'}
  </section>

  <section class="card">
    <div class="card-head"><h2>How are you feeling?</h2>${tabShown('journal') ? `<button class="link" data-action="open-journal" data-day="${k}">Journal →</button>` : ''}</div>
    <div class="moods">${MOODS.map((m, i) => `<button class="mood ${j.mood === i + 1 ? 'on' : ''}" data-action="mood"
      data-day="${k}" data-v="${i + 1}" aria-label="Mood ${i + 1} of 5">${m}</button>`).join('')}</div>
  </section>

  <section class="card">
    <div class="card-head"><h2>Expenses</h2><button class="link" data-action="go" data-tab="money">Details →</button></div>
    <div class="meta">This month: <strong>${Privacy.pm(spentMonth)}</strong> spent</div>
    ${state.bills.filter(b => b.next <= addDays(k, 3)).sort((a, b) => a.next.localeCompare(b.next)).map(b =>
      `<div class="meta bill-soon">🧾 <b>${esc(b.name)}</b> — ${dueLabel(b.next)}</div>`).join('')}
    <form class="quick" data-form="expense">
      <input type="hidden" name="type" value="out">
      <input name="amount" inputmode="decimal" placeholder="Amount" required aria-label="Amount" style="flex:1">
      <select name="category" aria-label="Category" style="flex:1">${catOptions('out')}</select>
      <button class="btn primary">Log</button>
    </form>
  </section>`;
};

views.tasks = () => {
  const k = today();
  const now = sortTasks(todaysTasks());
  const upcoming = state.tasks.filter(t => !isRepeat(t) && !t.done && t.due && t.due > k)
    .sort((a, b) => a.due.localeCompare(b.due));
  const routines = state.tasks.filter(t => isRepeat(t) && !dueOn(t, k));
  const done = state.tasks.filter(t => !isRepeat(t) && t.done && t.doneAt !== k)
    .sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')).slice(0, 15);

  return `
  <form class="card add" data-form="task">
    <input name="title" placeholder="What do you need to do?" required autocomplete="off" aria-label="New task">
    <div class="add-row">
      <input type="date" name="due" aria-label="Date (optional)">
      <select name="repeat" aria-label="Repeat">
        ${Object.entries(REPEATS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
      </select>
    </div>
    <div class="add-row">
      <select name="time" aria-label="Time (optional)"><option value="">🕘 No time</option>${timeOptions()}</select>
      <label class="toggle"><input type="checkbox" name="remind"><span>🔔 Remind me</span></label>
    </div>
    <button class="btn primary block" style="margin-top:8px">Add task</button>
    ${!state.settings.notify ? '<p class="meta hint">To get 🔔 reminders, turn on notifications in ☰ Menu → Notifications.</p>' : ''}
  </form>
  ${taskSection('Today', now, 'Nothing due today. Enjoy! 🎉')}
  ${upcoming.length ? taskSection('Upcoming', upcoming) : ''}
  ${routines.length ? taskSection('Other routines', routines, '', { check: false }) : ''}
  ${done.length ? taskSection('Completed', done) : ''}`;
};

views.habits = () => `
  <form class="card add" data-form="habit">
    <div class="add-row" style="margin:0">
      <input name="emoji" class="emoji-in" maxlength="4" placeholder="💧" aria-label="Emoji">
      <input name="name" class="grow" placeholder="New habit, e.g. Drink 8 glasses of water" required autocomplete="off" aria-label="Habit name">
      <button class="btn primary">Add</button>
    </div>
  </form>
  ${state.habits.length
    ? state.habits.map(habitCard).join('')
    : '<p class="empty" style="text-align:center">Add habits you want to build — reading, exercise, prayer, water, sleep on time…</p>'}`;

views.money = () => {
  if (Privacy.locked()) return Privacy.lockScreen();
  const m = ui.month;
  const [y, mo] = m.split('-').map(Number);
  const label = new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const withIncome = state.settings.trackIncome;
  const items = state.expenses.filter(e => e.date.startsWith(m) && (withIncome || e.type === 'out'))
    .sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
  const outItems = items.filter(e => e.type === 'out');
  // expense-only view: daily average and biggest category instead of income/net
  const daysIn = m === today().slice(0, 7) ? parseKey(today()).getDate() : new Date(y, mo, 0).getDate();
  const spent = sum(outItems);
  const income = sum(items.filter(e => e.type === 'in'));
  const net = income - spent;

  const byCat = {};
  outItems.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const max = cats.length ? cats[0][1] : 1;

  const groups = {};
  items.forEach(e => { (groups[e.date] = groups[e.date] || []).push(e); });

  return `
  <form class="card add" data-form="expense">
    ${withIncome ? `<div class="seg" role="radiogroup" aria-label="Type">
      <label><input type="radio" name="type" value="out" checked> Expense</label>
      <label><input type="radio" name="type" value="in"> Income</label>
    </div>` : '<input type="hidden" name="type" value="out">'}
    <div class="add-row" ${withIncome ? '' : 'style="margin-top:0"'}>
      <input name="amount" inputmode="decimal" placeholder="Amount spent" required aria-label="Amount">
      <select name="category" aria-label="Category">${catOptions('out')}</select>
    </div>
    <div class="add-row">
      <input name="note" placeholder="Note (optional)" autocomplete="off" aria-label="Note">
      <input type="date" name="date" value="${today()}" aria-label="Date" style="max-width:160px">
    </div>
    <button class="btn primary block" style="margin-top:8px">Add</button>
  </form>

  <div class="card">
    <div class="month-nav">
      <button data-action="month" data-delta="-1" aria-label="Previous month">‹</button>
      <strong>${label}</strong>
      <button data-action="month" data-delta="1" aria-label="Next month" ${m >= today().slice(0, 7) ? 'disabled' : ''}>›</button>
    </div>
    <div class="totals">${withIncome ? `
      <div><b>${money(spent)}</b><span>Spent</span></div>
      <div><b>${money(income)}</b><span>Income</span></div>
      <div><b class="${net >= 0 ? 'pos' : 'neg'}">${money(net)}</b><span>Net</span></div>` : `
      <div><b>${money(spent)}</b><span>Spent</span></div>
      <div><b>${money(daysIn ? spent / daysIn : 0)}</b><span>Per day</span></div>
      <div><b>${cats.length ? esc(cats[0][0]) : '—'}</b><span>Top category</span></div>`}
    </div>
    ${cats.length ? `<div class="bars">${cats.map(([c, v]) => `
      <div class="bar-row"><span>${esc(c)}</span><div class="bar"><i style="width:${(v / max * 100).toFixed(1)}%"></i></div>
      <span class="amt">${money(v)}</span></div>`).join('')}</div>` : ''}
  </div>

  ${budgetsCard(m)}
  ${billsCard()}

  ${items.length ? `<div class="card">${Object.entries(groups).map(([d, list]) => `
    <div class="day-label">${fmtDate(d)}</div>
    <ul class="list">${list.map(e => `
      <li class="row">
        <div class="grow"><div class="row-title">${esc(e.category)}</div>${e.note ? `<div class="meta">${esc(e.note)}</div>` : ''}</div>
        <span class="amt ${e.type === 'in' ? 'pos' : ''}">${e.type === 'in' ? '+' : '−'}${money(e.amount)}</span>
        <button class="icon-btn" data-action="del-expense" data-id="${e.id}" aria-label="Delete entry">×</button>
      </li>`).join('')}</ul>`).join('')}</div>`
    : '<p class="empty" style="text-align:center">Nothing logged this month yet.</p>'}`;
};

views.journal = () => {
  const k = ui.jdate;
  const j = state.journal[k] || {};
  const recent = Object.keys(state.journal).sort().reverse().slice(0, 20);

  return `
  <div class="card">
    <div class="date-nav">
      <button data-action="jday" data-delta="-1" aria-label="Previous day">‹</button>
      <strong>${fmtDate(k) === 'Today' ? 'Today' : fmtLong(k)}</strong>
      <button data-action="jday" data-delta="1" aria-label="Next day" ${k >= today() ? 'disabled' : ''}>›</button>
    </div>
    <span class="lbl" style="margin-top:0">Mood</span>
    <div class="moods">${MOODS.map((m, i) => `<button class="mood ${j.mood === i + 1 ? 'on' : ''}" data-action="mood"
      data-day="${k}" data-v="${i + 1}" aria-label="Mood ${i + 1} of 5">${m}</button>`).join('')}</div>
    <div class="two">
      <label class="lbl">Sleep (hours)
        <input type="number" inputmode="decimal" step="0.5" min="0" max="24" data-j="sleep" value="${j.sleep ?? ''}" placeholder="7.5">
      </label>
      <label class="lbl">Energy
        <select data-j="energy">
          <option value="">—</option>
          ${['Very low', 'Low', 'Okay', 'Good', 'Great'].map((l, i) =>
            `<option value="${i + 1}" ${j.energy === i + 1 ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </label>
    </div>
    <label class="lbl">Notes
      <textarea data-j="text" rows="7" placeholder="How was your day? What happened? What are you grateful for?">${esc(j.text || '')}</textarea>
    </label>
    <div class="meta saved" id="saved"></div>
  </div>

  ${recent.length ? `<h2 class="sec">Recent entries</h2><div class="card">${recent.map(d => {
    const e = state.journal[d];
    return `<button class="entry" data-action="open-journal" data-day="${d}">
      <span class="e-mood">${e.mood ? MOODS[e.mood - 1] : '📝'}</span>
      <span class="grow"><strong>${fmtDate(d)}</strong>
        <span class="meta">${[e.sleep ? `😴 ${e.sleep}h` : '', e.energy ? `⚡ ${e.energy}/5` : ''].filter(Boolean).join(' · ')}</span>
        ${e.text ? `<span class="snippet">${esc(e.text)}</span>` : ''}</span>
    </button>`;
  }).join('')}</div>` : ''}`;
};

views.office = () => {
  const subs = { hours: '⏱ Hours', tasks: '✅ Tasks', meetings: '🗓 Meetings' };
  const body = { hours: officeHours, tasks: officeTasks, meetings: officeMeetings }[ui.office]();
  return `<div class="subtabs" role="tablist">${Object.entries(subs).map(([key, label]) =>
    `<button role="tab" class="${ui.office === key ? 'on' : ''}" aria-selected="${ui.office === key}"
      data-action="office-view" data-view="${key}">${label}</button>`).join('')}</div>${body}`;
};

// ---------- shared shopping list ----------
function startShop() {
  if (!PUSH_SERVER) return;
  if (!state.settings.shopCode || !state.settings.deviceId) {
    state.settings.shopCode = state.settings.shopCode || Shop.newCode();
    state.settings.deviceId = state.settings.deviceId || uid();
    save();
  }
  Shop.init({
    code: state.settings.shopCode, name: state.settings.name || 'Me', device: state.settings.deviceId,
    currency: state.settings.currency, owner: true,
    onChange: () => { if (ui.tab === 'shop' && !Shop.isTyping() && !$('#sheet').open) render(); },
    onMessage: toast,
    // "Finish trip" → record the spend in the Money tab
    onLogMoney: (amount, store, count) => {
      state.expenses.push({
        id: uid(), type: 'out', amount, category: 'Groceries', date: today(), created: Date.now(),
        note: `Shopping trip${store ? ` · ${store}` : ''} (${count} item${count === 1 ? '' : 's'})`,
      });
      save();
    },
  });
}

const shopLink = () => new URL(`shop.html?list=${state.settings.shopCode}`, location.href.split(/[?#]/)[0]).href;

async function shareShopLink() {
  const url = shopLink();
  try {
    if (navigator.share) { await navigator.share({ title: 'Our shopping list', text: 'Here’s our shared shopping list 🛒', url }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); toast('Link copied — paste it in a message'); }
  catch { prompt('Copy this link:', url); }
}

async function resetShopLink() {
  if (!confirm('Make a new link? The old link will stop showing your list. You’ll need to send the new link again.')) return;
  const keep = JSON.parse(JSON.stringify(Shop.doc));
  await Shop.wipe();
  state.settings.shopCode = Shop.newCode();
  save();
  startShop();
  await Shop.importDoc(keep);
  render();
  toast('New link ready — tap Share link to send it');
}

views.shop = () => Shop.html();

views.insights = () => insightsView();
views.review = () => reviewView();

// Tabs that can be hidden from the bottom bar (Today always stays)
const OPTIONAL_TABS = ['tasks', 'habits', 'money', 'office', 'shop', 'journal'];
const tabShown = t => !(state.settings.hiddenTabs || []).includes(t);

// ---------- render ----------
function render() {
  ui.day = today();
  $('#title').textContent = TABS[ui.tab];
  document.title = `${TABS[ui.tab]} · Juned Daily`;
  if (OPTIONAL_TABS.includes(ui.tab) && !tabShown(ui.tab)) ui.tab = 'today';
  const visibleTabs = [...document.querySelectorAll('.tabs button')].filter(b => { const show = tabShown(b.dataset.tab); b.hidden = !show; return show; });
  $('.tabs').style.gridTemplateColumns = `repeat(${visibleTabs.length}, 1fr)`;
  const badges = tabBadges();
  document.querySelectorAll('.tabs button').forEach(b => {
    const on = b.dataset.tab === ui.tab;
    if (on && !b.classList.contains('active')) { b.classList.remove('bounce'); void b.offsetWidth; b.classList.add('bounce'); }
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    const n = badges[b.dataset.tab];
    if (n) b.dataset.badge = n > 99 ? '99+' : n; else delete b.dataset.badge;
    b.classList.toggle('live', b.dataset.tab === 'office' && !!openShift());
  });
  if (ui.tab === 'shop') Shop.start(); else Shop.stop();
  document.body.dataset.tab = ui.tab;
  $('#view').innerHTML = views[ui.tab]();
  if (ui.tab === 'shop') Shop.mounted();
  if (ui.tab === 'today') animateRing(dayProgress().pct);
  if (justToggled) {
    document.querySelectorAll(`[data-id="${justToggled}"].on`).forEach(el => el.classList.add('pop'));
    justToggled = null;
  }
}

// Little counts on the bottom tabs
function tabBadges() {
  const k = today();
  return {
    tasks: todaysTasks().filter(t => !isDone(t, k)).length,
    habits: state.habits.filter(h => !h.log[k]).length,
    money: Privacy.locked() ? 0 : state.bills.filter(b => b.next <= addDays(k, 3)).length,
    shop: PUSH_SERVER ? Shop.items.filter(i => !i.done).length + Shop.choresForMe() : 0,
  };
}

function go(tab) {
  if (ui.tab === 'money' && tab !== 'money') Privacy.markAway();
  if (tab === 'money') Privacy.markBack();
  ui.tab = tab;
  try { localStorage.setItem(KEY + ':tab', tab); } catch { /* ignore */ }
  render();
  window.scrollTo(0, 0);
}

// ---------- toast with optional undo ----------
let toastTimer;
function toast(msg, undo) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">Undo</button>' : ''}`;
  if (undo) el.querySelector('button').onclick = () => { undo(); el.classList.remove('show'); };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

const listAt = path => path.split('.').reduce((o, k) => o[k], state);

function removeWithUndo(list, id, label) {
  const arr = listAt(list);
  const i = arr.findIndex(x => x.id === id);
  if (i < 0) return;
  const [item] = arr.splice(i, 1);
  save(); render();
  toast(`${label} deleted`, () => { listAt(list).splice(i, 0, item); save(); render(); });
}

// ---------- journal edits ----------
function setJournal(k, field, value) {
  const e = { ...(state.journal[k] || {}) };
  if (value === '' || value === null || value === undefined) delete e[field]; else e[field] = value;
  if (Object.keys(e).length) state.journal[k] = e; else delete state.journal[k];
  save();
}

// ---------- reminders (push notifications) ----------
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const b64uToBytes = str => {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(str + '='.repeat((4 - (str.length % 4)) % 4)), c => c.charCodeAt(0));
};
const postJSON = (path, data) => fetch(`${PUSH_SERVER}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
});

// What the server needs to know: titles, times and repeat rules of tasks with 🔔 on
function reminderList() {
  const k = today();
  return state.tasks.filter(t => t.remind && t.time && !(t.repeat === 'none' && t.done)).map(t => ({
    id: t.id, title: t.title, time: t.time,
    repeat: isRepeat(t) ? t.repeat : 'none',
    weekday: t.weekday, monthDay: t.monthDay,
    date: isRepeat(t) ? null : (t.due || createdKey(t)),
    start: createdKey(t),
    // already ticked off → no reminder that day
    skip: isRepeat(t) ? [addDays(k, -1), k, addDays(k, 1)].filter(d => t.doneDates && t.doneDates[d]) : [],
  })).concat(nudgeList(), billReminders());
}

// ---------- daily nudges (morning brief, habit reminder, evening check-in) ----------
const NUDGES = {
  morning: ['☀️ Morning brief', 'Your tasks and habits for the day'],
  habits: ['🔁 Habit reminder', 'Habits you haven’t done yet'],
  evening: ['🌙 Evening check-in', 'Log your mood and how the day went'],
};

// tasks due on a given day (overdue one-off tasks count for today)
function tasksOn(d) {
  return state.tasks.filter(t => isRepeat(t) ? dueOn(t, d) && !(t.doneDates && t.doneDates[d]) : !t.done && (t.due ? t.due <= d : d === today()));
}

// The server sends these at the set time. The text is worked out here for the
// next time each one fires; if the app hasn't been opened since, a general line is used.
function nudgeList() {
  const n = state.settings.nudges, k = today(), out = [];
  const nextDay = hm => (atTime(k, hm) > Date.now() ? k : addDays(k, 1));
  if (n.morning.on) {
    const d = nextDay(n.morning.time), tasks = tasksOn(d), habits = state.habits.length;
    const first = tasks.filter(t => t.time).sort((a, b) => a.time.localeCompare(b.time))[0];
    const parts = [tasks.length && `${tasks.length} task${tasks.length === 1 ? '' : 's'}`, habits && `${habits} habit${habits === 1 ? '' : 's'}`].filter(Boolean);
    out.push({ id: 'nudge-morning', kind: 'nudge', title: `${withName('Good morning')} ☀️`, time: n.morning.time, repeat: 'daily', start: k,
      body: parts.length ? `Today: ${parts.join(' and ')}${first ? ` · first up: ${first.title} at ${fmtHM(first.time)}` : ''}` : 'A fresh day — plan something good.',
      bodyDate: d, fallback: 'Open Juned Daily to plan your day.', url: './?tab=today', skip: [] });
  }
  if (n.habits.on && state.habits.length) {
    const d = nextDay(n.habits.time);
    const left = state.habits.filter(h => !h.log[d]);
    const top = left.slice().sort((a, b) => streak(b) - streak(a))[0];
    out.push({ id: 'nudge-habits', kind: 'nudge', title: '🔁 Habits still to do', time: n.habits.time, repeat: 'daily', start: k,
      body: `${left.map(h => `${h.emoji || ''} ${h.name}`.trim()).join(', ')}${top && streak(top) >= 2 ? ` — keep your ${streak(top)}-day streak going!` : ''}`,
      bodyDate: d, fallback: 'Don’t forget your habits today.', url: './?tab=habits',
      skip: [k, addDays(k, 1)].filter(x => state.habits.every(h => h.log[x])) });
  }
  if (n.evening.on) {
    out.push({ id: 'nudge-evening', kind: 'nudge', title: `🌙 ${withName('How was your day')}?`, time: n.evening.time, repeat: 'daily', start: k,
      body: tabShown('journal') ? 'Tap to log your mood and a few words.' : 'Tap to log your mood for today.', bodyDate: '', fallback: 'Tap to log your mood and a few words.', url: tabShown('journal') ? './?tab=journal' : './?tab=today',
      skip: [k].filter(x => state.journal[x] && state.journal[x].mood) });
  }
  return out;
}

let syncTimer, lastSync = '';
function scheduleSync() {
  if (!state.settings.notify || !PUSH_SERVER) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncReminders, 1500);
}

async function syncReminders(force = false) {
  try {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (!sub) return false;
    const data = {
      id: state.settings.deviceId, subscription: sub.toJSON(),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone, reminders: reminderList(),
      lists: state.settings.shopCode ? [state.settings.shopCode] : [], app: 'main',
    };
    const key = JSON.stringify(data);
    if (!force && key === lastSync) return true;
    const res = await postJSON('/sync', data);
    if (res.ok) lastSync = key;
    return res.ok;
  } catch { return false; }
}

async function enableNotifications() {
  if (!PUSH_SERVER) { toast('The reminder server is not connected yet'); return; }
  if (!pushSupported()) {
    toast(isStandalone() ? 'This device does not support notifications'
      : 'Open Juned Daily from your Home Screen icon, then try again');
    return;
  }
  const perm = await Notification.requestPermission();   // must run straight from the tap
  if (perm !== 'granted') {
    toast('Notifications are blocked — allow them in iPhone Settings → Notifications → Juned Daily');
    return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { publicKey } = await (await fetch(`${PUSH_SERVER}/key`)).json();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(publicKey) });
    }
    state.settings.deviceId = state.settings.deviceId || uid();
    state.settings.notify = true;
    save();
    if (!(await syncReminders(true))) throw new Error('sync failed');
    await postJSON('/test', { id: state.settings.deviceId });
    toast('Notifications are on 🔔');
  } catch {
    state.settings.notify = false; save();
    toast('Could not turn on notifications — check your internet and try again');
  }
  refreshSettings();
}

async function disableNotifications() {
  try {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    await postJSON('/unsubscribe', { id: state.settings.deviceId });
  } catch { /* server forgets this device on its own once pushes fail */ }
  state.settings.notify = false; save(); render();
  toast('Notifications off');
  refreshSettings();
}

async function testNotification() {
  try {
    await syncReminders(true);
    const res = await postJSON('/test', { id: state.settings.deviceId });
    toast(res.ok ? 'Test sent — it should arrive in a few seconds' : 'Test failed — try turning notifications off and on');
  } catch { toast('Could not reach the reminder server'); }
}

function notifySettings() {
  const count = state.tasks.filter(t => t.remind && t.time).length;
  if (!PUSH_SERVER) return '<p class="meta">Reminder server not connected yet.</p>';
  if (state.settings.notify) return `
    <p class="meta">🔔 Notifications are on for this device · ${count} task reminder${count === 1 ? '' : 's'} set.</p>
    <div class="nudges">${Object.entries(NUDGES).map(([key, [label, hint]]) => {
      const nd = state.settings.nudges[key];
      return `<div class="nudge-row">
        <label class="toggle"><input type="checkbox" data-nudge="${key}" ${nd.on ? 'checked' : ''}><span><b>${label}</b><small>${hint}</small></span></label>
        <select data-nudge-time="${key}" aria-label="${label} time" ${nd.on ? '' : 'disabled'}>${timeOptions().replace(`value="${nd.time}"`, `value="${nd.time}" selected`)}</select>
      </div>`;
    }).join('')}</div>
    <div class="btns" style="margin-top:10px"><button type="button" class="btn" data-action="notify-test">Send a test</button>
      <button type="button" class="btn danger" data-action="notify-off">Turn off</button></div>`;
  return `
    <p class="meta">Get a notification at the time you set on a task. On iPhone, open Juned Daily from its Home Screen icon first.</p>
    <div class="btns"><button type="button" class="btn primary" data-action="notify-on">🔔 Turn on notifications</button></div>`;
}

const refreshSettings = () => { if ($('#sheet').open && $('#sheet [data-settings]')) openSettings(settingsPage); };

// ---------- settings ----------
// ---------- menu & settings (grouped into pages) ----------
const SETTINGS_PAGES = {
  appearance: ['🎨', 'You & appearance', 'Your name, theme and tabs'],
  notifications: ['🔔', 'Notifications', 'Task reminders and daily nudges'],
  expense: ['🧾', 'Expense', 'Currency, income, Face ID lock'],
  shopping: ['🛒', 'Shopping', 'Share the list with family'],
  work: ['💼', 'Work', 'Work day length and overtime'],
  data: ['📦', 'Reports & data', 'Weekly Excel, backup, erase'],
};
let settingsPage = 'menu';

function settingsBody(page) {
  switch (page) {
    case 'appearance': return `
      <label class="lbl">Your name — used in greetings and on the shared shopping list
        <input id="myName" maxlength="30" autocomplete="given-name" placeholder="Your name" value="${esc(state.settings.name || '')}">
      </label>
      <span class="lbl">Theme</span>
      ${themePickerHtml()}
      <span class="lbl">Tabs in the bottom bar</span>
      <p class="meta">Tap to show or hide. Today always stays.</p>
      <div class="chips tab-picker">${OPTIONAL_TABS.map(t => `<button type="button" class="chip ${tabShown(t) ? 'on' : ''}" data-action="toggle-tab" data-tab="${t}" aria-pressed="${tabShown(t)}">${tabShown(t) ? '✓ ' : ''}${TABS[t]}</button>`).join('')}</div>`;
    case 'notifications': return notifySettings();
    case 'expense': return `
      <label class="lbl">Currency
        <select id="currency">${CURRENCIES.map(c => `<option ${c === state.settings.currency ? 'selected' : ''}>${c}</option>`).join('')}</select>
      </label>
      <label class="toggle" style="margin-top:16px"><input type="checkbox" id="trackIncome" ${state.settings.trackIncome ? 'checked' : ''}>
        <span><b>💵 Track income too</b><small>Off: Expense is a spending tracker only. Any income you entered stays saved but hidden.</small></span></label>
      ${Privacy.settingsHtml()}`;
    case 'shopping': return `
      ${PUSH_SERVER ? `<h3 style="margin-top:8px">Share the list</h3>
      <p class="meta">Send this link to anyone you shop with. It opens a shopping-only app — they can't see anything else in Juned Daily.
        ${state.settings.notify ? 'You’ll get a 🔔 when they add something.' : 'Turn on notifications (Menu → Notifications) to get a 🔔 when they add something.'}
        “New link” stops the old link from working.</p>
      <div class="btns"><button type="button" class="btn" data-action="shop-share">📤 Share link</button>
        <button type="button" class="btn" data-action="shop-reset">New link</button></div>` : '<p class="meta">The shopping list isn’t connected.</p>'}`;
    case 'work': return `
      <label class="lbl">Work day length (hours) — used for overtime
        <input type="number" id="workHours" min="1" max="24" step="0.5" inputmode="decimal" value="${state.settings.workHours}">
      </label>`;
    case 'data': return `
      <h3>Weekly report</h3>
      <p class="meta">An Excel file with this week's summary plus a Weekly Tracker sheet covering every week so far. Save it to Files or iCloud Drive.</p>
      <div class="btns"><button type="button" class="btn" data-action="report" data-week="${weekStart(today())}">📊 Export this week (Excel)</button></div>
      <h3>Backup</h3>
      <p class="meta">Your data is stored only on this phone. Export a backup now and then — and use it to move your data to another device.</p>
      <div class="btns">
        <button type="button" class="btn" data-action="export">⬇︎ Export backup</button>
        <label class="btn">⬆︎ Import backup<input type="file" id="importFile" accept="application/json,.json" hidden></label>
      </div>
      <h3>Danger zone</h3>
      <button type="button" class="btn danger" data-action="wipe">Erase all data</button>`;
  }
  // the menu itself
  const counts = `${state.tasks.length} tasks · ${state.habits.length} habits · ${state.expenses.length} expenses · ${state.office.shifts.length} work entries`;
  const row = (icon, title, sub, attrs) => `<button type="button" class="menu-row" ${attrs}>
      <span class="menu-icon">${icon}</span><span class="grow"><b>${title}</b><small>${sub}</small></span><span class="chev">›</span></button>`;
  return `
    <div class="menu-list">
      ${row('📅', 'Weekly review', 'Your week at a glance, compared with the last', 'data-action="menu-go" data-tab="review"')}
      ${row('📊', 'Insights', 'Charts of your habits, mood, spending and work', 'data-action="menu-go" data-tab="insights"')}
    </div>
    <span class="lbl">Settings</span>
    <div class="menu-list">
      ${Object.entries(SETTINGS_PAGES).filter(([k]) => k !== 'shopping' || PUSH_SERVER)
        .map(([k, [icon, title, sub]]) => row(icon, title, sub, `data-action="settings-page" data-page="${k}"`)).join('')}
    </div>
    <p class="meta center" style="margin-top:18px">${counts}</p>`;
}

function openSettings(page = settingsPage) {
  settingsPage = SETTINGS_PAGES[page] ? page : 'menu';
  const dlg = $('#sheet');
  const [, title] = SETTINGS_PAGES[settingsPage] || [];
  dlg.classList.add('full');
  dlg.innerHTML = `
  <form method="dialog" class="sheet settings" data-settings>
    <div class="sheet-head">
      ${settingsPage === 'menu' ? `<h2>${firstName() ? `Hi, ${esc(firstName())} 👋` : 'Menu'}</h2>` : `<button type="button" class="link back" data-action="settings-page" data-page="menu">‹ Menu</button><h2>${title}</h2>`}
      <button type="button" class="icon-btn close-x" data-action="close-sheet" aria-label="Close">✕</button>
    </div>
    ${settingsBody(settingsPage)}
  </form>`;
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  shareOrDownload(blob, `juned-daily-backup-${today()}.json`);
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    const ok = data && Array.isArray(data.tasks) && Array.isArray(data.habits) && Array.isArray(data.expenses)
      && typeof data.journal === 'object';
    if (!ok) throw new Error('bad shape');
    if (!confirm('Replace ALL current data with this backup?')) return;
    state = hydrate(data);
    save(); render(); $('#sheet').close();
    toast('Backup restored');
  } catch {
    toast('That file is not a Juned Daily backup');
  }
}

// ---------- events ----------
document.addEventListener('click', e => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const { action, id, day } = b.dataset;

  switch (action) {
    case 'go':
      if (b.dataset.tab === 'money') Privacy.openMoney();   // Face ID prompt needs the tap
      go(b.dataset.tab);
      break;
    case 'reveal': Privacy.reveal(); break;
    case 'settings': openSettings('menu'); break;
    case 'settings-page': openSettings(b.dataset.page); break;
    case 'menu-go': $('#sheet').close(); go(b.dataset.tab); break;

    case 'toggle-task': {
      const before = dayProgress();
      toggleTask(id); justToggled = id; render();
      celebrateDay(before);
      break;
    }
    case 'del-task': if ($('#sheet').open) $('#sheet').close(); removeWithUndo('tasks', id, 'Task'); break;
    case 'edit-task': openTaskEdit(id); break;
    case 'toggle-remind': {
      const t = state.tasks.find(x => x.id === id);
      if (!t) break;
      t.remind = !t.remind; save(); render();
      if (t.remind && !state.settings.notify) toast('Turn on notifications in ☰ Menu → Notifications to get reminders');
      else toast(t.remind ? `🔔 Reminder on for ${fmtHM(t.time)}` : 'Reminder off');
      break;
    }
    case 'quick': openQuick(); break;
    case 'open-review': reviewWeek = b.dataset.week; go('review'); break;
    case 'open-chores': Shop.showChores(); go('shop'); break;
    case 'toggle-tab': {
      const t = b.dataset.tab, hidden = new Set(state.settings.hiddenTabs || []);
      if (hidden.has(t)) hidden.delete(t); else hidden.add(t);
      state.settings.hiddenTabs = [...hidden];
      save(); render(); refreshSettings();
      toast(hidden.has(t) ? `${TABS[t]} tab hidden — turn it back on in ☰ Menu → Appearance` : `${TABS[t]} tab shown`);
      break;
    }
    case 'close-sheet': $('#sheet').close(); break;
    case 'irange': insightRange = Number(b.dataset.v); render(); break;
    case 'shop-share': shareShopLink(); break;
    case 'shop-reset': resetShopLink(); break;
    case 'notify-on': enableNotifications(); break;
    case 'notify-off': disableNotifications(); break;
    case 'notify-test': testNotification(); break;

    case 'toggle-habit': {
      const h = state.habits.find(x => x.id === id);
      if (!h) break;
      const before = dayProgress();
      if (h.log[day]) delete h.log[day]; else h.log[day] = true;
      justToggled = id;
      save(); render();
      if (!celebrateStreak(h)) celebrateDay(before);
      break;
    }
    case 'del-habit': {
      const h = state.habits.find(x => x.id === id);
      if (h && confirm(`Delete "${h.name}" and all its history?`)) removeWithUndo('habits', id, 'Habit');
      break;
    }

    case 'del-expense': removeWithUndo('expenses', id, 'Entry'); break;
    case 'month': {
      const [y, m] = ui.month.split('-').map(Number);
      const d = new Date(y, m - 1 + Number(b.dataset.delta), 1);
      ui.month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      render();
      break;
    }

    case 'mood': {
      const v = Number(b.dataset.v);
      const cur = state.journal[day]?.mood;
      setJournal(day, 'mood', cur === v ? null : v);
      render();
      break;
    }
    case 'jday': {
      const next = addDays(ui.jdate, Number(b.dataset.delta));
      if (next <= today()) { ui.jdate = next; render(); }
      break;
    }
    case 'open-journal': ui.jdate = day; go('journal'); break;

    case 'office-view': ui.office = b.dataset.view; render(); break;
    case 'clock-in':
      if (!openShift()) state.office.shifts.push({ id: uid(), date: today(), start: Date.now(), end: null, breakMin: 0 });
      save(); render();
      break;
    case 'clock-out': {
      const sh = openShift();
      if (sh) { sh.end = Date.now(); save(); render(); toast(`Clocked out · ${fmtDur(shiftMin(sh))}`); }
      break;
    }
    case 'del-shift': removeWithUndo('office.shifts', id, 'Entry'); break;
    case 'del-dayoff': removeWithUndo('office.daysOff', id, 'Day off'); break;
    case 'toggle-otask': {
      const t = state.office.tasks.find(x => x.id === id);
      if (t) { t.done = !t.done; t.doneAt = t.done ? today() : null; save(); render(); }
      break;
    }
    case 'del-otask': removeWithUndo('office.tasks', id, 'Task'); break;
    case 'toggle-action': {
      const a = state.office.meetings.find(m => m.id === id)?.actions.find(x => x.id === b.dataset.aid);
      if (a) { a.done = !a.done; save(); render(); }
      break;
    }
    case 'del-meeting': {
      const m = state.office.meetings.find(x => x.id === id);
      if (m && confirm(`Delete the meeting "${m.title}"?`)) removeWithUndo('office.meetings', id, 'Meeting');
      break;
    }

    case 'export': if (Privacy.requireUnlock('To export a backup')) exportData(); break;
    case 'report': if (Privacy.requireUnlock('To export the report')) exportReport(b.dataset.week); break;
    case 'report-skip':
      state.settings.lastReport = b.dataset.week; save(); render();
      toast('You can export it any time from ☰ Menu → Reports & data');
      break;
    case 'wipe':
      if (!Privacy.requireUnlock('To erase your data')) break;
      if (confirm('Erase ALL your Juned Daily data on this device? This cannot be undone.')
        && confirm('Are you absolutely sure? Consider exporting a backup first.')) {
        state = defaults(); save(); render(); $('#sheet').close();
        toast('All data erased');
      }
      break;
  }
});

document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form], form[data-task-edit]');
  if (!f) return;
  e.preventDefault();
  const d = Object.fromEntries(new FormData(f));
  const kind = f.dataset.form;

  if (f.dataset.taskEdit) {
    const t = state.tasks.find(x => x.id === f.dataset.taskEdit);
    if (!t) { $('#sheet').close(); return; }
    const repeat = REPEATS[d.repeat] ? d.repeat : 'none';
    let time = /^\d{2}:\d{2}$/.test(d.time || '') ? d.time : '';
    const remind = !!d.remind;
    let due = repeat === 'none' ? (d.due || null) : null;
    if (remind && !time) {
      if (repeat === 'none') ({ date: due, time } = defaultReminder(due));
      else time = '09:00';
    }
    const base = d.due || today();
    const wasRepeat = isRepeat(t);
    Object.assign(t, {
      title: (d.title || '').trim() || t.title, repeat, due, time, remind,
      weekday: repeat === 'weekly' ? parseKey(base).getDay() : undefined,
      monthDay: repeat === 'monthly' ? parseKey(base).getDate() : undefined,
    });
    if (wasRepeat && repeat === 'none') { t.done = false; t.doneAt = null; }   // a routine turned into a one-off starts fresh
    t.doneDates = t.doneDates || {};
    $('#sheet').close();
    save(); render();
    toast(remind && time ? `✏️ Saved · 🔔 ${fmtHM(time)}${due && due !== today() ? ` ${fmtDate(due).toLowerCase()}` : ''}` : '✏️ Task saved');
    return;
  }

  if (kind === 'task') {
    const title = (d.title || '').trim();
    if (!title) return;
    const repeat = REPEATS[d.repeat] ? d.repeat : 'none';
    let time = /^\d{2}:\d{2}$/.test(d.time || '') ? d.time : '';
    const remind = !!d.remind;
    let due = repeat === 'none' ? (d.due || null) : null;
    if (remind && !time) {
      if (repeat === 'none') ({ date: due, time } = defaultReminder(due));
      else time = '09:00';
    }
    // a one-time reminder with no date: today if the time is still ahead, otherwise tomorrow
    if (repeat === 'none' && remind && !due) due = atTime(today(), time) > Date.now() ? today() : addDays(today(), 1);
    const base = d.due || today();
    state.tasks.push({
      id: uid(), title, created: Date.now(), repeat, due, time, remind,
      weekday: repeat === 'weekly' ? parseKey(base).getDay() : undefined,
      monthDay: repeat === 'monthly' ? parseKey(base).getDate() : undefined,
      done: false, doneAt: null, doneDates: {},
    });
    if (remind && !state.settings.notify) toast('Saved — turn on notifications in ☰ Menu → Notifications to get the reminder');
    else if (remind) toast(`🔔 Reminder set for ${fmtHM(time)}`);
  } else if (kind === 'habit') {
    const name = (d.name || '').trim();
    if (!name) return;
    state.habits.push({ id: uid(), name, emoji: (d.emoji || '').trim() || '✅', created: Date.now(), log: {} });
  } else if (kind === 'expense') {
    const amount = parseAmount(d.amount);
    if (!amount) { toast('Enter an amount greater than 0'); return; }
    const type = d.type === 'in' ? 'in' : 'out';
    state.expenses.push({
      id: uid(), type, amount, category: d.category || 'Other',
      note: (d.note || '').trim(), date: d.date || today(), created: Date.now(),
    });
    toast(`${type === 'in' ? 'Income' : 'Expense'} of ${money(amount)} logged${type === 'out' ? budgetNote(d.category || 'Other', d.date || today()) : ''}`);
  } else if (kind === 'shift') {
    if (!d.date || !d.start || !d.end) return;
    const start = atTime(d.date, d.start);
    let end = atTime(d.date, d.end);
    if (end <= start) end += 864e5;   // shift past midnight
    const breakMin = Math.max(0, parseInt(d.break, 10) || 0);
    state.office.shifts.push({ id: uid(), date: d.date, start, end, breakMin });
    toast(`Added ${fmtDur((end - start) / 6e4 - breakMin)} on ${fmtDate(d.date)}`);
  } else if (kind === 'dayoff') {
    if (!d.date) return;
    state.office.daysOff = state.office.daysOff.filter(o => o.date !== d.date);
    state.office.daysOff.push({ id: uid(), date: d.date, type: d.type || 'Day off' });
    toast(`${d.type} saved for ${fmtDate(d.date)}`);
  } else if (kind === 'otask') {
    const title = (d.title || '').trim();
    if (!title) return;
    state.office.tasks.push({
      id: uid(), title, priority: PRIORITY[d.priority] ? d.priority : 'med',
      due: d.due || null, done: false, doneAt: null, created: Date.now(),
    });
  } else if (kind === 'meeting') {
    const title = (d.title || '').trim();
    if (!title) return;
    const actions = (d.actions || '').split('\n').map(x => x.trim()).filter(Boolean)
      .map(text => ({ id: uid(), text, done: false }));
    state.office.meetings.push({
      id: uid(), title, date: d.date || today(), time: d.time || '',
      notes: (d.notes || '').trim(), actions, created: Date.now(),
    });
    toast('Meeting saved');
  } else return;

  save(); render();
  // keep the keyboard open for quick consecutive entries
  const again = $(`form[data-form="${kind}"] input:not([type=hidden]):not([type=radio])`);
  if (again) again.focus();
});

// Task form: picking a time or a date ticks 🔔 Remind me (unless you unticked it yourself)
document.addEventListener('change', e => {
  const f = e.target.form;
  if (!f || !(f.dataset.form === 'task' || f.dataset.taskEdit) || !f.remind) return;
  if (e.target === f.remind) { f.remind.dataset.userSet = '1'; return; }
  if ((e.target.name === 'time' || e.target.name === 'due') && !f.remind.dataset.userSet) {
    f.remind.checked = !!((f.time && f.time.value) || (f.due && f.due.value));
  }
});

// Switching Expense/Income swaps the category list
document.addEventListener('change', e => {
  const t = e.target;
  if (t.name === 'type' && t.type === 'radio') {
    const sel = t.form.querySelector('select[name=category]');
    if (sel) sel.innerHTML = catOptions(t.value);
  } else if (t.id === 'currency') {
    state.settings.currency = t.value; save(); startShop(); render();
  } else if (t.id === 'trackIncome') {
    state.settings.trackIncome = t.checked; save(); render();
    toast(t.checked ? '💵 Income tracking on' : '💸 Expense tracker only — income hidden');
  } else if (t.dataset.nudge) {
    state.settings.nudges[t.dataset.nudge].on = t.checked; save(); refreshSettings();
    toast(t.checked ? `${NUDGES[t.dataset.nudge][0]} on` : `${NUDGES[t.dataset.nudge][0]} off`);
  } else if (t.dataset.nudgeTime) {
    state.settings.nudges[t.dataset.nudgeTime].time = t.value; save();
    toast(`${NUDGES[t.dataset.nudgeTime][0]} at ${fmtHM(t.value)}`);
  } else if (t.id === 'myName') {
    state.settings.name = t.value.trim().slice(0, 30); save(); startShop(); render(); refreshSettings();
  } else if (t.id === 'workHours') {
    const n = parseFloat(t.value);
    if (n > 0 && n <= 24) { state.settings.workHours = n; save(); render(); }
  } else if (t.id === 'importFile' && t.files[0] && !Privacy.requireUnlock('To import a backup')) {
    t.value = '';
  } else if (t.id === 'importFile' && t.files[0]) {
    importData(t.files[0]);
    t.value = '';
  } else if (t.dataset.j === 'energy') {
    setJournal(ui.jdate, 'energy', t.value ? Number(t.value) : null);
    flashSaved();
  }
});

// Journal fields autosave as you type (no re-render, so focus is kept)
let savedTimer;
function flashSaved() {
  const el = $('#saved');
  if (!el) return;
  el.textContent = 'Saved ✓';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { el.textContent = ''; }, 1500);
}
document.addEventListener('input', e => {
  const f = e.target.dataset.j;
  if (f === 'text') setJournal(ui.jdate, 'text', e.target.value.trim() ? e.target.value : null);
  else if (f === 'sleep') {
    const n = parseFloat(e.target.value);
    setJournal(ui.jdate, 'sleep', Number.isFinite(n) && n >= 0 && n <= 24 ? n : null);
  } else return;
  flashSaved();
});

// Roll over to the new day if the app stays open past midnight
function checkDay() {
  const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (ui.tab === 'office' && ui.office === 'hours' && openShift() && !typing && !$('details[open]')) render();
  if (ui.day !== today()) {
    if (ui.jdate === ui.day) ui.jdate = today();
    if (ui.month === ui.day.slice(0, 7)) ui.month = today().slice(0, 7);
    scheduleSync();
    if (!typing) render();
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDay(); });
setInterval(checkDay, 60 * 1000);

// settings use a full-screen sheet; other sheets (quick add) don't
$('#sheet').addEventListener('close', () => { if (!$('#sheet').open) $('#sheet').classList.remove('full'); });

// ---------- boot ----------
startShop();
render();
if (state.settings.notify && PUSH_SERVER) navigator.serviceWorker?.ready.then(() => syncReminders(true));
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
