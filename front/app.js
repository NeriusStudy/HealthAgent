const API_BASE = window.API_BASE || 'http://localhost:8000/api/v1';

const state = { registerToken: '' };
const elements = {
  loginView: document.querySelector('#loginView'),
  registerView: document.querySelector('#registerView'),
  loginForm: document.querySelector('#loginForm'),
  registerForm: document.querySelector('#registerForm'),
  loginOpenid: document.querySelector('#loginOpenid'),
  loginPassword: document.querySelector('#loginPassword'),
  registerPassword: document.querySelector('#registerPassword'),
  registerPasswordAgain: document.querySelector('#registerPasswordAgain'),
  registerNickname: document.querySelector('#registerNickname'),
  loginMessage: document.querySelector('#loginMessage'),
  registerMessage: document.querySelector('#registerMessage'),
  backToLogin: document.querySelector('#backToLogin'),
};

function setMessage(element, message, success = false) {
  element.textContent = message;
  element.classList.toggle('success', success);
}

function showView(view) {
  elements.loginView.classList.toggle('hidden', view !== 'login');
  elements.registerView.classList.toggle('hidden', view !== 'register');
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
  } catch (error) {
    throw new Error('无法连接服务器，请确认后端已启动');
  }

  let body = null;
  try {
    body = await response.json();
  } catch (error) {
    throw new Error('服务器返回了无效响应');
  }

  if (!response.ok) {
    const detail = body?.detail;
    if (response.status === 401 && detail === 'invalid password') {
      throw new Error('密码不对，无法登录');
    }
    if (response.status === 401 && detail === 'password is required for existing user') {
      throw new Error('请输入密码后登录');
    }
    throw new Error(detail || body?.message || '请求失败');
  }

  return body?.data;
}

function saveSession(data) {
  localStorage.setItem('water_token', data.token);
  localStorage.setItem('water_user', JSON.stringify(data.user));
}

function validateLoginForm(openid, password) {
  if (!openid) return '请输入微信号';
  if (!password) return '请输入密码';
  return '';
}

elements.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(elements.loginMessage, '');

  const openid = elements.loginOpenid.value.trim();
  const password = elements.loginPassword.value;
  const validationMessage = validateLoginForm(openid, password);
  if (validationMessage) {
    setMessage(elements.loginMessage, validationMessage);
    return;
  }

  const button = elements.loginForm.querySelector('button');
  button.disabled = true;
  try {
    const data = await request('/auth/wechat-login', {
      method: 'POST',
      body: JSON.stringify({ openid, password }),
    });

    if (data.need_register) {
      state.registerToken = data.register_token;
      setMessage(elements.loginMessage, '这是新微信号，请完成注册。', true);
      elements.registerPassword.value = password;
      showView('register');
      elements.registerPasswordAgain.focus();
      return;
    }

    saveSession(data);
    window.location.href = './hall.html';
  } catch (error) {
    setMessage(elements.loginMessage, error.message);
  } finally {
    button.disabled = false;
  }
});

elements.registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(elements.registerMessage, '');

  const password = elements.registerPassword.value;
  const passwordAgain = elements.registerPasswordAgain.value;
  if (password.length < 6 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    setMessage(elements.registerMessage, '密码至少 6 位，且必须同时包含字母和数字');
    return;
  }
  if (password !== passwordAgain) {
    setMessage(elements.registerMessage, '两次输入的密码不一致');
    return;
  }
  if (!state.registerToken) {
    setMessage(elements.registerMessage, '注册信息已失效，请返回重新登录');
    return;
  }

  const button = elements.registerForm.querySelector('button');
  button.disabled = true;
  try {
    const data = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        register_token: state.registerToken,
        password,
        nickname: elements.registerNickname.value.trim() || undefined,
      }),
    });
    saveSession(data);
    window.location.href = './hall.html';
  } catch (error) {
    setMessage(elements.registerMessage, error.message);
  } finally {
    button.disabled = false;
  }
});

elements.backToLogin.addEventListener('click', () => {
  state.registerToken = '';
  elements.registerForm.reset();
  setMessage(elements.registerMessage, '');
  showView('login');
  elements.loginPassword.focus();
});
