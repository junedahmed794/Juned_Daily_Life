'use strict';

/* =========================================================
   Quick add: one box that understands plain language.
   "pay rent tomorrow 9am"  → task with a reminder
   "lunch 12.50"            → expense
   "slept 7h, feeling good" → journal
   "buy milk, eggs"         → shopping list
   "water done"             → habit ticked
   "clock in"               → office hours
   Uses globals from app.js at call time.
   ========================================================= */

const QUICK_TYPES = { auto: '✨ Auto', task: '✅ Task', expense: '💸 Expense', income: '💵 Income', journal: '📓 Journal', shop: '🛒 Shopping', work: '💼 Work task' };
let quickType = 'auto';

const Q_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const Q_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const Q_DAY = '(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday)?';
const Q_SPEND = {
  Food: 'lunch dinner breakfast brunch coffee tea snack snacks food restaurant pizza burger takeout takeaway cafe',
  Groceries: 'groceries grocery supermarket',
  Transport: 'uber lyft taxi cab bus train metro subway gas fuel petrol parking toll',
  Bills: 'rent bill bills electricity electric water internet wifi phone netflix spotify subscription insurance',
  Shopping: 'clothes shoes amazon shopping',
  Health: 'doctor medicine pharmacy gym dentist',
  Fun: 'movie movies cinema game games concert',
};
const Q_MOODS = [
  [5, /\b(great|amazing|awesome|fantastic|excellent|wonderful)\b/i],
  [4, /\b(good|happy|fine|nice|productive|calm)\b/i],
  [3, /\b(okay|ok|meh|average|alright|so-so)\b/i],
  [2, /\b(tired|sad|bad|stressed|low|anxious|down)\b/i],
  [1, /\b(awful|terrible|horrible|depressed|miserable)\b/i],
];

