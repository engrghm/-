let plans = [], wallets = [], data = null, wdInvestment = null;

function table(head, rows, empty) {
  if (!rows.length) return `<div class="empty">${empty}</div>`;
  return `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.join('')}</table>`;
}

function showTab(name) {
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
}

function render() {
  const t = data.totals;
  $('#who').textContent = data.user.name;
  $('#stats').innerHTML = [
    ['চলমান বিনিয়োগ', usdt(t.invested)],
    ['বর্তমান মূল্য', usdt(t.value)],
    ['এ পর্যন্ত লাভ', '+' + usdt(t.value - t.invested)],
    ['মেয়াদ শেষে প্রত্যাশিত', usdt(t.at_maturity)],
  ].map(([l, v]) => `<div class="card stat"><div class="label">${l}</div><div class="value num">${v}</div></div>`).join('');

  $('#investments').innerHTML = table(
    ['প্ল্যান', 'মূলধন', 'বর্তমান মূল্য', 'মেয়াদ শেষে', 'অগ্রগতি', 'মেয়াদ পূর্ণ', 'অবস্থা', ''],
    data.investments.map((i) => `<tr>
      <td>${esc(i.plan_name)}<div class="muted small">${pct(i.apy)} APY · ${COMPOUNDING[i.compounding]}</div></td>
      <td class="num">${usdt(i.principal)}</td>
      <td class="num">${usdt(i.current_value)}</td>
      <td class="num">${usdt(i.maturity_value)}</td>
      <td><div class="bar"><i data-w="${(i.progress * 100).toFixed(1)}"></i></div><span class="muted small num">${(i.progress * 100).toFixed(1)}%</span></td>
      <td>${fmtDate(i.end_at)}</td>
      <td>${badge(i.status)}</td>
      <td>${i.status === 'active' ? `<button class="btn ghost sm" data-wd="${i.id}">উত্তোলন</button>` : ''}</td>
    </tr>`),
    'এখনো কোনো বিনিয়োগ নেই। “নতুন বিনিয়োগ” ট্যাব থেকে শুরু করুন।'
  );
  // Inline styles are blocked by the CSP, so widths are applied through the DOM.
  $$('.bar i').forEach((el) => { el.style.width = el.dataset.w + '%'; });

  $('#deposits').innerHTML = table(
    ['তারিখ', 'প্ল্যান', 'পরিমাণ', 'TxID', 'অবস্থা'],
    data.deposits.map((d) => `<tr>
      <td>${fmtDate(d.created_at)}</td>
      <td>${esc(d.plan_name)}</td>
      <td class="num">${esc(d.amount)} ${esc(d.asset)} <span class="muted small">(${esc(d.network)})</span></td>
      <td class="wrap-any">${esc(d.txid)}</td>
      <td>${badge(d.status)}${d.note ? `<div class="muted small">${esc(d.note)}</div>` : ''}</td>
    </tr>`),
    'কোনো ডিপোজিট নেই।'
  );

  $('#withdrawals').innerHTML = table(
    ['তারিখ', 'পরিমাণ', 'নেটওয়ার্ক', 'অ্যাড্রেস', 'অবস্থা', 'পেআউট TxID'],
    data.withdrawals.map((w) => `<tr>
      <td>${fmtDate(w.created_at)}</td>
      <td class="num">${usdt(w.amount)}${w.early ? '<div class="muted small">মেয়াদের আগে</div>' : ''}</td>
      <td>${esc(w.network)}</td>
      <td class="wrap-any">${esc(w.address)}</td>
      <td>${badge(w.status)}</td>
      <td class="wrap-any">${esc(w.payout_txid) || '—'}</td>
    </tr>`),
    'কোনো উত্তোলনের অনুরোধ নেই।'
  );
}

