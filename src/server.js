const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { db, tx, hashPassword, verifyPassword } = require('./db');
const C = require('../public/js/compound.js');

const app = express();
const PROD = process.env.NODE_ENV === 'production';
const SESSION_MS = 7 * C.DAY_MS;
if (PROD) app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; frame-ancestors 'none'",
  });
  next();
});
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

// ---------- helpers ----------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, msg) => { throw new HttpError(status, msg); };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const int = (v) => (Number.isInteger(Number(v)) ? Number(v) : NaN);

function cookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)')
    .run(sha(token), userId, Date.now() + SESSION_MS);
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: SESSION_MS, path: '/' });
}

function currentUser(req) {
  const token = cookie(req, 'sid');
  if (!token) return null;
  return db.prepare(
    `SELECT u.id, u.name, u.email, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`
  ).get(sha(token), Date.now()) || null;
}

function auth(req, res, next) {
  req.user = currentUser(req);
  if (!req.user) return next(new HttpError(401, 'অনুগ্রহ করে লগইন করুন।'));
  next();
}
function admin(req, res, next) {
  auth(req, res, (err) => {
    if (err) return next(err);
    if (!req.user.is_admin) return next(new HttpError(403, 'অনুমতি নেই।'));
    next();
  });
}

// Simple in-memory limiter for the auth endpoints (per IP).
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) return next(new HttpError(429, 'অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।'));
    list.push(now);
    hits.set(key, list);
    next();
  };
}
setInterval(() => hits.clear(), 60 * 60 * 1000).unref();

function investmentView(inv, now = Date.now()) {
  const elapsed = (now - inv.start_at) / C.DAY_MS;
  const matured = now >= inv.end_at;
  return {
    ...inv,
    matured,
    current_value: C.valueAt(inv.principal, inv.apy, inv.duration_days, inv.compounding, elapsed),
    maturity_value: C.maturityValue(inv.principal, inv.apy, inv.duration_days),
    progress: Math.min(1, Math.max(0, elapsed / inv.duration_days)),
  };
}

// ---------- auth ----------
const api = express.Router();
// All state-changing requests must be JSON: blocks cross-site form posts.
api.use((req, res, next) => {
  if (req.method !== 'GET' && !req.is('application/json')) return next(new HttpError(415, 'JSON প্রয়োজন।'));
  next();
});

api.post('/register', rateLimit(10, 15 * 60 * 1000), (req, res) => {
  const name = str(req.body.name, 80);
  const email = str(req.body.email, 120).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (name.length < 2) fail(400, 'সঠিক নাম দিন।');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'সঠিক ইমেইল দিন।');
  if (password.length < 8 || password.length > 200) fail(400, 'পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) fail(409, 'এই ইমেইলে আগে থেকেই অ্যাকাউন্ট আছে।');
  const { hash, salt } = hashPassword(password);
  const r = db.prepare('INSERT INTO users (name, email, pass_hash, salt, created_at) VALUES (?,?,?,?,?)')
    .run(name, email, hash, salt, Date.now());
  startSession(res, Number(r.lastInsertRowid));
  res.json({ ok: true });
});

api.post('/login', rateLimit(10, 15 * 60 * 1000), (req, res) => {
  const email = str(req.body.email, 120).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password.slice(0, 200) : '';
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!u || !verifyPassword(password, u.salt, u.pass_hash)) fail(401, 'ইমেইল অথবা পাসওয়ার্ড ভুল।');
  startSession(res, u.id);
  res.json({ ok: true, is_admin: !!u.is_admin });
});

api.post('/logout', (req, res) => {
  const token = cookie(req, 'sid');
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
  res.clearCookie('sid', { path: '/' });
  res.json({ ok: true });
});

api.get('/me', (req, res) => res.json({ user: currentUser(req) }));

// ---------- public ----------
api.get('/plans', (req, res) => {
  res.json({ plans: db.prepare('SELECT * FROM plans WHERE active = 1 ORDER BY duration_days').all() });
});
api.get('/wallets', auth, (req, res) => {
  res.json({ wallets: db.prepare("SELECT id, asset, network, address FROM wallets WHERE active = 1 AND address != ''").all() });
});

