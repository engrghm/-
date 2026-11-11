// Small helpers shared by every page.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdt = (n) => money(n) + ' USDT';
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('bn-BD', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const pct = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';

function duration(days) {
  if (days % 365 === 0) return days / 365 + ' বছর';
  if (days % 30 === 0) return days / 30 + ' মাস';
  return days + ' দিন';
}
const COMPOUNDING = { daily: 'দৈনিক', monthly: 'মাসিক' };
const STATUS = {
  pending: 'অপেক্ষমাণ', approved: 'অনুমোদিত', rejected: 'বাতিল', paid: 'পরিশোধিত',
  active: 'চলমান', withdrawing: 'উত্তোলন প্রক্রিয়াধীন', closed: 'সমাপ্ত',
};
const badge = (status) => `<span class="badge ${esc(status)}">${esc(STATUS[status] || status)}</span>`;

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'কিছু একটা সমস্যা হয়েছে।');
    err.status = res.status;
    throw err;
  }
  return data;
}

function showMsg(el, text, ok = false) {
  el.textContent = text;
  el.className = 'msg ' + (ok ? 'ok' : 'err');
}

async function logout() {
  await api('/logout', { method: 'POST', body: {} }).catch(() => {});
  location.href = '/';
}
