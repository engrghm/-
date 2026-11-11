const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');
if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  duration_days INTEGER NOT NULL,
  apy REAL NOT NULL,
  compounding TEXT NOT NULL CHECK (compounding IN ('daily','monthly')),
  min_amount REAL NOT NULL,
  max_amount REAL NOT NULL,
  featured INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS wallets (
  id INTEGER PRIMARY KEY,
  asset TEXT NOT NULL,
  network TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  asset TEXT NOT NULL,
  network TEXT NOT NULL,
  amount REAL NOT NULL,
  txid TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);
CREATE TABLE IF NOT EXISTS investments (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  deposit_id INTEGER NOT NULL UNIQUE REFERENCES deposits(id),
  plan_name TEXT NOT NULL,
  principal REAL NOT NULL,
  apy REAL NOT NULL,
  compounding TEXT NOT NULL,
  duration_days INTEGER NOT NULL,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','withdrawing','closed'))
);
CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  investment_id INTEGER NOT NULL REFERENCES investments(id),
  amount REAL NOT NULL,
  early INTEGER NOT NULL DEFAULT 0,
  network TEXT NOT NULL,
  address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','rejected')),
  payout_txid TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);
`);

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, salt, expected) {
  const got = crypto.scryptSync(password, salt, 64);
  const want = Buffer.from(expected, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function seed() {
  if (db.prepare('SELECT COUNT(*) c FROM plans').get().c === 0) {
    const ins = db.prepare(
      `INSERT INTO plans (name, description, duration_days, apy, compounding, min_amount, max_amount, featured)
       VALUES (?,?,?,?,?,?,?,?)`
    );
    ins.run('স্টার্টার', 'ছোট অঙ্ক দিয়ে শুরু করার জন্য স্বল্পমেয়াদি প্ল্যান।', 180, 8, 'monthly', 50, 5000, 0);
    ins.run('গ্রোথ', 'এক বছরের দৈনিক কম্পাউন্ডিং প্ল্যান।', 365, 12, 'daily', 500, 25000, 0);
    ins.run('প্রিমিয়াম', 'দুই বছর মেয়াদে উচ্চতর রিটার্ন।', 730, 15, 'daily', 2000, 100000, 0);
    // 2x in 4 years => APY = 2^(1/4) - 1 = 18.9207%
    ins.run('ডাবল প্ল্যান', 'দৈনিক কম্পাউন্ডিংয়ে ৪ বছরে মূলধন দ্বিগুণ।', 1460, 18.9207, 'daily', 1000, 250000, 1);
  }
  if (db.prepare('SELECT COUNT(*) c FROM wallets').get().c === 0) {
    // Addresses are intentionally empty and inactive: the admin must set real ones.
    const ins = db.prepare('INSERT INTO wallets (asset, network) VALUES (?,?)');
    ins.run('USDT', 'TRC20');
    ins.run('USDT', 'BEP20');
    ins.run('BTC', 'Bitcoin');
    ins.run('ETH', 'ERC20');
  }
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (email && password && !db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    const { hash, salt } = hashPassword(password);
    db.prepare('INSERT INTO users (name, email, pass_hash, salt, is_admin, created_at) VALUES (?,?,?,?,1,?)')
      .run('Admin', email, hash, salt, Date.now());
    console.log(`Admin account created: ${email}`);
  }
}
seed();

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, tx, hashPassword, verifyPassword };
