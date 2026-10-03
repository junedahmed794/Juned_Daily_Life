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
