/* =========================================================
   Juned Daily - reminder push server (Cloudflare Worker)

   Setup (Cloudflare dashboard):
   - Binding:      KV namespace, variable name  KV
   - Cron trigger: * * * * *   (every minute)

   Stores only reminder titles, times and repeat rules, the shared
   shopping list, and the push address of each device.
   Everything else stays on the phone.
   ========================================================= */

const ALLOWED_ORIGINS = ['https://junedahmed794.github.io', 'http://localhost:5173'];
const APP_URL = 'https://junedahmed794.github.io/Juned_Daily_Life/';
const PUSH_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)\//i;
const REPEATS = ['none', 'daily', 'weekdays', 'weekly', 'monthly'];
const MAX_DEVICES = 10, MAX_REMINDERS = 300;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LIST_CODE = /^[A-Za-z0-9_-]{20,64}$/;
const SECTIONS = ['Produce', 'Dairy', 'Meat', 'Bakery', 'Frozen', 'Pantry', 'Snacks', 'Drinks', 'Household', 'Pharmacy', 'Other'];
const DEFAULT_STORES = [];
const MAX_ITEMS = 300, MAX_HISTORY = 300, MAX_STAPLES = 50;

const te = new TextEncoder();
const b64u = {
  enc(buf) {
    let s = '';
    for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(str + '='.repeat((4 - (str.length % 4)) % 4));
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  },
};
const concat = (...arrs) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};

// ---------- VAPID keys (created once, kept in KV) ----------
async function vapidKeys(env) {
  let keys = await env.KV.get('vapid', 'json');
  if (!keys) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    keys = {
      jwk: await crypto.subtle.exportKey('jwk', kp.privateKey),
      publicKey: b64u.enc(await crypto.subtle.exportKey('raw', kp.publicKey)),
    };
    await env.KV.put('vapid', JSON.stringify(keys));
  }
  return keys;
}

