/* Автор: Сивак Микола Володимирович, +380961179898, Цифросервіс */
// Слідкує за набором тексту в полях. Коли набір зупинився на кілька секунд, перевіряє текст.
// Якщо він схожий на набраний не в тій розкладці, біля кінця тексту з'являється напівпрозора кнопка
// «Можливо: Українська?» (клік перетворює текст) або, в режимі «автоматично», текст перетворюється одразу
// з кнопкою «Скасувати». Вигляд кнопки узято з міток клікера по сайтах.
// Текст нікуди не надсилається: усе відбувається на цьому комп'ютері.

(function () {
  const LFX = globalThis.LFX;
  if (!LFX) return;

  const DEFAULTS = { enabled: true, langs: null, delaySec: 2.5, minLetters: 5, excluded: '', mode: 'chip' };
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
  function endOfField(el, f) {
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
      d.textContent = el.value;
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
    const end = endOfText(el, f);
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

  function makeChip(el, label, title, undo, onClick, ttl, onExpire) {
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
      'Можливо: ' + target + '?',
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
      '↶ Скасувати',
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
    const ms = Math.max(1, Math.min(10, Number(S.delaySec) || 2.5)) * 1000;
    timer = setTimeout(() => check(el), ms);
  }, true);

  // Esc ховає кнопку (і більше не пропонує для цього тексту)
  document.addEventListener('keydown', (e) => {
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
