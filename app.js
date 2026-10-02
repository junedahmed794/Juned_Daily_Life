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
const TABS = { today: 'Today', tasks: 'Tasks', habits: 'Habits', money: 'Money', journal: 'Journal' };

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
const defaults = () => ({ tasks: [], habits: [], expenses: [], journal: {}, settings: { currency: guessCurrency() } });

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return { ...defaults(), ...data, settings: { ...defaults().settings, ...(data.settings || {}) } };
    }
  } catch { /* fall through to defaults */ }
  return defaults();
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch { toast('Could not save — browser storage is unavailable'); }
}

let state = load();
const ui = { tab: 'today', month: today().slice(0, 7), jdate: today(), day: today() };
try { const t = localStorage.getItem(KEY + ':tab'); if (TABS[t]) ui.tab = t; } catch { /* ignore */ }

// ---------- tasks ----------
const isRepeat = t => t.repeat === 'daily' || t.repeat === 'weekly';

function dueOn(t, k) {
  if (t.repeat === 'daily') return true;
  if (t.repeat === 'weekly') return parseKey(k).getDay() === t.weekday;
  return false;
}

const isDone = (t, k = today()) => isRepeat(t) ? !!(t.doneDates && t.doneDates[k]) : !!t.done;

function todaysTasks() {
  const k = today();
  return state.tasks.filter(t => isRepeat(t)
    ? dueOn(t, k)
    : (!t.done && (!t.due || t.due <= k)) || (t.done && t.doneAt === k));
}

const sortTasks = list => [...list].sort((a, b) =>
  isDone(a) - isDone(b) || (a.due || '9999').localeCompare(b.due || '9999') || a.created - b.created);

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
  if (t.repeat === 'daily') meta = '↻ Every day';
  else if (t.repeat === 'weekly') meta = `↻ Every ${WEEKDAYS[t.weekday]}`;
  else if (t.done && t.doneAt) meta = `Done ${fmtDate(t.doneAt).toLowerCase()}`;
  else if (t.due) meta = t.due < k ? `<span class="overdue">Overdue · ${fmtDate(t.due)}</span>` : fmtDate(t.due);
  return `<li class="row ${done ? 'done' : ''}">
    <button class="check ${done ? 'on' : ''} ${check ? '' : 'ghost'}" data-action="toggle-task" data-id="${t.id}"
      aria-label="${done ? 'Mark not done' : 'Mark done'}: ${esc(t.title)}" ${check ? '' : 'tabindex="-1"'}></button>
    <div class="grow"><div class="row-title">${esc(t.title)}</div>${meta ? `<div class="meta">${meta}</div>` : ''}</div>
    <button class="icon-btn" data-action="del-task" data-id="${t.id}" aria-label="Delete task">×</button>
  </li>`;
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
  };
}

