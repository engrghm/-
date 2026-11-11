let mode = location.hash === '#register' ? 'register' : 'login';
const next = new URLSearchParams(location.search).get('next');
// Only same-site relative paths are accepted as a redirect target.
const safeNext = next && /^\/[a-z?=&0-9]*$/i.test(next) ? next : null;

function setMode(m) {
  mode = m;
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  $('#name-field').classList.toggle('hidden', m !== 'register');
  $('#submit').textContent = m === 'register' ? 'অ্যাকাউন্ট খুলুন' : 'লগইন';
  $('#password').autocomplete = m === 'register' ? 'new-password' : 'current-password';
  $('#msg').className = '';
  $('#msg').textContent = '';
}
$$('.tabs button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
setMode(mode);

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#submit');
  btn.disabled = true;
  try {
    const body = { email: $('#email').value, password: $('#password').value };
    if (mode === 'register') body.name = $('#name').value;
    const r = await api('/' + mode, { method: 'POST', body });
    location.href = r.is_admin ? '/admin' : safeNext || '/dashboard';
  } catch (err) {
    showMsg($('#msg'), err.message);
    btn.disabled = false;
  }
});
