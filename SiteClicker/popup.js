// Автор: Сивак Микола Володимирович, Цифросервіс, +380961179898
const ALARM = 'site-clicker-run';
const DAYS = [[1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [0, 'Нд']];
const SLOTS = [1, 2, 3];

let job = { steps: [] };
let texts = [{}, {}, {}]; // заготовлені тексти: [{ text, enter }, ...] (до трьох)
let chain = Promise.resolve();

function $(id) { return document.getElementById(id); }
function err(t) { $('err').textContent = t || ''; }

// Усі зміни job йдуть по черзі: читаємо свіжий job зі сховища, змінюємо і записуємо назад
function updateJob(fn) {
  chain = chain.then(async () => {
    const data = await chrome.storage.local.get('job');
    const j = data.job || { steps: [] };
    j.steps = j.steps || [];
    fn(j);
    await chrome.storage.local.set({ job: j });
    job = j;
  });
  chain = chain.catch((e) => { console.warn('updateJob:', e && e.message); });
  return chain;
}

async function loadJob() {
  const data = await chrome.storage.local.get('job');
  job = data.job || { steps: [] };
  job.steps = job.steps || [];
}

// Розклад із job (старий формат startAt + repeatMin теж підтримується)
function scheduleOf(j) {
  if (j.schedule) return j.schedule;
  const rep = Number(j.repeatMin) || 0;
  if (!j.startAt) return null;
  return { mode: rep > 0 ? 'interval' : 'once', startAt: j.startAt, repeatMin: rep };
}

function fmt(ms) {
  return new Date(ms).toLocaleString('uk-UA');
}

function toLocalInput(ms) {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

function describe(sch) {
  if (!sch) return 'не задано';
  if (sch.mode === 'once') return 'один раз, ' + fmt(sch.startAt);
  if (sch.mode === 'interval') return 'кожні ' + sch.repeatMin + ' хв, починаючи з ' + fmt(sch.startAt);
  if (sch.mode === 'weekly') {
    const names = DAYS.filter((d) => (sch.weekdays || []).indexOf(d[0]) !== -1).map((d) => d[1]);
    return 'щотижня (' + names.join(', ') + ') о ' + sch.time;
  }
  if (sch.mode === 'monthly') return 'щомісяця, ' + sch.monthDay + '-го числа о ' + sch.time;
  return 'не задано';
}

// ---------- Вкладки ----------
async function loadTabs() {
  const sel = $('tab');
  sel.textContent = '';
  const all = await chrome.tabs.query({});
  const web = all.filter((t) => t.url && /^https?:/.test(t.url));
  const wins = [];
  web.forEach((t) => {
    if (wins.indexOf(t.windowId) === -1) wins.push(t.windowId);
  });
  const cur = await chrome.tabs.query({ active: true, currentWindow: true });
  const curId = cur.length ? cur[0].id : null;
  // Поточна сторінка (з якої відкрито вікно) обирається автоматично; якщо це службова сторінка, береться збережена
  let want = curId;
  if (!web.some((t) => t.id === want)) want = job.tabId;
  web.forEach((t) => {
    let host = '';
    try { host = new URL(t.url).host; } catch (e) {}
    const o = document.createElement('option');
    o.value = String(t.id);
    o.dataset.host = host;
    o.textContent = 'Вікно ' + (wins.indexOf(t.windowId) + 1) + ' · ' + (t.title || host).slice(0, 40) + ' (' + host + ')';
    if (t.id === want) o.selected = true;
    sel.appendChild(o);
  });
  if (!web.length) err('Немає відкритих вкладок із сайтами (http/https).');
  updateTabSite();
}

// Назва сайту обраної вкладки виділяється кольором і жирним
function updateTabSite() {
  const sel = $('tab');
  const o = sel.options && sel.options[sel.selectedIndex];
  $('tabSite').textContent = o && o.dataset ? o.dataset.host : '';
}

$('tab').addEventListener('change', updateTabSite);

async function selectedTab() {
  const id = Number($('tab').value);
  if (!id) throw new Error('Оберіть вкладку.');
  return chrome.tabs.get(id);
}

// ---------- Тексти для введення ----------
let openSlot = 0; // рядок тексту, який зараз розгорнуто (0 = усі згорнуті)

// Підсвітка заповнених і короткий перегляд тексту у згорнутому рядку
let textsOpen = false; // розгорнуто весь блок «Текст для введення»

function updateTextRows() {
  const filledCount = SLOTS.filter((n) => $('txt' + n).value.trim()).length;
  $('textsSum').textContent = 'заповнено: ' + filledCount + ' з 3';
  $('textsHead').classList.toggle('filled', filledCount > 0);
  $('textsArrow').textContent = textsOpen ? '▾' : '▸';
  $('textsBody').hidden = !textsOpen;
  SLOTS.forEach((n) => {
    const v = $('txt' + n).value;
    const filled = !!v.trim();
    $('row' + n).classList.toggle('filled', filled);
    $('del' + n).hidden = !filled;
    $('prev' + n).textContent = filled ? v.replace(/\s+/g, ' ').trim().slice(0, 40) + ' ⏎' : 'порожньо';
    $('txt' + n).hidden = openSlot !== n;
  });
}

async function loadTexts() {
  const data = await chrome.storage.local.get('texts');
  const saved = data.texts || [];
  texts = SLOTS.map((n) => saved[n - 1] || {});
  SLOTS.forEach((n) => {
    $('txt' + n).value = texts[n - 1].text || '';
  });
  updateTextRows();
}

// Enter не налаштовується: є текст у полі, отже після вставки натискається Enter; порожнє поле не використовується.
// Записуємо одразу всі три поля цілим масивом, тому порядок подій не має значення
function saveTexts() {
  texts = SLOTS.map((n) => {
    const v = $('txt' + n).value;
    return { text: v, enter: !!v.trim() };
  });
  updateTextRows();
  return chrome.storage.local.set({ texts: texts });
}

SLOTS.forEach((n) => {
  $('txt' + n).addEventListener('input', saveTexts);
  $('del' + n).addEventListener('click', (e) => {
    e.stopPropagation(); // не розгортати і не згортати рядок
    $('txt' + n).value = '';
    saveTexts();
  });
  $('head' + n).addEventListener('click', () => {
    openSlot = openSlot === n ? 0 : n;
    updateTextRows();
    if (openSlot === n) $('txt' + n).focus();
  });
});

// Клік по заголовку «Текст для введення» розгортає або згортає весь блок
$('textsHead').addEventListener('click', () => {
  textsOpen = !textsOpen;
  if (!textsOpen) openSlot = 0;
  updateTextRows();
});

// Клік поза рядками тексту згортає розгорнутий
document.addEventListener('click', (e) => {
  if (openSlot && !e.target.closest('.txtrow')) {
    openSlot = 0;
    updateTextRows();
  }
});

// ---------- Кроки ----------
function renderSummary() {
  const steps = job.steps || [];
  const nText = steps.filter((s) => s.type === 'text').length;
  const nClick = steps.length - nText;
  $('stepsSum').textContent = steps.length
    ? 'Записано кліків: ' + nClick + (nText ? ' · вставок тексту: ' + nText : '')
    : 'Запису ще немає. Натисніть «● Записати».';
  $('record').textContent = steps.length ? '● Записати заново' : '● Записати';
}

function validateSteps() {
  if (!job.steps.length) return 'Спершу запишіть кліки.';
  for (let i = 0; i < job.steps.length; i++) {
    const st = job.steps[i];
    if (st.type !== 'text') continue;
    if (st.slot) {
      const t = texts[st.slot - 1] || {};
      if (!String(t.text || '').trim()) return 'Крок ' + (i + 1) + ': заповніть «Текст ' + st.slot + '».';
    } else if (!String(st.text || '').trim()) {
      return 'Крок ' + (i + 1) + ': введіть текст.';
    }
  }
  return '';
}

// Кожен запис замінює попередній; вставку тексту додають кнопками на панелі запису на сторінці
async function startRecord() {
  err('');
  try {
    const tab = await selectedTab();
    await updateJob((j) => {
      j.tabId = tab.id;
      j.origin = new URL(tab.url).origin;
      j.steps = [];
    });
    // Новий запис починається з порожніх текстів: слоти заповнюються самі, коли набираєте текст у полях на сторінці
    await chrome.storage.local.set({ texts: [{}, {}, {}] });
    await chrome.storage.local.set({ recording: { active: true, tabId: tab.id, mode: 'clicks' } });
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id, { type: 'record-start', mode: 'clicks' });
    } catch (e) {
      await chrome.storage.local.set({ recording: { active: false } });
      throw new Error('Не вдалося почати запис на цій вкладці: ' + e.message);
    }
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    window.close();
  } catch (e) {
    err(e.message);
  }
}

