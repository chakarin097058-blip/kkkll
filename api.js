const crypto = require('crypto');

// ── Upstash Redis REST ─────────────────────────────────────────────────────
const BASE = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

const redisFetch = async (method, path, body) => {
  const url = `${BASE}${path}`;
  const opts = { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const json = await res.json();
  if (json.error) throw new Error('Redis: ' + json.error);
  return json.result;
};

const rGet = (key) => redisFetch('GET', `/${encodeURIComponent('GET')}/${encodeURIComponent(key)}`);
const rCmd = (...args) => redisFetch('POST', '/pipeline', [args]).then(r => Array.isArray(r) ? r[0]?.result : r);

const G = async (key, def = null) => {
  const v = await rGet(key);
  if (v === null || v === undefined) return def;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return def; } }
  return v;
};
const S = (key, val) => rCmd('SET', key, JSON.stringify(val));
const SX = (key, val, ex) => rCmd('SET', key, JSON.stringify(val), 'EX', String(ex));
const SADD = (key, ...members) => rCmd('SADD', key, ...members);
const SISMEMBER = (key, member) => redisFetch('GET', `/${encodeURIComponent('SISMEMBER')}/${encodeURIComponent(key)}/${encodeURIComponent(member)}`);
const SMEMBERS = (key) => redisFetch('GET', `/${encodeURIComponent('SMEMBERS')}/${encodeURIComponent(key)}`);

const hash = (pw, salt) => crypto.scryptSync(String(pw), String(salt), 32).toString('hex');
const ERR = (msg, status = 400) => { const e = new Error(msg); e.s = status; return e; };

// Default settings
const DS = {
  title: 'HEX PRODUCT',
  sub: 'ร้านไอเทมและโค้ดเกม เติมคอยน์แล้วซื้อได้ทันที',
  ann: 'เติมคอยน์ผ่าน QR แล้วกดซื้อได้เลย • ส่งสินค้าภายใน 24 ชม.',
  pp: '',
  qrImg: '/qr.jpg',
  contact: 'LINE: -',
  colorPrimary: '#d8f01c',
  colorBg: '#050505',
  colorCard: '#0d0d0b',
  fontFamily: 'Kanit',
  heroImg: '',
  logoText: 'HEX PRODUCT',
  slipProvider: 'slipok',
  slipBranchId: '',
  slipApiKey: ''
};

const DP = [
  { id: 1, name: 'ตัวอย่างสินค้า A', price: 99, stock: 10, cat: 'โค้ด', em: '🔑', img: '' },
  { id: 2, name: 'ตัวอย่างสินค้า B', price: 249, stock: 999, cat: 'ไอเทม', em: '🎁', img: '' }
];

const userInfo = (username, user) => ({
  n: username,
  displayName: user?.displayName || username,
  coins: Number(user?.coins) || 0,
  hasAvatar: !!user?.hasAvatar
});

const doLogin = async (username) => {
  const token = crypto.randomBytes(24).toString('hex');
  await SX('s:' + token, username, 2592000);
  const user = await G('u:' + username, { coins: 0 });
  return { t: token, me: userInfo(username, user) };
};

