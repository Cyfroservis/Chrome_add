/* Автор: Сивак Микола Володимирович, +380961179898, Цифросервіс */
// Слідкує за набором тексту в полях. Коли набір зупинився на кілька секунд, перевіряє текст.
// Якщо він схожий на набраний не в тій розкладці, біля кінця тексту з'являється напівпрозора кнопка
// «Можливо: Українська?» (клік перетворює текст) або, в режимі «автоматично», текст перетворюється одразу
// з кнопкою «Скасувати». Вигляд кнопки узято з міток клікера по сайтах.
// Текст нікуди не надсилається: усе відбувається на цьому комп'ютері.

(function () {
  const LFX = globalThis.LFX;
  if (!LFX) return;

  const DEFAULTS = { enabled: true, langs: null, pauseSec: 0.8, minLetters: 5, excluded: '', mode: 'chip', triggers: [] };
  const MAX_TEXT = 3000; // довші тексти не аналізуємо
  const CHIP_MS = 20000; // скільки кнопка висить без відповіді
  const UNDO_MS = 8000; // скільки доступна кнопка «Скасувати»

  let S = Object.assign({}, DEFAULTS, { langs: ['en'] });
  let timer = null;
  let placeRaf = 0;
  const dismissed = new WeakMap(); // поле -> текст, для якого підказку відхилено
  let chip = null; // { host, btn, el, timer, onExpire }

  function defaultLangs() {
    const b = String(navigator.language || 'en').slice(0, 2).toLowerCase();
    const list = ['en'];
    if (b !== 'en' && LFX.LAYOUTS[b]) list.push(b);
    return list;
  }

  function applySettings(raw) {
    S = Object.assign({}, DEFAULTS, raw);
    if (!Array.isArray(S.langs) || !S.langs.length) S.langs = defaultLangs();
    S.langs = S.langs.filter((l) => LFX.LAYOUTS[l]);
    if (S.mode !== 'auto') S.mode = 'chip';
    S.pauseSec = DEFAULTS.pauseSec; // пауза і мінімум літер більше не налаштовуються: завжди типові значення
    S.minLetters = DEFAULTS.minLetters;
    if (!Array.isArray(S.triggers)) S.triggers = [];
  }

  function loadSettings() {
    try {
      chrome.storage.local.get(DEFAULTS, applySettings);
    } catch (e) {}
  }
  loadSettings();
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') loadSettings();
    });
  } catch (e) {}

  function siteExcluded() {
    const host = location.hostname.toLowerCase();
    return String(S.excluded || '')
      .split(/[\s,;]+/)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean)
      .some((d) => host === d || host.endsWith('.' + d));
  }

  const OK_TYPES = ['text', 'search', ''];

  // Повертає поле, яке можна аналізувати, або null (паролі, оплата, службові поля пропускаємо)
  function editableOf(target) {
    if (!(target instanceof Element)) return null;
    if (target instanceof HTMLInputElement) {
      if (OK_TYPES.indexOf((target.getAttribute('type') || '').toLowerCase()) < 0) return null;
      const hint = (target.name || '') + ' ' + (target.id || '') + ' ' + (target.autocomplete || '');
      if (/pass|pwd|card|cc-|cvv|cvc|(?<![a-z])(pin|otp)(?![a-z])|pincode|iban|secret/i.test(hint)) return null;
      return target;
    }
    if (target instanceof HTMLTextAreaElement) return target;
    if (target.isContentEditable) {
      let n = target;
      while (n.parentElement && n.parentElement.isContentEditable) n = n.parentElement;
      return n;
    }
    return null;
  }

  function getText(el) {
    return 'value' in el ? el.value : el.innerText || '';
  }

  function replaceText(el, text) {
    try {
      el.focus();
      if ('value' in el) {
        el.select();
      } else {
        const r = document.createRange();
        r.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      }
      // insertText зберігає історію скасування (Ctrl+Z) і зрозумілий більшості редакторів
      if (document.execCommand('insertText', false, text)) return true;
    } catch (e) {}
    if ('value' in el) {
      try {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      } catch (e) {}
    }
    return false;
  }

  // ---------- Де закінчується текст ----------
  // Для редактора (contenteditable): прямокутник останнього символу
  function endOfEditable(el) {
    try {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let last = null;
      while (walker.nextNode()) {
        if (walker.currentNode.nodeValue && walker.currentNode.nodeValue.trim()) last = walker.currentNode;
      }
      if (!last) return null;
      const len = last.nodeValue.length;
      const r = document.createRange();
      r.setStart(last, len - 1);
      r.setEnd(last, len);
      const rects = r.getClientRects();
      if (!rects.length) return null;
      const q = rects[rects.length - 1];
      return { right: q.right, top: q.top, bottom: q.bottom };
    } catch (e) {
      return null;
    }
  }

  // Для input і textarea: невидима копія поля з тими самими шрифтом і відступами, мітка стоїть після останнього символу
  function endOfField(el, f, upTo) {
    try {
      const cs = getComputedStyle(el);
      const d = document.createElement('div');
      ['boxSizing', 'width', 'height', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight', 'fontSize',
        'lineHeight', 'fontFamily', 'letterSpacing', 'textTransform', 'textIndent', 'wordSpacing', 'tabSize'
      ].forEach((p) => { d.style[p] = cs[p]; });
      d.style.whiteSpace = el instanceof HTMLTextAreaElement ? 'pre-wrap' : 'pre';
      d.style.overflowWrap = 'break-word';
      d.style.overflow = 'hidden';
      d.style.position = 'fixed';
      d.style.left = '-99999px';
      d.style.top = '0';
      d.style.visibility = 'hidden';
      d.textContent = upTo == null ? el.value : el.value.slice(0, upTo);
      const m = document.createElement('span');
      m.textContent = '​';
      d.appendChild(m);
      (document.body || document.documentElement).appendChild(d);
      const mr = m.getBoundingClientRect();
      const dr = d.getBoundingClientRect();
      d.remove();
      const top = f.top + (mr.top - dr.top) - el.scrollTop;
      return { right: f.left + (mr.left - dr.left) - el.scrollLeft, top: top, bottom: top + mr.height };
    } catch (e) {
      return null;
    }
  }

  function endOfText(el, f) {
    return 'value' in el ? endOfField(el, f) : endOfEditable(el);
  }

  // Де закінчується виділення: у input і textarea за індексом, у редакторі за правим краєм виділеного
  function endOfSelection(el, f, idx) {
    if ('value' in el) return endOfField(el, f, idx);
    try {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return null;
      const rects = sel.getRangeAt(0).getClientRects();
      if (!rects.length) return null;
      const q = rects[rects.length - 1];
      return { right: q.right, top: q.top, bottom: q.bottom };
    } catch (e) {
      return null;
    }
  }

  // ---------- Кнопка ----------
  // Вигляд узято з міток клікера: напівпрозоре тло, біла рамка, тінь тексту, заокруглений контур
  const CSS = `
    :host { all: initial; }
    .chip { position: fixed; z-index: 2147483647; box-sizing: border-box; max-width: 300px; height: 22px; margin: 0; padding: 0 10px;
      font: bold 12px/20px "Segoe UI", Arial, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      color: #fff; text-shadow: 0 0 2px rgba(0,0,0,.8); background: rgba(46,125,50,.72);
      border: 1px solid rgba(255,255,255,.6); border-radius: 11px; box-shadow: 0 2px 8px rgba(0,0,0,.4);
      opacity: .75; cursor: pointer; transition: opacity .15s; }
    .chip.undo { background: rgba(110,110,110,.78); }
    .chip:hover, .chip:focus-visible { opacity: 1; }
    .chip:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
  `;

  function hideChip() {
    if (chip) {
      clearTimeout(chip.timer);
      if (chip.host.parentNode) chip.host.parentNode.removeChild(chip.host);
      chip = null;
    }
  }

  function short(t) {
    const s = String(t).replace(/\s+/g, ' ').trim();
    return s.length > 60 ? s.slice(0, 57) + '…' : s;
  }

  // Ставить кнопку в кінці тексту; якщо там немає місця в полі, над правим краєм поля (або під ним)
  function placeChip() {
    if (!chip) return;
    const el = chip.el;
    if (!el.isConnected) {
      hideChip();
      return;
    }
    const f = el.getBoundingClientRect();
    const b = chip.btn.getBoundingClientRect();
    if (chip.kind === 'page') {
      // Текст на сторінці (не поле): кнопка стоїть одразу після виділеного
      const pe = endOfSelection(el, f);
      if (!pe) {
        hideChip();
        return;
      }
      chip.btn.style.left = Math.round(Math.max(4, Math.min(pe.right + 8, window.innerWidth - b.width - 4))) + 'px';
      chip.btn.style.top = Math.round(Math.max(4, Math.min(pe.top + (pe.bottom - pe.top - b.height) / 2, window.innerHeight - b.height - 4))) + 'px';
      return;
    }
    const end = chip.kind === 'selection' ? endOfSelection(el, f, chip.selEnd) : endOfText(el, f);
    let x;
    let y;
    if (end && end.right + 8 + b.width <= f.right - 4 && end.top >= f.top - 2 && end.bottom <= f.bottom + 2) {
      x = end.right + 8;
      y = end.top + (end.bottom - end.top - b.height) / 2;
    } else {
      x = f.right - b.width;
      y = f.top - b.height - 4;
      if (y < 4) y = f.bottom + 4;
    }
    x = Math.max(4, Math.min(x, window.innerWidth - b.width - 4));
    y = Math.max(4, Math.min(y, window.innerHeight - b.height - 4));
    chip.btn.style.left = Math.round(x) + 'px';
    chip.btn.style.top = Math.round(y) + 'px';
  }

  function schedulePlace() {
    if (!chip || placeRaf) return;
    placeRaf = requestAnimationFrame(() => {
      placeRaf = 0;
      placeChip();
    });
  }

  function makeChip(el, label, title, undo, onClick, ttl, onExpire, extra) {
    hideChip();
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = undo ? 'chip undo' : 'chip';
    btn.textContent = label;
    btn.title = title;
    // Кнопка не забирає фокус із поля, щоб текст і курсор лишались на місці
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', onClick);
    root.appendChild(style);
    root.appendChild(btn);
    (document.documentElement || document.body).appendChild(host);
    chip = { host: host, btn: btn, el: el, onExpire: onExpire || null, timer: setTimeout(() => { hideChip(); if (onExpire) onExpire(); }, ttl) };
    if (extra) Object.assign(chip, extra); // kind: 'selection' і selEnd для кнопки біля виділення
    placeChip();
  }

  function applyConvert(el, original, res) {
    if (!replaceText(el, res.text)) return false;
    dismissed.set(el, res.text);
    showUndo(el, original);
    return true;
  }

  function showSuggestion(el, original, res) {
    const target = LFX.LAYOUTS[res.to].name;
    makeChip(
      el,
      target + '?',
      'Клік замінить текст на «' + short(res.text) + '». Esc ховає кнопку',
      false,
      () => { if (!applyConvert(el, original, res)) hideChip(); },
      CHIP_MS,
      () => dismissed.set(el, original)
    );
  }

  function showUndo(el, original) {
    makeChip(
      el,
      '↶',
      'Повернути початковий текст (Ctrl+Z теж працює)',
      true,
      () => {
        replaceText(el, original);
        dismissed.set(el, original);
        hideChip();
      },
      UNDO_MS
    );
  }

  // ---------- Слідкування за набором ----------
  function check(el) {
    if (!S.enabled || !el.isConnected || siteExcluded()) return;
    if (!(document.activeElement === el || el.contains(document.activeElement))) return; // поле вже не в фокусі
    const text = getText(el);
    if (!text || text.length > MAX_TEXT) return;
    if (dismissed.get(el) === text) return;
    const res = LFX.analyze(text, S.langs, { minLetters: Number(S.minLetters) || 5 });
    if (!res) return;
    if (S.mode === 'auto') applyConvert(el, text, res);
    else showSuggestion(el, text, res);
  }

  document.addEventListener('input', (e) => {
    if (!e.isTrusted) return; // ігноруємо синтетичні події сторінки
    const el = editableOf(e.target);
    if (!el) return;
    clearTimeout(timer);
    hideChip(); // набір триває: стара підказка вже не актуальна
    if (dismissed.has(el) && dismissed.get(el) !== getText(el)) dismissed.delete(el); // текст змінився: відхилення втрачає силу
    let sec = Math.max(0.3, Math.min(10, Number(S.pauseSec) || 0.8));
    // Слово щойно закінчено (пробіл чи розділовий знак): у режимі кнопки перевіряємо майже одразу
    if (S.mode !== 'auto' && typeof e.data === 'string' && /^[\s.,!?;:]$/.test(e.data)) sec = Math.min(sec, 0.35);
    timer = setTimeout(() => check(el), sec * 1000);
  }, true);

  // ---------- Гаряча клавіша: виправити виділений текст ----------
  // Фоновий скрипт надсилає повідомлення, коли натиснуто клавішу. Діє лише кадр, у якому зараз фокус.
  function activeEditable() {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return editableOf(a);
  }

  // Найкраще перетворення без перевірки «текст схожий на нормальний»: користувач сам сказав, що розкладка хибна
  function forcedConvert(text, langs) {
    let best = null;
    for (const from of langs) {
      for (const to of langs) {
        if (from === to) continue;
        const conv = LFX.convert(text, from, to);
        if (conv === null || conv === text) continue;
        const sc = LFX.scoreText(conv, to);
        const score = sc === null ? 0 : sc;
        if (!best || score > best.score) best = { from: from, to: to, text: conv, score: score };
      }
    }
    return best;
  }

  function notify(el, msg) {
    makeChip(el, msg, msg, true, hideChip, 2500);
  }

  function convertSelection() {
    if (!S.enabled || !document.hasFocus()) return;
    const el = activeEditable();
    if (!el) return;
    clearTimeout(timer);
    hideChip();
    if (S.langs.length < 2) {
      notify(el, 'Увімкніть щонайменше дві мови');
      return;
    }
    let start = -1;
    let end = -1;
    let text = '';
    if ('value' in el) {
      start = el.selectionStart;
      end = el.selectionEnd;
      if (start != null && end != null && start !== end) text = el.value.slice(start, end);
    } else {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && !sel.isCollapsed && el.contains(sel.anchorNode)) text = sel.toString();
    }
    const partial = !!text;
    if (!partial) text = getText(el); // нічого не виділено: виправляється весь текст поля
    if (!text.trim() || text.length > MAX_TEXT) return;
    const res = forcedConvert(text, S.langs);
    if (!res) {
      notify(el, 'Не вдалося перетворити цей текст');
      return;
    }
    let ok = false;
    if (partial) {
      try {
        el.focus();
        ok = document.execCommand('insertText', false, res.text); // виділення лишається, тож замінюється саме воно
      } catch (e) {}
      if (!ok && 'value' in el && start >= 0) {
        el.setRangeText(res.text, start, end, 'end');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        ok = true;
      }
    } else {
      ok = replaceText(el, res.text);
    }
    if (!ok) {
      notify(el, 'Не вдалося замінити текст');
      return;
    }
    dismissed.set(el, getText(el));
    makeChip(el, '↶', 'Повернути початковий текст (Ctrl+Z теж працює)', true, () => {
      el.focus();
      document.execCommand('undo');
      dismissed.set(el, getText(el));
      hideChip();
    }, UNDO_MS);
  }

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'convert-selection') convertSelection();
    });
  } catch (e) {}

  // ---------- Виділення: швидка перевірка виділеного тексту ----------
  // Виділили текст у полі: за чверть секунди його перевіряємо, і якщо це схоже на хибну розкладку,
  // біля виділення з'являється кнопка. Ctrl, утримуваний у момент, коли відпускаєте кнопку миші
  // після виділення, перетворює виділене одразу (так само, як гаряча клавіша).
  let selTimer = null;

  // Виділений текст у полі: { text, start, end } (start і end лише для input і textarea)
  function readSelection(el) {
    if ('value' in el) {
      const s = el.selectionStart;
      const e = el.selectionEnd;
      if (s != null && e != null && s !== e) return { text: el.value.slice(s, e), start: s, end: e };
    } else {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && !sel.isCollapsed && el.contains(sel.anchorNode)) return { text: sel.toString(), start: -1, end: -1 };
    }
    return { text: '', start: -1, end: -1 };
  }

  // Замінює виділене (виділення ще активне, тож insertText змінює саме його) і показує «Скасувати»
  function replaceSelection(el, sel, newText) {
    let ok = false;
    try {
      el.focus();
      ok = document.execCommand('insertText', false, newText);
    } catch (e) {}
    if (!ok && 'value' in el && sel.start >= 0) {
      el.setRangeText(newText, sel.start, sel.end, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      ok = true;
    }
    if (!ok) return false;
    dismissed.set(el, getText(el));
    makeChip(el, '↶', 'Повернути початковий текст (Ctrl+Z теж працює)', true, () => {
      el.focus();
      document.execCommand('undo');
      dismissed.set(el, getText(el));
      hideChip();
    }, UNDO_MS);
    return true;
  }

  function selectionCheck(ctrl) {
    if (!S.enabled || siteExcluded() || !document.hasFocus()) return;
    const el = activeEditable();
    const stale = !!chip && (chip.kind === 'selection' || chip.kind === 'page');
    if (!el) {
      pageSelection(stale); // виділено текст не в полі вводу
      return;
    }
    const sel = readSelection(el);
    if (!sel.text) {
      if (stale) hideChip(); // виділення зняли: стара кнопка вже не потрібна
      return;
    }
    if (ctrl) {
      convertSelection();
      return;
    }
    let res = null;
    if (sel.text.length <= MAX_TEXT && S.langs.length >= 2) res = LFX.analyze(sel.text, S.langs, { minLetters: 3 });
    if (!res) {
      if (stale) hideChip();
      return;
    }
    makeChip(
      el,
      LFX.LAYOUTS[res.to].name + '?',
      'Клік замінить виділене на «' + short(res.text) + '». Esc ховає кнопку',
      false,
      () => {
        const now = readSelection(el);
        if (now.text !== sel.text || !replaceSelection(el, now, res.text)) hideChip();
      },
      CHIP_MS,
      null,
      { kind: 'selection', selEnd: sel.end }
    );
  }

  // ---------- Текст на сторінці (не поле): віконце з розшифрованим текстом ----------
  const BUBBLE_CSS = `
    :host { all: initial; }
    .box { position: fixed; z-index: 2147483647; box-sizing: border-box; width: 320px; max-width: calc(100vw - 16px); padding: 8px 10px;
      font: 13px/1.4 "Segoe UI", Arial, sans-serif; color: #fff; text-shadow: 0 0 2px rgba(0,0,0,.8);
      background: rgba(18,35,26,.94); border: 1px solid rgba(255,255,255,.6); border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,.45); }
    .cap { font-size: 11.5px; opacity: .8; margin-bottom: 4px; }
    .res { max-height: 160px; overflow: auto; padding: 5px 8px; margin-bottom: 8px; white-space: pre-wrap; word-break: break-word;
      background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.35); border-radius: 6px; user-select: text; }
    .row { display: flex; gap: 6px; }
    button { font: bold 12px/18px "Segoe UI", Arial, sans-serif; cursor: pointer; padding: 2px 12px; color: #fff; text-shadow: inherit;
      background: rgba(46,125,50,.8); border: 1px solid rgba(255,255,255,.6); border-radius: 11px; }
    button.sec { background: rgba(255,255,255,.15); }
    button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
  `;
  let bubble = null; // { host, timer }

  function hideBubble() {
    if (bubble) {
      clearTimeout(bubble.timer);
      if (bubble.host.parentNode) bubble.host.parentNode.removeChild(bubble.host);
      bubble = null;
    }
  }

  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(() => true, () => false);
    } catch (e) {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.documentElement.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return Promise.resolve(ok);
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  function showBubble(anchor, resultText, langName) {
    hideBubble();
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = BUBBLE_CSS;
    const box = document.createElement('div');
    box.className = 'box';
    box.setAttribute('role', 'dialog');
    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.textContent = 'У розкладці «' + langName + '»:';
    const res = document.createElement('div');
    res.className = 'res';
    res.textContent = resultText;
    const row = document.createElement('div');
    row.className = 'row';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Копіювати';
    copy.title = 'Скопіювати розшифрований текст у буфер обміну';
    copy.addEventListener('click', () => {
      copyText(resultText).then((ok) => {
        copy.textContent = ok ? 'Скопійовано ✓' : 'Не вдалося скопіювати';
        setTimeout(() => { copy.textContent = 'Копіювати'; }, 1500);
      });
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'sec';
    close.textContent = 'Закрити';
    close.addEventListener('click', hideBubble);
    row.appendChild(copy);
    row.appendChild(close);
    box.appendChild(cap);
    box.appendChild(res);
    box.appendChild(row);
    root.appendChild(style);
    root.appendChild(box);
    (document.documentElement || document.body).appendChild(host);
    // Під виділеним текстом; якщо внизу немає місця, над ним
    const bw = box.getBoundingClientRect();
    const x = Math.max(8, Math.min(anchor.left, window.innerWidth - bw.width - 8));
    let y = anchor.bottom + 6;
    if (y + bw.height > window.innerHeight - 8) y = Math.max(8, anchor.top - bw.height - 6);
    box.style.left = Math.round(x) + 'px';
    box.style.top = Math.round(y) + 'px';
    bubble = { host: host, timer: setTimeout(hideBubble, 30000) };
  }

  // Виділено текст не в полі вводу (наприклад, повідомлення на сторінці): якщо це хибна розкладка, пропонуємо показати розшифровку
  function pageSelection(stale) {
    const sel = window.getSelection();
    const text = sel && sel.rangeCount && !sel.isCollapsed ? sel.toString() : '';
    if (!text.trim() || text.length > MAX_TEXT) {
      if (stale) hideChip();
      return;
    }
    const res = S.langs.length >= 2 ? LFX.analyze(text, S.langs, { minLetters: 3 }) : null;
    const node = sel.anchorNode;
    const host = node instanceof Element ? node : node && node.parentElement;
    if (!host) return;
    if (!res) {
      // Хибної розкладки немає: можливо, у тексті є слово-тригер, тоді пропонуємо готові відповіді
      const found = matchTriggers(text);
      if (!found.length) {
        if (stale) hideChip();
        return;
      }
      makeChip(
        host,
        'Відповіді',
        'Клік покаже готові відповіді на це повідомлення. Esc ховає кнопку',
        false,
        () => {
          const r = selRect(host);
          hideChip();
          showReplies(r, found);
        },
        CHIP_MS,
        null,
        { kind: 'page' }
      );
      return;
    }
    const name = LFX.LAYOUTS[res.to].name;
    makeChip(
      host,
      name + '?',
      'Клік покаже розшифрований текст у віконці. Esc ховає кнопку',
      false,
      () => {
        let rect = null;
        try {
          const rects = sel.getRangeAt(0).getClientRects();
          if (rects.length) rect = rects[rects.length - 1];
        } catch (e) {}
        hideChip();
        showBubble(rect || host.getBoundingClientRect(), res.text, name);
      },
      CHIP_MS,
      null,
      { kind: 'page' }
    );
  }

  // ---------- Тригери і готові відповіді; меню правої кнопки миші ----------
  const PANEL_CSS = `
    .grp { margin-bottom: 6px; }
    button.rep { display: block; width: 100%; text-align: left; margin: 0 0 4px; padding: 4px 8px; border-radius: 6px;
      font-weight: normal; white-space: normal; word-break: break-word; line-height: 1.3; }
    textarea { display: block; width: 100%; min-height: 56px; box-sizing: border-box; resize: vertical; margin-bottom: 6px; padding: 5px 8px;
      font: 13px/1.35 "Segoe UI", Arial, sans-serif; color: #fff; background: rgba(255,255,255,.12);
      border: 1px solid rgba(255,255,255,.35); border-radius: 6px; }
    textarea:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
  `;
  let lastEditable = null; // останнє поле вводу, куди користувач клікав: туди вставляються відповіді

  document.addEventListener('focusin', (e) => {
    const t = e.composedPath ? e.composedPath()[0] : e.target;
    const el = editableOf(t);
    if (el) lastEditable = el;
  }, true);

  function selRect(fallbackEl) {
    try {
      const s = window.getSelection();
      if (s && s.rangeCount && !s.isCollapsed) {
        const rs = s.getRangeAt(0).getClientRects();
        if (rs.length) return rs[rs.length - 1];
      }
    } catch (e) {}
    const el = fallbackEl || document.activeElement;
    if (el && el.getBoundingClientRect) return el.getBoundingClientRect();
    return { left: 20, top: 20, bottom: 20 };
  }

  // Тригери, слово яких є у тексті (і для яких задано хоч одну відповідь)
  function matchTriggers(text) {
    const low = String(text).toLowerCase();
    return (S.triggers || []).filter((t) => t && typeof t.w === 'string' && t.w && Array.isArray(t.r) && t.r.length && low.indexOf(t.w.toLowerCase()) >= 0);
  }

  // Загальне віконце: caption, вузли з вмістом і кнопка «Закрити»
  function showPanel(anchor, caption, nodes) {
    hideBubble();
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = BUBBLE_CSS + PANEL_CSS;
    const box = document.createElement('div');
    box.className = 'box';
    box.setAttribute('role', 'dialog');
    ['keydown', 'keyup', 'keypress'].forEach((n) => box.addEventListener(n, (e) => { if (e.key !== 'Escape') e.stopPropagation(); }));
    if (caption) {
      const cap = document.createElement('div');
      cap.className = 'cap';
      cap.textContent = caption;
      box.appendChild(cap);
    }
    nodes.forEach((n) => box.appendChild(n));
    const row = document.createElement('div');
    row.className = 'row';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'sec';
    close.textContent = 'Закрити';
    close.addEventListener('click', hideBubble);
    row.appendChild(close);
    box.appendChild(row);
    root.appendChild(style);
    root.appendChild(box);
    (document.documentElement || document.body).appendChild(host);
    const bw = box.getBoundingClientRect();
    const x = Math.max(8, Math.min(anchor.left, window.innerWidth - bw.width - 8));
    let y = anchor.bottom + 6;
    if (y + bw.height > window.innerHeight - 8) y = Math.max(8, anchor.top - bw.height - 6);
    box.style.left = Math.round(x) + 'px';
    box.style.top = Math.round(y) + 'px';
    bubble = { host: host, timer: setTimeout(hideBubble, 60000) };
    return box;
  }

  function textNode(t) {
    const d = document.createElement('div');
    d.className = 'res';
    d.textContent = t;
    return d;
  }

  // Вставляє відповідь у останнє поле вводу; якщо поля немає, копіює в буфер обміну
  function insertReply(text) {
    const el = lastEditable;
    if (el && el.isConnected) {
      let ok = false;
      try {
        el.focus();
        ok = document.execCommand('insertText', false, text);
      } catch (e) {}
      if (!ok && 'value' in el) {
        try {
          el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end');
          el.dispatchEvent(new Event('input', { bubbles: true }));
          ok = true;
        } catch (e) {}
      }
      if (ok) return Promise.resolve('inserted');
    }
    return copyText(text).then((ok) => (ok ? 'copied' : 'fail'));
  }

  function showReplies(anchor, found) {
    if (!found.length) {
      showPanel(anchor, '', [textNode('Для цього тексту немає тригерів з відповідями. Додайте слово через пункт меню «Додати виділене як тригер відповідей».')]);
      return;
    }
    const nodes = found.map((tr) => {
      const g = document.createElement('div');
      g.className = 'grp';
      const c = document.createElement('div');
      c.className = 'cap';
      c.textContent = 'Тригер «' + tr.w + '»:';
      g.appendChild(c);
      tr.r.forEach((r) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'rep';
        b.textContent = r;
        b.title = 'Вставити у поле вводу (якщо поля немає, текст копіюється)';
        b.addEventListener('click', () => {
          insertReply(r).then((how) => {
            b.textContent = how === 'inserted' ? 'Вставлено ✓' : how === 'copied' ? 'Скопійовано ✓' : 'Не вдалося вставити';
            setTimeout(hideBubble, 700);
          });
        });
        g.appendChild(b);
      });
      return g;
    });
    showPanel(anchor, 'Готові відповіді', nodes);
  }

  // Зберігає тригер (і, якщо задано, відповідь) у сховищі розширення
  function saveTrigger(word, reply) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get({ triggers: [] }, (s) => {
          const list = Array.isArray(s.triggers) ? s.triggers.slice() : [];
          let t = list.find((x) => x && typeof x.w === 'string' && x.w.toLowerCase() === word.toLowerCase());
          if (!t) {
            t = { w: word, r: [] };
            list.push(t);
          }
          if (!Array.isArray(t.r)) t.r = [];
          if (reply && t.r.indexOf(reply) < 0) t.r.push(reply.slice(0, 1000));
          chrome.storage.local.set({ triggers: list }, () => resolve(true));
        });
      } catch (e) {
        resolve(false);
      }
    });
  }

  function showAddTrigger(anchor, raw) {
    const word = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!word) return;
    if (word.length > 80) {
      showPanel(anchor, '', [textNode('Тригер має бути коротшим за 80 символів: виділіть слово чи коротку фразу.')]);
      return;
    }
    saveTrigger(word, '');
    const ta = document.createElement('textarea');
    ta.placeholder = 'Готова відповідь на це слово';
    ta.title = 'Текст, який можна буде вставити одним кліком';
    const status = document.createElement('div');
    status.className = 'cap';
    status.textContent = 'Тригер збережено. Додайте готову відповідь (можна кілька).';
    const add = document.createElement('button');
    add.type = 'button';
    add.textContent = 'Додати відповідь';
    add.addEventListener('click', () => {
      const v = ta.value.trim();
      if (!v) return;
      saveTrigger(word, v).then((ok) => {
        status.textContent = ok ? 'Відповідь додано ✓' : 'Не вдалося зберегти';
        ta.value = '';
      });
    });
    const wrap = document.createElement('div');
    wrap.appendChild(ta);
    wrap.appendChild(add);
    wrap.style.marginBottom = '8px';
    const box = showPanel(anchor, 'Тригер: «' + word + '»', [status, wrap]);
    try { ta.focus(); } catch (e) {}
    return box;
  }

  function ctxConvert(text) {
    if (!S.enabled) return;
    const el = activeEditable();
    if (el && readSelection(el).text) {
      convertSelection();
      return;
    }
    const anchor = selRect();
    const t = String(text || '').trim();
    if (!t || t.length > MAX_TEXT) return;
    if (S.langs.length < 2) {
      showPanel(anchor, '', [textNode('Увімкніть щонайменше дві мови в налаштуваннях.')]);
      return;
    }
    const res = forcedConvert(t, S.langs);
    if (!res) {
      showPanel(anchor, '', [textNode('Не вдалося перетворити цей текст.')]);
      return;
    }
    showBubble(anchor, res.text, LFX.LAYOUTS[res.to].name);
  }

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg) return;
      if (msg.type === 'ctx-convert') ctxConvert(msg.text);
      else if (msg.type === 'ctx-replies') showReplies(selRect(), matchTriggers(String(msg.text || '')));
      else if (msg.type === 'ctx-trigger') showAddTrigger(selRect(), msg.text);
    });
  } catch (e) {}

  // Клік поза віконцем закриває його
  document.addEventListener('mousedown', (e) => {
    if (bubble && e.composedPath().indexOf(bubble.host) === -1) hideBubble();
  }, true);

  function scheduleSelCheck(ctrl) {
    clearTimeout(selTimer);
    selTimer = setTimeout(() => selectionCheck(ctrl), 250);
  }

  document.addEventListener('mouseup', (e) => {
    // Відпускання кнопки миші на нашій кнопці чи віконці виділення не змінює
    const path = e.composedPath();
    if ((chip && path.indexOf(chip.host) !== -1) || (bubble && path.indexOf(bubble.host) !== -1)) return;
    scheduleSelCheck(e.ctrlKey);
  }, true);
  document.addEventListener('keyup', (e) => {
    if (bubble && e.composedPath().indexOf(bubble.host) !== -1) return; // друк у нашому віконці
    // Виділення з клавіатури: Shift + стрілки, Ctrl + A
    if (e.shiftKey || e.key === 'Shift' || (e.ctrlKey && e.code === 'KeyA')) scheduleSelCheck(false);
  }, true);

  // Esc ховає кнопку (і більше не пропонує для цього тексту)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && bubble) hideBubble();
    if (e.key !== 'Escape' || !chip) return;
    const f = chip.onExpire;
    hideChip();
    if (f) f();
  }, true);

  // Фокус пішов з поля: кнопка цього поля зникає (клік по самій кнопці фокус не забирає)
  document.addEventListener('focusout', (e) => {
    if (!chip || !(e.target instanceof Node) || !(e.target === chip.el || chip.el.contains(e.target))) return;
    const f = chip.onExpire;
    hideChip();
    if (f) f();
  }, true);

  window.addEventListener('scroll', schedulePlace, true);
  window.addEventListener('resize', schedulePlace);
})();