$('record').addEventListener('click', () => {
  const hasText = texts.some((t) => String((t && t.text) || '').trim());
  if (((job.steps || []).length || hasText) && !confirm('Замінити поточний запис новим? Тексти теж будуть очищені.')) return;
  startRecord();
});

// ---------- Розклад ----------
function updateModeUi() {
  const m = $('mode').value;
  $('fStart').hidden = !(m === 'once' || m === 'interval');
  $('fWeekly').hidden = m !== 'weekly';
  $('fMonthly').hidden = m !== 'monthly';
  $('fTime').hidden = !(m === 'weekly' || m === 'monthly');
  $('fInterval').hidden = m !== 'interval';
  $('startLabel').textContent = m === 'interval' ? 'Почати з (дата й час)' : 'Дата й час запуску';
}

function fillSchedule() {
  const sch = scheduleOf(job);
  $('mode').value = sch ? sch.mode : 'once';
  if (sch) {
    if (sch.startAt) $('startAt').value = toLocalInput(sch.startAt);
    if (sch.repeatMin) $('repeatMin').value = String(sch.repeatMin);
    if (sch.time) $('time').value = sch.time;
    if (sch.monthDay) $('monthDay').value = String(sch.monthDay);
    DAYS.forEach((d) => { $('wd' + d[0]).checked = (sch.weekdays || []).indexOf(d[0]) !== -1; });
  }
  updateModeUi();
}

