'use strict';

/* =========================================================
   Budgets (monthly, per category) and recurring bills
   (rent, phone, subscriptions) for the Expense tab.
   Uses globals from app.js at call time.
   ========================================================= */

const BILL_EVERY = { week: 'Every week', '2weeks': 'Every 2 weeks', month: 'Every month', year: 'Every year' };
const BILL_REMIND = { 0: 'On the day', 1: '1 day before', 2: '2 days before', 3: '3 days before', 7: '1 week before' };

// ---------- budgets ----------
function spentIn(cat, month) {
  return state.expenses.filter(e => e.type === 'out' && e.category === cat && e.date.startsWith(month)).reduce((t, e) => t + e.amount, 0);
}

function budgetLevel(pct) { return pct >= 1 ? 'over' : pct >= 0.75 ? 'warn' : 'ok'; }

// A short note to add to the "expense logged" message when a budget is nearly used up
function budgetNote(cat, date) {
  const limit = Number(state.budgets[cat]) || 0;
  if (!limit) return '';
  const spent = spentIn(cat, date.slice(0, 7)), pct = spent / limit;
  if (pct >= 1) return ` · 🔴 ${cat} is over budget (${Privacy.pmText(spent)} of ${Privacy.pmText(limit)})`;
  if (pct >= 0.9) return ` · 🟠 ${cat}: ${Math.round(pct * 100)}% of budget used`;
  return '';
}

function budgetsCard(month) {
  const cats = CATS.out.filter(c => Number(state.budgets[c]) > 0);
  const total = cats.reduce((t, c) => t + Number(state.budgets[c]), 0);
  if (!cats.length) return `<div class="card">
      <div class="card-head"><h2>🎯 Budgets</h2></div>
      <p class="meta">Set a monthly limit for each category — the bar turns orange near the limit and red when you go over.</p>
      <button class="btn block" data-action="budgets-edit">Set budgets</button></div>`;
  const spentTotal = cats.reduce((t, c) => t + spentIn(c, month), 0);
  return `<div class="card">
    <div class="card-head"><h2>🎯 Budgets</h2><button class="link" data-action="budgets-edit">Edit</button></div>
    <div class="meta">${money(spentTotal)} of ${money(total)} budgeted this month</div>
    <div class="budgets">${cats.map(c => {
      const limit = Number(state.budgets[c]), spent = spentIn(c, month), pct = spent / limit, lvl = budgetLevel(pct);
      return `<div class="budget ${lvl}">
        <div class="budget-top"><span>${esc(c)}</span><span class="amt">${money(spent)} <span class="meta">of ${money(limit)}</span></span></div>
        <div class="bar"><i style="width:${Math.min(100, pct * 100).toFixed(1)}%"></i></div>
        <div class="meta">${lvl === 'over' ? `🔴 Over by ${money(spent - limit)}` : `${Math.round(pct * 100)}% used · ${money(limit - spent)} left`}</div>
      </div>`;
    }).join('')}</div>
  </div>`;
}

function openBudgets() {
  const dlg = $('#sheet');
  dlg.classList.remove('full');
  dlg.innerHTML = `<form class="sheet" data-budgets>
    <h2>🎯 Monthly budgets</h2>
    <p class="meta">Leave a box empty for no limit.</p>
    <div class="budget-inputs">${CATS.out.map(c => `<label class="lbl">${esc(c)}
      <input name="${esc(c)}" inputmode="decimal" placeholder="No limit" value="${state.budgets[c] || ''}"></label>`).join('')}</div>
    <div class="btns end" style="margin-top:16px"><button type="button" class="btn" data-action="close-sheet">Cancel</button><button class="btn primary">Save</button></div>
  </form>`;
  if (!dlg.open) dlg.showModal();
}

// ---------- bills ----------
const lastDayOf = (y, m) => new Date(y, m + 1, 0).getDate();

