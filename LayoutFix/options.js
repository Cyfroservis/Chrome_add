/* Автор: Сивак Микола Володимирович, +380961179898, Цифросервіс */
const DEFAULTS = { enabled: true, langs: null, pauseSec: 0.8, minLetters: 5, excluded: '', mode: 'chip' };
const LAYOUTS = globalThis.LFX_LAYOUTS;

function $(id) { return document.getElementById(id); }

function defaultLangs() {
  const b = String(navigator.language || 'en').slice(0, 2).toLowerCase();
  const list = ['en'];
  if (b !== 'en' && LAYOUTS[b]) list.push(b);
  return list;
}

let savedTimer = null;
function flashSaved() {
  $('saved').textContent = 'Збережено';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { $('saved').textContent = ''; }, 1200);
}

function buildLangs(selected) {
  const box = $('langs');
  box.textContent = '';
  Object.keys(LAYOUTS).forEach((id) => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = id;
    cb.checked = selected.indexOf(id) >= 0;
    cb.addEventListener('change', save);
    label.appendChild(cb);
    label.appendChild(document.createTextNode(LAYOUTS[id].name));
    if (LAYOUTS[id].experimental) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = '(експериментально)';
      label.appendChild(tag);
    }
    box.appendChild(label);
  });
}

function chosenLangs() {
  return Array.from($('langs').querySelectorAll('input:checked')).map((c) => c.value);
}

async function load() {
  const s = await chrome.storage.local.get(DEFAULTS);
  const langs = Array.isArray(s.langs) && s.langs.length ? s.langs : defaultLangs();
  buildLangs(langs);
  $('enabled').checked = s.enabled;
  const modeRadio = document.querySelector('input[name="mode"][value="' + (s.mode === 'auto' ? 'auto' : 'chip') + '"]');
  if (modeRadio) modeRadio.checked = true;
  $('delaySec').value = s.pauseSec;
  $('minLetters').value = s.minLetters;
  $('excluded').value = s.excluded;
}

async function save() {
  const o = {
    enabled: $('enabled').checked,
    langs: chosenLangs(),
    mode: (document.querySelector('input[name="mode"]:checked') || {}).value === 'auto' ? 'auto' : 'chip',
    excluded: $('excluded').value
  };
  const d = parseFloat($('delaySec').value);
  if (d >= 0.3 && d <= 10) o.pauseSec = d;
  const m = parseInt($('minLetters').value, 10);
  if (m >= 3 && m <= 30) o.minLetters = m;
  await chrome.storage.local.set(o);
  flashSaved();
}

['enabled', 'delaySec', 'minLetters', 'excluded'].forEach((id) => {
  $(id).addEventListener(id === 'enabled' ? 'change' : 'input', save);
});

document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', save));

// Гаряча клавіша: показуємо поточну і відкриваємо сторінку Chrome, де її можна змінити
async function showHotkey() {
  try {
    const cmds = await chrome.commands.getAll();
    const c = cmds.find((x) => x.name === 'convert-selection');
    $('hotkey').textContent = c && c.shortcut ? c.shortcut : 'не задано';
  } catch (e) {
    $('hotkey').textContent = 'не задано';
  }
}
$('hotkeyBtn').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
showHotkey();

load();