// Verify bank slip via SlipOK or EasySlip
async function verifySlipAuto(st, slipDataUrl, qrData) {
  const provider = st.slipProvider || 'slipok';
  const apiKey = st.slipApiKey || process.env.SLIP_API_KEY || '';
  const branchId = st.slipBranchId || process.env.SLIP_BRANCH_ID || '';
  if (!apiKey) return null;

  // Convert data URL to Blob
  const match = slipDataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) throw ERR('รูปแบบไฟล์สลิปไม่ถูกต้อง');
  const mime = match[1];
  const buf = Buffer.from(match[2], 'base64');
  const blob = new Blob([buf], { type: mime });

  if (provider === 'easyslip') {
    let res;
    if (qrData) {
      res = await fetch('https://developer.easyslip.com/api/v1/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: qrData })
      });
    } else {
      const fd = new FormData();
      fd.append('file', blob, 'slip.jpg');
      res = await fetch('https://developer.easyslip.com/api/v1/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: fd
      });
    }
    const j = await res.json();
    if (!res.ok || j.status !== 200 || !j.data) {
      throw ERR(j.message || 'ตรวจสอบสลิปไม่ผ่าน (EasySlip)');
    }
    const amt = Number(j.data?.amount?.amount ?? j.data?.amount ?? 0);
    const ref = String(j.data?.transRef || '');
    if (!(amt > 0)) throw ERR('ไม่พบยอดเงินในสลิป');
    return { amount: amt, ref };
  }

  // Default: SlipOK
  if (!branchId) throw ERR('ยังไม่ได้ตั้งค่า SlipOK Branch ID ในหลังบ้าน', 500);
  const fd = new FormData();
  fd.append('files', blob, 'slip.jpg');
  if (qrData) fd.append('data', qrData);
  fd.append('log', 'true');

  const res = await fetch(`https://api.slipok.com/api/line/apikey/${encodeURIComponent(branchId)}`, {
    method: 'POST',
    headers: { 'x-authorization': apiKey },
    body: fd
  });
  const j = await res.json();
  if (!res.ok || !j.success || !j.data) {
    throw ERR(j.message || 'ตรวจสอบสลิปไม่ผ่าน (SlipOK)');
  }
  const amt = Number(j.data?.amount ?? 0);
  const ref = String(j.data?.transRef || '');
  if (!(amt > 0)) throw ERR('ไม่พบยอดเงินในสลิป');
  return { amount: amt, ref };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (!BASE || !TOKEN) throw ERR('ยังไม่ได้ตั้งค่า UPSTASH_REDIS_REST_URL / TOKEN', 500);

    let b = req.body || {};
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }

    const a = String(b.a || '');
    const out = (obj) => res.status(200).json(obj);
    const isAdmin = !!process.env.ADMIN_KEY && req.headers['x-admin-key'] === process.env.ADMIN_KEY;

    const stRaw = await G('settings', DS);
    const st = { ...DS, ...stRaw };
    const pr = await G('products', DP);

    // ── Public ─────────────────────────────────────────────────────────────
    if (a === 'shop') {
      const publicSt = { ...st };
      delete publicSt.slipApiKey;
      publicSt.autoSlip = !!(st.slipApiKey || process.env.SLIP_API_KEY);
      return out({ st: publicSt, pr: pr || DP });
    }

    if (a === 'register') {
      const n = String(b.n || '').trim().toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(n)) throw ERR('ชื่อผู้ใช้ใช้ a-z 0-9 _ ความยาว 3-20 ตัว');
      if (String(b.p || '').length < 6) throw ERR('รหัสผ่านอย่างน้อย 6 ตัว');
      const existing = await G('u:' + n);
      if (existing) throw ERR('ชื่อผู้ใช้นี้ถูกใช้แล้ว');
      const salt = crypto.randomBytes(8).toString('hex');
      await S('u:' + n, { n, displayName: n, s: salt, h: hash(b.p, salt), coins: 0, hasAvatar: false });
      await SADD('users', n);
      return out(await doLogin(n));
    }

    if (a === 'login') {
      const n = String(b.n || '').trim().toLowerCase();
      const user = await G('u:' + n);
      if (!user || hash(b.p, user.s) !== user.h) throw ERR('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
      return out(await doLogin(n));
    }

    if (a === 'img') {
      const img = await G('img:' + b.id);
      if (!img) throw ERR('ไม่พบรูป', 404);
      return out({ img });
    }

    if (a === 'avatar') {
      const img = await G('avatar:' + String(b.n || '').toLowerCase());
      return out({ img: img || '' });
    }

    // ── Admin ──────────────────────────────────────────────────────────────
    if (a.startsWith('a_')) {
      if (!isAdmin) throw ERR('รหัสแอดมินไม่ถูกต้อง', 401);

      if (a === 'a_all') {
        let names = [];
        try { names = await SMEMBERS('users') || []; } catch {}
        if (!Array.isArray(names)) names = [];
        const users = [];
        for (const name of names) {
          const u = await G('u:' + name);
          if (u) users.push({ n: u.n, displayName: u.displayName || u.n, coins: Number(u.coins) || 0 });
        }
        return out({ st, pr: pr || DP, users, orders: await G('orders', []), topups: await G('topups', []) });
      }

      if (a === 'a_save') {
        if (b.st) await S('settings', { ...DS, ...st, ...b.st });
        if (b.pr) await S('products', b.pr);
        return out({ ok: 1 });
      }

      if (a === 'a_slip') return out({ img: await G('slip:' + b.id) });

      if (a === 'a_topup') {
        const topups = await G('topups', []);
        const tp = topups.find(x => x.id === b.id);
        if (!tp || tp.s !== 'pending') throw ERR('ไม่พบรายการหรือดำเนินการแล้ว');
        tp.s = b.ok ? 'approved' : 'rejected';
        if (b.ok) {
          const u = await G('u:' + tp.n);
          if (!u) throw ERR('ไม่พบสมาชิก');
          u.coins = (Number(u.coins) || 0) + (Number(tp.amount) || 0);
          await S('u:' + tp.n, u);
        }
        await S('topups', topups);
        return out({ ok: 1 });
      }

      if (a === 'a_deliver') {
        const orders = await G('orders', []);
        const o = orders.find(x => x.id === b.id);
        if (!o) throw ERR('ไม่พบออเดอร์');
        o.s = 'done'; o.d = String(b.text || '');
        await S('orders', orders);
        return out({ ok: 1 });
      }

      if (a === 'a_coins') {
        const uname = String(b.n || '').trim().toLowerCase();
        const u = await G('u:' + uname);
        if (!u) throw ERR('ไม่พบสมาชิก: ' + uname);
        u.coins = (Number(u.coins) || 0) + (Number(b.amount) || 0);
        await S('u:' + u.n, u);
        return out({ ok: 1, coins: u.coins });
      }

      if (a === 'a_upload_img') {
        const pid = b.id;
        const img = String(b.img || '');
        if (!img.startsWith('data:image/')) throw ERR('ไฟล์ไม่ใช่รูปภาพ');
        await S('img:' + pid, img);
        const products = await G('products', DP);
        const p = products.find(x => x.id == pid);
        if (p) { p.img = `__redis:img:${pid}`; await S('products', products); }
        return out({ ok: 1, url: `__redis:img:${pid}` });
      }

      throw ERR('admin action ไม่รู้จัก');
    }

    // ── Authenticated ──────────────────────────────────────────────────────
    const tokenVal = b.t ? await G('s:' + b.t) : null;
    if (!tokenVal) throw ERR('กรุณาเข้าสู่ระบบ', 401);
    const n = String(tokenVal);
    const u = await G('u:' + n);
    if (!u) throw ERR('ไม่พบสมาชิก กรุณาเข้าสู่ระบบใหม่', 401);

    if (a === 'me') return out({ me: userInfo(n, u) });

    if (a === 'profile_save') {
      const displayName = String(b.displayName || '').trim();
      if (displayName) {
        if (displayName.length > 30) throw ERR('ชื่อที่แสดงยาวเกิน 30 ตัวอักษร');
        u.displayName = displayName;
      }
      if (b.avatar) {
        const av = String(b.avatar);
        if (!av.startsWith('data:image/') || av.length > 500000) throw ERR('รูปโปรไฟล์ไม่ถูกต้องหรือใหญ่เกินไป');
        await S('avatar:' + n, av);
        u.hasAvatar = true;
      }
      await S('u:' + n, u);
      return out({ ok: 1, me: userInfo(n, u) });
    }

    if (a === 'profile_pw') {
      const curPw = String(b.currentPassword || '');
      const newPw = String(b.newPassword || '');
      if (hash(curPw, u.s) !== u.h) throw ERR('รหัสผ่านปัจจุบันไม่ถูกต้อง');
      if (newPw.length < 6) throw ERR('รหัสผ่านใหม่อย่างน้อย 6 ตัวอักษร');
      const salt = crypto.randomBytes(8).toString('hex');
      u.s = salt;
      u.h = hash(newPw, salt);
      await S('u:' + n, u);
      return out({ ok: 1 });
    }

    if (a === 'buy') {
      const product = (pr || DP).find(x => x.id == b.id);
      const qty = Math.floor(Number(b.q));
      if (!product || !(qty >= 1 && qty <= 99)) throw ERR('ข้อมูลไม่ถูกต้อง');
      if (product.stock < qty) throw ERR('สินค้าไม่พอ');
      const total = product.price * qty;
      if ((Number(u.coins) || 0) < total) throw ERR('คอยน์ไม่พอ กรุณาเติมคอยน์');
      u.coins = (Number(u.coins) || 0) - total;
      if (product.stock < 999) product.stock -= qty;
      await S('u:' + n, u);
      await S('products', pr);
      const orders = await G('orders', []);
      orders.unshift({ id: 'O' + Date.now(), n, item: product.name, q: qty, total, s: 'pending', d: '', ts: Date.now() });
      await S('orders', orders);
      return out({ coins: u.coins });
    }

    if (a === 'topup') {
      const slip = String(b.slip || '');
      const qrData = String(b.qrData || '').trim();
      if (!slip.startsWith('data:image/')) throw ERR('กรุณาแนบสลิปรูปภาพ');
      if (slip.length > 1500000) throw ERR('ไฟล์สลิปใหญ่เกินไป');

      // Prevent duplicate slip image upload
      const slipHash = crypto.createHash('sha256').update(slip).digest('hex');
      const dupImg = await SISMEMBER('used_slips', 'h:' + slipHash);
      if (dupImg) throw ERR('สลิปนี้ถูกใช้งานไปแล้ว');

      if (qrData) {
        const dupQr = await SISMEMBER('used_slips', 'q:' + qrData);
        if (dupQr) throw ERR('QR สลิปนี้ถูกใช้งานไปแล้ว');
      }

      const hasAutoApi = !!(st.slipApiKey || process.env.SLIP_API_KEY);
      if (hasAutoApi) {
        const verified = await verifySlipAuto(st, slip, qrData);
        if (verified.ref) {
          const dupRef = await SISMEMBER('used_slips', 'r:' + verified.ref);
          if (dupRef) throw ERR('รายการโอนนี้ถูกใช้งานไปแล้ว');
          await SADD('used_slips', 'r:' + verified.ref);
        }
        await SADD('used_slips', 'h:' + slipHash);
        if (qrData) await SADD('used_slips', 'q:' + qrData);

        const id = 'T' + Date.now();
        await S('slip:' + id, slip);
        u.coins = (Number(u.coins) || 0) + verified.amount;
        await S('u:' + n, u);

        const topups = await G('topups', []);
        topups.unshift({ id, n, amount: verified.amount, s: 'approved', auto: true, ref: verified.ref, ts: Date.now() });
        await S('topups', topups);
        return out({ ok: 1, auto: true, amount: verified.amount, coins: u.coins });
      }

      // Manual approval fallback when Slip API Key is not configured
      const amount = Math.floor(Number(b.amount));
      if (!(amount >= 1)) throw ERR('กรุณาระบุจำนวนเงิน (ขั้นต่ำ 1 บาท)');
      await SADD('used_slips', 'h:' + slipHash);
      const id = 'T' + Date.now();
      await S('slip:' + id, slip);
      const topups = await G('topups', []);
      topups.unshift({ id, n, amount, s: 'pending', ts: Date.now() });
      await S('topups', topups);
      return out({ ok: 1, auto: false, amount });
    }

    if (a === 'mine') {
      const allOrders = await G('orders', []);
      const allTopups = await G('topups', []);
      return out({ orders: allOrders.filter(x => x.n === n), topups: allTopups.filter(x => x.n === n) });
    }

    throw ERR('action ไม่รู้จัก');
  } catch (e) {
    console.error('[API Error]', e.message);
    res.status(e.s || 500).json({ e: e.message || 'เกิดข้อผิดพลาด' });
  }
};
