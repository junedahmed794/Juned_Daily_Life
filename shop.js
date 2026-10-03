'use strict';

/* =========================================================
   Shared shopping list — used by the Shop tab (app.js)
   and by the shopping-only app (shop.html).
   The list lives on the reminder server, keyed by a secret
   code that is part of the share link.
   ========================================================= */

const Shop = (() => {
  // Sections in default walking order: [emoji, label]
  const SECTIONS = {
    Produce: ['🥦', 'Produce'], Dairy: ['🥛', 'Dairy & Eggs'], Meat: ['🍗', 'Meat & Fish'], Bakery: ['🍞', 'Bakery'],
    Frozen: ['🧊', 'Frozen'], Pantry: ['🥫', 'Pantry'], Snacks: ['🍪', 'Snacks'], Drinks: ['🥤', 'Drinks'],
    Household: ['🧽', 'Household'], Pharmacy: ['💊', 'Pharmacy'], Other: ['📦', 'Other'],
  };
  // Words that tell us an item's section (checked top to bottom)
  const KEYWORDS = [
    ['Frozen', 'frozen ice-cream icecream pizza fries popsicle'],
    ['Pharmacy', 'tylenol advil ibuprofen paracetamol aspirin vitamin vitamins medicine bandage bandaid band-aid cough allergy claritin zyrtec tums pepto thermometer'],
    ['Household', 'soap detergent shampoo conditioner toothpaste toothbrush tissue tissues toilet towel towels napkins foil wrap trash bleach cleaner sponge lotion deodorant razor diapers wipes batteries bulb'],
    ['Dairy', 'milk eggs egg cheese butter yogurt yoghurt curd dahi paneer cream ghee'],
    ['Meat', 'chicken beef mutton lamb goat pork turkey fish salmon shrimp prawns tuna sausage bacon ham mince keema'],
    ['Bakery', 'bread bagel bagels bun buns croissant muffin muffins tortilla tortillas pita naan roti cake'],
    ['Produce', 'apple apples banana bananas orange oranges grapes mango mangoes lemon lemons lime limes tomato tomatoes onion onions potato potatoes garlic ginger spinach lettuce carrot carrots cucumber peppers chilli chillies chili cilantro coriander mint avocado berries strawberries fruit fruits vegetables okra bhindi cauliflower cabbage broccoli'],
    ['Drinks', 'water juice soda coke pepsi 7up gatorade coffee tea chai lassi beer wine sprite'],
    ['Snacks', 'chips crisps biscuits cookies crackers chocolate candy nuts almonds cashews popcorn namkeen'],
    ['Pantry', 'rice atta flour sugar salt oil dal lentils beans chickpeas chana pasta noodles cereal oats spices masala turmeric cumin sauce ketchup jam honey vinegar besan maida sooji'],
  ].map(([sec, words]) => [sec, words.split(' ').map(w => new RegExp(`(^|[^a-z])${w.replace('-', '[ -]?')}($|[^a-z])`))]);
  const UNIT = '(?:x|kgs?|g|gm|lbs?|l|ltr|ml|oz|pcs?|packs?|dozen|doz|bottles?|cans?|box|boxes|bags?|bunch|bunches)';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const key = name => String(name || '').trim().toLowerCase();
  const blankDoc = () => ({ items: [], history: {}, staples: [], stores: [], order: Object.keys(SECTIONS), trips: [], shopping: null, currency: '' });

  const cfg = { code: '', name: '', device: '', currency: '', owner: false, onChange: () => {}, onMessage: () => {}, onLogMoney: null };
  let editBuy = false;   // "Buy again" chips show ✕ to remove them
  let doc = blankDoc(), status = 'loading', pollTimer = null, busy = 0, wakeLock = null, refocus = false, dlg = null, draftOrder = [];
  let ui = { mode: 'list', store: '' };

  // ---------- helpers ----------
  function guess(name) {
    const n = key(name);
    for (const [sec, res] of KEYWORDS) if (res.some(r => r.test(n))) return sec;
    return '';
  }
  const sectionOf = i => (SECTIONS[i.cat] ? i.cat : guess(i.name) || 'Other');
  const isStaple = i => doc.staples.some(s => s.key === key(i.name));
  const visible = list => ui.store ? list.filter(i => i.store === ui.store || !i.store) : list;
  const sum = list => list.reduce((t, i) => t + (Number(i.price) || 0), 0);

  function money(n) {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: doc.currency || cfg.currency || 'USD' }).format(n); }
    catch { return Number(n).toFixed(2); }
  }
  function currencySymbol() {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: doc.currency || cfg.currency || 'USD' }).formatToParts(0).find(p => p.type === 'currency').value; }
    catch { return '$'; }
  }
  const parsePrice = v => { const n = parseFloat(String(v).replace(/[^\d.,]/g, '').replace(',', '.')); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null; };

  // "milk, eggs, rice 5kg, 2 bread" → [{name, qty}]
  function parseItems(text) {
    return String(text).split(/[,\n;]+|\s+and\s+|\s+&\s+/i).map(s => s.trim()).filter(Boolean).map(part => {
      let name = part, qty = '', m;
      if ((m = part.match(new RegExp(`^(\\d+(?:\\.\\d+)?\\s*${UNIT}?)\\s+(.+)$`, 'i')))) { qty = m[1]; name = m[2]; }
      else if ((m = part.match(new RegExp(`^(.+?)\\s+(?:x\\s*)?(\\d+(?:\\.\\d+)?\\s*${UNIT}?)$`, 'i')))) { name = m[1]; qty = m[2]; }
      qty = qty.replace(/\s+/g, '');
      if (/^\d+(\.\d+)?x$/i.test(qty)) qty = qty.slice(0, -1);
      name = name.replace(/\s+/g, ' ').trim();
      return { name: name.charAt(0).toUpperCase() + name.slice(1), qty };
    }).filter(x => x.name);
  }

  // 2 → 3, "5kg" → "6kg", "" → "2"
  function stepQty(q, d) {
    if (!q) return d > 0 ? '2' : '';
    const m = String(q).match(/^(\d+(?:\.\d+)?)(.*)$/);
    if (!m) return q;
    const n = Math.max(1, Number(m[1]) + d);
    return n === 1 && !m[2] ? '' : `${n}${m[2]}`;
  }

  // ---------- storage ----------
  const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
  const cacheKey = () => `shop-cache:${cfg.code}`, uiKey = () => `shop-ui:${cfg.code}`;
  function normalize(d) {
    d = { ...blankDoc(), ...(d || {}) };
    d.order = (d.order || []).filter(s => SECTIONS[s]);
    Object.keys(SECTIONS).forEach(s => { if (!d.order.includes(s)) d.order.push(s); });
    return d;
  }
  const saveCache = () => lsSet(cacheKey(), JSON.stringify(doc));
  const saveUI = () => lsSet(uiKey(), JSON.stringify(ui));

  function init(options) {
    Object.assign(cfg, options);
    try { doc = normalize(JSON.parse(lsGet(cacheKey()) || 'null')); } catch { doc = blankDoc(); }
    try { ui = { mode: 'list', store: '', ...JSON.parse(lsGet(uiKey()) || '{}') }; } catch { ui = { mode: 'list', store: '' }; }
    status = doc.items.length ? 'cached' : 'loading';
    if (ui.mode === 'shopping') keepAwake(true);
  }

  // ---------- server ----------
  async function refresh() {
    if (!PUSH_SERVER || !cfg.code || busy) return;
    try {
      const res = await fetch(`${PUSH_SERVER}/list?code=${encodeURIComponent(cfg.code)}`);
      if (!res.ok) throw new Error(res.status);
      const data = normalize(await res.json());
      if (busy) return;                 // a change is on its way; its reply is newer
      const changed = JSON.stringify(data) !== JSON.stringify(doc) || status !== 'online';
      doc = data;
      status = 'online';
      saveCache();
      if (cfg.owner && cfg.currency && doc.currency !== cfg.currency) op({ op: 'settings', currency: cfg.currency });
      if (changed) cfg.onChange();
    } catch {
      if (status !== 'offline') { status = 'offline'; cfg.onChange(); }
    }
  }

  // Show the change straight away, then confirm with the server
  async function op(body, optimistic) {
    if (optimistic) { optimistic(); saveCache(); cfg.onChange(); }
    busy++;
    try {
      const res = await fetch(`${PUSH_SERVER}/list`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: cfg.code, by: cfg.name, device: cfg.device, ...body }),
      });
      const data = await res.json();
      if (data.items) { doc = normalize(data); status = 'online'; saveCache(); }
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

  // ---------- actions ----------
  function addEntries(entries) {
    const onList = new Set(doc.items.filter(i => !i.done).map(i => key(i.name)));
    const fresh = entries.filter(e => !onList.has(key(e.name)));
    if (!fresh.length) { cfg.onMessage('Already on the list'); return; }
    op({ op: 'addMany', items: fresh }, () => {
      fresh.forEach((e, n) => doc.items.push({ id: `tmp-${Date.now()}-${n}`, done: false, by: cfg.name, at: Date.now(), note: '', price: null, ...e }));
    }).then(ok => { if (ok) cfg.onMessage(fresh.length === 1 ? `Added ${fresh[0].name}` : `Added ${fresh.length} items`); });
  }

  function addText(text, cat, store) {
    addEntries(parseItems(text).map(p => {
      const h = doc.history[key(p.name)];
      return {
        name: h ? h.name : p.name, qty: p.qty,
        cat: cat !== 'auto' ? cat : (h && SECTIONS[h.cat] ? h.cat : guess(p.name) || 'Other'),
        store: store !== 'auto' ? store : (h && h.store) || ui.store || '',
      };
    }));
  }

  const toggle = id => op({ op: 'toggle', id }, () => { const i = doc.items.find(x => x.id === id); if (i) i.done = !i.done; });
  const update = (id, fields) => op({ op: 'update', id, fields }, () => { const i = doc.items.find(x => x.id === id); if (i) Object.assign(i, fields); });

  function removeItems(ids, message) {
    const gone = doc.items.filter(i => ids.includes(i.id));
    if (!gone.length) return;
    const body = ids.length === 1 ? { op: 'remove', id: ids[0] } : { op: 'clear' };
    op(body, () => { doc.items = doc.items.filter(i => !ids.includes(i.id)); });
    cfg.onMessage(message, () => op({ op: 'restore', items: gone }, () => { doc.items.push(...gone); }));
  }

  async function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch { /* not supported — fine */ }
  }

  function setMode(mode) {
    ui.mode = mode; saveUI();
    keepAwake(mode === 'shopping');
    clearInterval(pollTimer); pollTimer = null; start();
    cfg.onChange();
    window.scrollTo(0, 0);
  }

  // ---------- rendering ----------
  function suggestHtml(q) {
    const onList = new Set(doc.items.filter(i => !i.done).map(i => key(i.name)));
    const hist = Object.entries(doc.history).filter(([k]) => !onList.has(k));
    q = key(q);
    let list = [], label = '';
    if (q && !/[,;\n]/.test(q)) list = hist.filter(([k]) => k.startsWith(q) || k.includes(` ${q}`)).sort((a, b) => b[1].n - a[1].n).slice(0, 6);
    else if (!q) { list = hist.sort((a, b) => b[1].n - a[1].n || String(b[1].last).localeCompare(String(a[1].last))).slice(0, 12); label = 'Buy again'; }
    if (!list.length) { editBuy = false; return ''; }
    const editing = editBuy && !!label;
    return `${label ? `<span class="chips-label">${label}</span>
      <button type="button" class="chip edit" data-shop="buy-edit">${editing ? '✓ Done' : '✏️ Edit'}</button>` : ''}${list.map(([k, h]) => editing
      ? `<button type="button" class="chip forget" data-shop="forget" data-key="${esc(k)}" aria-label="Remove ${esc(h.name)} from Buy again">${esc(h.name)} ✕</button>`
      : `<button type="button" class="chip" data-shop="sugg" data-key="${esc(k)}">${(SECTIONS[h.cat] || SECTIONS.Other)[0]} ${esc(h.name)}</button>`).join('')}`;
  }

  function row(i, big) {
    const meta = [i.note && `📝 ${esc(i.note)}`, i.store && !ui.store && `🏬 ${esc(i.store)}`, isStaple(i) && '🔁 staple',
      i.by && i.by !== cfg.name && i.by !== 'Staple' && `by ${esc(i.by)}`].filter(Boolean).join(' · ');
    const qty = i.qty ? `<span class="qty">${esc(i.qty)}</span>` : '';
    const side = i.done
      ? `<input class="price" data-shop-price="${esc(i.id)}" inputmode="decimal" placeholder="${esc(currencySymbol())}" value="${i.price ?? ''}" aria-label="Price of ${esc(i.name)}">`
      : big ? qty
        : `<div class="stepper"><button type="button" data-shop="minus" data-id="${esc(i.id)}" aria-label="Less ${esc(i.name)}">−</button>
           <span>${esc(i.qty || '1')}</span><button type="button" data-shop="plus" data-id="${esc(i.id)}" aria-label="More ${esc(i.name)}">+</button></div>`;
    return `<li class="row srow ${i.done ? 'done' : ''} ${big ? 'big' : ''}" data-swipe="${esc(i.id)}">
      <button class="check ${i.done ? 'on' : ''} ${big ? 'big' : ''}" data-shop="toggle" data-id="${esc(i.id)}"
        aria-label="${i.done ? 'Put back' : 'Got it'}: ${esc(i.name)}"></button>
      <div class="grow tap" data-shop="edit" data-id="${esc(i.id)}">
        <div class="row-title">${esc(i.name)}${i.done ? ` ${qty}` : ''}</div>
        ${meta ? `<div class="meta">${meta}</div>` : ''}
      </div>
      ${side}
    </li>`;
  }

  function sectionsHtml(items, big) {
    return doc.order.map(sec => {
      const list = items.filter(i => sectionOf(i) === sec);
      if (!list.length) return '';
      const [emoji, label] = SECTIONS[sec];
      return `<h2 class="sec">${emoji} ${label} · ${list.length}</h2><div class="card"><ul class="list">${list.map(i => row(i, big)).join('')}</ul></div>`;
    }).join('');
  }

  function storeChips() {
    if (!doc.stores.length) return '';
    return `<div class="chips store-chips">${['', ...doc.stores].map(s =>
      `<button type="button" class="chip ${ui.store === s ? 'on' : ''}" data-shop="store" data-store="${esc(s)}">${s ? `🏬 ${esc(s)}` : 'All stores'}</button>`).join('')}</div>`;
  }

  function basketHtml(bought) {
    const total = sum(bought);
    return `<h2 class="sec">🧺 In the basket · ${bought.length}${total ? ` · ${money(total)}` : ''}</h2>
      <div class="card"><ul class="list">${bought.map(i => row(i, false)).join('')}</ul>
      <p class="meta hint">Add prices to see your trip total.</p>
      <div class="btns spread"><button type="button" class="link danger" data-shop="clear">Clear bought items</button>
        <button type="button" class="btn primary" data-shop="finish">✅ Finish trip</button></div></div>`;
  }

  function addForm(compact) {
    return `<form class="card add" data-shop-form>
      <input name="text" data-shop-add placeholder="Add items… e.g. milk, eggs, rice 5kg" autocomplete="off" enterkeyhint="done" aria-label="Add items" maxlength="400">
      <div class="chips sugg" id="shopSugg">${suggestHtml('')}</div>
      ${compact ? '' : `<div class="add-row nowrap">
        <select name="cat" aria-label="Section"><option value="auto">✨ Auto</option>${Object.entries(SECTIONS).map(([k, [e, l]]) => `<option value="${k}">${e} ${l}</option>`).join('')}</select>
        <select name="store" aria-label="Store"><option value="auto">🏬 Usual</option><option value="">Any store</option>${doc.stores.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select>
      </div>`}
      <button class="btn primary block" style="margin-top:8px">Add</button>
    </form>`;
  }

  function listHtml() {
    const open = visible(doc.items.filter(i => !i.done)), bought = doc.items.filter(i => i.done);
    const month = new Date().toISOString().slice(0, 7);
    const trips = doc.trips.filter(t => String(t.date).startsWith(month));
    const sh = doc.shopping;
    return `
      ${sh && sh.by !== cfg.name && Date.now() - sh.at < 4 * 3600e3
        ? `<div class="card banner">🛒 <b>${esc(sh.by)}</b> is shopping now${sh.store ? ` at ${esc(sh.store)}` : ''} — add anything you need.</div>` : ''}
      ${addForm(false)}
      <button type="button" class="btn primary block big-btn" data-shop="start">🛒 Start shopping${open.length ? ` · ${open.length} item${open.length === 1 ? '' : 's'}` : ''}</button>
      ${storeChips()}
      ${status === 'offline' ? '<p class="meta center">⚠️ Offline — showing the last saved list</p>' : ''}
      ${status === 'loading' ? '<p class="meta center">Loading…</p>' : ''}
      ${sectionsHtml(open, false)}
      ${!open.length && status !== 'loading' ? '<p class="empty center">Nothing on the list 🎉</p>' : ''}
      ${bought.length ? basketHtml(bought) : ''}
      ${trips.length ? `<p class="meta center insight">🧾 This month: <b>${money(trips.reduce((t, x) => t + (x.total || 0), 0))}</b> on groceries · ${trips.length} trip${trips.length === 1 ? '' : 's'}</p>` : ''}
      <p class="meta hint center">Tap an item to edit · swipe right to tick, left to remove</p>
      <p class="center"><button type="button" class="link" data-shop="settings">⚙︎ Stores & aisle order</button></p>`;
  }

  function shoppingHtml() {
    const items = visible(doc.items), open = items.filter(i => !i.done), bought = doc.items.filter(i => i.done);
    const done = items.filter(i => i.done).length, total = items.length, pct = total ? Math.round(done / total * 100) : 0;
    const spent = sum(bought);
    return `
      <div class="card shopping-head">
        <div class="card-head"><h2>🛒 Shopping${ui.store ? ` at ${esc(ui.store)}` : ''}</h2>
          <button type="button" class="link" data-shop="exit">Exit</button></div>
        <div class="progress" role="progressbar" aria-valuenow="${done}" aria-valuemax="${total}"><i style="width:${pct}%"></i></div>
        <div class="meta">${done} of ${total} in the basket${spent ? ` · ${money(spent)}` : ''}</div>
        <button type="button" class="btn primary block" data-shop="finish" style="margin-top:10px">✅ Finish trip</button>
      </div>
      ${storeChips()}
      ${sectionsHtml(open, true)}
      ${!open.length ? '<p class="empty center">Everything’s in the basket 🎉 Tap <b>Finish trip</b>.</p>' : ''}
      ${bought.length ? `<h2 class="sec">🧺 In the basket · ${bought.length}${spent ? ` · ${money(spent)}` : ''}</h2>
        <div class="card"><ul class="list">${bought.map(i => row(i, false)).join('')}</ul>
        <p class="meta hint">Add prices to see your trip total.</p></div>` : ''}
      ${addForm(true)}`;
  }

  function html() {
    const a = document.activeElement;
    refocus = !!(a && a.matches && a.matches('[data-shop-add]'));
    if (!PUSH_SERVER) return '<p class="empty center">The shopping list needs the reminder server — it isn’t connected yet.</p>';
    return ui.mode === 'shopping' ? shoppingHtml() : listHtml();
  }

  // call after the HTML is on the page
  function mounted() {
    if (refocus) { const i = document.querySelector('[data-shop-add]'); if (i) i.focus(); }
  }

  // true while someone is typing or choosing (so a refresh doesn't wipe it)
  function isTyping() {
    const a = document.activeElement;
    if (!a || !a.closest || a.closest('dialog')) return false;
    if (!a.closest('[data-shop-form], .srow')) return false;
    return a.tagName === 'SELECT' || !!(a.value || '').length;
  }

  // ---------- sheets (edit, finish, settings) ----------
  function sheet(inner) {
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'shopSheet'; document.body.appendChild(dlg); }
    dlg.innerHTML = inner;
    if (!dlg.open) dlg.showModal();
  }
  const closeSheet = () => { if (dlg && dlg.open) dlg.close(); };
  const options = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');

  function openEdit(id) {
    const i = doc.items.find(x => x.id === id);
    if (!i) return;
    const st = doc.staples.find(s => s.key === key(i.name));
    sheet(`<form class="sheet" data-shop-edit="${esc(id)}">
      <h2>Edit item</h2>
      <label class="lbl">Item<input name="name" value="${esc(i.name)}" maxlength="80" required></label>
      <div class="two">
        <label class="lbl">Quantity<input name="qty" value="${esc(i.qty)}" maxlength="20" placeholder="e.g. 2 or 5kg"></label>
        <label class="lbl">Price<input name="price" value="${i.price ?? ''}" inputmode="decimal" placeholder="optional"></label>
      </div>
      <div class="two">
        <label class="lbl">Section<select name="cat">${options(Object.entries(SECTIONS).map(([k, [e, l]]) => [k, `${e} ${l}`]), sectionOf(i))}</select></label>
        <label class="lbl">Store<select name="store">${options([['', 'Any store'], ...doc.stores.map(s => [s, s])], i.store)}</select></label>
      </div>
      <label class="lbl">Note<input name="note" value="${esc(i.note)}" maxlength="120" placeholder="e.g. organic, 2% not whole"></label>
      <label class="lbl">🔁 Weekly staple — comes back on the list by itself
        <select name="every">${options([['0', 'No'], ['7', 'Every week'], ['14', 'Every 2 weeks'], ['30', 'Every month']], String(st ? st.every : 0))}</select></label>
      <div class="btns spread" style="margin-top:18px">
        <button type="button" class="btn danger" data-shop="delete" data-id="${esc(id)}">Delete</button>
        <span class="btns"><button type="button" class="btn" data-shop="close">Cancel</button><button class="btn primary">Save</button></span>
      </div>
    </form>`);
  }

  function openFinish() {
    const bought = doc.items.filter(i => i.done);
    if (!bought.length) { cfg.onMessage('Tick what you bought first — or tap Exit'); return; }
    const total = sum(bought);
    sheet(`<form class="sheet" data-shop-finish>
      <h2>✅ Finish trip</h2>
      <p class="meta">${bought.length} item${bought.length === 1 ? '' : 's'} bought. They'll be cleared from the list and the trip saved.</p>
      <label class="lbl">Total spent (${esc(currencySymbol())})<input name="total" inputmode="decimal" value="${total ? total.toFixed(2) : ''}" placeholder="0.00"></label>
      <label class="lbl">Store<select name="store">${options([['', '—'], ...doc.stores.map(s => [s, s])], ui.store || (doc.shopping && doc.shopping.store) || '')}</select></label>
      ${cfg.onLogMoney ? '<label class="toggle" style="margin-top:14px"><input type="checkbox" name="log" checked><span>💰 Log to Money as Groceries</span></label>' : ''}
      <div class="btns end" style="margin-top:18px"><button type="button" class="btn" data-shop="close">Cancel</button><button class="btn primary">Finish</button></div>
    </form>`);
  }

  function settingsSheet() {
    sheet(`<form class="sheet" data-shop-settings>
      <h2>Stores & aisle order</h2>
      <label class="lbl">Your stores <span class="meta">(one per line)</span>
        <textarea name="stores" rows="4" placeholder="Supermarket&#10;Pharmacy">${esc(doc.stores.join('\n'))}</textarea></label>
      <span class="lbl">Aisle order — the way you walk through the store</span>
      <ul class="list order">${draftOrder.map((s, n) => `<li class="row"><span class="grow">${SECTIONS[s][0]} ${SECTIONS[s][1]}</span>
        <button type="button" class="icon-btn" data-shop="up" data-idx="${n}" aria-label="Move ${SECTIONS[s][1]} up" ${n ? '' : 'disabled'}>↑</button>
        <button type="button" class="icon-btn" data-shop="down" data-idx="${n}" aria-label="Move ${SECTIONS[s][1]} down" ${n < draftOrder.length - 1 ? '' : 'disabled'}>↓</button></li>`).join('')}</ul>
      <div class="btns end" style="margin-top:18px"><button type="button" class="btn" data-shop="close">Cancel</button><button class="btn primary">Save</button></div>
    </form>`);
  }

  // ---------- events (work in both pages) ----------
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-shop]');
    if (!b) return;
    const { shop, id } = b.dataset;
    const item = id && doc.items.find(i => i.id === id);
    switch (shop) {
      case 'toggle': toggle(id); break;
      case 'plus': case 'minus': if (item) update(id, { qty: stepQty(item.qty, shop === 'plus' ? 1 : -1) }); break;
      case 'edit': openEdit(id); break;
      case 'delete': closeSheet(); if (item) removeItems([id], `Removed ${item.name}`); break;
      case 'clear': removeItems(doc.items.filter(i => i.done).map(i => i.id), 'Cleared bought items'); break;
      case 'sugg': {
        const h = doc.history[b.dataset.key];
        if (h) addEntries([{ name: h.name, qty: '', cat: SECTIONS[h.cat] ? h.cat : 'Other', store: h.store || '' }]);
        const input = document.querySelector('[data-shop-add]');
        if (input) { input.value = ''; input.focus(); }
        break;
      }
      case 'buy-edit': {
        editBuy = !editBuy;
        const box = document.getElementById('shopSugg');
        if (box) box.innerHTML = suggestHtml('');
        break;
      }
      case 'forget': {
        const k = b.dataset.key, h = doc.history[k];
        if (!h) break;
        op({ op: 'forget', name: k }, () => { delete doc.history[k]; });
        cfg.onMessage(`Removed ${h.name} from Buy again`);
        break;
      }
      case 'store': ui.store = b.dataset.store; saveUI(); cfg.onChange(); break;
      case 'start':
        setMode('shopping');
        op({ op: 'shopping', on: true, store: ui.store });
        break;
      case 'exit': setMode('list'); op({ op: 'shopping', on: false }); break;
      case 'finish': openFinish(); break;
      case 'settings': draftOrder = doc.order.slice(); settingsSheet(); break;
      case 'up': case 'down': {
        const n = Number(b.dataset.idx), m = shop === 'up' ? n - 1 : n + 1;
        if (m < 0 || m >= draftOrder.length) break;
        const stores = dlg.querySelector('[name=stores]').value;
        [draftOrder[n], draftOrder[m]] = [draftOrder[m], draftOrder[n]];
        settingsSheet();
        dlg.querySelector('[name=stores]').value = stores;
        break;
      }
      case 'close': closeSheet(); break;
    }
  });

  document.addEventListener('submit', e => {
    const f = e.target;
    if (f.matches('[data-shop-form]')) {
      e.preventDefault();
      const text = f.text.value.trim();
      if (!text) return;
      const cat = f.cat ? f.cat.value : 'auto', store = f.store ? f.store.value : 'auto';
      f.text.value = '';                       // clear first so the screen can refresh
      addText(text, cat, store);
      const input = document.querySelector('[data-shop-add]');
      if (input) input.focus();                // keep the keyboard up for the next item
    } else if (f.matches('[data-shop-edit]')) {
      e.preventDefault();
      const id = f.dataset.shopEdit, i = doc.items.find(x => x.id === id);
      if (!i) { closeSheet(); return; }
      const fields = { name: f.name.value.trim() || i.name, qty: f.qty.value.trim(), price: parsePrice(f.price.value),
        cat: f.cat.value, store: f.store.value, note: f.note.value.trim() };
      const st = doc.staples.find(s => s.key === key(i.name));
      const every = Number(f.every.value);
      closeSheet();
      update(id, fields).then(() => {
        if (every !== (st ? st.every : 0)) {
          op({ op: 'staple', every, item: { ...i, ...fields } });
          cfg.onMessage(every ? `🔁 ${fields.name} will come back ${every === 7 ? 'every week' : every === 14 ? 'every 2 weeks' : 'every month'}` : 'No longer a staple');
        }
      });
    } else if (f.matches('[data-shop-finish]')) {
      e.preventDefault();
      const total = parsePrice(f.total.value) || 0, store = f.store.value, log = !!(f.log && f.log.checked);
      const count = doc.items.filter(i => i.done).length;
      closeSheet();
      ui.mode = 'list'; saveUI(); keepAwake(false);
      op({ op: 'finish', total, totalText: total ? money(total) : '', store }, () => { doc.items = doc.items.filter(i => !i.done); });
      if (log && total && cfg.onLogMoney) cfg.onLogMoney(total, store, count);
      cfg.onMessage(`Trip saved${total ? ` · ${money(total)}` : ''}${log && total ? ' · logged to Money' : ''} ✅`);
    } else if (f.matches('[data-shop-settings]')) {
      e.preventDefault();
      const stores = f.stores.value.split('\n').map(s => s.trim()).filter(Boolean);
      closeSheet();
      if (ui.store && !stores.includes(ui.store)) { ui.store = ''; saveUI(); }
      op({ op: 'settings', stores, order: draftOrder }, () => { doc.stores = stores; doc.order = draftOrder.slice(); });
    }
  });

  // suggestions as you type
  document.addEventListener('input', e => {
    if (!e.target.matches || !e.target.matches('[data-shop-add]')) return;
    const box = document.getElementById('shopSugg');
    if (box) box.innerHTML = suggestHtml(e.target.value);
  });

  // prices typed in the basket
  document.addEventListener('change', e => {
    const id = e.target.dataset && e.target.dataset.shopPrice;
    if (id) update(id, { price: parsePrice(e.target.value) });
  });

  // swipe right = tick, swipe left = remove
  let sw = null;
  document.addEventListener('touchstart', e => {
    const r = e.target.closest && e.target.closest('[data-swipe]');
    if (!r || e.target.closest('input, select, .stepper')) return;
    sw = { r, x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, on: false };
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!sw) return;
    const dx = e.touches[0].clientX - sw.x, dy = e.touches[0].clientY - sw.y;
    if (!sw.on) {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) sw.on = true;
      else if (Math.abs(dy) > 12) { sw = null; return; }
    }
    if (sw.on) {
      sw.dx = dx;
      sw.r.style.transform = `translateX(${dx}px)`;
      sw.r.classList.toggle('swipe-right', dx > 70);
      sw.r.classList.toggle('swipe-left', dx < -70);
    }
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (!sw) return;
    const { r, dx, on } = sw;
    sw = null;
    r.style.transform = '';
    r.classList.remove('swipe-right', 'swipe-left');
    if (!on) return;
    const id = r.dataset.swipe, item = doc.items.find(i => i.id === id);
    if (!item) return;
    if (dx > 70) toggle(id);
    else if (dx < -70) removeItems([id], `Removed ${item.name}`);
  });

  // ---------- polling ----------
  function start() {
    if (pollTimer) return;
    refresh();
    pollTimer = setInterval(() => { if (!document.hidden) refresh(); }, ui.mode === 'shopping' ? 5000 : 10000);
  }
  function stop() { clearInterval(pollTimer); pollTimer = null; }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (pollTimer) refresh();
    if (ui.mode === 'shopping') keepAwake(true);
  });

  const newCode = () => {
    const b = crypto.getRandomValues(new Uint8Array(18));
    return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  return {
    init, refresh, start, stop, html, mounted, isTyping, newCode,
    wipe: () => op({ op: 'wipe' }),
    importDoc: d => op({ op: 'import', doc: d }),
    get items() { return doc.items; },
    get doc() { return doc; },
    get mode() { return ui.mode; },
    _test: { parseItems, guess, stepQty },
  };
})();
