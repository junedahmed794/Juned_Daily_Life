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
document.addEventListener('click', async e => {
  const b = e.target.closest && e.target.closest('[data-refresh]');
  if (!b || b.classList.contains('spinning')) return;
  b.classList.add('spinning');
  try {
    const reg = 'serviceWorker' in navigator && await navigator.serviceWorker.getRegistration();
    if (reg) await Promise.race([reg.update(), new Promise(r => setTimeout(r, 2500))]);
  } catch { /* offline — reload what we have */ }
  location.reload();
});

// Line icons used on task rows (same style as ↻ and ☰)
const ICONS = {
  bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  bellOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.7 3A6 6 0 0 1 18 8c0 2.4.5 4.3 1.1 5.7"/><path d="M17 17H3s3-2 3-9a5 5 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6M14 11v6"/></svg>',
};
