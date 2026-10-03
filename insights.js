'use strict';

/* =========================================================
   Insights: habit heatmaps, mood & sleep, spending,
   work hours and tasks over time. Plain SVG charts that
   follow the theme colours. Tap a mark to see its value.
   Uses globals from app.js at call time.
   ========================================================= */

const INSIGHT_RANGES = { 30: '30 days', 90: '3 months' };
let insightRange = 30;

const shortDate = k => parseKey(k).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const avgOf = list => list.length ? list.reduce((s, n) => s + n, 0) / list.length : null;
const lastDays = n => Array.from({ length: n }, (_, i) => addDays(today(), i - n + 1));

// Bar with rounded ends only at the data end (top), anchored to the baseline
function barPath(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function chartFigure(title, svg, hint, extra = '') {
  return `<figure class="chart card">
    <figcaption class="chart-title">${title}</figcaption>
    ${extra}
    ${svg}
    <p class="tip meta" aria-live="polite">${hint}</p>
  </figure>`;
}

// ---------- summary tiles ----------
function insightTiles(days) {
  const set = new Set(days);
  const doneTasks = state.tasks.reduce((n, t) => n + (isRepeat(t)
    ? Object.keys(t.doneDates || {}).filter(d => set.has(d)).length
    : (t.done && set.has(t.doneAt) ? 1 : 0)), 0);
  let hPossible = 0, hDone = 0;
  for (const h of state.habits) for (const d of days) {
    if (d < createdKey(h) && !h.log[d]) continue;
    hPossible++; if (h.log[d]) hDone++;
  }
  const entries = days.map(d => state.journal[d]).filter(Boolean);
  const mood = avgOf(entries.map(e => e.mood).filter(Number.isFinite));
  const sleep = avgOf(entries.map(e => e.sleep).filter(Number.isFinite));
  const spent = sum(state.expenses.filter(e => e.type === 'out' && set.has(e.date)));
  const work = days.reduce((t, d) => t + workMin(d), 0) / 60;
  const tile = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
  return `<div class="stats stats-2">
    ${tile(doneTasks, 'Tasks done')}
    ${tile(hPossible ? `${Math.round(hDone / hPossible * 100)}%` : '—', 'Habits kept')}
    ${tile(mood ? `${MOODS[Math.round(mood) - 1]} ${mood.toFixed(1)}` : '—', 'Average mood')}
    ${tile(sleep ? `${sleep.toFixed(1)}h` : '—', 'Average sleep')}
    ${tile(Privacy.pm(spent), 'Spent')}
    ${tile(work ? `${work.toFixed(1)}h` : '—', 'Worked')}
  </div>`;
}

// ---------- habit heatmaps ----------
function bestStreak(h) {
  const days = Object.keys(h.log).sort();
  let best = 0, run = 0, prev = null;
  for (const d of days) { run = prev && addDays(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  return best;
}

function habitHeatmap(h) {
  const weeks = 13, cell = 13, gap = 3, k = today();
  const start = addDays(weekStart(k), -(weeks - 1) * 7);
  const created = createdKey(h);
  let rects = '', possible = 0, done = 0;
  for (let w = 0; w < weeks; w++) for (let d = 0; d < 7; d++) {
    const day = addDays(start, w * 7 + d);
    if (day > k) continue;
    const on = !!h.log[day], before = day < created && !on;
    if (!before) { possible++; if (on) done++; }
    const cls = on ? 'hm-on' : before ? 'hm-none' : 'hm-off';
    rects += `<rect class="${cls}" x="${w * (cell + gap)}" y="${d * (cell + gap)}" width="${cell}" height="${cell}" rx="3"
      data-tip="${esc(shortDate(day))} · ${on ? 'done ✓' : before ? 'before you started' : 'not done'}"><title>${shortDate(day)}</title></rect>`;
  }
  const W = weeks * (cell + gap) - gap, H = 7 * (cell + gap) - gap;
  const labels = ['M', '', 'W', '', 'F', '', ''].map((l, i) => l ? `<text x="-6" y="${i * (cell + gap) + cell - 2}" text-anchor="end" class="axis">${l}</text>` : '').join('');
  const svg = `<svg class="heatmap" viewBox="-14 0 ${W + 14} ${H}" role="img" aria-label="${esc(h.name)}: done ${done} of ${possible} days in the last ${weeks} weeks">${labels}${rects}</svg>`;
  const stats = `<div class="meta hm-stats">🔥 ${streak(h)} now · 🏆 best ${bestStreak(h)} · ${possible ? Math.round(done / possible * 100) : 0}% of days</div>`;
  return chartFigure(`${esc(h.emoji || '🔁')} ${esc(h.name)}`, svg, 'Last 13 weeks · tap a square', stats);
}

// ---------- mood & sleep ----------
function moodChart(days) {
  const W = 320, H = 130, L = 26, R = 6, T = 8, B = 18;
  const pts = days.map((d, i) => ({ d, i, v: state.journal[d] && state.journal[d].mood })).filter(p => Number.isFinite(p.v));
  if (pts.length < 2) return chartFigure('😊 Mood', '<p class="empty">Pick a mood on a few days (Today or Journal) to see your trend.</p>', '');
  const x = i => L + (W - L - R) * (days.length === 1 ? 0.5 : i / (days.length - 1));
  const y = v => T + (H - T - B) * (1 - (v - 1) / 4);
  const grid = [1, 2, 3, 4, 5].map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 4}" y="${y(v) + 4}" text-anchor="end">${MOODS[v - 1]}</text>`).join('');
  const line = pts.map((p, n) => `${n ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const dots = pts.map(p => `<g class="mark" data-tip="${esc(shortDate(p.d))} · ${MOODS[p.v - 1]} ${p.v}/5">
      <circle class="hit" cx="${x(p.i)}" cy="${y(p.v)}" r="10"/><circle class="dot" cx="${x(p.i)}" cy="${y(p.v)}" r="4"/></g>`).join('');
  const ends = `<text class="axis" x="${L}" y="${H - 4}">${parseKey(days[0]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</text>
    <text class="axis" x="${W - R}" y="${H - 4}" text-anchor="end">Today</text>`;
  return chartFigure('😊 Mood', `<svg viewBox="0 0 ${W} ${H}" class="plot" role="img" aria-label="Mood over the last ${days.length} days">${grid}<path class="line" d="${line}"/>${dots}${ends}</svg>`, 'Tap a point to see the day');
}

function sleepChart(days) {
  const W = 320, H = 130, L = 26, R = 6, T = 8, B = 18;
  const vals = days.map(d => (state.journal[d] && state.journal[d].sleep) || 0);
  if (vals.filter(Boolean).length < 2) return chartFigure('😴 Sleep', '<p class="empty">Log your sleep in the Journal on a few days to see this.</p>', '');
  const max = Math.max(10, ...vals), slot = (W - L - R) / days.length, bw = Math.max(2, slot - 2);
  const y = v => T + (H - T - B) * (1 - v / max);
  const grid = [0, 4, 8].filter(v => v <= max).map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 4}" y="${y(v) + 4}" text-anchor="end">${v}h</text>`).join('');
  const bars = days.map((d, i) => vals[i] ? `<g class="mark" data-tip="${esc(shortDate(d))} · ${vals[i]}h sleep">
      <rect class="hit" x="${L + i * slot}" y="${T}" width="${slot}" height="${H - T - B}"/>
      <path class="bar" d="${barPath(L + i * slot + (slot - bw) / 2, y(vals[i]), bw, y(0) - y(vals[i]), Math.min(4, bw / 2))}"/></g>` : '').join('');
  const target = `<line class="target" x1="${L}" x2="${W - R}" y1="${y(7)}" y2="${y(7)}"/><text class="axis" x="${W - R}" y="${y(7) - 4}" text-anchor="end">7h</text>`;
  return chartFigure('😴 Sleep', `<svg viewBox="0 0 ${W} ${H}" class="plot" role="img" aria-label="Hours of sleep over the last ${days.length} days">${grid}${bars}${target}</svg>`, 'Tap a bar to see the night');
}

function sleepMoodInsight(days) {
  const pairs = days.map(d => state.journal[d]).filter(e => e && Number.isFinite(e.mood) && Number.isFinite(e.sleep));
  const good = pairs.filter(e => e.sleep >= 7).map(e => e.mood), short = pairs.filter(e => e.sleep < 7).map(e => e.mood);
  if (good.length < 3 || short.length < 3) return '';
  const a = avgOf(good), b = avgOf(short), diff = a - b;
  const text = Math.abs(diff) < 0.3
    ? `Your mood is about the same whether you sleep more or less than 7 hours (${a.toFixed(1)} vs ${b.toFixed(1)}).`
    : `On days after <b>7h+ sleep</b> your mood averages <b>${a.toFixed(1)}</b>, vs <b>${b.toFixed(1)}</b> after less sleep — ${diff > 0 ? 'sleep seems to help 😴✨' : 'interesting: shorter nights haven’t hurt your mood'}.`;
  return `<div class="card insight-note">💡 ${text}</div>`;
}

// ---------- spending: this month vs last ----------
function spendingChart() {
  const k = today(), thisM = k.slice(0, 7);
  const d = parseKey(k); d.setDate(1); d.setMonth(d.getMonth() - 1);
  const lastM = dateKey(d).slice(0, 7);
  const out = state.expenses.filter(e => e.type === 'out');
  const by = m => { const o = {}; out.filter(e => e.date.startsWith(m)).forEach(e => { o[e.category] = (o[e.category] || 0) + e.amount; }); return o; };
  const a = by(thisM), b = by(lastM);
  const cats = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort((x, y) => (a[y] || 0) - (a[x] || 0) || (b[y] || 0) - (b[x] || 0));
  if (!cats.length) return chartFigure('💰 Spending by category', '<p class="empty">Log a few expenses to compare months.</p>', '');
  const ta = Object.values(a).reduce((s, n) => s + n, 0), tb = Object.values(b).reduce((s, n) => s + n, 0);
  const max = Math.max(...cats.map(c => Math.max(a[c] || 0, b[c] || 0))) || 1;
  const rowH = 30, L = 82, W = 320, R = 64, H = cats.length * rowH;
  const w = v => (W - L - R) * v / max;
  const rows = cats.map((c, i) => {
    const y0 = i * rowH;
    return `<g class="mark" data-tip="${esc(c)} · this month ${Privacy.pmText(a[c] || 0)} · last month ${Privacy.pmText(b[c] || 0)}">
      <rect class="hit" x="0" y="${y0}" width="${W}" height="${rowH}"/>
      <text class="axis label" x="${L - 8}" y="${y0 + 17}" text-anchor="end">${esc(c)}</text>
      ${a[c] ? `<rect class="bar" x="${L}" y="${y0 + 5}" width="${Math.max(2, w(a[c]))}" height="10" rx="3"/>` : ''}
      ${b[c] ? `<rect class="bar ghost" x="${L}" y="${y0 + 17}" width="${Math.max(2, w(b[c]))}" height="6" rx="3"/>` : ''}
      <text class="axis value" x="${L + Math.max(w(a[c] || 0), w(b[c] || 0)) + 6}" y="${y0 + 15}">${a[c] ? Privacy.pmText(a[c]) : '—'}</text>
    </g>`;
  }).join('');
  // fair comparison: the same days of last month (1st → today's date)
  const upTo = parseKey(k).getDate();
  const tbSame = out.filter(e => e.date.startsWith(lastM) && parseKey(e.date).getDate() <= upTo).reduce((s, e) => s + e.amount, 0);
  const change = tbSame ? Math.round((ta - tbSame) / tbSame * 100) : null;
  const head = `<div class="hero-num"><b>${Privacy.pmText(ta)}</b> <span class="meta">this month so far${change === null ? '' : ` · ${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}% vs the same days last month (${Privacy.pmText(tbSame)})`}</span></div>
    <div class="meta" style="margin-bottom:6px">Last month in total: ${Privacy.pmText(tb)}</div>
    <div class="legend"><span><i class="sw bar"></i>This month</span><span><i class="sw ghost"></i>Last month</span></div>`;
  return chartFigure('💰 Spending by category', `<svg viewBox="0 0 ${W} ${H}" class="plot" role="img" aria-label="Spending by category, this month compared with last month">${rows}</svg>`, 'Tap a category for both months', head);
}

// ---------- weekly bars (work hours, tasks done) ----------
function weeklyBars(title, valueOf, fmt, unit, target) {
  const weeks = 8, W = 320, H = 130, L = 28, R = 6, T = 10, B = 20;
  const starts = Array.from({ length: weeks }, (_, i) => addDays(weekStart(today()), (i - weeks + 1) * 7));
  const vals = starts.map(valueOf);
  if (!vals.some(Boolean)) return '';
  const max = Math.max(target || 0, ...vals) * 1.1 || 1, slot = (W - L - R) / weeks, bw = Math.min(26, slot - 6);
  const y = v => T + (H - T - B) * (1 - v / max);
  const bars = starts.map((s, i) => `<g class="mark" data-tip="Week of ${esc(parseKey(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))} · ${fmt(vals[i])}${unit}">
      <rect class="hit" x="${L + i * slot}" y="${T}" width="${slot}" height="${H - T - B}"/>
      ${vals[i] ? `<path class="bar ${i === weeks - 1 ? 'current' : ''}" d="${barPath(L + i * slot + (slot - bw) / 2, y(vals[i]), bw, y(0) - y(vals[i]))}"/>` : ''}
      <text class="axis" x="${L + i * slot + slot / 2}" y="${H - 5}" text-anchor="middle">${i === weeks - 1 ? 'Now' : parseKey(s).getDate()}</text></g>`).join('');
  const base = `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/><text class="axis" x="${L - 4}" y="${y(max / 1.1) + 4}" text-anchor="end">${fmt(max / 1.1)}</text>`;
  const tgt = target ? `<line class="target" x1="${L}" x2="${W - R}" y1="${y(target)}" y2="${y(target)}"/><text class="axis" x="${W - R}" y="${y(target) - 4}" text-anchor="end">goal ${fmt(target)}${unit}</text>` : '';
  return chartFigure(title, `<svg viewBox="0 0 ${W} ${H}" class="plot" role="img" aria-label="${esc(title)}, last ${weeks} weeks">${base}${bars}${tgt}</svg>`, 'Tap a week to see the total');
}

function insightsView() {
  const days = lastDays(insightRange);
  const tasksPerWeek = ws => { const s = new Set(Array.from({ length: 7 }, (_, i) => addDays(ws, i)));
    return state.tasks.reduce((n, t) => n + (isRepeat(t) ? Object.keys(t.doneDates || {}).filter(d => s.has(d)).length : (t.done && s.has(t.doneAt) ? 1 : 0)), 0); };
  return `
  <div class="chips range" role="radiogroup" aria-label="Period">${Object.entries(INSIGHT_RANGES).map(([v, l]) =>
    `<button type="button" class="chip ${Number(v) === insightRange ? 'on' : ''}" data-action="irange" data-v="${v}" role="radio" aria-checked="${Number(v) === insightRange}">${l}</button>`).join('')}</div>
  ${insightTiles(days)}
  ${state.habits.length ? `<h2 class="sec">🔁 Habits</h2>${state.habits.map(habitHeatmap).join('')}` : ''}
  <h2 class="sec">😊 Mood & sleep</h2>
  ${sleepMoodInsight(days)}
  ${moodChart(days)}
  ${sleepChart(days)}
  <h2 class="sec">💰 Money</h2>
  ${spendingChart()}
  ${weeklyBars('✅ Tasks completed per week', tasksPerWeek, v => Math.round(v), '') ? `<h2 class="sec">✅ Tasks & work</h2>` : ''}
  ${weeklyBars('✅ Tasks completed per week', tasksPerWeek, v => Math.round(v), '')}
  ${weeklyBars('💼 Hours worked per week', ws => Array.from({ length: 7 }, (_, i) => workMin(addDays(ws, i))).reduce((a, b) => a + b, 0) / 60,
    v => v.toFixed(v < 10 ? 1 : 0), 'h', (Number(state.settings.workHours) || 8) * 5)}
  <p class="center"><button class="link" data-action="go" data-tab="today">← Back to Today</button></p>`;
}

// Tap / hover a mark → show its value under the chart
function showTip(mark) {
  const fig = mark.closest('figure');
  if (!fig) return;
  fig.querySelectorAll('.mark.hl').forEach(m => m.classList.remove('hl'));
  mark.classList.add('hl');
  fig.querySelector('.tip').textContent = mark.dataset.tip;
}
document.addEventListener('click', e => { const m = e.target.closest && e.target.closest('figure [data-tip]'); if (m) showTip(m); });
document.addEventListener('mouseover', e => { const m = e.target.closest && e.target.closest('figure [data-tip]'); if (m) showTip(m); });
