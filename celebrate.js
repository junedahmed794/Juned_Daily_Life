'use strict';

/* =========================================================
   Progress ring for the day + celebrations (confetti).
   Uses globals from app.js at call time.
   ========================================================= */

const STREAK_MILESTONES = [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365];
let lastRingPct = null;   // so the ring animates from where it was

// Today's tasks + habits: how many, how many done
function dayProgress() {
  const k = today();
  const tasks = todaysTasks(), habits = state.habits;
  const tDone = tasks.filter(t => isDone(t, k)).length, hDone = habits.filter(h => h.log[k]).length;
  const total = tasks.length + habits.length, done = tDone + hDone;
  return { tasks: tasks.length, tDone, habits: habits.length, hDone, total, done, pct: total ? done / total : 0 };
}

function ringSvg(pct, size = 104, stroke = 11) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, mid = size / 2;
  const from = lastRingPct === null ? pct : lastRingPct;
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${stroke}"/>
    <circle class="ring-fill ${pct >= 1 ? 'full' : ''}" cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke-width="${stroke}"
      stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - from)).toFixed(1)}"
      data-to="${(c * (1 - pct)).toFixed(1)}" transform="rotate(-90 ${mid} ${mid})"/>
  </svg>`;
}

// call after the ring is on the page
function animateRing(pct) {
  const el = document.querySelector('.ring-fill');
  lastRingPct = pct;
  if (!el) return;
  requestAnimationFrame(() => requestAnimationFrame(() => { el.style.strokeDashoffset = el.dataset.to; }));
}

function dayMessage(p) {
  if (!p.total) return 'A fresh day — add a task or a habit';
  if (p.pct >= 1) return 'All done — amazing! 🎉';
  if (p.pct >= 0.75) return 'Almost there!';
  if (p.pct >= 0.4) return 'Good progress — keep going 💪';
  if (p.done) return 'Nice start!';
  return 'Let’s get started';
}

// The next task today that has a time still ahead
function nextUp() {
  const now = Date.now();
  return todaysTasks().filter(t => t.time && !isDone(t) && atTime(today(), t.time) > now)
    .sort((a, b) => a.time.localeCompare(b.time))[0] || null;
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const css = getComputedStyle(document.documentElement);
  const colors = [css.getPropertyValue('--accent'), css.getPropertyValue('--good'), '#f59e0b', '#ec4899', '#06b6d4'].map(c => c.trim());
  const cv = Object.assign(document.createElement('canvas'), { className: 'confetti' });
  document.body.appendChild(cv);
  const dpr = window.devicePixelRatio || 1, W = innerWidth, H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  const parts = Array.from({ length: 150 }, (_, i) => ({
    x: W / 2 + (Math.random() - 0.5) * 40, y: H * 0.32,
    vx: (Math.random() - 0.5) * 13, vy: -Math.random() * 13 - 4,
    s: 5 + Math.random() * 5, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.35, c: colors[i % colors.length],
  }));
  const start = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.32; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
      ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    if (t - start < 2400) requestAnimationFrame(frame); else cv.remove();
  })(start);
}

// Call with progress from before a tick; celebrates if the tick finished the day
function celebrateDay(before) {
  const after = dayProgress();
  if (after.total && after.pct >= 1 && before.pct < 1) {
    confetti();
    toast('🎉 Everything done for today — well done!');
    return true;
  }
  return false;
}

function celebrateStreak(h) {
  const s = streak(h);
  if (!h.log[today()] || !STREAK_MILESTONES.includes(s)) return false;
  confetti();
  toast(`🔥 ${s}-day streak: ${h.emoji || ''} ${h.name}!`);
  return true;
}
