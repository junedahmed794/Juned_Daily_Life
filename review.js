'use strict';

/* =========================================================
   Weekly review: your week at a glance, compared with the
   week before, with highlights and what's coming up.
   Uses globals from app.js at call time.
   ========================================================= */

let reviewWeek = null;   // Monday of the week being shown

// On Sunday show this week; other days show last week
function defaultReviewWeek() {
  const k = today(), ws = weekStart(k);
  return parseKey(k).getDay() === 0 ? ws : addDays(ws, -7);
}

function compareTile(label, now, before, fmt, goodWhenUp = true) {
  let delta = '';
  if (now !== null && before !== null && now !== before) {
    const up = now > before, good = up === goodWhenUp;
    delta = `<span class="delta ${good ? 'pos' : 'neg'}">${up ? '▲' : '▼'} ${fmt(Math.abs(now - before), true)}</span>`;
  }
  return `<div class="stat"><b>${now === null ? '—' : fmt(now)}</b><span>${label}</span>${delta}</div>`;
}

function reviewView() {
  const ws = reviewWeek || defaultReviewWeek(), we = addDays(ws, 6), prevWs = addDays(ws, -7);
  const s = weekStats(ws), p = weekStats(prevWs), k = today();
  const isCurrent = ws === weekStart(k);
  const pct = v => (v === null ? null : Math.round(v * 100));
  const hidden = Privacy.masked();

  // highlights
  const hl = [];
  const habits = s.habits.filter(h => h.possible).sort((a, b) => b.done / b.possible - a.done / a.possible);
  if (habits.length) hl.push(`🏆 Best habit: <b>${esc(habits[0].label)}</b> — ${habits[0].done} of ${habits[0].possible} days`);
  const streaky = state.habits.map(h => [h, streak(h)]).sort((a, b) => b[1] - a[1])[0];
  if (streaky && streaky[1] >= 3) hl.push(`🔥 Longest streak: <b>${esc(streaky[0].emoji || '')} ${esc(streaky[0].name)}</b> — ${streaky[1]} days`);
  const busiest = s.daily.slice().sort((a, b) => b.tasks - a.tasks)[0];
  if (busiest && busiest.tasks) hl.push(`📈 Most productive: <b>${parseKey(busiest.date).toLocaleDateString(undefined, { weekday: 'long' })}</b> — ${busiest.tasks} task${busiest.tasks === 1 ? '' : 's'} done`);
  const moodDay = s.daily.filter(d => d.mood).sort((a, b) => b.mood - a.mood)[0];
  if (moodDay) hl.push(`😊 Best mood: <b>${parseKey(moodDay.date).toLocaleDateString(undefined, { weekday: 'long' })}</b> ${MOODS[moodDay.mood - 1]}`);
  if (s.cats.length) hl.push(`💸 Top spending: <b>${esc(s.cats[0][0])}</b>${hidden ? '' : ` — ${money(s.cats[0][1])}`}`);
  if (s.office.overtime >= 30) hl.push(`💼 Overtime: <b>${fmtDur(s.office.overtime)}</b> — remember to rest`);
  const trips = (Shop.doc.trips || []).filter(t => t.date >= ws && t.date <= we);
  if (trips.length) hl.push(`🛒 ${trips.length} shopping trip${trips.length === 1 ? '' : 's'}`);
  const chores = (Shop.doc.chores || []).filter(c => c.done && c.doneBy === state.settings.name && c.doneAt && dateKey(new Date(c.doneAt)) >= ws && dateKey(new Date(c.doneAt)) <= we);
  if (chores.length) hl.push(`🏠 ${chores.length} chore${chores.length === 1 ? '' : 's'} done`);

  // coming up in the 7 days after this week
  const from = isCurrent ? k : addDays(we, 1), to = addDays(from, 7);
  const bills = state.bills.filter(b => b.next >= from && b.next <= to).sort((a, b) => a.next.localeCompare(b.next));
  const tasks = state.tasks.filter(t => !isRepeat(t) && !t.done && t.due && t.due >= from && t.due <= to).sort((a, b) => a.due.localeCompare(b.due));
  const myChores = (Shop.doc.chores || []).filter(c => !c.done && (!c.who || c.who === state.settings.name));
  const upcoming = [
    ...bills.map(b => `🧾 <b>${esc(b.name)}</b>${hidden ? '' : ` ${money(b.amount)}`} — ${fmtDate(b.next)}`),
    ...tasks.slice(0, 6).map(t => `✅ ${esc(t.title)} — ${fmtDate(t.due)}`),
    ...myChores.slice(0, 4).map(c => `🏠 ${esc(c.title)}${c.due ? ` — ${fmtDate(c.due)}` : ''}`),
  ];

  const title = isCurrent ? 'This week so far' : ws === addDays(weekStart(k), -7) ? 'Last week' : 'Week in review';
  return `
  <div class="card review-head">
    <div class="month-nav">
      <button data-action="review-week" data-delta="-1" aria-label="Previous week">‹</button>
      <div class="center"><strong>${title}</strong><div class="meta">${fmtRange(ws, we)}</div></div>
      <button data-action="review-week" data-delta="1" aria-label="Next week" ${isCurrent ? 'disabled' : ''}>›</button>
    </div>
    <p class="review-msg">${reviewMessage(s, p)}</p>
  </div>

  <h2 class="sec">Compared with the week before</h2>
  <div class="stats stats-2">
    ${compareTile('Tasks done', s.tasksDone, p.tasksDone, v => Math.round(v))}
    ${compareTile('Habits kept', pct(s.habitPct), pct(p.habitPct), v => `${v}%`)}
    ${compareTile('Spent', hidden ? null : s.spent, hidden ? null : p.spent, v => money(v), false)}
    ${compareTile('Hours worked', s.office.total ? s.office.total / 60 : null, p.office.total ? p.office.total / 60 : null, v => `${v.toFixed(1)}h`)}
    ${compareTile('Average mood', s.avgMood, p.avgMood, v => v.toFixed(1))}
    ${compareTile('Average sleep', s.avgSleep, p.avgSleep, v => `${v.toFixed(1)}h`)}
  </div>

  ${hl.length ? `<h2 class="sec">✨ Highlights</h2><div class="card"><ul class="plain">${hl.map(h => `<li>${h}</li>`).join('')}</ul></div>` : ''}
  ${upcoming.length ? `<h2 class="sec">📅 Coming up</h2><div class="card"><ul class="plain">${upcoming.map(u => `<li>${u}</li>`).join('')}</ul></div>` : ''}

  <div class="btns center-btns">
    <button class="btn" data-action="report" data-week="${ws}">📊 Excel report</button>
    <button class="btn" data-action="go" data-tab="insights">Insights →</button>
  </div>`;
}

function reviewMessage(s, p) {
  const name = firstName();
  if (!s.tasksDone && s.habitPct === null && !s.spent) return `A quiet week${name ? `, ${esc(name)}` : ''}. Next week is a fresh start 🌱`;
  const parts = [];
  if (s.tasksDone > p.tasksDone) parts.push(`you got <b>${s.tasksDone - p.tasksDone} more tasks</b> done than the week before`);
  if (s.habitPct !== null && p.habitPct !== null && s.habitPct > p.habitPct) parts.push('your habits improved');
  if (!Privacy.masked() && p.spent && s.spent < p.spent) parts.push(`you spent <b>${money(p.spent - s.spent)} less</b>`);
  if (parts.length) return `Nice${name ? `, ${esc(name)}` : ''} — ${parts.join(', ')} 👏`;
  return `Here’s how your week went${name ? `, ${esc(name)}` : ''}.`;
}

document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-action="review-week"]');
  if (!b) return;
  const ws = reviewWeek || defaultReviewWeek(), next = addDays(ws, Number(b.dataset.delta) * 7);
  if (next <= weekStart(today())) { reviewWeek = next; render(); }
});