function readSchedule() {
  const mode = $('mode').value;
  if (mode === 'once') {
    const startAt = $('startAt').value ? new Date($('startAt').value).getTime() : 0;
    if (!startAt) throw new Error('Вкажіть дату й час запуску.');
    if (startAt <= Date.now()) throw new Error('Цей час уже минув. Вкажіть майбутній.');
    return { mode: mode, startAt: startAt };
  }
  if (mode === 'interval') {
    const repeat = parseInt($('repeatMin').value, 10) || 0;
    if (repeat < 1) throw new Error('Інтервал має бути не менше 1 хвилини.');
    const startAt = $('startAt').value ? new Date($('startAt').value).getTime() : Date.now() + 3000;
    return { mode: mode, startAt: startAt, repeatMin: repeat };
  }
  const time = $('time').value;
  if (!time) throw new Error('Вкажіть час.');
  if (mode === 'weekly') {
    const weekdays = DAYS.map((d) => d[0]).filter((d) => $('wd' + d).checked);
    if (!weekdays.length) throw new Error('Оберіть хоча б один день тижня.');
    return { mode: mode, weekdays: weekdays, time: time };
  }
  const monthDay = parseInt($('monthDay').value, 10) || 0;
  if (monthDay < 1 || monthDay > 31) throw new Error('Число місяця має бути від 1 до 31.');
  return { mode: 'monthly', monthDay: monthDay, time: time };
}

