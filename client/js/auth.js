const API = '/api/v1/auth';

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

function showMessage(text, type) {
  const el = document.getElementById('form-message');
  if (!el) return;
  el.textContent = text;
  el.className = `form-message ${type || ''}`;
}

function errorText(data) {
  if (data.errors) return data.errors.map((e) => e.message).join('. ');
  return data.message || 'Something went wrong. Please try again.';
}

function handleForm(formId, path, onSuccess) {
  const form = document.getElementById(formId);
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const body = Object.fromEntries(new FormData(form).entries());

    showMessage('');
    button.disabled = true;

    try {
      const result = await request(path, { method: 'POST', body: JSON.stringify(body) });
      if (result.ok) {
        onSuccess();
      } else {
        showMessage(errorText(result.data), 'error');
      }
    } catch (err) {
      showMessage('Cannot reach the server. Check your connection.', 'error');
    } finally {
      button.disabled = false;
    }
  });
}

handleForm('register-form', '/register', async () => {
  showMessage('Account created! Logging you in…', 'success');
  const form = document.getElementById('register-form');
  const body = {
    email: form.elements.email.value,
    password: form.elements.password.value,
  };
  const login = await request('/login', { method: 'POST', body: JSON.stringify(body) });
  if (login.ok) {
    window.location.href = '/account.html';
  } else {
    window.location.href = '/login.html';
  }
});

handleForm('login-form', '/login', () => {
  window.location.href = '/account.html';
});

async function loadAccount() {
  const card = document.getElementById('account-card');
  if (!card) return;

  const loading = document.getElementById('loading');
  const result = await request('/me').catch(() => null);

  if (!result || !result.ok) {
    window.location.href = '/login.html';
    return;
  }

  loading.hidden = true;
  const username = document.getElementById('account-username');
  const email = document.getElementById('account-email');
  username.textContent = `Username: ${result.data.user.username}`;
  email.textContent = `Email: ${result.data.user.email}`;
  username.hidden = false;
  email.hidden = false;

  const logoutBtn = document.getElementById('logout-btn');
  logoutBtn.hidden = false;
  logoutBtn.addEventListener('click', async () => {
    await request('/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });
}

loadAccount();