// ---------- client ----------
api.post('/deposits', auth, (req, res) => {
  const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND active = 1').get(int(req.body.plan_id));
  const wallet = db.prepare("SELECT * FROM wallets WHERE id = ? AND active = 1 AND address != ''").get(int(req.body.wallet_id));
  const amount = num(req.body.amount);
  const txid = str(req.body.txid, 120);
  if (!plan) fail(400, 'প্ল্যানটি পাওয়া যায়নি।');
  if (!wallet) fail(400, 'পেমেন্ট মেথডটি পাওয়া যায়নি।');
  if (!(amount > 0)) fail(400, 'সঠিক পরিমাণ দিন।');
  if (!/^[A-Za-z0-9]{20,120}$/.test(txid)) fail(400, 'সঠিক ট্রানজ্যাকশন আইডি (TxID) দিন।');
  if (db.prepare('SELECT 1 FROM deposits WHERE txid = ?').get(txid)) fail(409, 'এই TxID আগেই জমা দেওয়া হয়েছে।');
  db.prepare(
    'INSERT INTO deposits (user_id, plan_id, asset, network, amount, txid, created_at) VALUES (?,?,?,?,?,?,?)'
  ).run(req.user.id, plan.id, wallet.asset, wallet.network, amount, txid, Date.now());
  res.json({ ok: true });
});

