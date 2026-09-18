(() => {
const API_BASE = window.API_BASE || 'http://localhost:8000/api/v1';
const token = localStorage.getItem('water_token');
const user = JSON.parse(localStorage.getItem('water_user') || 'null');
const state = { records: [], editingId: null };
const elements = {
  list: document.querySelector('#recordList'),
  count: document.querySelector('#recordCount'),
  addButton: document.querySelector('#addRecordButton'),
  modal: document.querySelector('#recordModal'),
  modalTitle: document.querySelector('#recordModalTitle'),
  form: document.querySelector('#recordForm'),
  amount: document.querySelector('#recordAmount'),
  drankAt: document.querySelector('#recordDrankAt'),
  cancel: document.querySelector('#cancelRecord'),
  formMessage: document.querySelector('#recordFormMessage'),
  goalInput: document.querySelector('#goalInput'),
  saveGoalButton: document.querySelector('#saveGoalButton'),
  goalMessage: document.querySelector('#goalMessage'),
  todayAmount: document.querySelector('#todayAmount'),
  todayProgress: document.querySelector('#todayProgress'),
  todayProgressBar: document.querySelector('#todayProgressBar'),
  queryStart: document.querySelector('#queryStart'),
  queryEnd: document.querySelector('#queryEnd'),
  queryButton: document.querySelector('#queryButton'),
  queryMessage: document.querySelector('#queryMessage'),
  rangeTotal: document.querySelector('#rangeTotal'),
  rangeAverage: document.querySelector('#rangeAverage'),
  dailyStats: document.querySelector('#dailyStats'),
};

function localDateTimeValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function displayDate(value) {
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function dateInputValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function dateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function dateLabel(value) {
  const [year, month, day] = value.split('-');
  return `${year}/${month}/${day}`;
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  let body = null;
  try { body = await response.json(); } catch (error) { throw new Error('服务器返回了无效响应'); }
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('water_token');
      localStorage.removeItem('water_user');
      window.location.replace('./index.html');
    }
    throw new Error(body?.detail || '操作失败');
  }
  return body?.data;
}

function renderRecords() {
  elements.count.textContent = `${state.records.length} 条记录`;
  if (!state.records.length) {
    elements.list.innerHTML = '<div class="record-empty">还没有饮水记录<br /><small>点击上方按钮记录第一杯水</small></div>';
    return;
  }

  elements.list.innerHTML = state.records.map((record) => `
    <article class="record-row">
      <div class="record-amount"><strong>${record.amount_ml}</strong><span>ml</span></div>
      <div class="record-time">${displayDate(record.drank_at)}</div>
      <div class="record-actions">
        <button class="icon-button edit-record" data-id="${record.id}" type="button" aria-label="编辑记录">编辑</button>
        <button class="icon-button delete-record" data-id="${record.id}" type="button" aria-label="删除记录">删除</button>
      </div>
    </article>
  `).join('');

  elements.list.querySelectorAll('.edit-record').forEach((button) => {
    button.addEventListener('click', () => openModal(Number(button.dataset.id)));
  });
  elements.list.querySelectorAll('.delete-record').forEach((button) => {
    button.addEventListener('click', () => deleteRecord(Number(button.dataset.id)));
  });
}

async function loadRecords() {
  const data = await request(`/water-records?user_id=${encodeURIComponent(user.user_id)}&page=1&page_size=100`);
  state.records = (data.records || []).sort((a, b) => new Date(b.drank_at) - new Date(a.drank_at));
  renderRecords();
}

async function loadGoal() {
  const goal = await request(`/water-goals?user_id=${encodeURIComponent(user.user_id)}`);
  elements.goalInput.value = goal?.target_ml || '';
  return goal?.target_ml || 0;
}

function setPanelMessage(element, message) {
  element.textContent = message;
}

async function loadTodaySummary(target) {
  const today = dateInputValue();
  const start = new Date(`${today}T00:00:00`);
  const end = new Date(`${today}T23:59:59.999`);
  const data = await request(`/water-records/range?user_id=${encodeURIComponent(user.user_id)}&start_time=${encodeURIComponent(start.toISOString())}&end_time=${encodeURIComponent(end.toISOString())}&page=1&page_size=1000`);
  const amount = (data.records || []).reduce((sum, record) => sum + Number(record.amount_ml), 0);
  elements.todayAmount.textContent = `${amount} ml`;
  if (!target) {
    elements.todayProgress.textContent = '暂无目标';
    elements.todayProgressBar.style.width = '0%';
    return;
  }
  const percent = Math.round((amount / target) * 100);
  elements.todayProgress.textContent = `${percent}%`;
  elements.todayProgressBar.style.width = `${Math.min(percent, 100)}%`;
}

function renderDailyStats(records, startDate, endDate, target) {
  const totals = {};
  records.forEach((record) => {
    const key = dateKey(record.drank_at);
    totals[key] = (totals[key] || 0) + Number(record.amount_ml);
  });

  const days = [];
  const cursor = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  while (cursor <= end) {
    const key = dateInputValue(cursor);
    days.push({ key, amount: totals[key] || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  const total = days.reduce((sum, day) => sum + day.amount, 0);
  elements.rangeTotal.textContent = `${total} ml`;
  elements.rangeAverage.textContent = `${Math.round(total / Math.max(days.length, 1))} ml`;
  elements.dailyStats.innerHTML = days.map((day) => {
    let status = '暂无目标';
    let statusClass = 'pending';
    if (target) {
      status = day.amount >= target ? '已达成' : `还差 ${target - day.amount} ml`;
      statusClass = day.amount >= target ? '' : 'pending';
    }
    return `<div class="daily-stat-row"><span class="daily-stat-date">${dateLabel(day.key)}</span><strong class="daily-stat-amount">${day.amount} ml</strong><span class="daily-stat-status ${statusClass}">${status}</span></div>`;
  }).join('');
}

async function queryStats() {
  const startDate = elements.queryStart.value;
  const endDate = elements.queryEnd.value;
  if (!startDate || !endDate) {
    setPanelMessage(elements.queryMessage, '请选择开始日期和截至日期');
    return;
  }
  if (startDate > endDate) {
    setPanelMessage(elements.queryMessage, '开始日期不能晚于截至日期');
    return;
  }
  setPanelMessage(elements.queryMessage, '');
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T23:59:59.999`);
  const data = await request(`/water-records/range?user_id=${encodeURIComponent(user.user_id)}&start_time=${encodeURIComponent(start.toISOString())}&end_time=${encodeURIComponent(end.toISOString())}&page=1&page_size=1000`);
  const target = Number(elements.goalInput.value) || 0;
  renderDailyStats(data.records || [], startDate, endDate, target);
}

function setFormMessage(message) {
  elements.formMessage.textContent = message;
}

function openModal(id = null) {
  state.editingId = id;
  setFormMessage('');
  elements.modalTitle.textContent = id === null ? '新增饮水记录' : '编辑饮水记录';
  const record = id === null ? null : state.records.find((item) => item.id === id);
  elements.amount.value = record ? record.amount_ml : '';
  elements.drankAt.value = record ? localDateTimeValue(new Date(record.drank_at)) : localDateTimeValue();
  elements.modal.classList.remove('hidden');
  elements.amount.focus();
}

function closeModal() {
  elements.modal.classList.add('hidden');
  elements.form.reset();
  state.editingId = null;
}

async function deleteRecord(id) {
  if (!window.confirm('确定删除这条饮水记录吗？')) return;
  try {
    await request(`/water-records/${id}`, { method: 'DELETE' });
    await loadRecords();
  } catch (error) {
    window.alert(error.message);
  }
}

function initializeWaterPage() {
  if (!elements.addButton || !elements.modal || !elements.form) return;

  elements.addButton.addEventListener('click', () => openModal());
  elements.cancel.addEventListener('click', closeModal);
  elements.modal.addEventListener('click', (event) => {
    if (event.target === elements.modal) closeModal();
  });
  elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setFormMessage('');
  const amount = Number(elements.amount.value);
  const drankAt = new Date(elements.drankAt.value);
  if (!Number.isInteger(amount) || amount <= 0 || amount > 5000) {
    setFormMessage('饮水量必须是 1 到 5000 之间的整数');
    return;
  }
  if (Number.isNaN(drankAt.getTime())) {
    setFormMessage('请选择有效的饮水时间');
    return;
  }

  const button = elements.form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const payload = { amount_ml: amount, drank_at: drankAt.toISOString() };
    if (state.editingId === null) {
      await request('/water-records', { method: 'POST', body: JSON.stringify({ ...payload, user_id: user.user_id }) });
    } else {
      await request(`/water-records/${state.editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
    }
    closeModal();
    await loadRecords();
  } catch (error) {
    setFormMessage(error.message);
  } finally {
    button.disabled = false;
  }
  });

  elements.saveGoalButton.addEventListener('click', async () => {
    const target = Number(elements.goalInput.value);
    if (!Number.isInteger(target) || target <= 0 || target > 10000) {
      setPanelMessage(elements.goalMessage, '请输入 1 到 10000 之间的整数');
      return;
    }
    elements.saveGoalButton.disabled = true;
    setPanelMessage(elements.goalMessage, '');
    try {
      await request('/water-goals', { method: 'PUT', body: JSON.stringify({ user_id: user.user_id, target_ml: target }) });
      await loadTodaySummary(target);
      await queryStats();
      setPanelMessage(elements.goalMessage, '目标已保存');
    } catch (error) {
      setPanelMessage(elements.goalMessage, error.message);
    } finally {
      elements.saveGoalButton.disabled = false;
    }
  });

  elements.queryButton.addEventListener('click', () => {
    queryStats().catch((error) => setPanelMessage(elements.queryMessage, error.message));
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeWaterPage, { once: true });
} else {
  initializeWaterPage();
}

if (token && user) {
  Promise.resolve(window.sessionReady)
    .then(async (valid) => {
      if (!valid) return;
      elements.queryStart.value = dateInputValue();
      elements.queryEnd.value = dateInputValue();
      const [target] = await Promise.all([loadGoal(), loadRecords()]);
      await Promise.all([loadTodaySummary(target), queryStats()]);
    })
    .catch((error) => setFormMessage(error.message));
}
})();
