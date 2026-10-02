'use strict';

/* =========================================================
   Shared shopping list — used by the Shop tab (app.js)
   and by the shopping-only app (shop.html).
   The list lives on the reminder server, keyed by a secret
   code that is part of the share link.
   ========================================================= */

const Shop = (() => {
  const CATS = { Groceries: '🥦', Household: '🧽', Pharmacy: '💊', Other: '📦' };
  const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const cfg = { code: '', name: '', device: '', onChange: () => {}, onMessage: () => {} };
  let items = [], status = 'loading', pollTimer = null, busy = 0, lastCat = 'Groceries';

  const cacheKey = () => `shop-cache:${cfg.code}`;
  function loadCache() {
    try { items = JSON.parse(localStorage.getItem(cacheKey()) || '[]'); } catch { items = []; }
  }
  function saveCache() {
    try { localStorage.setItem(cacheKey(), JSON.stringify(items)); } catch { /* ignore */ }
  }

  function init(options) {
    Object.assign(cfg, options);
    loadCache();
    status = items.length ? 'cached' : 'loading';
  }

  async function refresh() {
    if (!PUSH_SERVER || !cfg.code || busy) return;
    try {
      const res = await fetch(`${PUSH_SERVER}/list?code=${encodeURIComponent(cfg.code)}`);
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      if (busy) return;                 // a change is on its way; its reply is newer
      const changed = JSON.stringify(data.items) !== JSON.stringify(items) || status !== 'online';
      items = data.items || [];
      status = 'online';
      saveCache();
      if (changed) cfg.onChange();
    } catch {
      if (status !== 'offline') { status = 'offline'; cfg.onChange(); }
    }
  }

  // Apply the change on screen straight away, then confirm with the server
  async function op(body, optimistic) {
    if (optimistic) { optimistic(); saveCache(); cfg.onChange(); }
    busy++;
    try {
      const res = await fetch(`${PUSH_SERVER}/list`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: cfg.code, by: cfg.name, device: cfg.device, ...body }),
      });
      const data = await res.json();
      if (data.items) { items = data.items; status = 'online'; saveCache(); }
      if (!res.ok) cfg.onMessage('That didn’t save — please try again');
      return res.ok;
    } catch {
      cfg.onMessage('No internet — the change was not saved');
      status = 'offline';
      return false;
    } finally {
      busy--;
      cfg.onChange();
    }
  }

  const add = (name, qty, cat) => op({ op: 'add', item: { name, qty, cat } },
    () => items.push({ id: `tmp-${Date.now()}`, name, qty, cat, done: false, by: cfg.name, at: Date.now() }));
  const toggle = id => op({ op: 'toggle', id }, () => { const i = items.find(x => x.id === id); if (i) i.done = !i.done; });
  const remove = id => op({ op: 'remove', id }, () => { items = items.filter(x => x.id !== id); });
  const clearBought = () => op({ op: 'clear' }, () => { items = items.filter(x => !x.done); });
  const importItems = list => op({ op: 'import', items: list });
  const wipe = () => op({ op: 'wipe' });

  function start() {
    if (pollTimer) return;
    refresh();
    pollTimer = setInterval(() => { if (!document.hidden) refresh(); }, 10000);
  }
  function stop() { clearInterval(pollTimer); pollTimer = null; }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && pollTimer) refresh(); });

  function row(i) {
    return `<li class="row ${i.done ? 'done' : ''}">
      <button class="check ${i.done ? 'on' : ''}" data-shop="toggle" data-id="${escHtml(i.id)}"
        aria-label="${i.done ? 'Put back on the list' : 'Mark bought'}: ${escHtml(i.name)}"></button>
      <div class="grow"><div class="row-title">${escHtml(i.name)}${i.qty ? ` <span class="qty">${escHtml(i.qty)}</span>` : ''}</div>
        ${i.by && i.by !== cfg.name ? `<div class="meta">added by ${escHtml(i.by)}</div>` : ''}</div>
      <button class="icon-btn" data-shop="remove" data-id="${escHtml(i.id)}" aria-label="Remove ${escHtml(i.name)}">×</button>
    </li>`;
  }

  function html() {
    if (!PUSH_SERVER) return '<p class="empty" style="text-align:center">The shopping list needs the reminder server — it isn’t connected yet.</p>';
    const open = items.filter(i => !i.done), bought = items.filter(i => i.done);
    const groups = Object.keys(CATS).map(c => [c, open.filter(i => (CATS[i.cat] ? i.cat : 'Other') === c)]).filter(([, l]) => l.length);
    return `
    <form class="card add" data-shop-form>
      <input name="name" placeholder="Add an item… e.g. Milk" required autocomplete="off" aria-label="Item" maxlength="80">
      <div class="add-row nowrap">
        <input name="qty" placeholder="Qty" autocomplete="off" aria-label="Quantity" maxlength="20" style="max-width:96px">
        <select name="cat" aria-label="Category">${Object.entries(CATS).map(([c, e]) => `<option value="${c}" ${c === lastCat ? 'selected' : ''}>${e} ${c}</option>`).join('')}</select>
        <button class="btn primary">Add</button>
      </div>
    </form>
    ${status === 'offline' ? '<p class="meta" style="text-align:center">⚠️ Offline — showing the last saved list</p>' : ''}
    ${status === 'loading' ? '<p class="meta" style="text-align:center">Loading…</p>' : ''}
    ${groups.map(([c, l]) => `<h2 class="sec">${CATS[c]} ${c} · ${l.length}</h2>
      <div class="card"><ul class="list">${l.map(row).join('')}</ul></div>`).join('')}
    ${!open.length && status !== 'loading' ? '<p class="empty" style="text-align:center">Nothing on the list 🎉</p>' : ''}
    ${bought.length ? `<h2 class="sec">🧺 In the basket · ${bought.length}</h2>
      <div class="card"><ul class="list">${bought.map(row).join('')}</ul>
      <button class="link danger" data-shop="clear">Clear bought items</button></div>` : ''}`;
  }

  // ---------- events (work in both pages) ----------
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-shop]');
    if (!b) return;
    const { shop, id } = b.dataset;
    if (shop === 'toggle') toggle(id);
    else if (shop === 'remove') remove(id);
    else if (shop === 'clear' && confirm('Remove all bought items from the list?')) clearBought();
  });

  document.addEventListener('submit', e => {
    const f = e.target.closest('form[data-shop-form]');
    if (!f) return;
    e.preventDefault();
    const name = f.name.value.trim();
    if (!name) return;
    const qty = f.qty.value.trim(), cat = f.cat.value;
    lastCat = cat;
    f.name.value = ''; f.qty.value = '';      // clear first so the screen can refresh
    add(name, qty, cat).then(ok => { if (ok) cfg.onMessage(`Added ${name}`); });
    const input = document.querySelector('form[data-shop-form] input[name=name]');
    if (input) input.focus();                 // keep the keyboard up for the next item
  });

  // true while someone is typing in the add-item form (so a refresh doesn't wipe it)
  const isTyping = () => !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('form[data-shop-form]')
    && (document.activeElement.value || '').length);

  const newCode = () => {
    const b = crypto.getRandomValues(new Uint8Array(18));
    return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  return { init, refresh, start, stop, html, importItems, wipe, isTyping, newCode, get items() { return items; } };
})();
