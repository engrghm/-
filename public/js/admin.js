let data = null, editingPlan = null;
const STABLE = ['USDT', 'USDC', 'DAI', 'BUSD'];

function table(head, rows, empty) {
  if (!rows.length) return `<div class="empty">${empty}</div>`;
  return `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.join('')}</table>`;
}
const note = (text, ok) => { showMsg($('#msg'), text, ok); window.scrollTo({ top: 0, behavior: 'smooth' }); };

async function act(fn, okText) {
  try {
    await fn();
    await load();
    note(okText, true);
  } catch (err) {
    note(err.message);
  }
}

function render() {
  const s = data.stats;
  $('#stats').innerHTML = [
    ['ইউজার', s.users],
    ['মোট চলমান মূলধন', usdt(s.principal)],
    ['বর্তমান দায়', usdt(s.liability_now)],
    ['মেয়াদ শেষে মোট দায়', usdt(s.liability_at_maturity)],
    ['অপেক্ষমাণ ডিপোজিট', s.pending_deposits],
    ['অপেক্ষমাণ উত্তোলন', s.pending_withdrawals],
  ].map(([l, v]) => `<div class="card stat"><div class="label">${l}</div><div class="value num">${v}</div></div>`).join('');

  $('#deposits').innerHTML = table(
    ['তারিখ', 'ইউজার', 'প্ল্যান', 'পরিমাণ', 'TxID', 'অবস্থা', 'ক্রেডিট (USDT)', ''],
    data.deposits.map((d) => {
      const pending = d.status === 'pending';
      return `<tr>
        <td>${fmtDate(d.created_at)}</td>
        <td>${esc(d.user_name)}<div class="muted small">${esc(d.email)}</div></td>
        <td>${esc(d.plan_name)}<div class="muted small num">${money(d.min_amount)}–${money(d.max_amount)}</div></td>
        <td class="num">${esc(d.amount)} ${esc(d.asset)}<div class="muted small">${esc(d.network)}</div></td>
        <td class="wrap-any">${esc(d.txid)}</td>
        <td>${badge(d.status)}</td>
        <td>${pending ? `<input type="number" step="any" min="0" aria-label="ক্রেডিট পরিমাণ" data-credit="${d.id}" value="${STABLE.includes(d.asset) ? esc(d.amount) : ''}">` : ''}</td>
        <td>${pending ? `<div class="actions"><button class="btn good sm" data-approve="${d.id}">অনুমোদন</button><button class="btn bad sm" data-reject="${d.id}">বাতিল</button></div>` : ''}</td>
      </tr>`;
    }),
    'কোনো ডিপোজিট নেই।'
  );

  $('#withdrawals').innerHTML = table(
    ['তারিখ', 'ইউজার', 'প্ল্যান', 'পরিমাণ', 'নেটওয়ার্ক', 'অ্যাড্রেস', 'অবস্থা', 'পেআউট TxID', ''],
    data.withdrawals.map((w) => {
      const pending = w.status === 'pending';
      return `<tr>
        <td>${fmtDate(w.created_at)}</td>
        <td>${esc(w.email)}</td>
        <td>${esc(w.plan_name)}</td>
        <td class="num">${usdt(w.amount)}${w.early ? '<div class="muted small">মেয়াদের আগে</div>' : ''}</td>
        <td>${esc(w.network)}</td>
        <td class="wrap-any">${esc(w.address)}</td>
        <td>${badge(w.status)}</td>
        <td class="wrap-any">${pending ? `<input aria-label="পেআউট TxID" data-payout="${w.id}" maxlength="120">` : esc(w.payout_txid) || '—'}</td>
        <td>${pending ? `<div class="actions"><button class="btn good sm" data-paid="${w.id}">পরিশোধিত</button><button class="btn bad sm" data-wreject="${w.id}">বাতিল</button></div>` : ''}</td>
      </tr>`;
    }),
    'কোনো উত্তোলনের অনুরোধ নেই।'
  );

  $('#investments').innerHTML = table(
    ['ইউজার', 'প্ল্যান', 'মূলধন', 'বর্তমান মূল্য', 'মেয়াদ শেষে', 'শুরু', 'মেয়াদ পূর্ণ', 'অবস্থা'],
    data.investments.map((i) => `<tr>
      <td>${esc(i.email)}</td>
      <td>${esc(i.plan_name)}<div class="muted small">${pct(i.apy)} APY</div></td>
      <td class="num">${usdt(i.principal)}</td>
      <td class="num">${usdt(i.current_value)}</td>
      <td class="num">${usdt(i.maturity_value)}</td>
      <td>${fmtDate(i.start_at)}</td>
      <td>${fmtDate(i.end_at)}</td>
      <td>${badge(i.status)}</td>
    </tr>`),
    'কোনো বিনিয়োগ নেই।'
  );

  $('#plans').innerHTML = table(
    ['নাম', 'মেয়াদ', 'APY', 'গুণিতক', 'কম্পাউন্ডিং', 'সীমা (USDT)', 'অবস্থা', ''],
    data.plans.map((p) => `<tr>
      <td>${esc(p.name)} ${p.featured ? '<span class="badge gold">হাইলাইট</span>' : ''}</td>
      <td>${esc(duration(p.duration_days))}</td>
      <td class="num">${pct(p.apy)}</td>
      <td class="num">${Compound.multiple(p.apy, p.duration_days).toFixed(2)}x</td>
      <td>${COMPOUNDING[p.compounding]}</td>
      <td class="num">${money(p.min_amount)} – ${money(p.max_amount)}</td>
      <td>${p.active ? '<span class="badge active">চালু</span>' : '<span class="badge closed">বন্ধ</span>'}</td>
      <td><button class="btn ghost sm" data-edit="${p.id}">সম্পাদনা</button></td>
    </tr>`),
    'কোনো প্ল্যান নেই।'
  );

  $('#wallets').innerHTML = data.wallets.map((w) => `
    <div class="row" data-wallet="${w.id}">
      <div class="field"><label>কয়েন</label><input value="${esc(w.asset)} (${esc(w.network)})" disabled></div>
      <div class="field"><label>অ্যাড্রেস</label><input data-addr value="${esc(w.address)}" maxlength="120" autocomplete="off"></div>
      <div class="field"><label>চালু</label><select data-active><option value="1" ${w.active ? 'selected' : ''}>হ্যাঁ</option><option value="0" ${w.active ? '' : 'selected'}>না</option></select></div>
      <div class="field"><label>&nbsp;</label><button class="btn ghost" data-wsave="${w.id}">সংরক্ষণ</button></div>
    </div>`).join('');

  $('#users').innerHTML = table(
    ['আইডি', 'নাম', 'ইমেইল', 'ধরন', 'যোগদান'],
    data.users.map((u) => `<tr><td>${u.id}</td><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${u.is_admin ? 'অ্যাডমিন' : 'ক্লায়েন্ট'}</td><td>${fmtDate(u.created_at)}</td></tr>`),
    'কোনো ইউজার নেই।'
  );
}