async function vapidAuth(endpoint, keys) {
  const header = b64u.enc(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u.enc(te.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: APP_URL,
  })));
  const { key_ops, ext, ...jwk } = keys.jwk;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u.enc(sig)}, k=${keys.publicKey}`;
}

// ---------- payload encryption (RFC 8291, aes128gcm) ----------
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

async function encryptPayload(sub, text) {
  const uaPublic = b64u.dec(sub.keys.p256dh), auth = b64u.dec(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));

  const ikm = await hkdf(auth, shared, concat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key,
    concat(te.encode(text), new Uint8Array([2]))));

  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ct);
}

async function sendPush(sub, data, keys) {
  return fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuth(sub.endpoint, keys),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '3600',
      Urgency: 'high',
    },
    body: await encryptPayload(sub, JSON.stringify(data)),
  });
}

// ---------- schedule matching ----------
function localNow(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday),
    day: Number(p.day),
    lastDay: new Date(Date.UTC(Number(p.year), Number(p.month), 0)).getUTCDate(),
  };
}

function isDue(r, n) {
  if (r.time !== n.time || r.skip.includes(n.date) || (r.start && n.date < r.start)) return false;
  switch (r.repeat) {
    case 'daily': return true;
    case 'weekdays': return n.dow >= 1 && n.dow <= 5;
    case 'weekly': return n.dow === r.weekday;
    case 'monthly': return n.day === Math.min(r.monthDay, n.lastDay);
    default: return r.date === n.date;
  }
}

function cleanReminder(r) {
  if (!r || !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)) return null;
  return {
    id: String(r.id || '').slice(0, 40),
    title: String(r.title || 'Reminder').slice(0, 120),
    time: r.time,
    repeat: REPEATS.includes(r.repeat) ? r.repeat : 'none',
    weekday: Math.min(6, Math.max(0, Number(r.weekday) || 0)),
    monthDay: Math.min(31, Math.max(1, Number(r.monthDay) || 1)),
    date: DATE.test(r.date) ? r.date : null,
    start: DATE.test(r.start) ? r.start : null,
    skip: Array.isArray(r.skip) ? r.skip.filter(x => DATE.test(x)).slice(0, 10) : [],
  };
}

// ---------- shared shopping list ----------
const rid = () => b64u.enc(crypto.getRandomValues(new Uint8Array(9)));
const cleanText = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const todayUTC = () => new Date().toISOString().slice(0, 10);
const addDaysUTC = (k, n) => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const cleanPrice = v => { const n = Number(v); return v === null || v === '' || !Number.isFinite(n) || n < 0 || n > 1e6 ? null : Math.round(n * 100) / 100; };
const keyOf = name => String(name || '').trim().toLowerCase();

// Fill in anything an older list is missing
function normalizeList(list) {
  list = list || {};
  list.items = Array.isArray(list.items) ? list.items : [];
  list.history = list.history && typeof list.history === 'object' ? list.history : {};
  list.staples = Array.isArray(list.staples) ? list.staples : [];
  list.stores = Array.isArray(list.stores) ? list.stores : DEFAULT_STORES.slice();
  list.order = Array.isArray(list.order) ? list.order.filter(s => SECTIONS.includes(s)) : [];
  SECTIONS.forEach(s => { if (!list.order.includes(s)) list.order.push(s); });
  list.trips = Array.isArray(list.trips) ? list.trips : [];
  list.shopping = list.shopping || null;
  list.currency = /^[A-Z]{3}$/.test(list.currency || '') ? list.currency : 'USD';
  return list;
}

function cleanItem(x, by, list, keep = false) {
  const name = cleanText(x && x.name, 80);
  if (!name) return null;
  const store = cleanText(x.store, 30);
  return {
    id: (keep && cleanText(x.id, 20)) || rid(),
    name, qty: cleanText(x.qty, 20), note: cleanText(x.note, 120),
    cat: SECTIONS.includes(x.cat) ? x.cat : 'Other',
    store: list.stores.includes(store) ? store : '',
    price: keep ? cleanPrice(x.price) : null,
    done: keep ? !!x.done : false,
    by: cleanText(x.by || by, 30),
    at: (keep && Number(x.at)) || Date.now(),
  };
}

// Remember each item's usual section and store (used for suggestions and "Buy again")
function learn(list, it, count) {
  const k = keyOf(it.name), h = list.history[k] || { n: 0 };
  list.history[k] = { name: it.name, cat: it.cat, store: it.store, n: h.n + (count ? 1 : 0), last: todayUTC() };
  const keys = Object.keys(list.history);
  if (keys.length > MAX_HISTORY) {
    keys.sort((a, b) => (list.history[a].last || '').localeCompare(list.history[b].last || '') || list.history[a].n - list.history[b].n)
      .slice(0, keys.length - MAX_HISTORY).forEach(old => delete list.history[old]);
  }
}

// Weekly staples come back on the list when they are due
function applyStaples(list) {
  const today = todayUTC();
  let changed = false;
  for (const s of list.staples) {
    if (s.next > today) continue;
    if (!list.items.some(i => !i.done && keyOf(i.name) === s.key) && list.items.length < MAX_ITEMS) {
      list.items.push(cleanItem({ ...s, by: 'Staple' }, 'Staple', list));
    }
    s.next = addDaysUTC(today, s.every);
    changed = true;
  }
  return changed;
}

function applyListOp(list, b) {
  const by = cleanText(b.by, 30);
  const find = id => list.items.find(i => i.id === id);
  switch (b.op) {
    case 'add':
    case 'addMany': {
      const raw = b.op === 'add' ? [b.item] : (Array.isArray(b.items) ? b.items : []);
      const added = [];
      for (const x of raw.slice(0, 50)) {
        if (list.items.length >= MAX_ITEMS) break;
        const it = cleanItem(x || {}, by, list);
        if (!it) continue;
        const dup = list.items.find(i => !i.done && keyOf(i.name) === keyOf(it.name));
        if (dup) { if (it.qty && !dup.qty) dup.qty = it.qty; continue; }   // already on the list
        list.items.push(it);
        learn(list, it, true);
        added.push(it);
      }
      return { added };
    }
    case 'toggle': {
      const i = find(b.id);
      if (i) i.done = !i.done;
      return {};
    }
    case 'update': {
      const i = find(b.id), f = b.fields || {};
      if (!i) return null;
      if ('name' in f && cleanText(f.name, 80)) i.name = cleanText(f.name, 80);
      if ('qty' in f) i.qty = cleanText(f.qty, 20);
      if ('note' in f) i.note = cleanText(f.note, 120);
      if ('cat' in f && SECTIONS.includes(f.cat)) i.cat = f.cat;
      if ('store' in f) i.store = list.stores.includes(cleanText(f.store, 30)) ? cleanText(f.store, 30) : '';
      if ('price' in f) i.price = cleanPrice(f.price);
      learn(list, i, false);
      return {};
    }
    case 'remove': list.items = list.items.filter(i => i.id !== b.id); return {};
    case 'restore':   // undo
      for (const x of (Array.isArray(b.items) ? b.items : []).slice(0, MAX_ITEMS)) {
        if (!find(x.id) && list.items.length < MAX_ITEMS) { const it = cleanItem(x, by, list, true); if (it) list.items.push(it); }
      }
      return {};
    case 'clear': list.items = list.items.filter(i => !i.done); return {};
    case 'forget': delete list.history[keyOf(b.name)]; return {};   // remove from "Buy again"
    case 'wipe': list.items = []; list.staples = []; return {};   // old link retired
    case 'import':   // moving everything to a new link: only into an empty list
      if (!list.items.length && b.doc) {
        const d = normalizeList(b.doc);
        Object.assign(list, { stores: d.stores, order: d.order, history: d.history, staples: d.staples, trips: d.trips, currency: d.currency });
        list.items = d.items.slice(0, MAX_ITEMS).map(x => cleanItem(x, by, list, true)).filter(Boolean);
      }
      return {};
    case 'settings':
      if (Array.isArray(b.stores)) list.stores = [...new Set(b.stores.map(s => cleanText(s, 30)).filter(Boolean))].slice(0, 10);
      if (Array.isArray(b.order)) { list.order = b.order.filter(s => SECTIONS.includes(s)); SECTIONS.forEach(s => { if (!list.order.includes(s)) list.order.push(s); }); }
      if (/^[A-Z]{3}$/.test(b.currency || '')) list.currency = b.currency;
      list.items.forEach(i => { if (i.store && !list.stores.includes(i.store)) i.store = ''; });
      return {};
    case 'staple': {
      const k = keyOf(b.item && b.item.name);
      if (!k) return null;
      list.staples = list.staples.filter(s => s.key !== k);
      const every = Number(b.every);
      if ([7, 14, 30].includes(every)) {
        const it = cleanItem(b.item, by, list);
        list.staples.push({ key: k, name: it.name, qty: it.qty, cat: it.cat, store: it.store, note: it.note, every, next: addDaysUTC(todayUTC(), every) });
        list.staples = list.staples.slice(-MAX_STAPLES);
      }
      return {};
    }
    case 'shopping': {
      const store = list.stores.includes(cleanText(b.store, 30)) ? cleanText(b.store, 30) : '';
      list.shopping = b.on ? { by, store, at: Date.now() } : null;
      return b.on ? { notify: {
        title: `\u{1f6d2} ${by || 'Someone'} is shopping now`,
        body: `${store ? `At ${store} - ` : ''}add anything you need to the list`, tag: 'shop-now',
      } } : {};
    }
    case 'finish': {
      const bought = list.items.filter(i => i.done);
      list.items = list.items.filter(i => !i.done);
      const total = cleanPrice(b.total) || 0;
      const store = list.stores.includes(cleanText(b.store, 30)) ? cleanText(b.store, 30) : '';
      list.trips.push({ date: todayUTC(), total, store, by, count: bought.length });
      list.trips = list.trips.slice(-100);
      list.shopping = null;
      const totalText = cleanText(b.totalText, 20);
      return { notify: {
        title: '\u{2705} Shopping done',
        body: `${by || 'Someone'} got ${bought.length} item${bought.length === 1 ? '' : 's'}${store ? ` at ${store}` : ''}${totalText ? ` - ${totalText}` : ''}`,
        tag: 'shop-done',
      } };
    }
    default: return null;
  }
}

function addedMessage(added) {
  if (!added.length) return null;
  const by = added[0].by ? ` - by ${added[0].by}` : '';
  if (added.length === 1) {
    const it = added[0];
    return { title: '\u{1f6d2} Added to the shopping list', body: `${it.name}${it.qty ? ` (${it.qty})` : ''}${by}`, tag: `shop-${it.id}` };
  }
  return { title: `\u{1f6d2} ${added.length} items added`, body: `${added.map(i => i.name).join(', ').slice(0, 140)}${by}`, tag: `shop-${added[0].id}` };
}

// Tell everyone else who follows this list
async function notifyList(env, code, msg, fromDevice) {
  const devices = (await env.KV.get('devices', 'json')) || {};
  const targets = Object.entries(devices).filter(([id, d]) => id !== fromDevice && (d.lists || []).includes(code));
  if (!targets.length) return;
  const keys = await vapidKeys(env);
  await Promise.all(targets.map(([, d]) =>
    sendPush(d.subscription, { ...msg, url: d.app === 'shop' ? 'shop.html' : './' }, keys).catch(() => {})));
}

// ---------- handlers ----------
export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    };
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const path = new URL(req.url).pathname;

    try {
      if (req.method === 'GET' && path === '/') return new Response('Juned Daily reminder server is running \u{2713}', { headers: cors });
      if (req.method === 'GET' && path === '/key') return json({ publicKey: (await vapidKeys(env)).publicKey });
      if (req.method === 'GET' && path === '/list') {
        if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'forbidden' }, 403);
        const code = new URL(req.url).searchParams.get('code') || '';
        if (!LIST_CODE.test(code)) return json({ error: 'bad code' }, 400);
        const list = normalizeList(await env.KV.get(`list:${code}`, 'json'));
        if (applyStaples(list)) { list.updated = Date.now(); await env.KV.put(`list:${code}`, JSON.stringify(list)); }
        return json(list);
      }
      if (req.method !== 'POST') return json({ error: 'not found' }, 404);
      if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'forbidden' }, 403);

      const body = await req.json();

      if (path === '/list') {
        if (!LIST_CODE.test(body.code || '')) return json({ error: 'bad code' }, 400);
        const key = `list:${body.code}`;
        const list = normalizeList(await env.KV.get(key, 'json'));
        applyStaples(list);
        const result = applyListOp(list, body);
        if (!result) return json({ error: 'bad request', ...list }, 400);
        list.updated = Date.now();
        await env.KV.put(key, JSON.stringify(list));
        const msg = result.notify || (result.added && addedMessage(result.added));
        if (msg) await notifyList(env, body.code, msg, cleanText(body.device, 40));
        return json(list);
      }

      const id = String(body.id || '').slice(0, 40);
      if (!id) return json({ error: 'missing id' }, 400);
      const devices = (await env.KV.get('devices', 'json')) || {};

      if (path === '/sync') {
        const sub = body.subscription;
        if (!sub || !PUSH_HOSTS.test(String(sub.endpoint)) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
          return json({ error: 'bad subscription' }, 400);
        }
        if (!devices[id] && Object.keys(devices).length >= MAX_DEVICES) return json({ error: 'too many devices' }, 429);
        const reminders = (Array.isArray(body.reminders) ? body.reminders : [])
          .slice(0, MAX_REMINDERS).map(cleanReminder).filter(Boolean);
        devices[id] = {
          subscription: { endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } },
          tz: typeof body.tz === 'string' ? body.tz.slice(0, 64) : 'UTC',
          reminders,
          lists: (Array.isArray(body.lists) ? body.lists : []).filter(c => LIST_CODE.test(c)).slice(0, 5),
          app: body.app === 'shop' ? 'shop' : 'main',
          updated: Date.now(),
        };
        await env.KV.put('devices', JSON.stringify(devices));
        return json({ ok: true, reminders: reminders.length });
      }

      if (path === '/test') {
        const dev = devices[id];
        if (!dev) return json({ error: 'not registered' }, 404);
        const res = await sendPush(dev.subscription,
          { title: '\u{1f514} Notifications are on', body: dev.app === 'shop' ? 'You will hear about shopping list updates.' : 'Juned Daily will remind you at the times you set.', tag: 'test', url: dev.app === 'shop' ? 'shop.html' : './' },
          await vapidKeys(env));
        return json({ ok: res.ok, status: res.status });
      }

      if (path === '/unsubscribe') {
        delete devices[id];
        await env.KV.put('devices', JSON.stringify(devices));
        return json({ ok: true });
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500);
    }
  },

  // Runs every minute: send every reminder that is due at this minute in the device's time zone.
  async scheduled(event, env) {
    const devices = (await env.KV.get('devices', 'json')) || {};
    const due = [];
    for (const [id, dev] of Object.entries(devices)) {
      let now;
      try { now = localNow(event.scheduledTime, dev.tz); } catch { now = localNow(event.scheduledTime, 'UTC'); }
      for (const r of dev.reminders) if (isDue(r, now)) due.push({ id, dev, r });
    }
    if (!due.length) return;

    const keys = await vapidKeys(env);
    const gone = new Set();
    await Promise.all(due.map(async ({ id, dev, r }) => {
      try {
        const res = await sendPush(dev.subscription, { title: `\u{23f0} ${r.title}`, body: 'Reminder from Juned Daily', tag: r.id, url: './' }, keys);
        if (res.status === 404 || res.status === 410) gone.add(id);   // device unsubscribed
      } catch { /* try again next time */ }
    }));
    if (gone.size) {
      const fresh = (await env.KV.get('devices', 'json')) || {};
      gone.forEach(id => delete fresh[id]);
      await env.KV.put('devices', JSON.stringify(fresh));
    }
  },
};
