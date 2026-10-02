const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const LIMIT = 5000;
const TRASH_LABEL = 'Перенести в кошик';

let found = {};
let armed = false;

function $(id) { return document.getElementById(id); }
function log(t) { $('log').textContent = t; }
function err(t) { $('err').textContent = t || ''; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function setBusy(busy) {
  $('count').disabled = busy;
  if (busy) $('trash').disabled = true;
}

function getToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Немає токена'));
      } else {
        resolve(token);
      }
    });
  });
}

function dropToken(token) {
  return new Promise((resolve) => chrome.identity.removeCachedAuthToken({ token: token }, resolve));
}

async function gmail(path, options, retried) {
  const token = await getToken(true);
  const opts = options || {};
  const headers = Object.assign({ Authorization: 'Bearer ' + token }, opts.headers || {});
  const resp = await fetch(API + path, Object.assign({}, opts, { headers: headers }));
  if (resp.status === 401 && !retried) {
    await dropToken(token);
    return gmail(path, options, true);
  }
  if (resp.status === 429 && !retried) {
    await sleep(1500);
    return gmail(path, options, true);
  }
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error('Gmail API ' + resp.status + ': ' + text.slice(0, 200));
  }
  return resp.json();
}

function days(id) {
  return Math.max(1, parseInt($(id).value, 10) || 30);
}

function categories() {
  const list = [];
  if ($('catSpam').checked) {
    list.push({ name: 'Спам', q: 'in:spam -is:starred', spam: true });
  }
  if ($('catPromo').checked) {
    list.push({ name: 'Промоакції', q: 'category:promotions older_than:' + days('promoDays') + 'd -is:starred', spam: false });
  }
  if ($('catSocial').checked) {
    list.push({ name: 'Соцмережі', q: 'category:social older_than:' + days('socialDays') + 'd -is:starred', spam: false });
  }
  return list;
}

async function listIds(q, includeSpam) {
  const ids = [];
  let pageToken = '';
  while (ids.length < LIMIT) {
    let url = '/messages?maxResults=500&q=' + encodeURIComponent(q);
    if (includeSpam) url += '&includeSpamTrash=true';
    if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
    const data = await gmail(url);
    (data.messages || []).forEach((m) => ids.push(m.id));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return ids.slice(0, LIMIT);
}

function totalFound() {
  return Object.keys(found).reduce((sum, k) => sum + found[k].length, 0);
}

async function trashAll(ids, onProgress) {
  let done = 0;
  let failed = 0;
  let idx = 0;
  let lastErr = '';
  async function worker() {
    while (idx < ids.length) {
      const id = ids[idx++];
      try {
        await gmail('/messages/' + id + '/trash', { method: 'POST' });
      } catch (e) {
        failed++;
        lastErr = e.message;
      }
      done++;
      if (done % 10 === 0) onProgress(done);
    }
  }
  await Promise.all([worker(), worker(), worker(), worker(), worker()]);
  return { done: done, failed: failed, lastErr: lastErr };
}

$('count').addEventListener('click', async () => {
  err('');
  found = {};
  armed = false;
  $('trash').textContent = TRASH_LABEL;
  const cats = categories();
  if (!cats.length) {
    err('Оберіть хоча б одну категорію.');
    return;
  }
  setBusy(true);
  try {
    const lines = [];
    for (const c of cats) {
      log('Рахую: ' + c.name + '...');
      const ids = await listIds(c.q, c.spam);
      found[c.name] = ids;
      lines.push(c.name + ': ' + ids.length + (ids.length >= LIMIT ? '+' : ''));
    }
    const total = totalFound();
    log(lines.join('\n') + '\nУсього: ' + total);
    setBusy(false);
    $('trash').disabled = total === 0;
  } catch (e) {
    log('');
    err(e.message);
    setBusy(false);
  }
});

$('trash').addEventListener('click', async () => {
  const total = totalFound();
  if (!total) return;
  if (!armed) {
    armed = true;
    $('trash').textContent = 'Підтвердити: ' + total;
    return;
  }
  armed = false;
  $('trash').textContent = TRASH_LABEL;
  err('');
  setBusy(true);
  try {
    const all = [];
    Object.keys(found).forEach((k) => found[k].forEach((id) => all.push(id)));
    const res = await trashAll(all, (n) => log('Перенесено: ' + n + ' з ' + all.length + '. Не закривайте це вікно.'));
    found = {};
    let msg = 'Готово. Перенесено в кошик: ' + (res.done - res.failed);
    if (res.failed) {
      msg += '\nПомилок: ' + res.failed;
      err(res.lastErr);
    }
    log(msg);
  } catch (e) {
    err(e.message);
  }
  setBusy(false);
  $('trash').disabled = true;
});

$('opts').addEventListener('click', () => chrome.runtime.openOptionsPage());
