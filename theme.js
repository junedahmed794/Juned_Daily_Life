'use strict';

/* Colour themes — shared by the main app and the shopping app.
   The choice is kept per phone (localStorage "theme"). */

const THEMES = {
  auto: { name: 'Auto', hint: 'Follows your iPhone', swatch: ['#f5f5f8', '#1e1f23', '#4f46e5'] },
  light: { name: 'White', hint: 'Clean and bright', swatch: ['#f5f5f8', '#ffffff', '#4f46e5'] },
  charcoal: { name: 'Charcoal', hint: 'Soft dark grey', swatch: ['#1e1f23', '#2a2b31', '#9b95ff'] },
  cream: { name: 'Cream', hint: 'Warm and cosy', swatch: ['#f5efe2', '#fffaf1', '#9a5b2e'] },
};

function currentTheme() {
  try { const t = localStorage.getItem('theme'); return THEMES[t] ? t : 'auto'; } catch { return 'auto'; }
}

function applyTheme(t) {
  if (!THEMES[t]) t = 'auto';
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch { /* ignore */ }
  // match the iPhone status bar to the page
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && document.body) meta.content = getComputedStyle(document.body).backgroundColor;
}

function themePickerHtml() {
  const cur = currentTheme();
  return `<div class="themes" role="radiogroup" aria-label="Theme">${Object.entries(THEMES).map(([key, t]) => `
    <button type="button" class="theme-opt ${key === cur ? 'on' : ''}" role="radio" aria-checked="${key === cur}" data-theme-pick="${key}">
      <span class="swatch">${t.swatch.map(c => `<i style="background:${c}"></i>`).join('')}</span>
      <span><b>${t.name}</b><small>${t.hint}</small></span>
    </button>`).join('')}</div>`;
}

document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-theme-pick]');
  if (!b) return;
  applyTheme(b.dataset.themePick);
  b.closest('.themes').outerHTML = themePickerHtml();
});

// keep the status bar right when the phone switches light/dark in Auto
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(currentTheme()));
document.addEventListener('DOMContentLoaded', () => applyTheme(currentTheme()));

// No pinch-to-zoom (iPhone ignores the viewport setting on its own)
['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));

// ↻ Refresh: fetch the newest version of the app and the latest shared data, stay on the same screen
let refreshing = false;
async function refreshApp() {
  if (refreshing) return;
  refreshing = true;
  document.querySelectorAll('[data-refresh]').forEach(b => b.classList.add('spinning'));
  try {
    const reg = 'serviceWorker' in navigator && await navigator.serviceWorker.getRegistration();
    if (reg) await Promise.race([reg.update(), new Promise(r => setTimeout(r, 2500))]);
  } catch { /* offline — reload what we have */ }
  location.reload();
}
document.addEventListener('click', e => {
  if (e.target.closest && e.target.closest('[data-refresh]')) refreshApp();
});

// Pull down from the top of the page to refresh (same as ↻)
(() => {
  const PULL = 70;   // how far to pull (px) before letting go refreshes
  let start = null, ind = null;
  const indicator = () => {
    if (!ind) {
      ind = document.createElement('div');
      ind.className = 'ptr';
      ind.setAttribute('aria-hidden', 'true');
      ind.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      document.body.appendChild(ind);
    }
    return ind;
  };
  const hide = () => { if (ind) { ind.classList.remove('pulling', 'ready'); ind.style.transform = ''; ind.style.opacity = ''; } };
  document.addEventListener('touchstart', e => {
    start = null;
    if (refreshing || e.touches.length > 1 || window.scrollY > 0 || document.querySelector('dialog[open]')) return;
    if (e.target.closest && e.target.closest('input, textarea, select, .tabs')) return;
    start = { x: e.touches[0].clientX, y: e.touches[0].clientY, on: false, dy: 0 };
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!start) return;
    const dx = e.touches[0].clientX - start.x, dy = e.touches[0].clientY - start.y;
    if (!start.on) {
      if (dy > 10 && dy > Math.abs(dx) * 1.5 && window.scrollY <= 0) start.on = true;
      else if (Math.abs(dx) > 10 || dy < -10) { start = null; return; }
      else return;
    }
    start.dy = dy;
    const pull = Math.min(dy * 0.55, PULL * 1.3), el = indicator();
    el.classList.add('pulling');
    el.style.transform = `translate(-50%, ${pull}px) rotate(${dy * 2.2}deg)`;
    el.style.opacity = Math.min(1, dy / PULL);
    el.classList.toggle('ready', dy * 0.55 >= PULL * 0.75);
  }, { passive: true });
  const end = () => {
    if (!start) return;
    const go = start.on && start.dy * 0.55 >= PULL * 0.75;
    start = null;
    if (go) { ind.classList.remove('pulling'); ind.classList.add('spin'); refreshApp(); } else hide();
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', () => { start = null; hide(); });
})();

// Line icons used on task rows (same style as ↻ and ☰)
const ICONS = {
  bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  bellOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.7 3A6 6 0 0 1 18 8c0 2.4.5 4.3 1.1 5.7"/><path d="M17 17H3s3-2 3-9a5 5 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6M14 11v6"/></svg>',
};
