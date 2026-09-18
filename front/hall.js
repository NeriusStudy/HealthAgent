const API_BASE = window.API_BASE || 'http://localhost:8000/api/v1';
const token = localStorage.getItem('water_token');
const storedUser = JSON.parse(localStorage.getItem('water_user') || 'null');

function clearSession() {
  localStorage.removeItem('water_token');
  localStorage.removeItem('water_user');
}

async function verifySession() {
  if (!token || !storedUser) {
    window.location.replace('./index.html');
    return false;
  }

  try {
    const response = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('expired');
    const body = await response.json();
    const user = body.data;
    localStorage.setItem('water_user', JSON.stringify(user));
    const userName = document.querySelector('#userName');
    if (userName) userName.textContent = user.nickname || '用户';
    return true;
  } catch (error) {
    clearSession();
    window.location.replace('./index.html');
    return false;
  }
}

document.querySelector('#logoutButton')?.addEventListener('click', () => {
  clearSession();
  window.location.replace('./index.html');
});

document.querySelector('#waterService')?.addEventListener('click', () => {
  window.location.href = './water.html';
});

document.querySelector('#backToHall')?.addEventListener('click', () => {
  window.location.href = './hall.html';
});

window.sessionReady = verifySession();
