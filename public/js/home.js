let plans = [];

function renderPlans() {
  $('#plan-list').innerHTML = plans.map((p) => {
    const multiple = Compound.multiple(p.apy, p.duration_days);
    return `
    <div class="card plan ${p.featured ? 'featured' : ''}">
      ${p.featured ? '<span class="badge gold">বিশেষ প্ল্যান</span>' : `<span class="badge">${esc(duration(p.duration_days))}</span>`}
      <h3>${esc(p.name)}</h3>
      <div class="rate num">${pct(p.apy)} <span class="small muted">APY</span></div>
      <div class="muted small">${esc(p.description)}</div>
      <ul>
        <li><span>মেয়াদ</span><span>${esc(duration(p.duration_days))}</span></li>
        <li><span>কম্পাউন্ডিং</span><span>${COMPOUNDING[p.compounding]}</span></li>
        <li><span>মেয়াদ শেষে</span><span class="num">${multiple.toFixed(2)}x</span></li>
        <li><span>সর্বনিম্ন</span><span class="num">${usdt(p.min_amount)}</span></li>
        <li><span>সর্বোচ্চ</span><span class="num">${usdt(p.max_amount)}</span></li>
      </ul>
      <a class="btn block ${p.featured ? '' : 'ghost'}" href="/dashboard?plan=${p.id}">এই প্ল্যানে বিনিয়োগ করুন</a>
    </div>`;
  }).join('') || '<p class="empty">এই মুহূর্তে কোনো প্ল্যান চালু নেই।</p>';
}

function renderKpis() {
  if (!plans.length) return;
  const best = plans.reduce((a, b) => (b.apy > a.apy ? b : a));
  const minEntry = Math.min(...plans.map((p) => p.min_amount));
  $('#kpis').innerHTML = `
    <div class="kpi"><b class="num">${pct(best.apy)}</b><span class="muted small">সর্বোচ্চ বার্ষিক রিটার্ন (APY)</span></div>
    <div class="kpi"><b class="num">${Compound.multiple(best.apy, best.duration_days).toFixed(2)}x</b><span class="muted small">${esc(duration(best.duration_days))} মেয়াদে মূলধন</span></div>
    <div class="kpi"><b class="num">${usdt(minEntry)}</b><span class="muted small">থেকে শুরু করা যায়</span></div>
    <div class="kpi"><b>${plans.length}টি</b><span class="muted small">ভিন্ন মেয়াদের প্ল্যান</span></div>`;
}

function drawChart(points, principal) {
  const W = 520, H = 260, L = 56, R = 12, T = 14, B = 28;
  const max = points[points.length - 1].v, min = principal;
  const span = Math.max(max - min, 1e-9);
  const x = (i) => L + (i / (points.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - min) / span) * (H - T - B);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1)},${H - B} L${L},${H - B} Z`;
  $('#calc-chart').innerHTML = `
    <path class="area" d="${area}"/>
    <line class="base" x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}"/>
    <path class="line" d="${line}"/>
    <text x="${L - 6}" y="${T + 4}" text-anchor="end">${money(max)}</text>
    <text x="${L - 6}" y="${H - B + 4}" text-anchor="end">${money(min)}</text>
    <text x="${L}" y="${H - 8}">শুরু</text>
    <text x="${W - R}" y="${H - 8}" text-anchor="end">${esc(points[points.length - 1].label)}</text>`;
}

function calculate() {
  const p = plans.find((x) => x.id === Number($('#calc-plan').value));
  const amount = Number($('#calc-amount').value);
  if (!p || !(amount > 0)) return;
  const final = Compound.maturityValue(amount, p.apy, p.duration_days);
  $('#calc-final').textContent = usdt(final);
  $('#calc-profit').textContent = '+' + usdt(final - amount);
  $('#calc-multiple').textContent = (final / amount).toFixed(2) + 'x';
  $('#calc-formula').textContent =
    `সূত্র: মূলধন × (১ + APY)^(দিন ÷ ৩৬৫) — ${pct(p.apy)} APY, ${COMPOUNDING[p.compounding]} কম্পাউন্ডিং, ${duration(p.duration_days)} মেয়াদ।`;

  const steps = 40;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const d = (p.duration_days * i) / steps;
    points.push({ v: Compound.valueAt(amount, p.apy, p.duration_days, p.compounding, d), label: duration(p.duration_days) });
  }
  drawChart(points, amount);

  // Yearly (or monthly for short plans) milestones.
  const unit = p.duration_days >= 730 ? 365 : 30;
  const rows = [];
  for (let d = unit; d < p.duration_days; d += unit) rows.push(d);
  rows.push(p.duration_days);
  $('#calc-table').innerHTML =
    '<tr><th>সময়</th><th>মূল্য</th><th>লাভ</th></tr>' +
    rows.slice(-6).map((d) => {
      const v = Compound.valueAt(amount, p.apy, p.duration_days, p.compounding, d);
      return `<tr><td>${esc(duration(d))}</td><td class="num">${usdt(v)}</td><td class="num">+${usdt(v - amount)}</td></tr>`;
    }).join('');
}

async function init() {
  $('#year').textContent = new Date().getFullYear();
  api('/me').then(({ user }) => {
    if (!user) return;
    $('#nav-login').classList.add('hidden');
    $('#nav-cta').textContent = 'ড্যাশবোর্ড';
    $('#nav-cta').href = user.is_admin ? '/admin' : '/dashboard';
  }).catch(() => {});

  plans = (await api('/plans')).plans;
  renderPlans();
  renderKpis();
  $('#calc-plan').innerHTML = plans.map((p) => `<option value="${p.id}" ${p.featured ? 'selected' : ''}>${esc(p.name)} — ${pct(p.apy)} APY, ${esc(duration(p.duration_days))}</option>`).join('');
  $('#calc-plan').addEventListener('change', calculate);
  $('#calc-amount').addEventListener('input', calculate);
  calculate();
}
init();