function firstDataDay() {
  const keys = [
    ...state.tasks.map(createdKey), ...state.habits.map(createdKey),
    ...state.habits.flatMap(h => Object.keys(h.log)),
    ...state.expenses.map(e => e.date), ...Object.keys(state.journal),
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
    ['Total income', M(s.income)],
    ['Net', { v: s.net, s: S.moneyBold }],
    ['Top spending category', s.cats.length ? s.cats[0][0] : '—'],
    ['Journal days', `${s.journalDays} of ${s.days.length}`],
    ['Average mood (1–5)', D1(s.avgMood)],
    ['Average sleep (hours)', D1(s.avgSleep)],
    ['Average energy (1–5)', D1(s.avgEnergy)],
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
  rows.push([H('Day'), H('Tasks done'), H('Habits done'), H('Spent'), H('Mood'), H('Sleep (h)')]);
  s.daily.forEach(d => rows.push([
    parseKey(d.date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
    d.tasks, d.habitTotal ? `${d.habits} of ${d.habitTotal}` : '—', M(d.spent),
    d.mood ? `${d.mood} ${MOODS[d.mood - 1]}` : '—', typeof d.sleep === 'number' ? d.sleep : '—',
  ]));

  // Weekly Tracker: one row per week, from the first week with data up to this one
  const tracker = [[H('Week starting'), H('Week ending'), H('Tasks done'), H('Routines'), H('Habits'),
    H('Spent'), H('Income'), H('Net'), H('Journal days'), H('Avg mood'), H('Avg sleep')]];
  const lastWeek = weekStart(today());
  for (let w = weekStart(firstDataDay()); w <= lastWeek; w = addDays(w, 7)) {
    const x = weekStats(w);
    tracker.push([
      { v: excelDate(x.ws), s: S.date }, { v: excelDate(x.we), s: S.date },
      x.tasksDone, P(x.routinePct), P(x.habitPct),
      M(x.spent), M(x.income), M(x.net), x.journalDays, D1(x.avgMood), D1(x.avgSleep),
    ]);
  }

  return makeXlsx([
    { name: 'This Week', rows, widths: [26, 14, 12, 12, 15, 11] },
    { name: 'Weekly Tracker', rows: tracker, widths: [15, 15, 11, 11, 10, 12, 12, 12, 13, 10, 10], freeze: 1 },
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
  <p class="greet">${greeting} · ${fmtLong(k)}</p>
  ${(() => {
    const ws = pendingReportWeek();
    return ws ? `<section class="card report">
      <h2>📊 Your weekly report is ready</h2>
      <p class="meta">${fmtRange(ws, addDays(ws, 6))} · Excel file with your summary and weekly tracker</p>
      <div class="btns"><button class="btn primary" data-action="report" data-week="${ws}">Export to Excel</button>
      <button class="btn" data-action="report-skip" data-week="${ws}">Not now</button></div>
    </section>` : '';
  })()}

  <div class="stats">
    <div class="stat"><b>${doneN}/${tasks.length}</b><span>Tasks done</span></div>
    <div class="stat"><b>${habitsDone}/${state.habits.length}</b><span>Habits</span></div>
    <div class="stat"><b>${money(spentToday)}</b><span>Spent today</span></div>
  </div>

  <section class="card">
    <div class="card-head"><h2>Tasks</h2><button class="link" data-action="go" data-tab="tasks">All tasks →</button></div>
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
    <div class="card-head"><h2>How are you feeling?</h2><button class="link" data-action="open-journal" data-day="${k}">Journal →</button></div>
    <div class="moods">${MOODS.map((m, i) => `<button class="mood ${j.mood === i + 1 ? 'on' : ''}" data-action="mood"
      data-day="${k}" data-v="${i + 1}" aria-label="Mood ${i + 1} of 5">${m}</button>`).join('')}</div>
  </section>

  <section class="card">
    <div class="card-head"><h2>Money</h2><button class="link" data-action="go" data-tab="money">Details →</button></div>
    <div class="meta">This month: <strong>${money(spentMonth)}</strong> spent</div>
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
      <input type="date" name="due" aria-label="Due date (optional)">
      <select name="repeat" aria-label="Repeat">
        <option value="none">One-time</option>
        <option value="daily">Every day</option>
        <option value="weekly">Every week</option>
      </select>
      <button class="btn primary">Add</button>
    </div>
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
  const m = ui.month;
  const [y, mo] = m.split('-').map(Number);
  const label = new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const items = state.expenses.filter(e => e.date.startsWith(m))
    .sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
  const outItems = items.filter(e => e.type === 'out');
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
    <div class="seg" role="radiogroup" aria-label="Type">
      <label><input type="radio" name="type" value="out" checked> Expense</label>
      <label><input type="radio" name="type" value="in"> Income</label>
    </div>
    <div class="add-row">
      <input name="amount" inputmode="decimal" placeholder="Amount" required aria-label="Amount">
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
    <div class="totals">
      <div><b>${money(spent)}</b><span>Spent</span></div>
      <div><b>${money(income)}</b><span>Income</span></div>
      <div><b class="${net >= 0 ? 'pos' : 'neg'}">${money(net)}</b><span>Net</span></div>
    </div>
    ${cats.length ? `<div class="bars">${cats.map(([c, v]) => `
      <div class="bar-row"><span>${esc(c)}</span><div class="bar"><i style="width:${(v / max * 100).toFixed(1)}%"></i></div>
      <span class="amt">${money(v)}</span></div>`).join('')}</div>` : ''}
  </div>

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

// ---------- render ----------
function render() {
  ui.day = today();
  $('#title').textContent = TABS[ui.tab];
  document.title = `${TABS[ui.tab]} · Juned Daily`;
  document.querySelectorAll('.tabs button').forEach(b => {
    const on = b.dataset.tab === ui.tab;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('#view').innerHTML = views[ui.tab]();
}

function go(tab) {
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

function removeWithUndo(list, id, label) {
  const arr = state[list];
  const i = arr.findIndex(x => x.id === id);
  if (i < 0) return;
  const [item] = arr.splice(i, 1);
  save(); render();
  toast(`${label} deleted`, () => { state[list].splice(i, 0, item); save(); render(); });
}

// ---------- journal edits ----------
function setJournal(k, field, value) {
  const e = { ...(state.journal[k] || {}) };
  if (value === '' || value === null || value === undefined) delete e[field]; else e[field] = value;
  if (Object.keys(e).length) state.journal[k] = e; else delete state.journal[k];
  save();
}

// ---------- settings ----------
function openSettings() {
  const dlg = $('#sheet');
  const counts = `${state.tasks.length} tasks · ${state.habits.length} habits · ${state.expenses.length} money entries · ${Object.keys(state.journal).length} journal days`;
  dlg.innerHTML = `
  <form method="dialog" class="sheet">
    <h2>Settings</h2>
    <p class="meta">${counts}</p>
    <label class="lbl">Currency
      <select id="currency">${CURRENCIES.map(c => `<option ${c === state.settings.currency ? 'selected' : ''}>${c}</option>`).join('')}</select>
    </label>
    <h3>Weekly report</h3>
    <p class="meta">An Excel file with this week's summary plus a Weekly Tracker sheet covering every week so far. Save it to Files or iCloud Drive.</p>
    <div class="btns"><button type="button" class="btn" data-action="report" data-week="${weekStart(today())}">📊 Export this week (Excel)</button></div>
    <h3>Backup</h3>
    <p class="meta">Your data is stored only in this browser on this device. Export a backup now and then — and use it to move your data to another device.</p>
    <div class="btns">
      <button type="button" class="btn" data-action="export">⬇︎ Export backup</button>
      <label class="btn">⬆︎ Import backup<input type="file" id="importFile" accept="application/json,.json" hidden></label>
    </div>
    <h3>Danger zone</h3>
    <button type="button" class="btn danger" data-action="wipe">Erase all data</button>
    <div class="btns" style="justify-content:flex-end;margin-top:22px"><button class="btn primary">Done</button></div>
  </form>`;
  dlg.showModal();
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
    state = { ...defaults(), ...data, settings: { ...defaults().settings, ...(data.settings || {}) } };
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
    case 'go': go(b.dataset.tab); break;
    case 'settings': openSettings(); break;

    case 'toggle-task': toggleTask(id); render(); break;
    case 'del-task': removeWithUndo('tasks', id, 'Task'); break;

    case 'toggle-habit': {
      const h = state.habits.find(x => x.id === id);
      if (!h) break;
      if (h.log[day]) delete h.log[day]; else h.log[day] = true;
      save(); render();
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

    case 'export': exportData(); break;
    case 'report': exportReport(b.dataset.week); break;
    case 'report-skip':
      state.settings.lastReport = b.dataset.week; save(); render();
      toast('You can export it any time from ⚙︎ Settings');
      break;
    case 'wipe':
      if (confirm('Erase ALL your Juned Daily data on this device? This cannot be undone.')
        && confirm('Are you absolutely sure? Consider exporting a backup first.')) {
        state = defaults(); save(); render(); $('#sheet').close();
        toast('All data erased');
      }
      break;
  }
});

document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const d = Object.fromEntries(new FormData(f));
  const kind = f.dataset.form;

  if (kind === 'task') {
    const title = (d.title || '').trim();
    if (!title) return;
    const repeat = d.repeat || 'none';
    const base = d.due || today();
    state.tasks.push({
      id: uid(), title, created: Date.now(), repeat,
      due: repeat === 'none' ? (d.due || null) : null,
      weekday: repeat === 'weekly' ? parseKey(base).getDay() : undefined,
      done: false, doneAt: null, doneDates: {},
    });
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
    toast(`${type === 'in' ? 'Income' : 'Expense'} of ${money(amount)} logged`);
  } else return;

  save(); render();
  // keep the keyboard open for quick consecutive entries
  const again = $(`form[data-form="${kind}"] input:not([type=hidden]):not([type=radio])`);
  if (again) again.focus();
});

// Switching Expense/Income swaps the category list
document.addEventListener('change', e => {
  const t = e.target;
  if (t.name === 'type' && t.type === 'radio') {
    const sel = t.form.querySelector('select[name=category]');
    if (sel) sel.innerHTML = catOptions(t.value);
  } else if (t.id === 'currency') {
    state.settings.currency = t.value; save(); render();
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
  if (ui.day !== today()) {
    if (ui.jdate === ui.day) ui.jdate = today();
    if (ui.month === ui.day.slice(0, 7)) ui.month = today().slice(0, 7);
    const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (!typing) render();
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDay(); });
setInterval(checkDay, 60 * 1000);

// ---------- boot ----------
render();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
