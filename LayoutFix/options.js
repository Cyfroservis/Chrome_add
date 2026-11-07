/* Автор: Сивак Микола Володимирович, +380961179898, Цифросервіс */
// Пауза (0,8 с) і мінімум літер (5) заданo в content.js раз і назавжди, у меню їх немає.
const DEFAULTS = { enabled: true, langs: null, excluded: '', mode: 'chip', triggers: [] };
const LAYOUTS = globalThis.LFX_LAYOUTS;

function $(id) { return document.getElementById(id); }

function defaultLangs() {
  const b = String(navigator.language || 'en').slice(0, 2).toLowerCase();
  const list = ['en'];
  if (b !== 'en' && LAYOUTS[b]) list.push(b);
  return list;
}

let savedTimer = null;
function flash(msg, bad) {
  const el = $('saved');
  el.textContent = msg || 'Збережено';
  el.style.color = bad ? 'var(--danger)' : 'var(--ok)';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { el.textContent = ''; }, 1800);
}

// ---------- Згортні розділи ----------
const secs = Array.from(document.querySelectorAll('section.acc'));

function setOpen(sec, on) {
  sec.querySelector('.body').hidden = !on;
  sec.querySelector('.arrow').textContent = on ? '▾' : '▸';
  sec.querySelector('.head').setAttribute('aria-expanded', on ? 'true' : 'false');
  sec.dataset.open = on ? '1' : '';
}
function openedSec() { return secs.find((s) => s.dataset.open === '1') || null; }

secs.forEach((sec) => {
  setOpen(sec, false);
  sec.querySelector('.head').addEventListener('click', () => {
    const was = sec.dataset.open === '1';
    secs.forEach((s) => setOpen(s, false));
    if (!was) setOpen(sec, true);
  });
});
// Клік поза відкритим розділом згортає його (елемент, який уже прибрано зі сторінки, не рахуємо)
document.addEventListener('click', (e) => {
  const o = openedSec();
  if (!o || !(e.target instanceof Node) || !e.target.isConnected) return;
  if (!o.contains(e.target)) setOpen(o, false);
});

// ---------- Режим ----------
function modeValue() {
  return (document.querySelector('input[name="mode"]:checked') || {}).value === 'auto' ? 'auto' : 'chip';
}
function showModeSum() { $('sumMode').textContent = modeValue() === 'auto' ? 'автоматично' : 'кнопка'; }