async function load() {
  data = await api('/admin/overview');
  render();
}

function fillPlan(p) {
  editingPlan = p ? p.id : null;
  $('#plan-form-title').textContent = p ? `প্ল্যান সম্পাদনা: ${p.name}` : 'নতুন প্ল্যান';
  $('#p-name').value = p ? p.name : '';
  $('#p-days').value = p ? p.duration_days : '';
  $('#p-apy').value = p ? p.apy : '';
  $('#p-comp').value = p ? p.compounding : 'daily';
  $('#p-min').value = p ? p.min_amount : '';
  $('#p-max').value = p ? p.max_amount : '';
  $('#p-featured').value = p && p.featured ? '1' : '0';
  $('#p-active').value = !p || p.active ? '1' : '0';
  $('#p-desc').value = p ? p.description : '';
  planHint();
}
function planHint() {
  const days = Number($('#p-days').value), apy = Number($('#p-apy').value);
  $('#p-hint').textContent = days > 0 && apy > 0
    ? `এই প্ল্যানে মেয়াদ শেষে মূলধন ${Compound.multiple(apy, days).toFixed(3)}x হবে। সম্পাদনা করলে শুধু নতুন বিনিয়োগে প্রযোজ্য হবে।`
    : '';
}

document.addEventListener('click', (e) => {
  const d = e.target.dataset;
  if (d.approve) {
    const credited = Number($(`[data-credit="${d.approve}"]`).value);
    if (!(credited > 0)) return note('ক্রেডিট করার পরিমাণ (USDT) দিন।');
    if (!confirm(`ব্লকচেইনে লেনদেন যাচাই করেছেন? ${usdt(credited)} ক্রেডিট হবে।`)) return;
    act(() => api(`/admin/deposits/${d.approve}/approve`, { method: 'POST', body: { credited } }), 'ডিপোজিট অনুমোদিত হয়েছে।');
  } else if (d.reject) {
    const reason = prompt('বাতিলের কারণ (ঐচ্ছিক):');
    if (reason === null) return;
    act(() => api(`/admin/deposits/${d.reject}/reject`, { method: 'POST', body: { note: reason } }), 'ডিপোজিট বাতিল হয়েছে।');
  } else if (d.paid) {
    const payout_txid = $(`[data-payout="${d.paid}"]`).value.trim();
    act(() => api(`/admin/withdrawals/${d.paid}/paid`, { method: 'POST', body: { payout_txid } }), 'উত্তোলন পরিশোধিত হিসেবে চিহ্নিত হয়েছে।');
  } else if (d.wreject) {
    if (!confirm('উত্তোলনের অনুরোধ বাতিল করবেন? বিনিয়োগটি আবার চলমান হবে।')) return;
    act(() => api(`/admin/withdrawals/${d.wreject}/reject`, { method: 'POST', body: {} }), 'উত্তোলন বাতিল হয়েছে।');
  } else if (d.edit) {
    fillPlan(data.plans.find((p) => p.id === Number(d.edit)));
    $('#plan-form').scrollIntoView({ behavior: 'smooth' });
  } else if (d.wsave) {
    const row = $(`[data-wallet="${d.wsave}"]`);
    act(() => api(`/admin/wallets/${d.wsave}`, {
      method: 'PUT',
      body: { address: $('[data-addr]', row).value.trim(), active: $('[data-active]', row).value === '1' },
    }), 'ওয়ালেট সংরক্ষিত হয়েছে।');
  }
});

