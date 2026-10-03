'use strict';

/* =========================================================
   Swipe gestures for the main app.
   - On a list row: swipe right = done, swipe left = delete
     (rows say which with data-sw-r / data-sw-l = the action
     of a button inside the row, which is then "tapped").
   - Anywhere else on the page: swipe left / right to move
     to the next / previous tab in the bottom bar.
   The shopping list has its own row swipes (shop.js).
   Uses globals from app.js at call time.
   ========================================================= */

(() => {
  const ROW = 70;    // px a row must travel to count
  const TAB = 60;    // px the page must travel to change tab
  let g = null;

  // Tabs in bottom-bar order (Today first)
  const barTabs = () => ['today', ...OPTIONAL_TABS.filter(tabShown)];

  // Is the finger on something that scrolls sideways (chips, charts…)?
  function inSideScroller(el) {
    for (; el && el !== document.body; el = el.parentElement) {
      if (el.scrollWidth > el.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
    }
    return false;
  }

  document.addEventListener('touchstart', e => {
    g = null;
    if (e.touches.length > 1 || document.querySelector('dialog[open]')) return;
    const t = e.target;
    if (!t.closest || t.closest('input, textarea, select, .tabs, [data-swipe], .chart, .stepper')) return;
    const row = t.closest('[data-sw-r], [data-sw-l]');
    if (!row && (!barTabs().includes(ui.tab) || inSideScroller(t))) return;
    g = { row, x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, on: false };
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!g) return;
    const dx = e.touches[0].clientX - g.x, dy = e.touches[0].clientY - g.y;
    if (!g.on) {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        g.on = true;
        if (g.row) g.row.classList.add('swiping');
        else $('#view').classList.add('swiping');
      } else if (Math.abs(dy) > 12) { g = null; return; }
      else return;
    }
    g.dx = dx;
    if (g.row) {
      // only move the way(s) this row allows
      const r = g.row.dataset.swR, l = g.row.dataset.swL;
      const x = (dx > 0 && !r) || (dx < 0 && !l) ? dx * 0.15 : dx;
      g.row.style.transform = `translateX(${x}px)`;
      g.row.classList.toggle('swipe-right', !!r && dx > ROW);
      g.row.classList.toggle('swipe-left', !!l && dx < -ROW);
    } else {
      const list = barTabs(), i = list.indexOf(ui.tab);
      const edge = (dx > 0 && i === 0) || (dx < 0 && i === list.length - 1);
      $('#view').style.transform = `translateX(${dx * (edge ? 0.12 : 0.35)}px)`;
    }
  }, { passive: true });

  function endRow({ row, dx }) {
    row.classList.remove('swiping', 'swipe-right', 'swipe-left');
    const action = dx > ROW ? row.dataset.swR : dx < -ROW ? row.dataset.swL : '';
    const btn = action && row.querySelector(`[data-action="${action}"]`);
    if (!btn) { row.style.transform = ''; return; }
    if (dx < 0) {
      // slide the row away, then delete (with Undo)
      row.style.transform = 'translateX(-110%)';
      setTimeout(() => btn.click(), 160);
    } else {
      row.style.transform = '';
      btn.click();
    }
  }

  function endPage({ dx }) {
    const view = $('#view');
    view.classList.remove('swiping');
    const list = barTabs(), i = list.indexOf(ui.tab);
    const next = dx < -TAB ? list[i + 1] : dx > TAB ? list[i - 1] : null;
    if (!next) { view.style.transform = ''; return; }
    if (next === 'money') Privacy.openMoney();   // Face ID needs to start from the finger lifting
    view.style.transform = '';
    go(next);
    view.classList.remove('slide-from-left', 'slide-from-right');
    void view.offsetWidth;
    view.classList.add(dx < 0 ? 'slide-from-right' : 'slide-from-left');
  }

  document.addEventListener('touchend', () => {
    if (!g) return;
    const s = g;
    g = null;
    if (!s.on) return;
    if (s.row) endRow(s); else endPage(s);
  });
  document.addEventListener('touchcancel', () => {
    if (!g) return;
    if (g.row) { g.row.style.transform = ''; g.row.classList.remove('swiping', 'swipe-right', 'swipe-left'); }
    $('#view').style.transform = '';
    $('#view').classList.remove('swiping');
    g = null;
  });
  $('#view').addEventListener('animationend', e => e.currentTarget.classList.remove('slide-from-left', 'slide-from-right'));
})();