// ---------- Мови: випадаючий список ----------
function buildLangs(selected) {
  const box = $('langs');
  box.textContent = '';
  Object.keys(LAYOUTS).forEach((id) => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = id;
    cb.checked = selected.indexOf(id) >= 0;
    cb.addEventListener('change', () => { showLangSum(); save(); });
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
function showLangSum() {
  const names = chosenLangs().map((id) => LAYOUTS[id].name);
  const t = names.length ? names.join(', ') : 'не обрано';
  $('ddCur').textContent = t;
  $('sumLangs').textContent = names.length + ' з ' + Object.keys(LAYOUTS).length;
}
$('ddBtn').addEventListener('click', () => { $('langs').hidden = !$('langs').hidden; });

// ---------- Сайти-винятки ----------
let sites = [];

function normSite(v) {
  let s = String(v || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
  s = s.split(/[\/?#:\s]/)[0];
  return /^([a-z0-9-]+\.)+[a-z0-9-]+$|^localhost$/.test(s) ? s : '';
}
function renderSites() {
  const box = $('sites');
  box.textContent = '';
  if (!sites.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'Список порожній';
    box.appendChild(e);
  }
  sites.forEach((d, i) => {
    const row = document.createElement('div');
    row.className = 'item';
    const t = document.createElement('span');
    t.className = 'txt';
    t.textContent = d;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.textContent = 'видалити';
    del.addEventListener('click', () => { sites.splice(i, 1); renderSites(); saveSites(); });
    row.appendChild(t);
    row.appendChild(del);
    box.appendChild(row);
  });
  $('sumSites').textContent = sites.length ? String(sites.length) : '';
}
async function saveSites() {
  await chrome.storage.local.set({ excluded: sites.join('\n') });
  flash();
}
function addSite() {
  const d = normSite($('siteInput').value);
  if (!d) { flash('Введіть адресу сайту, наприклад docs.google.com', true); return; }
  if (sites.indexOf(d) >= 0) { flash('Цей сайт уже є у списку', true); return; }
  sites.push(d);
  $('siteInput').value = '';
  renderSites();
  saveSites();
}
$('siteAdd').addEventListener('click', addSite);
$('siteInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addSite(); });

// ---------- Тригери і відповіді ----------
let triggers = []; // [{ w: 'слово', r: ['відповідь', ...] }]

async function saveTriggers() {
  await chrome.storage.local.set({ triggers: triggers });
  flash();
}
function renderTriggers() {
  const box = $('trigs');
  box.textContent = '';
  if (!triggers.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'Тригерів ще немає';
    box.appendChild(e);
  }
  triggers.forEach((tr, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'trig';
    const top = document.createElement('div');
    top.className = 'top';
    const w = document.createElement('span');
    w.className = 'txt';
    w.textContent = tr.w;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.textContent = 'видалити';
    del.title = 'Видалити тригер разом з відповідями';
    del.addEventListener('click', () => { triggers.splice(i, 1); renderTriggers(); saveTriggers(); });
    top.appendChild(w);
    top.appendChild(del);
    wrap.appendChild(top);
    tr.r.forEach((txt, j) => {
      const rep = document.createElement('div');
      rep.className = 'rep';
      const t = document.createElement('span');
      t.className = 'txt';
      t.textContent = txt;
      const d2 = document.createElement('button');
      d2.type = 'button';
      d2.className = 'del';
      d2.textContent = 'видалити';
      d2.addEventListener('click', () => { tr.r.splice(j, 1); renderTriggers(); saveTriggers(); });
      rep.appendChild(t);
      rep.appendChild(d2);
      wrap.appendChild(rep);
    });
    const add = document.createElement('div');
    add.className = 'addrow';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = 'Готова відповідь';
    inp.title = 'Текст, який буде вставлено у поле вводу, коли оберете цю відповідь';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Додати';
    const go = () => {
      const v = inp.value.trim();
      if (!v) return;
      tr.r.push(v.slice(0, 1000));
      renderTriggers();
      saveTriggers();
    };
    btn.addEventListener('click', go);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    add.appendChild(inp);
    add.appendChild(btn);
    wrap.appendChild(add);
    box.appendChild(wrap);
  });
  $('sumTrig').textContent = triggers.length ? String(triggers.length) : '';
}
function addTrigger() {
  const v = $('trigInput').value.trim().slice(0, 80);
  if (!v) return;
  if (triggers.some((t) => t.w.toLowerCase() === v.toLowerCase())) { flash('Такий тригер уже є', true); return; }
  triggers.push({ w: v, r: [] });
  $('trigInput').value = '';
  renderTriggers();
  saveTriggers();
}
$('trigAdd').addEventListener('click', addTrigger);
$('trigInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addTrigger(); });

// ---------- Завантаження і збереження ----------
async function load() {
  const s = await chrome.storage.local.get(DEFAULTS);
  const langs = Array.isArray(s.langs) && s.langs.length ? s.langs : defaultLangs();
  buildLangs(langs);
  showLangSum();
  $('enabled').checked = s.enabled;
  const modeRadio = document.querySelector('input[name="mode"][value="' + (s.mode === 'auto' ? 'auto' : 'chip') + '"]');
  if (modeRadio) modeRadio.checked = true;
  showModeSum();
  sites = String(s.excluded || '').split(/[\s,;]+/).map(normSite).filter(Boolean);
  renderSites();
  triggers = (Array.isArray(s.triggers) ? s.triggers : [])
    .filter((t) => t && typeof t.w === 'string' && t.w)
    .map((t) => ({ w: t.w, r: Array.isArray(t.r) ? t.r.filter((x) => typeof x === 'string') : [] }));
  renderTriggers();
}

async function save() {
  await chrome.storage.local.set({ enabled: $('enabled').checked, langs: chosenLangs(), mode: modeValue() });
  flash();
}

$('enabled').addEventListener('change', save);
document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', () => { showModeSum(); save(); }));

// Гаряча клавіша: показуємо поточну і відкриваємо сторінку Chrome, де її можна змінити
async function showHotkey() {
  let t = 'не задано';
  try {
    const cmds = await chrome.commands.getAll();
    const c = cmds.find((x) => x.name === 'convert-selection');
    if (c && c.shortcut) t = c.shortcut;
  } catch (e) {}
  $('hotkey').textContent = t;
  $('sumKey').textContent = t === 'не задано' ? '' : t;
}
$('hotkeyBtn').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
showHotkey();

load();
