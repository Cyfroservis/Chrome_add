const DEFAULTS = {
  enabled: true,
  idleMinutes: 5,
  collapseGroups: true,
  minimizeWindows: true,
  restoreGroups: true,
  restoreWindows: true,
  noRestoreAfterMinutes: 0,
  switchToLastTab: true, // застаріле: лише для міграції в switchMode
  switchMode: '',
  pauseMedia: false
};

function $(id) { return document.getElementById(id); }

// Те саме правило, що й у background.js: старий прапорець switchToLastTab стає режимом
function effectiveSwitchMode(s) {
  if (s.switchMode === 'none' || s.switchMode === 'rightmost' || s.switchMode === 'media') return s.switchMode;
  return s.switchToLastTab === false ? 'none' : 'rightmost';
}

function fmt(ms) {
  return new Date(ms).toLocaleString('uk-UA');
}

let savedTimer = null;
function flashSaved() {
  $('saved').textContent = 'Збережено';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { $('saved').textContent = ''; }, 1200);
}

function validIdle() {
  const n = parseInt($('idleMinutes').value, 10);
  return n >= 1 ? n : 0;
}

function validNoRestore() {
  const raw = $('noRestoreAfterMinutes').value;
  const n = parseInt(raw, 10);
  return raw !== '' && n >= 0 ? n : -1;
}

async function refresh() {
  const s = await chrome.storage.local.get(Object.assign({}, DEFAULTS, { lastHideAt: 0 }));
  const on = !!s.enabled;
  $('indicator').className = 'ind ' + (on ? 'on' : 'off');
  $('indText').textContent = on
    ? 'Активно: згортання через ' + (Number(s.idleMinutes) || 5) + ' хв простою'
    : 'Не активно';
  $('toggle').textContent = on ? '⏻ Вимкнути' : '▶ Увімкнути';
  $('status').textContent = s.lastHideAt ? 'Останнє згортання: ' + fmt(s.lastHideAt) : '';
}

async function load() {
  const s = await chrome.storage.local.get(DEFAULTS);
  $('idleMinutes').value = s.idleMinutes;
  $('collapseGroups').checked = s.collapseGroups;
  $('minimizeWindows').checked = s.minimizeWindows;
  $('pauseMedia').checked = s.pauseMedia;
  $('switchMode').value = effectiveSwitchMode(s);
  $('restoreGroups').checked = s.restoreGroups;
  $('restoreWindows').checked = s.restoreWindows;
  $('noRestoreAfterMinutes').value = s.noRestoreAfterMinutes;
  await refresh();
}

// Зберігає все, що зараз у формі. Число з некоректним значенням (наприклад, поки поле порожнє) не записується.
async function save() {
  const o = {
    collapseGroups: $('collapseGroups').checked,
    minimizeWindows: $('minimizeWindows').checked,
    pauseMedia: $('pauseMedia').checked,
    switchMode: $('switchMode').value,
    restoreGroups: $('restoreGroups').checked,
    restoreWindows: $('restoreWindows').checked
  };
  const idle = validIdle();
  if (idle) o.idleMinutes = idle;
  const nr = validNoRestore();
  if (nr >= 0) o.noRestoreAfterMinutes = nr;
  await chrome.storage.local.set(o);
  flashSaved();
  await refresh();
}

['collapseGroups', 'minimizeWindows', 'pauseMedia', 'restoreGroups', 'restoreWindows'].forEach((id) => {
  $(id).addEventListener('change', save);
});
$('switchMode').addEventListener('change', save);

['idleMinutes', 'noRestoreAfterMinutes'].forEach((id) => {
  $(id).addEventListener('input', save);
  // Після завершення редагування повертаємо в поле коректне значення
  $(id).addEventListener('change', async () => {
    await save();
    if (id === 'idleMinutes') $(id).value = validIdle() || (await chrome.storage.local.get(DEFAULTS)).idleMinutes;
    else if (validNoRestore() < 0) $(id).value = (await chrome.storage.local.get(DEFAULTS)).noRestoreAfterMinutes;
  });
});

$('toggle').addEventListener('click', async () => {
  const s = await chrome.storage.local.get(DEFAULTS);
  await chrome.storage.local.set({ enabled: !s.enabled });
  await refresh();
});

load();
