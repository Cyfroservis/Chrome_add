// Автор: Сивак Микола Володимирович, Цифросервіс, +380961179898
const ALARM = 'site-clicker-run';
const MAX_RUN_MS = 10 * 60000;

function setResult(ok, text) {
  return chrome.storage.local.set({ lastResult: { ok: ok, text: text, ts: Date.now() } });
}

// Розклад із job. Старий формат (startAt + repeatMin) перетворюється на once/interval.
function getSchedule(job) {
  if (job.schedule) return job.schedule;
  const rep = Number(job.repeatMin) || 0;
  return { mode: rep > 0 ? 'interval' : 'once', startAt: Number(job.startAt) || 0, repeatMin: rep };
}

function parseTime(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return { h: h, mi: mi };
}

// Перший запуск суворо ПІСЛЯ моменту after (мс). 0 = запусків більше не буде.
function nextRun(sch, after) {
  if (!sch) return 0;

  if (sch.mode === 'once') {
    const at = Number(sch.startAt) || 0;
    return at > after ? at : 0;
  }

  if (sch.mode === 'interval') {
    const period = (Number(sch.repeatMin) || 0) * 60000;
    const first = Number(sch.startAt) || 0;
    if (period <= 0 || !first) return 0;
    if (first > after) return first;
    return first + (Math.floor((after - first) / period) + 1) * period;
  }

  const t = parseTime(sch.time);
  if (!t) return 0;
  const base = new Date(after);

  if (sch.mode === 'weekly') {
    const days = sch.weekdays || [];
    if (!days.length) return 0;
    for (let i = 0; i <= 7; i++) {
      const c = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, t.h, t.mi, 0, 0);
      if (days.indexOf(c.getDay()) !== -1 && c.getTime() > after) return c.getTime();
    }
    return 0;
  }

  if (sch.mode === 'monthly') {
    const md = Number(sch.monthDay) || 0;
    if (md < 1 || md > 31) return 0;
    for (let i = 0; i <= 13; i++) {
      // Якщо в місяці менше днів (наприклад, 31 у листопаді) — запуск в останній день місяця
      const dim = new Date(base.getFullYear(), base.getMonth() + i + 1, 0).getDate();
      const c = new Date(base.getFullYear(), base.getMonth() + i, Math.min(md, dim), t.h, t.mi, 0, 0);
      if (c.getTime() > after) return c.getTime();
    }
    return 0;
  }

  return 0;
}

// Завжди одноразовий alarm; після кожного спрацювання наступний час рахується заново
async function reschedule(after, quiet) {
  await chrome.alarms.clear(ALARM);
  const data = await chrome.storage.local.get('job');
  const job = data.job;
  if (!job || !job.enabled || !job.steps || !job.steps.length) return;
  const when = nextRun(getSchedule(job), after || Date.now());
  if (!when) {
    job.enabled = false;
    await chrome.storage.local.set({ job: job });
    if (!quiet) await setResult(false, 'Розклад вимкнено: наступного запуску немає (час минув або розклад неповний)');
    return;
  }
  chrome.alarms.create(ALARM, { when: when });
}

function inject(tabId) {
  return chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content.js'] });
}

async function findTab(job) {
  if (job.tabId != null) {
    try {
      return await chrome.tabs.get(job.tabId);
    } catch (e) {}
  }
  if (job.origin) {
    const tabs = await chrome.tabs.query({});
    const found = tabs.find((t) => t.url && t.url.indexOf(job.origin) === 0);
    if (found) return found;
  }
  return null;
}

// Фонові вкладки Chrome сильно сповільнює, тому перед кліками робимо вкладку активною, а її вікно переднім.
// Назад на попередню вкладку після завершення не повертаємось.
async function bringToFront(tab) {
  try {
    await chrome.tabs.update(tab.id, { active: true });
    const win = await chrome.windows.get(tab.windowId);
    const upd = { focused: true };
    if (win.state === 'minimized') upd.state = 'normal';
    await chrome.windows.update(tab.windowId, upd);
    // Невелика пауза, щоб вкладка встигла стати видимою
    await new Promise((resolve) => setTimeout(resolve, 300));
  } catch (e) {
    console.warn('Не вдалося перейти на вкладку', tab.id, e && e.message);
  }
}

async function startRun() {
  const data = await chrome.storage.local.get(['job', 'run']);
  const job = data.job;
  if (!job || !job.steps || !job.steps.length) {
    await setResult(false, 'Немає записаних кроків');
    return;
  }
  if (data.run && Date.now() - data.run.startedAt < MAX_RUN_MS) {
    await setResult(false, 'Попередній запуск ще триває');
    return;
  }
  const tab = await findTab(job);
  if (!tab) {
    await setResult(false, 'Вкладку не знайдено: відкрийте сайт');
    return;
  }
  await bringToFront(tab);
  await chrome.storage.local.set({ run: { tabId: tab.id, steps: job.steps, idx: 0, startedAt: Date.now() } });
  try {
    await inject(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: 'run-resume' });
  } catch (e) {
    await chrome.storage.local.remove('run');
    await setResult(false, 'Не вдалося запустити на вкладці: ' + (e && e.message));
  }
}

chrome.runtime.onInstalled.addListener(() => reschedule());

chrome.runtime.onStartup.addListener(async () => {
  // Ідентифікатори вкладок після перезапуску браузера недійсні
  await chrome.storage.local.remove(['recording', 'run']);
  await reschedule();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return;
  await startRun();
  // Наступний запуск рахуємо від моменту спрацювання; одноразовий розклад після запуску тихо вимикається
  await reschedule(Math.max(Date.now(), alarm.scheduledTime || 0), true);
});

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === 'reschedule') reschedule();
  if (msg.type === 'run-now') startRun();
});

// Після переходу на нову сторінку скрипт знищується: вставляємо його знову
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'complete') return;
  const data = await chrome.storage.local.get(['recording', 'run']);
  try {
    if (data.recording && data.recording.active && data.recording.tabId === tabId) {
      await inject(tabId);
      await chrome.tabs.sendMessage(tabId, { type: 'record-start', mode: data.recording.mode || 'clicks' });
    } else if (data.run && data.run.tabId === tabId) {
      await inject(tabId);
      await chrome.tabs.sendMessage(tabId, { type: 'run-resume' });
    }
  } catch (e) {
    console.warn('Не вдалося продовжити на вкладці', tabId, e && e.message);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const data = await chrome.storage.local.get('run');
  if (data.run && data.run.tabId === tabId) {
    await chrome.storage.local.remove('run');
    await setResult(false, 'Вкладку закрито під час виконання');
  }
});