function renderDepositForm() {
  const plan = plans.find((p) => p.id === Number($('#dep-plan').value));
  const wallet = wallets.find((w) => w.id === Number($('#dep-wallet').value));
  $('#dep-plan-info').textContent = plan
    ? `${pct(plan.apy)} APY · ${COMPOUNDING[plan.compounding]} কম্পাউন্ডিং · ${duration(plan.duration_days)} · সীমা ${usdt(plan.min_amount)} – ${usdt(plan.max_amount)}`
    : '';
  $('#dep-address').textContent = wallet ? wallet.address : 'এই মুহূর্তে কোনো পেমেন্ট মেথড চালু নেই।';
  $('#dep-asset').textContent = wallet ? wallet.asset : 'USDT';
  $('#dep-submit').disabled = !plan || !wallet;
}

async function load() {
  data = await api('/dashboard');
  render();
}

async function init() {
  try {
    await load();
  } catch (err) {
    if (err.status === 401) location.href = '/auth?next=' + encodeURIComponent(location.pathname + location.search);
    return;
  }
  [plans, wallets] = await Promise.all([api('/plans').then((r) => r.plans), api('/wallets').then((r) => r.wallets)]);
  const wanted = Number(new URLSearchParams(location.search).get('plan'));
  $('#dep-plan').innerHTML = plans.map((p) => `<option value="${p.id}" ${p.id === wanted ? 'selected' : ''}>${esc(p.name)} — ${pct(p.apy)} APY</option>`).join('');
  $('#dep-wallet').innerHTML = wallets.map((w) => `<option value="${w.id}">${esc(w.asset)} (${esc(w.network)})</option>`).join('');
  renderDepositForm();
  if (wanted) showTab('new');
}

$$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
$('#logout').addEventListener('click', logout);
$('#dep-plan').addEventListener('change', renderDepositForm);
$('#dep-wallet').addEventListener('change', renderDepositForm);
$('#copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#dep-address').textContent).catch(() => {});
  $('#copy').textContent = 'কপি হয়েছে';
  setTimeout(() => { $('#copy').textContent = 'কপি'; }, 1500);
});

$('#deposit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#dep-submit');
  btn.disabled = true;
  try {
    await api('/deposits', {
      method: 'POST',
      body: {
        plan_id: Number($('#dep-plan').value),
        wallet_id: Number($('#dep-wallet').value),
        amount: Number($('#dep-amount').value),
        txid: $('#dep-txid').value.trim(),
      },
    });
    e.target.reset();
    renderDepositForm();
    showMsg($('#dep-msg'), 'ডিপোজিট জমা হয়েছে। যাচাই শেষে আপনার বিনিয়োগ সক্রিয় হবে।', true);
    await load();
  } catch (err) {
    showMsg($('#dep-msg'), err.message);
  }
  btn.disabled = false;
});

$('#investments').addEventListener('click', (e) => {
  const id = Number(e.target.dataset.wd);
  if (!id) return;
  wdInvestment = data.investments.find((i) => i.id === id);
  const i = wdInvestment;
  $('#wd-summary').textContent = i.matured
    ? `মেয়াদ পূর্ণ হয়েছে। আপনি পাবেন ${usdt(i.maturity_value)}।`
    : `মেয়াদ এখনো পূর্ণ হয়নি (${fmtDate(i.end_at)})। এখন উত্তোলন করলে শুধু মূলধন ${usdt(i.principal)} ফেরত পাবেন; অর্জিত লাভ ${usdt(i.current_value - i.principal)} বাতিল হবে।`;
  $('#wd-msg').className = '';
  $('#wd-msg').textContent = '';
  $('#wd-dialog').showModal();
});
$('#wd-cancel').addEventListener('click', () => $('#wd-dialog').close());
$('#wd-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/withdrawals', {
      method: 'POST',
      body: { investment_id: wdInvestment.id, network: $('#wd-network').value, address: $('#wd-address').value.trim() },
    });
    $('#wd-dialog').close();
    e.target.reset();
    await load();
    showTab('withdrawals');
  } catch (err) {
    showMsg($('#wd-msg'), err.message);
  }
});

init();