$$('.tabs button').forEach((b) => b.addEventListener('click', () => {
  $$('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  $$('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== b.dataset.tab));
}));
$('#logout').addEventListener('click', logout);
$('#p-days').addEventListener('input', planHint);
$('#p-apy').addEventListener('input', planHint);
$('#plan-reset').addEventListener('click', () => fillPlan(null));
$('#plan-double').addEventListener('click', () => {
  const days = Number($('#p-days').value);
  if (!(days > 0)) return note('আগে মেয়াদ (দিন) দিন।');
  $('#p-apy').value = Compound.apyForMultiple(2, days).toFixed(4);
  planHint();
});

$('#plan-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const body = {
    name: $('#p-name').value,
    description: $('#p-desc').value,
    duration_days: Number($('#p-days').value),
    apy: Number($('#p-apy').value),
    compounding: $('#p-comp').value,
    min_amount: Number($('#p-min').value),
    max_amount: Number($('#p-max').value),
    featured: $('#p-featured').value === '1',
    active: $('#p-active').value === '1',
  };
  const id = editingPlan;
  act(async () => {
    await api(id ? `/admin/plans/${id}` : '/admin/plans', { method: id ? 'PUT' : 'POST', body });
    fillPlan(null);
  }, 'প্ল্যান সংরক্ষিত হয়েছে।');
});

$('#wallet-form').addEventListener('submit', (e) => {
  e.preventDefault();
  act(async () => {
    await api('/admin/wallets', { method: 'POST', body: { asset: $('#w-asset').value, network: $('#w-network').value } });
    e.target.reset();
  }, 'নতুন কয়েন যোগ হয়েছে। এখন অ্যাড্রেস দিয়ে চালু করুন।');
});

load().catch((err) => {
  if (err.status === 401) location.href = '/auth';
  else if (err.status === 403) location.href = '/dashboard';
});