function advanceBill(b) {
  const d = parseKey(b.next);
  if (b.every === 'week') return addDays(b.next, 7);
  if (b.every === '2weeks') return addDays(b.next, 14);
  if (b.every === 'year') return dateKey(new Date(d.getFullYear() + 1, d.getMonth(), Math.min(b.day, lastDayOf(d.getFullYear() + 1, d.getMonth()))));
  const y = d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear(), m = (d.getMonth() + 1) % 12;
  return dateKey(new Date(y, m, Math.min(b.day, lastDayOf(y, m))));
}

function dueLabel(k) {
  const diff = Math.round((parseKey(k) - parseKey(today())) / 864e5);
  if (diff < 0) return `<span class="overdue">Overdue · ${fmtDate(k)}</span>`;
  if (diff === 0) return '<span class="due-soon">Due today</span>';
  if (diff === 1) return '<span class="due-soon">Due tomorrow</span>';
  if (diff <= 7) return `Due in ${diff} days`;
  return `Due ${fmtDate(k)}`;
}

function billsCard() {
  const bills = state.bills.slice().sort((a, b) => a.next.localeCompare(b.next));
  const month = today().slice(0, 7);
  const dueThisMonth = bills.filter(b => b.next.startsWith(month)).reduce((t, b) => t + b.amount, 0);
  return `<div class="card">
    <div class="card-head"><h2>📅 Bills</h2><button class="link" data-action="bill-new">+ Add bill</button></div>
    ${bills.length ? `<div class="meta">${money(dueThisMonth)} still due this month</div>
    <ul class="list">${bills.map(b => `<li class="row">
      <div class="grow tap" data-action="bill-edit" data-id="${b.id}">
        <div class="row-title">${esc(b.name)} <span class="amt">${money(b.amount)}</span></div>
        <div class="meta">${dueLabel(b.next)} · ${BILL_EVERY[b.every] || ''}</div>
      </div>
      <button class="btn small" data-action="bill-paid" data-id="${b.id}">Paid ✓</button>
    </li>`).join('')}</ul>`
    : '<p class="meta">Add rent, phone, internet, subscriptions… You’ll get a reminder before each one is due, and one tap logs it as paid.</p>'}
  </div>`;
}

