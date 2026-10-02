/* =========================================================
   Juned Daily — reminder push server (Cloudflare Worker)

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
const SHOP_CATS = ['Groceries', 'Household', 'Pharmacy', 'Other'];
const MAX_ITEMS = 300;

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
const cleanText = (v, n) => String(v || '').trim().slice(0, n);

function cleanItem(x, by) {
  const name = cleanText(x && x.name, 80);
  if (!name) return null;
  return {
    id: cleanText(x.id, 20) || rid(), name, qty: cleanText(x.qty, 20),
    cat: SHOP_CATS.includes(x.cat) ? x.cat : 'Groceries',
    done: !!x.done, by: cleanText(x.by || by, 30), at: Number(x.at) || Date.now(),
  };
}

function applyListOp(list, b) {
  const by = cleanText(b.by, 30);
  const item = list.items.find(i => i.id === b.id);
  switch (b.op) {
    case 'add': {
      const it = cleanItem({ ...b.item, id: '', done: false, at: 0 }, by);
      if (!it || list.items.length >= MAX_ITEMS) return null;
      list.items.push(it);
      return it;
    }
    case 'toggle': if (item) item.done = !item.done; return item;
    case 'remove': list.items = list.items.filter(i => i.id !== b.id); return true;
    case 'clear': list.items = list.items.filter(i => !i.done); return true;
    case 'wipe': list.items = []; return true;   // old link retired
    case 'import':   // moving the list to a new link: only into an empty list
      if (!list.items.length && Array.isArray(b.items)) list.items = b.items.slice(0, MAX_ITEMS).map(x => cleanItem(x, by)).filter(Boolean);
      return true;
    default: return null;
  }
}

async function notifyListAdd(env, code, item, fromDevice) {
  const devices = (await env.KV.get('devices', 'json')) || {};
  const targets = Object.entries(devices).filter(([id, d]) => id !== fromDevice && (d.lists || []).includes(code));
  if (!targets.length) return;
  const keys = await vapidKeys(env);
  await Promise.all(targets.map(([, d]) => sendPush(d.subscription, {
    title: '🛒 Added to the shopping list',
    body: `${item.name}${item.qty ? ` (${item.qty})` : ''}${item.by ? ` — by ${item.by}` : ''}`,
    tag: `shop-${item.id}`,
  }, keys).catch(() => {})));
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
      if (req.method === 'GET' && path === '/') return new Response('Juned Daily reminder server is running ✓', { headers: cors });
      if (req.method === 'GET' && path === '/key') return json({ publicKey: (await vapidKeys(env)).publicKey });
      if (req.method === 'GET' && path === '/list') {
        if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'forbidden' }, 403);
        const code = new URL(req.url).searchParams.get('code') || '';
        if (!LIST_CODE.test(code)) return json({ error: 'bad code' }, 400);
        return json((await env.KV.get(`list:${code}`, 'json')) || { items: [] });
      }
      if (req.method !== 'POST') return json({ error: 'not found' }, 404);
      if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'forbidden' }, 403);

      const body = await req.json();

      if (path === '/list') {
        if (!LIST_CODE.test(body.code || '')) return json({ error: 'bad code' }, 400);
        const key = `list:${body.code}`;
        const list = (await env.KV.get(key, 'json')) || { items: [] };
        const result = applyListOp(list, body);
        if (!result) return json({ error: 'bad request', ...list }, 400);
        list.updated = Date.now();
        await env.KV.put(key, JSON.stringify(list));
        if (body.op === 'add') await notifyListAdd(env, body.code, result, cleanText(body.device, 40));
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
          updated: Date.now(),
        };
        await env.KV.put('devices', JSON.stringify(devices));
        return json({ ok: true, reminders: reminders.length });
      }

      if (path === '/test') {
        const dev = devices[id];
        if (!dev) return json({ error: 'not registered' }, 404);
        const res = await sendPush(dev.subscription,
          { title: '🔔 Notifications are on', body: 'Juned Daily will remind you at the times you set.', tag: 'test' },
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
        const res = await sendPush(dev.subscription, { title: `⏰ ${r.title}`, body: 'Reminder from Juned Daily', tag: r.id }, keys);
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