api.get('/dashboard', auth, (req, res) => {
  const investments = db.prepare('SELECT * FROM investments WHERE user_id = ? ORDER BY id DESC').all(req.user.id).map((i) => investmentView(i));
  const deposits = db.prepare(
    `SELECT d.*, p.name plan_name FROM deposits d JOIN plans p ON p.id = d.plan_id WHERE d.user_id = ? ORDER BY d.id DESC`
  ).all(req.user.id);
  const withdrawals = db.prepare('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  const open = investments.filter((i) => i.status === 'active');
  res.json({
    user: req.user,
    totals: {
      invested: C.round2(open.reduce((s, i) => s + i.principal, 0)),
      value: C.round2(open.reduce((s, i) => s + i.current_value, 0)),
      at_maturity: C.round2(open.reduce((s, i) => s + i.maturity_value, 0)),
      withdrawn: C.round2(withdrawals.filter((w) => w.status === 'paid').reduce((s, w) => s + w.amount, 0)),
    },
    investments, deposits, withdrawals,
  });
});

api.post('/withdrawals', auth, (req, res) => {
  const network = str(req.body.network, 30);
  const address = str(req.body.address, 120);
  if (!network) fail(400, 'নেটওয়ার্ক দিন।');
  if (!/^[A-Za-z0-9]{20,120}$/.test(address)) fail(400, 'সঠিক ওয়ালেট অ্যাড্রেস দিন।');
  const out = tx(() => {
    const inv = db.prepare('SELECT * FROM investments WHERE id = ? AND user_id = ?').get(int(req.body.investment_id), req.user.id);
    if (!inv || inv.status !== 'active') fail(400, 'এই বিনিয়োগ থেকে উত্তোলন করা যাবে না।');
    const v = investmentView(inv);
    // Before maturity only the principal is returned; accrued profit is forfeited.
    const amount = v.matured ? v.maturity_value : inv.principal;
    db.prepare("UPDATE investments SET status = 'withdrawing' WHERE id = ?").run(inv.id);
    db.prepare(
      'INSERT INTO withdrawals (user_id, investment_id, amount, early, network, address, created_at) VALUES (?,?,?,?,?,?,?)'
    ).run(req.user.id, inv.id, amount, v.matured ? 0 : 1, network, address, Date.now());
    return { amount, early: !v.matured };
  });
  res.json({ ok: true, ...out });
});

// ---------- admin ----------
api.get('/admin/overview', admin, (req, res) => {
  const investments = db.prepare(
    'SELECT i.*, u.email FROM investments i JOIN users u ON u.id = i.user_id ORDER BY i.id DESC LIMIT 500'
  ).all().map((i) => investmentView(i));
  const open = investments.filter((i) => i.status !== 'closed');
  res.json({
    stats: {
      users: db.prepare('SELECT COUNT(*) c FROM users WHERE is_admin = 0').get().c,
      principal: C.round2(open.reduce((s, i) => s + i.principal, 0)),
      liability_now: C.round2(open.reduce((s, i) => s + i.current_value, 0)),
      liability_at_maturity: C.round2(open.reduce((s, i) => s + i.maturity_value, 0)),
      pending_deposits: db.prepare("SELECT COUNT(*) c FROM deposits WHERE status = 'pending'").get().c,
      pending_withdrawals: db.prepare("SELECT COUNT(*) c FROM withdrawals WHERE status = 'pending'").get().c,
    },
    deposits: db.prepare(
      `SELECT d.*, u.email, u.name user_name, p.name plan_name, p.min_amount, p.max_amount
       FROM deposits d JOIN users u ON u.id = d.user_id JOIN plans p ON p.id = d.plan_id
       ORDER BY (d.status = 'pending') DESC, d.id DESC LIMIT 300`
    ).all(),
    withdrawals: db.prepare(
      `SELECT w.*, u.email, i.plan_name FROM withdrawals w JOIN users u ON u.id = w.user_id
       JOIN investments i ON i.id = w.investment_id ORDER BY (w.status = 'pending') DESC, w.id DESC LIMIT 300`
    ).all(),
    investments,
    plans: db.prepare('SELECT * FROM plans ORDER BY duration_days').all(),
    wallets: db.prepare('SELECT * FROM wallets ORDER BY id').all(),
    users: db.prepare('SELECT id, name, email, is_admin, created_at FROM users ORDER BY id DESC LIMIT 500').all(),
  });
});

// Approve after verifying the transfer on-chain. `credited` is the USDT value
// the investment starts with (for non-stablecoins the admin converts it).
api.post('/admin/deposits/:id/approve', admin, (req, res) => {
  const credited = num(req.body.credited);
  if (!(credited > 0)) fail(400, 'ক্রেডিট করার পরিমাণ (USDT) দিন।');
  tx(() => {
    const d = db.prepare('SELECT * FROM deposits WHERE id = ?').get(int(req.params.id));
    if (!d || d.status !== 'pending') fail(400, 'ডিপোজিটটি পেন্ডিং অবস্থায় নেই।');
    const p = db.prepare('SELECT * FROM plans WHERE id = ?').get(d.plan_id);
    if (credited < p.min_amount || credited > p.max_amount) fail(400, `পরিমাণ প্ল্যানের সীমার (${p.min_amount}–${p.max_amount} USDT) বাইরে।`);
    const now = Date.now();
    db.prepare("UPDATE deposits SET status = 'approved', reviewed_at = ? WHERE id = ?").run(now, d.id);
    db.prepare(
      `INSERT INTO investments (user_id, plan_id, deposit_id, plan_name, principal, apy, compounding, duration_days, start_at, end_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(d.user_id, p.id, d.id, p.name, C.round2(credited), p.apy, p.compounding, p.duration_days, now, now + p.duration_days * C.DAY_MS);
  });
  res.json({ ok: true });
});

api.post('/admin/deposits/:id/reject', admin, (req, res) => {
  const r = db.prepare("UPDATE deposits SET status = 'rejected', note = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'")
    .run(str(req.body.note, 200), Date.now(), int(req.params.id));
  if (!r.changes) fail(400, 'ডিপোজিটটি পেন্ডিং অবস্থায় নেই।');
  res.json({ ok: true });
});

api.post('/admin/withdrawals/:id/paid', admin, (req, res) => {
  const payout = str(req.body.payout_txid, 120);
  if (!/^[A-Za-z0-9]{20,120}$/.test(payout)) fail(400, 'পেআউটের TxID দিন।');
  tx(() => {
    const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(int(req.params.id));
    if (!w || w.status !== 'pending') fail(400, 'উত্তোলনটি পেন্ডিং অবস্থায় নেই।');
    db.prepare("UPDATE withdrawals SET status = 'paid', payout_txid = ?, reviewed_at = ? WHERE id = ?").run(payout, Date.now(), w.id);
    db.prepare("UPDATE investments SET status = 'closed' WHERE id = ?").run(w.investment_id);
  });
  res.json({ ok: true });
});

api.post('/admin/withdrawals/:id/reject', admin, (req, res) => {
  tx(() => {
    const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(int(req.params.id));
    if (!w || w.status !== 'pending') fail(400, 'উত্তোলনটি পেন্ডিং অবস্থায় নেই।');
    db.prepare("UPDATE withdrawals SET status = 'rejected', reviewed_at = ? WHERE id = ?").run(Date.now(), w.id);
    db.prepare("UPDATE investments SET status = 'active' WHERE id = ?").run(w.investment_id);
  });
  res.json({ ok: true });
});

function planInput(b) {
  const p = {
    name: str(b.name, 60),
    description: str(b.description, 300),
    duration_days: int(b.duration_days),
    apy: num(b.apy),
    compounding: b.compounding === 'monthly' ? 'monthly' : 'daily',
    min_amount: num(b.min_amount),
    max_amount: num(b.max_amount),
    featured: b.featured ? 1 : 0,
    active: b.active === false ? 0 : 1,
  };
  if (!p.name) fail(400, 'প্ল্যানের নাম দিন।');
  if (!(p.duration_days >= 1 && p.duration_days <= 3650)) fail(400, 'মেয়াদ ১–৩৬৫০ দিনের মধ্যে হতে হবে।');
  if (!(p.apy > 0 && p.apy <= 1000)) fail(400, 'সঠিক APY দিন।');
  if (!(p.min_amount > 0 && p.max_amount >= p.min_amount)) fail(400, 'সঠিক সর্বনিম্ন/সর্বোচ্চ পরিমাণ দিন।');
  return p;
}
const PLAN_COLS = ['name', 'description', 'duration_days', 'apy', 'compounding', 'min_amount', 'max_amount', 'featured', 'active'];

api.post('/admin/plans', admin, (req, res) => {
  const p = planInput(req.body);
  db.prepare(`INSERT INTO plans (${PLAN_COLS.join(',')}) VALUES (${PLAN_COLS.map(() => '?').join(',')})`).run(...PLAN_COLS.map((c) => p[c]));
  res.json({ ok: true });
});
// Editing a plan never changes existing investments: their terms are copied at approval.
api.put('/admin/plans/:id', admin, (req, res) => {
  const p = planInput(req.body);
  const r = db.prepare(`UPDATE plans SET ${PLAN_COLS.map((c) => c + ' = ?').join(', ')} WHERE id = ?`).run(...PLAN_COLS.map((c) => p[c]), int(req.params.id));
  if (!r.changes) fail(404, 'প্ল্যানটি পাওয়া যায়নি।');
  res.json({ ok: true });
});

api.put('/admin/wallets/:id', admin, (req, res) => {
  const address = str(req.body.address, 120);
  const active = req.body.active ? 1 : 0;
  if (address && !/^[A-Za-z0-9]{20,120}$/.test(address)) fail(400, 'সঠিক ওয়ালেট অ্যাড্রেস দিন।');
  if (active && !address) fail(400, 'সক্রিয় করার আগে অ্যাড্রেস দিন।');
  const r = db.prepare('UPDATE wallets SET address = ?, active = ? WHERE id = ?').run(address, active, int(req.params.id));
  if (!r.changes) fail(404, 'ওয়ালেটটি পাওয়া যায়নি।');
  res.json({ ok: true });
});
api.post('/admin/wallets', admin, (req, res) => {
  const asset = str(req.body.asset, 12).toUpperCase();
  const network = str(req.body.network, 30);
  if (!/^[A-Z0-9]{2,12}$/.test(asset) || !network) fail(400, 'কয়েন ও নেটওয়ার্ক দিন।');
  db.prepare('INSERT INTO wallets (asset, network) VALUES (?,?)').run(asset, network);
  res.json({ ok: true });
});

api.use((req, res) => res.status(404).json({ error: 'পাওয়া যায়নি।' }));
app.use('/api', api);

app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'সার্ভারে সমস্যা হয়েছে।' : err.message });
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`Investment platform running on http://localhost:${port}`));
}
module.exports = app;