function openBill(id) {
  const b = state.bills.find(x => x.id === id) || { name: '', amount: '', category: 'Bills', every: 'month', next: today(), remind: 2 };
  const dlg = $('#sheet');
  dlg.classList.remove('full');
  dlg.innerHTML = `<form class="sheet" data-bill="${id || ''}">
    <h2>${id ? 'Edit bill' : '📅 New bill'}</h2>
    <label class="lbl">Name<input name="name" value="${esc(b.name)}" maxlength="60" required placeholder="e.g. Rent, Phone, Netflix"></label>
    <div class="two">
      <label class="lbl">Amount<input name="amount" inputmode="decimal" value="${b.amount}" required placeholder="0.00"></label>
      <label class="lbl">Category<select name="category">${CATS.out.map(c => `<option ${c === b.category ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    </div>
    <div class="two">
      <label class="lbl">${id ? 'Next due' : 'First due date'}<input type="date" name="next" value="${b.next}" required></label>
      <label class="lbl">Repeats<select name="every">${Object.entries(BILL_EVERY).map(([v, l]) => `<option value="${v}" ${v === b.every ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <label class="lbl">Remind me<select name="remind">${Object.entries(BILL_REMIND).map(([v, l]) => `<option value="${v}" ${Number(v) === Number(b.remind) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    ${state.settings.notify ? '' : '<p class="meta hint">Turn on notifications (☰ Menu → Notifications) to get bill reminders.</p>'}
    <div class="btns spread" style="margin-top:16px">
      ${id ? `<button type="button" class="btn danger" data-action="bill-delete" data-id="${id}">Delete</button>
        <button type="button" class="btn" data-action="bill-skip" data-id="${id}">Skip this one</button>` : '<span></span>'}
      <span class="btns"><button type="button" class="btn" data-action="close-sheet">Cancel</button><button class="btn primary">Save</button></span>
    </div>
  </form>`;
  if (!dlg.open) dlg.showModal();
}

function payBill(id) {
  const b = state.bills.find(x => x.id === id);
  if (!b) return;
  const date = today();
  state.expenses.push({ id: uid(), type: 'out', amount: b.amount, category: b.category, note: b.name, date, created: Date.now(), bill: b.id });
  const was = b.next;
  b.lastPaid = date; b.next = advanceBill(b);
  save(); render();
  toast(`✅ ${b.name} paid · next ${fmtDate(b.next)}${budgetNote(b.category, date)}`, () => {
    state.expenses = state.expenses.filter(e => !(e.bill === b.id && e.date === date && e.amount === b.amount && e.note === b.name));
    b.next = was; save(); render();
  });
}

// Reminders sent by the server: a few days before (if chosen) and on the day
function billReminders() {
  const k = today(), hide = Privacy.masked() || state.settings.privacy.lock;
  return state.bills.flatMap(b => {
    const body = hide ? 'Tap to see it and mark it paid.' : `${money(b.amount)} · tap to mark it paid`;
    const base = { kind: 'nudge', repeat: 'none', time: '09:00', start: k, bodyDate: '', url: './?tab=money', skip: [], body, fallback: body };
    const out = [];
    const pre = addDays(b.next, -Number(b.remind || 0));
    if (Number(b.remind) > 0 && pre >= k) out.push({ ...base, id: `bill-${b.id}-pre`, date: pre, title: `🧾 ${b.name} due ${fmtDate(b.next).toLowerCase() === 'tomorrow' ? 'tomorrow' : `in ${b.remind} day${b.remind == 1 ? '' : 's'}`}` });
    if (b.next >= k) out.push({ ...base, id: `bill-${b.id}-due`, date: b.next, title: `🧾 ${b.name} is due today` });
    return out;
  });
}

// ---------- events ----------
document.addEventListener('submit', e => {
  const f = e.target;
  if (f.matches && f.matches('form[data-budgets]')) {
    e.preventDefault();
    const next = {};
    CATS.out.forEach(c => { const v = parseAmount(f[c].value); if (v) next[c] = v; });
    state.budgets = next; save(); $('#sheet').close(); render();
    toast(Object.keys(next).length ? '🎯 Budgets saved' : 'Budgets cleared');
  } else if (f.matches && f.matches('form[data-bill]')) {
    e.preventDefault();
    const amount = parseAmount(f.amount.value);
    if (!amount) { toast('Enter the bill amount'); return; }
    const id = f.dataset.bill, next = f.next.value || today();
    const data = { name: f.name.value.trim(), amount, category: f.category.value, every: f.every.value, next, day: parseKey(next).getDate(), remind: Number(f.remind.value) };
    if (id) Object.assign(state.bills.find(b => b.id === id), data);
    else state.bills.push({ id: uid(), created: Date.now(), ...data });
    save(); $('#sheet').close(); render();
    toast(`📅 ${data.name} — ${dueLabel(next).replace(/<[^>]+>/g, '').toLowerCase()}`);
  }
});

document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-action]');
  if (!b) return;
  const id = b.dataset.id;
  switch (b.dataset.action) {
    case 'budgets-edit': openBudgets(); break;
    case 'bill-new': openBill(null); break;
    case 'bill-edit': openBill(id); break;
    case 'bill-paid': payBill(id); break;
    case 'bill-skip': {
      const bill = state.bills.find(x => x.id === id);
      if (bill) { bill.next = advanceBill(bill); save(); $('#sheet').close(); render(); toast(`Skipped · next ${fmtDate(bill.next)}`); }
      break;
    }
    case 'bill-delete': {
      const bill = state.bills.find(x => x.id === id);
      if (bill) { $('#sheet').close(); removeWithUndo('bills', id, 'Bill'); }   // Undo instead of "Are you sure?"
      break;
    }
  }
});
