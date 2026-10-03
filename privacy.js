'use strict';

/* =========================================================
   Money privacy: Face ID / PIN lock for the Money tab,
   hidden amounts on Today & Insights, and auto-lock.

   Face ID uses the iPhone's own passkey prompt (WebAuthn), so
   the app never sees your face. The PIN is stored only as a
   salted hash. This stops people using your phone from seeing
   your spending; it is not encryption of the data itself.
   Uses globals from app.js at call time.
   ========================================================= */

const Privacy = (() => {
  const AUTO = { tab: 'When I leave Expense or the app', 1: 'After 1 minute away', 5: 'After 5 minutes away' };
  let unlockedAt = 0, awayAt = 0, fails = 0, waitUntil = 0, dlg = null, setup = null;

  const cfg = () => state.settings.privacy;
  const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fromB64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));

  // ---------- state ----------
  function isUnlocked() {
    if (!unlockedAt) return false;
    if (awayAt) {
      const mins = cfg().autoLock === 'tab' ? 0 : Number(cfg().autoLock) || 0;
      if (Date.now() - awayAt >= mins * 60000) { lockNow(); return false; }
    }
    return true;
  }
  const protectedOn = () => cfg().lock || cfg().blur;
  const locked = () => cfg().lock && !isUnlocked();          // Money tab hidden behind the lock screen
  const masked = () => cfg().blur && !isUnlocked();          // amounts on Today & Insights hidden
  function lockNow() { unlockedAt = 0; awayAt = 0; }
  function markAway() { if (unlockedAt && !awayAt) awayAt = Date.now(); }
  function markBack() { if (isUnlocked()) awayAt = 0; }
  function unlocked(msg) {
    unlockedAt = Date.now(); awayAt = 0; fails = 0;
    closeSheet();
    render();
    if (msg) toast(msg);
  }

  // ---------- amounts ----------
  const pm = n => (masked() ? '<span class="masked" data-action="reveal" role="button" aria-label="Hidden amount — tap to show">•••••</span>' : money(n));
  const pmText = n => (masked() ? '•••••' : money(n));

  // ---------- PIN ----------
  async function hashPin(pin, salt) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    return b64u(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64u(salt), iterations: 150000 }, key, 256));
  }
  async function checkPin(pin) {
    if (Date.now() < waitUntil) return 'wait';
    const ok = (await hashPin(pin, cfg().pinSalt)) === cfg().pinHash;
    if (!ok && ++fails >= 5) { waitUntil = Date.now() + 30000; fails = 0; }
    return ok;
  }
  async function savePin(pin) {
    const salt = b64u(crypto.getRandomValues(new Uint8Array(16)));
    Object.assign(cfg(), { pinSalt: salt, pinHash: await hashPin(pin, salt), pinLen: pin.length });
    save();
  }

  // ---------- Face ID (passkey) ----------
  async function faceAvailable() {
    try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
    catch { return false; }
  }
  async function registerFace() {
    try {
      const cred = await navigator.credentials.create({ publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'Juned Daily' },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'Expense lock', displayName: 'Expense lock' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        timeout: 60000, attestation: 'none',
      } });
      cfg().credId = b64u(cred.rawId); save();
      return true;
    } catch { return false; }
  }
  // must start straight from a tap
  async function faceUnlock(msg = '🔓 Unlocked') {
    try {
      await navigator.credentials.get({ publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: fromB64u(cfg().credId) }],
        userVerification: 'required', timeout: 60000,
      } });
      unlocked(msg);
      return true;
    } catch { return false; }
  }

  // Ask for Face ID (if set up), otherwise show the PIN sheet. `then` runs after unlocking.
  let pendingThen = null;
  function requireUnlock(reason, then) {
    if (!cfg().lock || isUnlocked()) { if (then) then(); return true; }
    pendingThen = then || null;
    if (cfg().credId) {
      faceUnlock().then(ok => {
        if (ok) { const t = pendingThen; pendingThen = null; if (t) t(); }
        else pinSheet(reason);
      });
    } else pinSheet(reason);
    return false;
  }

  // ---------- sheets ----------
  function sheet(html) {
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'lockSheet'; document.body.appendChild(dlg); }
    dlg.innerHTML = html;
    if (!dlg.open) dlg.showModal();
    const i = dlg.querySelector('input'); if (i) i.focus();
  }
  const closeSheet = () => { if (dlg && dlg.open) dlg.close(); };
  const pinInput = (label = 'PIN') =>
    `<input class="pin-input" name="pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="6" placeholder="••••" aria-label="${label}">`;

  function pinSheet(reason) {
    sheet(`<form class="sheet center" data-privacy="unlock">
      <div class="lock-icon">🔒</div>
      <h2>Enter your PIN</h2>
      <p class="meta">${esc(reason || 'To see your expenses')}</p>
      ${pinInput()}
      <p class="meta overdue pin-msg" aria-live="polite"></p>
      <div class="btns end"><button type="button" class="btn" data-privacy-close>Cancel</button><button class="btn primary">Unlock</button></div>
    </form>`);
  }

  function setupSheet(step, msg = '') {
    const titles = { new: 'Choose a PIN', confirm: 'Enter the PIN again', current: 'Enter your current PIN' };
    sheet(`<form class="sheet center" data-privacy="${step}">
      <div class="lock-icon">🔐</div>
      <h2>${titles[step]}</h2>
      <p class="meta">${step === 'new' ? '4–6 digits. It’s your backup if Face ID doesn’t work.' : step === 'current' ? 'To change your money lock settings' : 'Just to be sure'}</p>
      ${pinInput()}
      <p class="meta overdue pin-msg" aria-live="polite">${esc(msg)}</p>
      <div class="btns end"><button type="button" class="btn" data-privacy-close>Cancel</button><button class="btn primary">Next</button></div>
    </form>`);
  }

  async function faceOffer() {
    if (!(await faceAvailable())) { finishSetup(false); return; }
    sheet(`<div class="sheet center">
      <div class="lock-icon">😀</div>
      <h2>Use Face ID too?</h2>
      <p class="meta">Unlock Expense with a glance. Your iPhone may ask to save a passkey called “Expense lock” — that’s it.</p>
      <div class="btns end" style="margin-top:14px"><button type="button" class="btn" data-privacy-act="face-skip">Not now</button>
        <button type="button" class="btn primary" data-privacy-act="face-add">Use Face ID</button></div>
    </div>`);
  }

  function finishSetup(face) {
    cfg().lock = true;
    if (cfg().blur === undefined || setup === 'enable') cfg().blur = true;   // hide amounts too when the lock is first turned on
    save(); setup = null; unlockedAt = Date.now(); awayAt = 0;
    closeSheet(); refreshSettings(); render();
    toast(face ? '🔒 Expense locked with Face ID + PIN' : '🔒 Expense locked with your PIN');
  }

  // ---------- settings ----------
  function settingsHtml() {
    const p = cfg();
    return `<h3>🔒 Expense privacy</h3>
    <label class="toggle"><input type="checkbox" data-privacy-toggle="lock" ${p.lock ? 'checked' : ''}>
      <span><b>Lock the Expense tab</b><small>${p.lock ? (p.credId ? 'Face ID, with your PIN as backup' : 'With your PIN') : 'Face ID or a PIN to open Expense'}</small></span></label>
    <label class="toggle" style="margin-top:8px"><input type="checkbox" data-privacy-toggle="blur" ${p.blur ? 'checked' : ''}>
      <span><b>Hide amounts on Today & Insights</b><small>Shows ••••• until you unlock</small></span></label>
    ${p.lock ? `<label class="lbl">Lock again
      <select data-privacy-auto>${Object.entries(AUTO).map(([v, l]) => `<option value="${v}" ${String(p.autoLock) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="btns" style="margin-top:10px"><button type="button" class="btn" data-privacy-act="change-pin">Change PIN</button>
        <button type="button" class="btn" data-privacy-act="face-setup">${p.credId ? 'Set up Face ID again' : '😀 Set up Face ID'}</button></div>` : ''}`;
  }

  function lockScreen() {
    const p = cfg();
    return `<div class="card lock-card center">
      <div class="lock-icon">🔒</div>
      <h2>Expense is locked</h2>
      <p class="meta">Your spending is private.</p>
      ${p.credId ? '<button type="button" class="btn primary block" data-privacy-act="unlock-face">😀 Unlock with Face ID</button>' : ''}
      <form data-privacy="unlock" class="pin-form">${pinInput()}<button class="btn ${p.credId ? '' : 'primary'}">Unlock with PIN</button></form>
      <p class="meta overdue pin-msg" aria-live="polite"></p>
    </div>`;
  }

  // ---------- events ----------
  const msgIn = (f, m) => { const el = f.querySelector('.pin-msg') || document.querySelector('.pin-msg'); if (el) el.textContent = m; };

  document.addEventListener('submit', async e => {
    const f = e.target;
    if (!f.matches || !f.matches('[data-privacy]')) return;
    e.preventDefault();
    const pin = (f.pin && f.pin.value || '').trim(), step = f.dataset.privacy;
    if (step === 'unlock' || step === 'current') {
      const ok = await checkPin(pin);
      if (ok === 'wait') { msgIn(f, 'Too many tries — wait 30 seconds'); return; }
      if (!ok) { msgIn(f, 'Wrong PIN'); f.pin.value = ''; f.pin.focus(); return; }
      if (step === 'current') { unlockedAt = Date.now(); awayAt = 0; continueSetup(); return; }
      const t = pendingThen; pendingThen = null;
      unlocked('🔓 Unlocked');
      if (t) t();
    } else if (step === 'new') {
      if (!/^\d{4,6}$/.test(pin)) { msgIn(f, 'Use 4 to 6 digits'); return; }
      setup = { ...(typeof setup === 'object' && setup ? setup : { mode: setup }), pin };
      setupSheet('confirm');
    } else if (step === 'confirm') {
      if (pin !== setup.pin) { setup.pin = null; setupSheet('new', 'Those didn’t match — try again'); return; }
      await savePin(pin);
      if (setup.mode === 'change') { setup = null; closeSheet(); toast('🔐 PIN changed'); return; }
      setup = 'enable';
      faceOffer();
    }
  });

  // auto-submit when the PIN is complete
  document.addEventListener('input', e => {
    const i = e.target;
    if (!i.matches || !i.matches('.pin-input')) return;
    i.value = i.value.replace(/\D/g, '').slice(0, 6);
    const f = i.form, step = f && f.dataset.privacy;
    if ((step === 'unlock' || step === 'current') && cfg().pinLen && i.value.length === cfg().pinLen) f.requestSubmit();
  });

  let afterCurrent = null;
  function continueSetup() { const fn = afterCurrent; afterCurrent = null; closeSheet(); if (fn) fn(); }
  function askCurrent(fn) {
    if (isUnlocked()) { fn(); return; }
    afterCurrent = fn;
    if (cfg().credId) faceUnlock(null).then(ok => { if (ok) continueSetup(); else setupSheet('current'); });
    else setupSheet('current');
  }

  document.addEventListener('click', e => {
    if (e.target.closest && e.target.closest('[data-privacy-close]')) { closeSheet(); pendingThen = null; render(); return; }
    const b = e.target.closest && e.target.closest('[data-privacy-act]');
    if (!b) return;
    switch (b.dataset.privacyAct) {
      case 'unlock-face': faceUnlock().then(ok => { if (!ok) msgIn(document, 'Face ID didn’t work — use your PIN'); }); break;
      case 'face-add': registerFace().then(ok => finishSetup(ok)); break;
      case 'face-skip': finishSetup(false); break;
      case 'change-pin': askCurrent(() => { setup = 'change'; setupSheet('new'); }); break;
      case 'face-setup': askCurrent(() => registerFace().then(ok => { refreshSettings(); toast(ok ? '😀 Face ID is set up' : 'Face ID wasn’t set up'); })); break;
    }
  });

  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.privacyToggle === 'lock') {
      if (t.checked) { t.checked = false; setup = 'enable'; setupSheet('new'); }
      else {
        t.checked = true;   // only turn off after unlocking
        askCurrent(() => {
          Object.assign(cfg(), { lock: false, pinHash: '', pinSalt: '', pinLen: 0, credId: '' });
          save(); refreshSettings(); render(); toast('🔓 Expense lock turned off');
        });
      }
    } else if (t.dataset.privacyToggle === 'blur') {
      const want = t.checked;
      if (!want && cfg().lock) { t.checked = true; askCurrent(() => { cfg().blur = false; save(); refreshSettings(); render(); }); return; }
      cfg().blur = want; save(); render();
      toast(want ? '🙈 Amounts hidden on Today & Insights' : 'Amounts shown');
    } else if (t.matches && t.matches('[data-privacy-auto]')) {
      cfg().autoLock = t.value; save();
      toast(`Locks: ${AUTO[t.value].toLowerCase()}`);
    }
  });

  // lock when the app goes to the background
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { markAway(); return; }
    if (protectedOn() && !isUnlocked() && (ui.tab === 'money' || ui.tab === 'today' || ui.tab === 'insights')) render();
  });

  return {
    locked, masked, pm, pmText, lockScreen, settingsHtml, requireUnlock, markAway, markBack, isUnlocked,
    // reveal hidden amounts (asks for Face ID / PIN when the lock is on)
    reveal() {
      if (!cfg().lock) { unlockedAt = Date.now(); awayAt = 0; render(); return; }
      requireUnlock('To show your amounts');
    },
    // tapping the Money tab: ask straight away (Face ID needs a tap)
    openMoney() { if (locked() && cfg().credId) faceUnlock(); },
  };
})();