async function refreshStatus() {
  await loadJob();
  const alarm = await chrome.alarms.get(ALARM);
  const data = await chrome.storage.local.get(['lastResult', 'run']);
  const on = !!job.enabled;
  $('indicator').className = 'ind ' + (on ? 'on' : 'off');
  $('indText').textContent = on ? 'Активно: ' + describe(scheduleOf(job)) : 'Не активно';
  $('next').hidden = !(on && alarm);
  $('next').textContent = on && alarm ? 'Наступний запуск: ' + fmt(alarm.scheduledTime) : '';
  $('save').textContent = on ? 'Зупинити' : 'Зберегти й увімкнути';
  $('saveHint').hidden = on;
  // Підказка лише для «Зупинити»; у режимі «Зберегти й увімкнути» її немає
  if (on) $('save').title = 'Вимкнути автоматичні запуски. Запис кліків лишається';
  else $('save').removeAttribute('title');
  renderSummary();
  const lines = [];
  if (data.run) lines.push('Зараз виконується: ' + data.run.idx + ' з ' + data.run.steps.length + ' кроків');
  if (data.lastResult) {
    lines.push('Останній запуск: ' + fmt(data.lastResult.ts) + ' — ' + (data.lastResult.ok ? 'OK. ' : 'ПОМИЛКА. ') + data.lastResult.text);
  }
  $('status').textContent = lines.join('\n');
}

$('mode').addEventListener('change', updateModeUi);

// «Застосувати» знімає фокус з поля (це зазвичай закриває календар) і показує, що саме обрано
function fmtShort(ms) {
  return new Date(ms).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

$('applyStart').addEventListener('click', () => {
  const v = $('startAt').value;
  $('startAt').blur();
  $('okStart').textContent = v ? '✓ Обрано: ' + fmtShort(new Date(v).getTime()) : 'Спершу оберіть дату й час';
});

$('applyTime').addEventListener('click', () => {
  const v = $('time').value;
  $('time').blur();
  $('okTime').textContent = v ? '✓ Обрано: ' + v : 'Спершу оберіть час';
});

// Змінили значення, і старе підтвердження вже недійсне
$('startAt').addEventListener('input', () => { $('okStart').textContent = ''; });
$('time').addEventListener('input', () => { $('okTime').textContent = ''; });

// Одна кнопка: «Зберегти й увімкнути», а коли розклад активний, вона ж «Зупинити»
$('save').addEventListener('click', async () => {
  err('');
  try {
    await chain;
    await loadJob();
    if (job.enabled) {
      await updateJob((j) => { j.enabled = false; });
      chrome.runtime.sendMessage({ type: 'reschedule' });
      setTimeout(refreshStatus, 500);
      return;
    }
    const bad = validateSteps();
    if (bad) throw new Error(bad);
    const tab = await selectedTab();
    const sch = readSchedule();
    await updateJob((j) => {
      j.tabId = tab.id;
      j.origin = new URL(tab.url).origin;
      j.schedule = sch;
      j.enabled = true;
      delete j.startAt;
      delete j.repeatMin;
    });
    chrome.runtime.sendMessage({ type: 'reschedule' });
    setTimeout(refreshStatus, 500);
  } catch (e) {
    err(e.message);
  }
});

$('runNow').addEventListener('click', async () => {
  err('');
  try {
    const bad = validateSteps();
    if (bad) throw new Error(bad);
    const tab = await selectedTab();
    await updateJob((j) => {
      j.tabId = tab.id;
      j.origin = new URL(tab.url).origin;
    });
    chrome.runtime.sendMessage({ type: 'run-now' });
    setTimeout(refreshStatus, 700);
  } catch (e) {
    err(e.message);
  }
});

(async function init() {
  await loadJob();
  await loadTexts();
  await saveTexts(); // вирівнює збережені тексти під правило «є текст = Enter»
  await loadTabs();
  fillSchedule();
  await refreshStatus();
})();
