process.env.DB_PATH = ':memory:';
process.env.ADMIN_EMAIL = 'admin@example.com';
process.env.ADMIN_PASSWORD = 'admin-pass-123';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/js/compound.js');
const app = require('../src/server');
const { db } = require('../src/db');

test('compounding math', () => {
  assert.ok(Math.abs(C.apyForMultiple(2, 1460) - 18.9207) < 0.0001);
  assert.equal(C.maturityValue(1000, 18.9207, 1460), 2000);
  assert.equal(C.valueAt(1000, 18.9207, 1460, 'daily', 0), 1000);
  assert.equal(C.valueAt(1000, 18.9207, 1460, 'daily', 9999), 2000);
  // monthly plans only credit on 30-day boundaries
  assert.equal(C.valueAt(1000, 12, 180, 'monthly', 29), 1000);
  assert.ok(C.valueAt(1000, 12, 180, 'monthly', 30) > 1000);
});

test('deposit -> approve -> withdraw flow', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}/api`;
  const client = () => {
    let cookie = '';
    return async (path, method = 'GET', body) => {
      const res = await fetch(base + path, {
        method,
        headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, body: await res.json() };
    };
  };
  const user = client(), adm = client(), anon = client();
  const TX = 'a'.repeat(64), ADDR = 'T' + 'b'.repeat(33);

  assert.equal((await anon('/dashboard')).status, 401);
  assert.equal((await user('/register', 'POST', { name: 'Rahim', email: 'r@example.com', password: 'short' })).status, 400);
  assert.equal((await user('/register', 'POST', { name: 'Rahim', email: 'r@example.com', password: 'password123' })).status, 200);
  assert.equal((await user('/admin/overview')).status, 403);
  assert.equal((await adm('/login', 'POST', { email: 'admin@example.com', password: 'wrong' })).status, 401);
  assert.equal((await adm('/login', 'POST', { email: 'admin@example.com', password: 'admin-pass-123' })).status, 200);

  const plans = (await anon('/plans')).body.plans;
  const double = plans.find((p) => p.duration_days === 1460);
  assert.equal((await user('/wallets')).body.wallets.length, 0, 'no wallet is active until the admin sets an address');

  const w = (await adm('/admin/overview')).body.wallets[0];
  assert.equal((await adm(`/admin/wallets/${w.id}`, 'PUT', { address: '', active: true })).status, 400);
  assert.equal((await adm(`/admin/wallets/${w.id}`, 'PUT', { address: ADDR, active: true })).status, 200);

  const dep = { plan_id: double.id, wallet_id: w.id, amount: 1000, txid: TX };
  assert.equal((await user('/deposits', 'POST', dep)).status, 200);
  assert.equal((await user('/deposits', 'POST', dep)).status, 409, 'TxID cannot be reused');
  assert.equal((await user('/deposits/1/approve', 'POST', { credited: 1000 })).status, 404);
  assert.equal((await user('/admin/deposits/1/approve', 'POST', { credited: 1000 })).status, 403);
  assert.equal((await adm('/admin/deposits/1/approve', 'POST', { credited: 5 })).status, 400, 'below plan minimum');
  assert.equal((await adm('/admin/deposits/1/approve', 'POST', { credited: 1000 })).status, 200);
  assert.equal((await adm('/admin/deposits/1/approve', 'POST', { credited: 1000 })).status, 400, 'no double approval');

  let d = (await user('/dashboard')).body;
  assert.equal(d.investments.length, 1);
  assert.equal(d.investments[0].maturity_value, 2000);
  assert.equal(d.totals.invested, 1000);

  // Two years in: value should be sqrt(2) * principal.
  db.prepare('UPDATE investments SET start_at = start_at - ?, end_at = end_at - ?').run(730 * C.DAY_MS, 730 * C.DAY_MS);
  d = (await user('/dashboard')).body;
  assert.ok(Math.abs(d.investments[0].current_value - 1414.21) < 0.02);

  // Early withdrawal returns principal only; rejecting it reactivates the investment.
  let wd = await user('/withdrawals', 'POST', { investment_id: 1, network: 'USDT TRC20', address: ADDR });
  assert.deepEqual([wd.status, wd.body.amount, wd.body.early], [200, 1000, true]);
  assert.equal((await user('/withdrawals', 'POST', { investment_id: 1, network: 'USDT TRC20', address: ADDR })).status, 400);
  assert.equal((await adm('/admin/withdrawals/1/reject', 'POST', {})).status, 200);

  // After maturity the full 2x is paid.
  db.prepare('UPDATE investments SET start_at = start_at - ?, end_at = end_at - ?').run(731 * C.DAY_MS, 731 * C.DAY_MS);
  wd = await user('/withdrawals', 'POST', { investment_id: 1, network: 'USDT TRC20', address: ADDR });
  assert.deepEqual([wd.status, wd.body.amount, wd.body.early], [200, 2000, false]);
  assert.equal((await adm('/admin/withdrawals/2/paid', 'POST', { payout_txid: 'c'.repeat(64) })).status, 200);
  d = (await user('/dashboard')).body;
  assert.equal(d.investments[0].status, 'closed');
  assert.equal(d.totals.withdrawn, 2000);

  // Another user cannot touch someone else's investment.
  const other = client();
  await other('/register', 'POST', { name: 'Karim', email: 'k@example.com', password: 'password123' });
  assert.equal((await other('/withdrawals', 'POST', { investment_id: 1, network: 'x', address: ADDR })).status, 400);
});