const qCap = s => { s = s.replace(/\s+/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };

// Find an amount like 12.50, $12, ₹500, 40 dollars
function qAmount(text) {
  const m = text.match(/(?:^|\s)((?:[$£€₹]|rs\.?\s?)?(\d{1,6}(?:[.,]\d{1,2})?)(?:\s*(?:[$£€₹]|dollars?|usd|rs|rupees?|pounds?|euros?))?)(?=[\s,.!]|$)/i);
  if (!m) return null;
  return { value: Number(m[2].replace(',', '.')), raw: m[1], marked: /[$£€₹]|rs|dollar|usd|rupee|pound|euro/i.test(m[1]) || /[.,]\d/.test(m[2]) };
}

function qSpendCategory(text) {
  const t = text.toLowerCase();
  for (const [cat, words] of Object.entries(Q_SPEND)) if (words.split(' ').some(w => new RegExp(`\\b${w}\\b`).test(t))) return cat;
  return 'Other';
}

// Pull a date, time and repeat rule out of task text
function qWhen(text) {
  let s = ` ${text} `, date = null, time = '', repeat = 'none', weekday, monthDay;
  const k = today();
  const cut = re => { const m = s.match(re); if (m) s = s.replace(m[0], ' '); return m; };
  let m;

  // repeat
  if (cut(/\b(every ?day|daily|each day)\b/i)) repeat = 'daily';
  else if (cut(/\b(every weekday|weekdays|on weekdays|mon(day)?\s*(-|to)\s*fri(day)?)\b/i)) repeat = 'weekdays';
  else if ((m = cut(new RegExp(`\\b(?:every|each) ${Q_DAY}\\b`, 'i')))) { repeat = 'weekly'; weekday = Q_DAYS.findIndex(d => d.startsWith(m[1].toLowerCase().slice(0, 3))); }
  else if (cut(/\b(every week|weekly)\b/i)) repeat = 'weekly';
  else if (cut(/\b(every month|monthly)\b/i)) repeat = 'monthly';

  // time
  if ((m = cut(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?=\W)/i))) {
    let h = Number(m[1]) % 12; if (/p/i.test(m[3])) h += 12;
    time = `${pad(h)}:${m[2] || '00'}`;
  } else if ((m = cut(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/))) time = `${pad(Number(m[1]))}:${m[2]}`;
  else if ((m = cut(/\bat\s+(\d{1,2})\b(?!\s*(?:days?|weeks?))/i))) {
    let h = Number(m[1]); if (h >= 1 && h <= 7) h += 12;   // "at 5" usually means 5pm
    if (h <= 23) time = `${pad(h)}:00`;
  } else if (cut(/\bnoon\b/i)) time = '12:00';
  else if ((m = cut(/\b(this|in the|tomorrow|tmrw)\s+(morning|afternoon|evening)\b/i))) {
    time = { morning: '09:00', afternoon: '14:00', evening: '18:00' }[m[2].toLowerCase()];
    if (/^t(omorrow|mrw)/i.test(m[1])) date = addDays(k, 1);
  }
  if (/\btonight\b/i.test(s)) { cut(/\btonight\b/i); date = k; if (!time) time = '20:00'; }

  // date
  if (date) { /* already set by "tomorrow morning" */ }
  else if (cut(/\btoday\b/i)) date = k;
  else if (cut(/\b(tomorrow|tmrw|tmr)\b/i)) date = addDays(k, 1);
  else if ((m = cut(/\bin (\d{1,2}) days?\b/i))) date = addDays(k, Number(m[1]));
  else if ((m = cut(/\bin (\d{1,2}) weeks?\b/i))) date = addDays(k, Number(m[1]) * 7);
  else if (cut(/\bnext week\b/i)) date = addDays(k, 7);
  else if ((m = cut(new RegExp(`\\b(?:on\\s+)?(next\\s+)?${Q_DAY}\\b`, 'i')))) {
    const wd = Q_DAYS.findIndex(d => d.startsWith(m[2].toLowerCase().slice(0, 3)));
    let diff = (wd - parseKey(k).getDay() + 7) % 7;
    if (m[1]) diff = diff || 7;   // "next friday" on a Friday = a week away; "friday" = today
    date = addDays(k, diff);
  } else if ((m = cut(new RegExp(`\\b(?:on\\s+)?(${Q_MONTHS.join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i')))
    || (m = cut(new RegExp(`\\b(?:on\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${Q_MONTHS.join('|')})[a-z]*\\b`, 'i')))) {
    const [mon, day] = /\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
    const now = parseKey(k);
    let d = new Date(now.getFullYear(), Q_MONTHS.indexOf(mon.toLowerCase().slice(0, 3)), Number(day));
    if (dateKey(d) < k) d = new Date(now.getFullYear() + 1, d.getMonth(), d.getDate());
    date = dateKey(d);
  } else if (repeat === 'monthly' && (m = cut(/\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)?\b/i))) monthDay = Math.min(31, Number(m[1]));

  if (repeat === 'weekly' && weekday === undefined) weekday = parseKey(date || k).getDay();
  if (repeat === 'monthly' && !monthDay) monthDay = parseKey(date || k).getDate();
  // a one-time task with a time that has already passed today → tomorrow
  if (repeat === 'none' && time && !date) date = atTime(k, time) > Date.now() ? k : addDays(k, 1);

  const title = qCap(s.replace(/\b(at|on|by)\s*$/i, '').replace(/^\s*(at|on)\b/i, ''));
  return { title, date, time, repeat, weekday, monthDay };
}

// Decide what the text is and pull out the details
function parseQuick(raw, forced = 'auto') {
  let text = raw.trim();
  if (!text) return null;
  const low = text.toLowerCase();
  let type = forced;

  if (type === 'auto') {
    const amt = qAmount(text);
    const habit = state.habits.find(h => low.includes(h.name.toLowerCase()) || low.split(/\s+/)[0] === h.name.toLowerCase().split(/\s+/)[0]);
    if (/^clock\s*(in|out)\b/i.test(text)) type = 'clock';
    else if (/^(buy|get|shop|shopping|grab|pick up)\b[:\s]/i.test(text) || /^add .+ to (the )?(shopping )?list$/i.test(text)) type = 'shop';
    else if (/^(work|office)\s*:/i.test(text)) type = 'work';
    else if (habit && /\b(done|did|finished|completed|✓|✔)\b/i.test(text)) type = 'habit';
    else if (/^(slept|sleep|mood|feeling|felt|today was|journal|diary|dear diary)\b/i.test(text) || /\bslept\s+\d/i.test(text)) type = 'journal';
    else if (amt && state.settings.trackIncome && /\b(salary|paycheck|pay check|got paid|income|received|refund|bonus)\b/i.test(text)) type = 'income';
    else if (amt && !/\b(at|am|pm|tomorrow|today|tonight|every|daily|remind)\b/i.test(text)
      && (amt.marked || /^(spent|paid|bought)\b/i.test(text) || qSpendCategory(text) !== 'Other')) type = 'expense';
    else type = 'task';
  }

  if (type === 'clock') return { type, action: /out/i.test(text) ? 'out' : 'in' };
  if (type === 'habit') {
    const h = state.habits.find(x => low.includes(x.name.toLowerCase())) || state.habits.find(x => low.split(/\s+/)[0] === x.name.toLowerCase().split(/\s+/)[0]);
    return h ? { type, habit: h } : { ...parseQuick(text, 'task') };
  }
  if (type === 'shop') return { type, items: text.replace(/^(buy|get|shop|shopping|grab|pick up)\b[:\s]*/i, '').replace(/^add (.+) to (the )?(shopping )?list$/i, '$1') };
  if (type === 'work') { const w = qWhen(text.replace(/^(work|office)\s*:\s*/i, '')); return { type, title: w.title, due: w.date }; }
  if (type === 'expense' || type === 'income') {
    const amt = qAmount(text);
    if (!amt) return { type, error: 'Add an amount, e.g. “lunch 12.50”' };
    let note = text.replace(amt.raw, ' ').replace(/^(spent|paid|bought|got paid|received)\b/i, '').replace(/\b(on|for)\s*$/i, '');
    const yesterday = /\byesterday\b/i.test(note);
    note = qCap(note.replace(/\byesterday\b/i, '').replace(/^\s*(on|for)\b/i, ''));
    const category = type === 'income' ? (/\b(salary|paycheck|pay check|got paid)\b/i.test(text) ? 'Salary' : 'Other') : qSpendCategory(text);
    return { type, amount: Math.round(amt.value * 100) / 100, category, note, date: yesterday ? addDays(today(), -1) : today() };
  }
  if (type === 'journal') {
    const sleep = text.match(/\bslept\s+(\d{1,2}(?:\.\d)?)\s*(?:h|hrs?|hours?)?\b/i) || text.match(/\b(\d{1,2}(?:\.\d)?)\s*(?:h|hrs?|hours?) (?:of )?sleep\b/i);
    const mood = (Q_MOODS.find(([, re]) => re.test(text)) || [])[0];
    const energy = text.match(/\benergy\s*(?:is\s*)?([1-5])\b/i);
    const note = qCap(text.replace(/^(journal|diary|dear diary)\s*:?\s*/i, ''));
    return { type, sleep: sleep ? Number(sleep[1]) : null, mood: mood || null, energy: energy ? Number(energy[1]) : null, note };
  }
  // task
  const remindAsked = /^remind me (to\s+)?/i.test(text);
  const w = qWhen(text.replace(/^remind me (to\s+)?/i, ''));
  if (!w.title) return { type: 'task', error: 'What’s the task?' };
  // a time or a date means a reminder (9:00 AM, or the next hour today, when no time was said)
  const remind = !!w.time || !!w.date || remindAsked;
  if (remind && !w.time) {
    if (w.repeat === 'none') Object.assign(w, defaultReminder(w.date));
    else w.time = '09:00';
  }
  return { type: 'task', ...w, remind };
}

function quickPreview(p) {
  if (!p) return '<p class="meta">Type something above — it will show here how it’ll be saved.</p>';
  if (p.error) return `<p class="meta overdue">${esc(p.error)}</p>`;
  const chip = s => `<span class="qchip">${s}</span>`;
  switch (p.type) {
    case 'task': return [chip('✅ Task'), chip(`“${esc(p.title)}”`), p.repeat !== 'none' ? chip(repeatLabel(p)) : p.date ? chip(fmtDate(p.date)) : '',
      p.time ? chip(`🕘 ${fmtHM(p.time)}`) : '', p.time ? chip(p.remind ? (state.settings.notify ? '🔔 Reminder' : '🔔 Reminder (turn on notifications)') : '🔕 No reminder') : ''].join('');
    case 'expense': return [chip('💸 Expense'), chip(money(p.amount)), chip(p.category), p.note ? chip(`“${esc(p.note)}”`) : '', p.date !== today() ? chip(fmtDate(p.date)) : ''].join('');
    case 'income': return [chip('💵 Income'), chip(money(p.amount)), chip(p.category), p.note ? chip(`“${esc(p.note)}”`) : ''].join('');
    case 'journal': return [chip('📓 Journal · today'), p.mood ? chip(`Mood ${MOODS[p.mood - 1]}`) : '', p.sleep ? chip(`😴 ${p.sleep}h sleep`) : '',
      p.energy ? chip(`⚡ Energy ${p.energy}/5`) : '', chip('📝 Added to notes')].join('');
    case 'shop': {
      const items = Shop._test.parseItems(p.items);
      return PUSH_SERVER ? [chip('🛒 Shopping'), ...items.map(i => chip(esc(i.name) + (i.qty ? ` (${esc(i.qty)})` : '')))].join('') : '<p class="meta overdue">The shopping list isn’t connected.</p>';
    }
    case 'habit': return [chip('🔁 Habit'), chip(`${esc(p.habit.emoji || '')} ${esc(p.habit.name)} — done today`)].join('');
    case 'clock': return chip(p.action === 'in' ? (openShift() ? '💼 Already clocked in' : '💼 Clock in now') : (openShift() ? '💼 Clock out now' : '💼 Not clocked in'));
    case 'work': return [chip('💼 Work task'), chip(`“${esc(p.title)}”`), p.due ? chip(`Due ${fmtDate(p.due)}`) : ''].join('');
  }
  return '';
}

function openQuick() {
  quickType = 'auto';
  const dlg = $('#sheet');
  dlg.classList.remove('full');
  dlg.innerHTML = `<form class="sheet quick-sheet" data-quick>
    <h2>Quick add</h2>
    <input name="q" placeholder="${esc(firstName() ? `What’s next, ${firstName()}?` : 'Type anything…')}" autocomplete="off" enterkeyhint="done" aria-label="What do you want to add?">
    <div class="chips qtypes" role="radiogroup" aria-label="Type">${Object.entries(QUICK_TYPES).filter(([k]) => k !== 'income' || state.settings.trackIncome).map(([k, l]) =>
      `<button type="button" class="chip ${k === 'auto' ? 'on' : ''}" data-qtype="${k}" role="radio" aria-checked="${k === 'auto'}">${l}</button>`).join('')}</div>
    <div class="qpreview" id="qpreview" aria-live="polite">${quickPreview(null)}</div>
    <p class="meta qexamples">Try: <b>pay rent tomorrow 9am</b> · <b>lunch 12.50</b> · <b>slept 7h, feeling good</b> ·
      <b>buy milk, eggs</b> · <b>water done</b> · <b>gym every weekday 6pm</b> · <b>clock in</b>${state.settings.trackIncome ? ' · <b>salary 3200</b>' : ''}</p>
    <div class="btns end" style="margin-top:14px"><button type="button" class="btn" data-action="close-sheet">Cancel</button>
      <button class="btn primary">Add</button></div>
  </form>`;
  if (!dlg.open) dlg.showModal();
  dlg.querySelector('[name=q]').focus();
}

function refreshQuick() {
  const f = $('form[data-quick]');
  if (f) $('#qpreview').innerHTML = quickPreview(parseQuick(f.q.value, quickType));
}

// Save it. Returns a short message for the toast.
function commitQuick(p) {
  const before = dayProgress();
  switch (p.type) {
    case 'task':
      state.tasks.push({
        id: uid(), title: p.title, created: Date.now(), repeat: p.repeat,
        due: p.repeat === 'none' ? p.date : null, time: p.time, remind: !!(p.remind && p.time),
        weekday: p.repeat === 'weekly' ? p.weekday : undefined, monthDay: p.repeat === 'monthly' ? p.monthDay : undefined,
        done: false, doneAt: null, doneDates: {},
      });
      save();
      return `✅ Task added${p.time && p.remind ? ` · 🔔 ${fmtHM(p.time)}` : ''}`;
    case 'expense': case 'income':
      state.expenses.push({ id: uid(), type: p.type === 'income' ? 'in' : 'out', amount: p.amount, category: p.category, note: p.note, date: p.date, created: Date.now() });
      save();
      return `${p.type === 'income' ? '💵 Income' : '💸 Expense'} of ${money(p.amount)} logged${p.type === 'expense' ? budgetNote(p.category, p.date) : ''}`;
    case 'journal': {
      const k = today(), e = state.journal[k] || {};
      if (p.mood) setJournal(k, 'mood', p.mood);
      if (p.sleep) setJournal(k, 'sleep', p.sleep);
      if (p.energy) setJournal(k, 'energy', p.energy);
      setJournal(k, 'text', e.text ? `${e.text}\n${p.note}` : p.note);
      return '📓 Added to today’s journal';
    }
    case 'shop': Shop.add(p.items); return null;   // the list shows its own message
    case 'habit': {
      const k = today();
      if (p.habit.log[k]) return `${p.habit.emoji || '🔁'} ${p.habit.name} was already done today`;
      p.habit.log[k] = true; save();
      if (!celebrateStreak(p.habit)) celebrateDay(before);
      return `${p.habit.emoji || '🔁'} ${p.habit.name} — done!`;
    }
    case 'clock': {
      const sh = openShift();
      if (p.action === 'in') {
        if (sh) return '💼 You’re already clocked in';
        state.office.shifts.push({ id: uid(), date: today(), start: Date.now(), end: null, breakMin: 0 }); save();
        return `💼 Clocked in at ${fmtTime(Date.now())}`;
      }
      if (!sh) return '💼 You’re not clocked in';
      sh.end = Date.now(); save();
      return `💼 Clocked out · ${fmtDur(shiftMin(sh))}`;
    }
    case 'work':
      state.office.tasks.push({ id: uid(), title: p.title, priority: 'med', due: p.due || null, done: false, doneAt: null, created: Date.now() });
      save();
      return '💼 Work task added';
  }
  return null;
}

document.addEventListener('input', e => { if (e.target.matches && e.target.matches('form[data-quick] [name=q]')) refreshQuick(); });

document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-qtype]');
  if (!b) return;
  quickType = b.dataset.qtype;
  document.querySelectorAll('[data-qtype]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
  refreshQuick();
  $('form[data-quick] [name=q]').focus();
});

document.addEventListener('submit', e => {
  const f = e.target;
  if (!f.matches || !f.matches('form[data-quick]')) return;
  e.preventDefault();
  const p = parseQuick(f.q.value, quickType);
  if (!p) return;
  if (p.error) { refreshQuick(); return; }
  if (p.type === 'shop' && !PUSH_SERVER) return;
  $('#sheet').close();
  const msg = commitQuick(p);
  render();
  if (msg) toast(msg);
});
