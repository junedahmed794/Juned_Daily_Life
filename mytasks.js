'use strict';

/* =========================================================
   My tasks — a private task list inside the shopping app.
   Stored only on this phone. Reminders go through the same
   reminder service as the main app (titles and times only).
   ========================================================= */

const MyTasks = (() => {
  const KEY = 'my-tasks';
  const REPEATS = { none: 'One-time', daily: 'Every day', weekdays: 'Weekdays (Mon–Fri)', weekly: 'Every week', monthly: 'Every month' };
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const cfg = { onChange: () => {}, onMessage: () => {}, onSave: () => {}, shareNote: () => '' };
  let dlg = null;

  // ---------- helpers ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => dateKey();
  const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); };
  const atTime = (k, hm) => { const [h, m] = hm.split(':').map(Number); const d = parseKey(k); d.setHours(h, m, 0, 0); return d.getTime(); };
  const fmtHM = hm => new Date(atTime(today(), hm)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  function fmtDate(k) {
    const t = today();
    if (k === t) return 'Today';
    if (k === addDays(t, 1)) return 'Tomorrow';
    if (k === addDays(t, -1)) return 'Yesterday';
    return parseKey(k).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const timeOptions = sel => Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`)
    .map(hm => `<option value="${hm}" ${hm === sel ? 'selected' : ''}>${fmtHM(hm)}</option>`).join('');

  // ---------- data ----------
  let tasks = [];
  try { tasks = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { tasks = []; }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(tasks)); } catch { cfg.onMessage('Could not save on this phone'); }
    cfg.onSave();
  }

  const isRepeat = t => t.repeat && t.repeat !== 'none';
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
  const isDone = (t, k = today()) => (isRepeat(t) ? !!(t.doneDates && t.doneDates[k]) : !!t.done);
  const todays = () => {
    const k = today();
    return tasks.filter(t => isRepeat(t) ? dueOn(t, k) : (!t.done && (!t.due || t.due <= k)) || (t.done && t.doneAt === k));
  };
  const sortTasks = list => [...list].sort((a, b) => isDone(a) - isDone(b) || (a.due || '9999').localeCompare(b.due || '9999')
    || (a.time || '99:99').localeCompare(b.time || '99:99') || a.created - b.created);
  const createdKey = t => dateKey(new Date(t.created || 0));

  function repeatLabel(t) {
    switch (t.repeat) {
      case 'daily': return '↻ Every day';
      case 'weekdays': return '↻ Weekdays';
      case 'weekly': return `↻ Every ${WEEKDAYS[t.weekday]}`;
      case 'monthly': return `↻ Monthly on the ${ordinal(t.monthDay)}`;
      default: return '';
    }
  }

  // a date but no time: 9:00 AM, or the next hour if 9:00 has passed today
  function defaultReminder(date) {
    const k = today(), h = new Date().getHours();
    if (date && date > k) return { date, time: '09:00' };
    if (h < 9) return { date: date || k, time: '09:00' };
    if (h < 22) return { date: date || k, time: `${pad(h + 1)}:00` };
    return { date: addDays(k, 1), time: '09:00' };
  }

  // read a task form (new or edit) into task fields
  function fromForm(f) {
    const repeat = REPEATS[f.repeat.value] ? f.repeat.value : 'none';
    let time = /^\d{2}:\d{2}$/.test(f.time.value) ? f.time.value : '';
    const remind = f.remind.checked;
    let due = repeat === 'none' ? (f.due.value || null) : null;
    if (remind && !time) {
      if (repeat === 'none') ({ date: due, time } = defaultReminder(due));
      else time = '09:00';
    }
    // a time but no date: today if it's still ahead, otherwise tomorrow
    if (repeat === 'none' && remind && time && !due) due = atTime(today(), time) > Date.now() ? today() : addDays(today(), 1);
    const base = f.due.value || today();
    return {
      title: f.title.value.trim(), repeat, due, time, remind,
      weekday: repeat === 'weekly' ? parseKey(base).getDay() : undefined,
      monthDay: repeat === 'monthly' ? parseKey(base).getDate() : undefined,
    };
  }

  // ---------- rendering ----------
  function row(t, check = true) {
    const k = today(), done = check && isDone(t, k);
    let meta = '';
    if (isRepeat(t)) meta = repeatLabel(t);
    else if (t.done && t.doneAt) meta = `Done ${fmtDate(t.doneAt).toLowerCase()}`;
    else if (t.due) meta = t.due < k ? `<span class="overdue">Overdue · ${fmtDate(t.due)}</span>` : fmtDate(t.due);
    if (t.time) meta += `${meta ? ' · ' : ''}🕘 ${fmtHM(t.time)}${t.remind ? ' 🔔' : ''}`;
    return `<li class="row ${done ? 'done' : ''}">
      <button class="check ${done ? 'on' : ''} ${check ? '' : 'ghost'}" data-mt="toggle" data-id="${t.id}" aria-label="${done ? 'Mark not done' : 'Mark done'}: ${esc(t.title)}"></button>
      <div class="grow tap" data-mt="edit" data-id="${t.id}"><div class="row-title">${esc(t.title)}</div>${meta ? `<div class="meta">${meta}</div>` : ''}</div>
      <button class="icon-btn edit-btn" data-mt="edit" data-id="${t.id}" aria-label="Edit task">✏️</button>
      <button class="icon-btn" data-mt="del" data-id="${t.id}" aria-label="Delete task">×</button>
    </li>`;
  }
  const section = (title, list, empty, check) => `<h2 class="sec">${title}</h2><div class="card"><ul class="list">${list.length ? list.map(t => row(t, check)).join('') : `<li class="empty">${empty}</li>`}</ul></div>`;

  function formFields(t = {}) {
    return `<div class="add-row">
        <input type="date" name="due" value="${t.date || ''}" aria-label="Date (optional)">
        <select name="repeat" aria-label="Repeat">${Object.entries(REPEATS).map(([v, l]) => `<option value="${v}" ${v === (t.repeat || 'none') ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      <div class="add-row">
        <select name="time" aria-label="Time (optional)"><option value="">🕘 No time</option>${timeOptions(t.time)}</select>
        <label class="toggle"><input type="checkbox" name="remind" ${t.remind ? 'checked data-user-set="1"' : ''}><span>🔔 Remind me</span></label>
      </div>`;
  }

  function html() {
    const k = today();
    const now = sortTasks(todays());
    const upcoming = tasks.filter(t => !isRepeat(t) && !t.done && t.due && t.due > k).sort((a, b) => a.due.localeCompare(b.due));
    const routines = tasks.filter(t => isRepeat(t) && !dueOn(t, k));
    const done = tasks.filter(t => !isRepeat(t) && t.done && t.doneAt !== k).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')).slice(0, 15);
    return `${cfg.shareNote()}
      <form class="card add" data-mt-form>
        <input name="title" placeholder="What do you need to do?" required autocomplete="off" aria-label="New task" maxlength="120">
        ${formFields()}
        <button class="btn primary block" style="margin-top:8px">Add task</button>
      </form>
      ${section('Today', now, 'Nothing for today 🎉')}
      ${upcoming.length ? section('Upcoming', upcoming) : ''}
      ${routines.length ? section('Other routines', routines, '', false) : ''}
      ${done.length ? section('Completed', done) : ''}`;
  }

  function sheet(inner) {
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'taskSheet'; document.body.appendChild(dlg); }
    dlg.innerHTML = inner;
    if (!dlg.open) dlg.showModal();
  }
  const closeSheet = () => { if (dlg && dlg.open) dlg.close(); };

  function openEdit(id) {
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    let date = t.due || '';
    if (!date && t.repeat === 'weekly') date = addDays(today(), (t.weekday - parseKey(today()).getDay() + 7) % 7);
    if (!date && t.repeat === 'monthly') { const d = parseKey(today()); date = dateKey(new Date(d.getFullYear(), d.getMonth() + (d.getDate() > t.monthDay ? 1 : 0), t.monthDay)); }
    sheet(`<form class="sheet" data-mt-edit="${id}">
      <h2>✏️ Edit task</h2>
      <label class="lbl">Task<input name="title" value="${esc(t.title)}" maxlength="120" required></label>
      ${formFields({ ...t, date })}
      <div class="btns spread" style="margin-top:18px">
        <button type="button" class="btn danger" data-mt="del" data-id="${id}">Delete</button>
        <span class="btns"><button type="button" class="btn" data-mt="close">Cancel</button><button class="btn primary">Save</button></span>
      </div>
    </form>`);
  }

  // ---------- reminders for the server ----------
  function reminders() {
    const k = today();
    return tasks.filter(t => t.remind && t.time && !(t.repeat === 'none' && t.done)).map(t => ({
      id: `mt-${t.id}`, title: t.title, time: t.time, repeat: isRepeat(t) ? t.repeat : 'none',
      weekday: t.weekday, monthDay: t.monthDay, date: isRepeat(t) ? null : (t.due || createdKey(t)), start: createdKey(t),
      skip: isRepeat(t) ? [addDays(k, -1), k, addDays(k, 1)].filter(d => t.doneDates && t.doneDates[d]) : [],
      url: 'shop.html?view=tasks',
    }));
  }

  // ---------- events ----------
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-mt]');
    if (!b) return;
    const id = b.dataset.id, t = tasks.find(x => x.id === id);
    switch (b.dataset.mt) {
      case 'toggle': {
        if (!t) break;
        const k = today();
        if (isRepeat(t)) { t.doneDates = t.doneDates || {}; if (t.doneDates[k]) delete t.doneDates[k]; else t.doneDates[k] = true; }
        else { t.done = !t.done; t.doneAt = t.done ? k : null; }
        save(); cfg.onChange();
        break;
      }
      case 'edit': openEdit(id); break;
      case 'del': {
        if (!t) break;
        closeSheet();
        const i = tasks.indexOf(t);
        tasks.splice(i, 1); save(); cfg.onChange();
        cfg.onMessage(`Removed ${t.title}`, () => { tasks.splice(i, 0, t); save(); cfg.onChange(); });
        break;
      }
      case 'close': closeSheet(); break;
    }
  });

  document.addEventListener('submit', e => {
    const f = e.target;
    if (f.matches && f.matches('[data-mt-form]')) {
      e.preventDefault();
      const data = fromForm(f);
      if (!data.title) return;
      f.reset(); delete f.remind.dataset.userSet;   // clear the form first so the list can refresh
      tasks.push({ id: uid(), created: Date.now(), done: false, doneAt: null, doneDates: {}, ...data });
      save(); cfg.onChange();
      cfg.onMessage(data.remind && data.time ? `✅ Added · 🔔 ${fmtHM(data.time)}` : '✅ Task added');
      const input = document.querySelector('[data-mt-form] [name=title]');
      if (input) input.focus();
    } else if (f.matches && f.matches('[data-mt-edit]')) {
      e.preventDefault();
      const t = tasks.find(x => x.id === f.dataset.mtEdit);
      if (!t) { closeSheet(); return; }
      const data = fromForm(f);
      const wasRepeat = isRepeat(t);
      Object.assign(t, { ...data, title: data.title || t.title });
      if (wasRepeat && !isRepeat(t)) { t.done = false; t.doneAt = null; }
      closeSheet(); save(); cfg.onChange();
      cfg.onMessage(t.remind && t.time ? `✏️ Saved · 🔔 ${fmtHM(t.time)}` : '✏️ Task saved');
    }
  });

  // picking a time or date ticks 🔔 Remind me (unless she unticked it herself)
  document.addEventListener('change', e => {
    const f = e.target.form;
    if (!f || !(f.matches('[data-mt-form]') || f.matches('[data-mt-edit]'))) return;
    if (e.target === f.remind) { f.remind.dataset.userSet = '1'; return; }
    if ((e.target.name === 'time' || e.target.name === 'due') && !f.remind.dataset.userSet) f.remind.checked = !!(f.time.value || f.due.value);
  });

  return {
    init(options) { Object.assign(cfg, options); },
    html, reminders,
    all: () => tasks,
    count: () => todays().filter(t => !isDone(t)).length,
    isTyping: () => { const a = document.activeElement; return !!(a && a.closest && a.closest('[data-mt-form]') && (a.tagName === 'SELECT' || (a.value || '').length)); },
  };
})();
