// Автор: Сивак Микола Володимирович, Цифросервіс, +380961179898
(function () {
  // Захист від повторної ін'єкції в ту саму сторінку
  if (window.__siteClicker) return;
  window.__siteClicker = true;

  const CLICKABLE = 'a,button,input,select,textarea,summary,label,[role="button"],[onclick]';
  // Поля для тексту (паролі свідомо виключені: пароль у сховищі розширення зберігати не можна)
  const FIELD =
    'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])' +
    ':not([type="reset"]):not([type="file"]):not([type="hidden"]):not([type="password"]),' +
    'textarea,[contenteditable=""],[contenteditable="true"],[role="textbox"]';

  let recording = false;
  let captureField = null; // поле, у яке користувач зараз вписує текст: набране зберігається в «Текст N»
  let captureSlot = 0; // слот поточного поля (0 = ще визначається або всі слоти зайняті)
  let pendingField = null; // клік по полю: стане кроком «Текст N», щойно користувач почне набирати
  let ctrlAlone = false; // Ctrl натиснули й відпустили без інших клавіш (так завершується введення тексту)
  let notice = ''; // коротке повідомлення на панелі запису
  let overlay = null;
  let ui = {}; // положення панелі і чи вона згорнута: { x, y, collapsed }, пам'ятається між сторінками
  let drag = null; // триває перетягування панелі: зсув курсора відносно кута панелі
  let suppressClick = false; // клік одразу після перетягування не записується
  let reportMode = false; // панель показує підсумок запису після «Стоп» і не перемальовується як панель запису
  let reportTimers = [];
  let markRoot = null; // контейнер півпрозорих міток із номерами кліків (лише підказка, у запис не потрапляє)
  let marks = new Map(); // елемент -> { node, parts }, щоб кілька кліків по одному елементу давали одну мітку
  let placed = []; // зайняті місця міток, щоб сусідні не накладались
  let lastClickTs = 0;
  let running = false;
  let queue = Promise.resolve();

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ---------- Селектор і підпис елемента ----------
  function cssPath(el) {
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.documentElement) {
      if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) {
        parts.unshift('#' + CSS.escape(el.id));
        break;
      }
      let part = el.tagName.toLowerCase();
      const parent = el.parentElement;
      if (parent) {
        const sameTag = Array.prototype.filter.call(parent.children, (c) => c.tagName === el.tagName);
        if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(el) + 1) + ')';
      }
      parts.unshift(part);
      el = parent;
    }
    return parts.join(' > ');
  }

  function clean(raw) {
    return String(raw || '').trim().replace(/\s+/g, ' ');
  }

  // Для полів вводу підпис береться з placeholder/назви, а НЕ з вмісту (щоб не зберігати набраний текст)
  function fieldLabel(el) {
    const t = clean(
      el.getAttribute('placeholder') || el.getAttribute('aria-label') ||
      el.getAttribute('name') || el.getAttribute('title')
    );
    return (t || el.tagName.toLowerCase()).slice(0, 40);
  }

  function labelOf(el) {
    const tag = el.tagName;
    const isButtonInput = tag === 'INPUT' && /^(button|submit|reset)$/i.test(el.type || '');
    if (tag === 'TEXTAREA' || el.isContentEditable || (tag === 'INPUT' && !isButtonInput)) {
      return fieldLabel(el);
    }
    const t = clean(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title'));
    return (t || tag.toLowerCase()).slice(0, 40);
  }

  // ---------- Мітки на сторінці ----------
  function markerFor(el) {
    if (!markRoot) {
      markRoot = document.createElement('div');
      markRoot.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483646;pointer-events:none';
      document.documentElement.appendChild(markRoot);
    }
    let g = marks.get(el);
    if (g) return g;
    const r = el.getBoundingClientRect();
    const x = Math.max(0, r.left + window.scrollX - 10);
    let y = Math.max(0, r.top + window.scrollY - 10);
    // Мітка іншого елемента поруч зсувається вниз, щоб номери лишались читабельними
    for (let i = 0; i < 12 && placed.some((p) => Math.abs(p.x - x) < 40 && Math.abs(p.y - y) < 24); i++) y += 24;
    placed.push({ x: x, y: y });
    const node = document.createElement('div');
    node.style.cssText =
      'position:absolute;left:' + x + 'px;top:' + y + 'px;min-width:22px;height:22px;padding:0 6px;' +
      'box-sizing:border-box;border-radius:11px;border:1px solid rgba(255,255,255,.6);color:#fff;' +
      'font:bold 12px/20px Segoe UI,Arial,sans-serif;text-align:center;white-space:nowrap;' +
      'text-shadow:0 0 2px rgba(0,0,0,.8);pointer-events:none';
    markRoot.appendChild(node);
    g = { node: node, parts: [] };
    marks.set(el, g);
    return g;
  }

  // Клік: «2» (червона), кілька кліків по одному елементу: «2·3·5», вставка тексту: «4 · Текст 1» (синя),
  // клік без виконання (з Ctrl): «🛡 3» (фіолетова)
  function labelMark(g, n, slot, silent) {
    g.parts.push({ n: n, slot: slot, silent: !!silent });
    const hasText = g.parts.some((p) => p.slot);
    const hasSilent = g.parts.some((p) => p.silent);
    g.node.textContent = g.parts
      .map((p) => (p.silent ? '🛡 ' : '') + (p.slot ? p.n + ' · Текст ' + p.slot : String(p.n)))
      .join(hasText ? ' | ' : '·');
    g.node.style.background = hasText ? 'rgba(26,86,176,.55)' : hasSilent ? 'rgba(106,27,154,.6)' : 'rgba(176,0,32,.55)';
  }

  function clearMarks() {
    if (markRoot) {
      markRoot.remove();
      markRoot = null;
    }
    marks = new Map();
    placed = [];
  }

  // ---------- Запис кроків ----------
  function inside(parent, node) {
    return !!parent && (parent === node || (!!parent.contains && parent.contains(node)));
  }

  function valueOf(el) {
    return String((el.isContentEditable ? el.innerText : el.value) || '');
  }

  // Дописує крок у job у сховищі і повертає його номер
  async function pushStep(step) {
    const data = await chrome.storage.local.get('job');
    const job = data.job || { steps: [] };
    job.steps = job.steps || [];
    if (!job.steps.length) step.delayMs = 0;
    job.steps.push(step);
    await chrome.storage.local.set({ job: job });
    return job.steps.length;
  }

  function addStep(step, el, silent) {
    // Місце мітки вираховуємо одразу, поки елемент іще на екрані (сторінка може його сховати після кліку)
    const g = el ? markerFor(el) : null;
    // Черга, щоб швидкі кліки не затирали один одного при читанні/записі сховища
    queue = queue.then(async () => {
      const num = await pushStep(step);
      if (g) labelMark(g, num, step.type === 'text' ? step.slot : 0, silent);
      renderOverlay();
    });
  }

  function nextDelay() {
    // Затримка між кліками від 0.3 до 5 с (потім її можна змінити в налаштуваннях);
    // перший крок після переходу на нову сторінку чи нового запису отримує 1.5 с
    const now = Date.now();
    const d = lastClickTs ? Math.min(5000, Math.max(300, now - lastClickTs)) : 1500;
    lastClickTs = now;
    return d;
  }

  // Зберігаємо набране в слот (читаємо свіже значення зі сховища: записи йдуть по черзі)
  async function writeSlot(slot, text) {
    const data = await chrome.storage.local.get('texts');
    const arr = data.texts || [];
    while (arr.length < 3) arr.push({});
    arr[slot - 1] = { text: text, enter: !!String(text).trim() };
    await chrome.storage.local.set({ texts: arr });
  }

  function saveSlotText(slot, text) {
    queue = queue.then(() => writeSlot(slot, text));
  }

  // Клік по полю, у якому користувач почав набирати: це крок «Текст N» із першим вільним слотом
  function commitText(f) {
    const g = markerFor(f.el);
    queue = queue.then(async () => {
      const td = await chrome.storage.local.get('texts');
      const arr = td.texts || [];
      let slot = 0;
      for (let n = 1; n <= 3; n++) {
        if (!arr[n - 1] || !String(arr[n - 1].text || '').trim()) {
          slot = n;
          break;
        }
      }
      if (!slot) {
        // Усі слоти зайняті: поле лишається звичайним кліком, набране не зберігається
        const num = await pushStep(Object.assign({ type: 'click' }, f.base));
        labelMark(g, num, 0, false);
        notice = 'Усі 3 тексти зайняті, набране не збережено';
        renderOverlay();
        return;
      }
      if (captureField === f.el) captureSlot = slot;
      const num = await pushStep(Object.assign({ type: 'text', slot: slot }, f.base));
      labelMark(g, num, slot, false);
      await writeSlot(slot, valueOf(f.el));
      renderOverlay();
    });
  }

  // Клік по полю, у якому так і не почали набирати, лишається звичайним кліком
  function flushPending() {
    if (!pendingField) return;
    const f = pendingField;
    pendingField = null;
    addStep(Object.assign({ type: 'click' }, f.base), f.el);
  }

  function onClick(ev) {
    if (!recording || suppressClick) return;
    const path = ev.composedPath ? ev.composedPath() : [];
    if (overlay && path.indexOf(overlay) !== -1) return;
    const base = ev.target instanceof Element ? ev.target : null;
    if (!base) return;

    notice = '';
    // Ctrl + клік: крок записується, але сторінка клік не отримує (щоб не відправити повідомлення)
    const silent = !!ev.ctrlKey;
    if (silent) {
      ctrlAlone = false;
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }

    // Клік усередині поля, у яке вписують текст (поставити курсор), не записується
    if (!silent && (inside(captureField, base) || inside(pendingField && pendingField.el, base))) return;

    // Клік деінде завершує введення тексту і записується як звичайний
    captureField = null;
    captureSlot = 0;
    flushPending();

    const field = silent ? null : base.closest(FIELD);
    if (field) {
      // Крок стане «Текст N», якщо користувач почне набирати; якщо ні, залишиться кліком
      pendingField = { el: field, base: { sel: cssPath(field), label: fieldLabel(field), delayMs: nextDelay() } };
      renderOverlay();
      return;
    }
    const el = base.closest(CLICKABLE) || base;
    addStep({ type: 'click', sel: cssPath(el), label: labelOf(el), delayMs: nextDelay() }, el, silent);
  }

  // З Ctrl сторінка не бачить і решту подій миші, бо деякі сайти реагують не на click, а на mousedown/mouseup
  function onBlock(ev) {
    if (!recording || !ev.ctrlKey) return;
    const path = ev.composedPath ? ev.composedPath() : [];
    if (overlay && path.indexOf(overlay) !== -1) return;
    ctrlAlone = false;
    ev.preventDefault();
    ev.stopImmediatePropagation();
  }

  function onInput(ev) {
    if (!recording) return;
    const t = ev.target;
    if (pendingField && inside(pendingField.el, t)) {
      // Перше набране в щойно обраному полі: крок «Текст N»
      const f = pendingField;
      pendingField = null;
      captureField = f.el;
      captureSlot = 0;
      commitText(f);
      return;
    }
    if (!captureField || captureSlot < 1 || !inside(captureField, t)) return;
    saveSlotText(captureSlot, valueOf(captureField));
  }

  function onKey(ev) {
    if (!recording) return;
    if (ev.type === 'keydown' && ev.key !== 'Control' && ev.ctrlKey) ctrlAlone = false; // Ctrl+V, Ctrl+C тощо не є сигналом
    // Звичайний Enter у полі, куди вписують текст, блокується (щоб не відправити повідомлення); Shift+Enter працює
    if (ev.key === 'Enter' && !ev.shiftKey) {
      const f = captureField || (pendingField && pendingField.el);
      if (f && inside(f, ev.target)) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
      }
      return;
    }
    if (ev.key !== 'Control') return;
    if (ev.type === 'keydown') {
      if (!ev.repeat) ctrlAlone = true;
    } else if (ev.type === 'keyup') {
      // Ctrl натиснули й відпустили без інших клавіш: кінець введення тексту
      if (ctrlAlone && captureField) {
        captureField = null;
        captureSlot = 0;
        renderOverlay();
      }
      ctrlAlone = false;
    }
  }

  // ---------- Панель запису (індикатор) ----------
  function mkOverlayButton(text, act) {
    const b = document.createElement('button');
    b.textContent = text;
    b.dataset.act = act;
    b.style.cssText =
      'margin:8px 8px 0 0;padding:9px 16px;font:bold 16px Segoe UI,Arial,sans-serif;cursor:pointer;' +
      'border:1px solid rgba(255,255,255,.8);border-radius:6px;background:rgba(255,255,255,.2);color:#fff';
    return b;
  }

  function mkSmallButton(text, act, title) {
    const b = document.createElement('button');
    b.textContent = text;
    b.dataset.act = act;
    b.title = title;
    b.style.cssText =
      'margin:0;padding:1px 8px;font:bold 14px/18px Segoe UI,Arial,sans-serif;cursor:pointer;' +
      'border:1px solid rgba(255,255,255,.8);border-radius:4px;background:rgba(255,255,255,.2);color:#fff';
    return b;
  }

  // Індикатор тексту: порожній (сірий), заповнений (зелений), зараз набирається (жовтий)
  function mkChip(n, filled, active, small) {
    const chip = document.createElement('span');
    chip.textContent = small ? String(n) : 'Текст ' + n + (active ? ' ⌨' : filled ? ' ✓' : '');
    chip.title = 'Текст ' + n + (active ? ': набирається' : filled ? ': заповнено' : ': порожньо');
    chip.style.cssText =
      (small
        ? 'display:inline-block;min-width:20px;padding:1px 6px;border-radius:4px;font:bold 12px/18px Segoe UI,Arial,sans-serif;text-align:center;'
        : 'display:inline-block;margin:8px 6px 0 0;padding:5px 10px;border-radius:6px;font:bold 14px Segoe UI,Arial,sans-serif;') +
      'border:1px solid rgba(255,255,255,.8);' +
      (active ? 'background:#f9a825;color:#222' : filled ? 'background:#2e7d32;color:#fff' : 'background:rgba(255,255,255,.15);color:#fff');
    return chip;
  }

  // Панель не виходить за межі екрана, навіть якщо після згортання чи розгортання змінила розмір
  function clampOverlay() {
    if (!overlay || ui.x == null || !overlay.getBoundingClientRect) return;
    const r = overlay.getBoundingClientRect();
    const x = Math.max(0, Math.min(ui.x, window.innerWidth - r.width));
    const y = Math.max(0, Math.min(ui.y, window.innerHeight - r.height));
    overlay.style.left = x + 'px';
    overlay.style.top = y + 'px';
    overlay.style.right = 'auto';
  }

  function saveUi() {
    chrome.storage.local.set({ panelUi: ui });
  }

  // Згорнута панель: тонка смужка (кількість кроків, три кольорові індикатори тексту, «Стоп», «Розгорнути»)
  // Розгорнута: заголовок (за нього тягнуть), кнопка згортання, підказка, індикатори, стрічка кроків, «Стоп»
  async function renderOverlay() {
    if (!overlay || reportMode) return;
    const data = await chrome.storage.local.get(['texts', 'job']);
    if (!overlay || reportMode) return;
    const texts = data.texts || [];
    const steps = (data.job && data.job.steps) || [];
    const collapsed = !!ui.collapsed;
    const states = [1, 2, 3].map((n) => {
      const t = texts[n - 1];
      return { n: n, filled: !!(t && String(t.text || '').trim()), active: !!captureField && captureSlot === n };
    });
    overlay.style.background = 'rgba(176,0,32,.72)';
    overlay.style.padding = collapsed ? '4px 8px' : '10px 12px';
    overlay.textContent = '';

    if (collapsed) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;white-space:nowrap';
      const handle = document.createElement('span');
      handle.dataset.drag = '1';
      handle.title = 'Перетягнути панель';
      handle.style.cssText = 'cursor:move;font:bold 13px Segoe UI,Arial,sans-serif;padding:0 2px';
      handle.textContent = '● ' + steps.length;
      row.appendChild(handle);
      states.forEach((s) => row.appendChild(mkChip(s.n, s.filled, s.active, true)));
      if (notice) {
        const warn = document.createElement('span');
        warn.textContent = '!';
        warn.title = notice;
        warn.style.cssText = 'background:#f9a825;color:#222;border-radius:4px;padding:1px 7px;font:bold 12px/18px Segoe UI,Arial,sans-serif';
        row.appendChild(warn);
      }
      row.appendChild(mkSmallButton('■', 'stop', 'Зупинити запис'));
      row.appendChild(mkSmallButton('▢', 'toggle', 'Розгорнути панель'));
      overlay.appendChild(row);
      clampOverlay();
      return;
    }

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:flex-start;gap:8px';
    const title = document.createElement('div');
    title.dataset.drag = '1';
    title.title = 'Перетягніть, щоб перемістити панель';
    title.style.cssText = 'flex:1;font-size:16px;font-weight:bold;cursor:move';
    title.textContent = captureField && captureSlot > 0
      ? 'Пишіть текст у полі («Текст ' + captureSlot + '»). Щоб завершити, натисніть Ctrl. Enter не натискайте'
      : captureField
        ? 'Пишіть у полі. Щоб завершити, натисніть Ctrl'
        : '● Запис кліків';
    head.appendChild(title);
    head.appendChild(mkSmallButton('—', 'toggle', 'Згорнути панель до смужки'));
    overlay.appendChild(head);

    if (notice) {
      const note = document.createElement('div');
      note.style.cssText = 'margin-top:4px;color:#ffe082;font-weight:bold';
      note.textContent = notice;
      overlay.appendChild(note);
    }

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:12px;margin-top:4px;opacity:.9';
    hint.textContent = 'Ctrl + клік: записати клік без виконання (щоб не відправити)';
    overlay.appendChild(hint);

    const chips = document.createElement('div');
    states.forEach((s) => chips.appendChild(mkChip(s.n, s.filled, s.active, false)));
    overlay.appendChild(chips);

    // Що вже записано (береться зі сховища, тому лишається повним і після переходу на нову сторінку)
    const items = steps.map((s, i) => (i + 1) + (s.type === 'text' ? ' Текст' + (s.slot ? ' ' + s.slot : '') : ' клік'));
    const counter = document.createElement('div');
    counter.style.cssText = 'font-size:13px;margin-top:6px;opacity:.95';
    counter.textContent = items.length
      ? 'Записано: ' + (items.length > 12 ? '… ' : '') + items.slice(-12).join(', ')
      : 'Поки нічого не записано';
    overlay.appendChild(counter);
    overlay.appendChild(mkOverlayButton('■ Стоп', 'stop'));
    clampOverlay();
  }

  // ---------- Перетягування панелі ----------
  function onDragMove(e) {
    if (!drag || !overlay) return;
    const r = overlay.getBoundingClientRect();
    ui.x = Math.max(0, Math.min(e.clientX - drag.dx, window.innerWidth - r.width));
    ui.y = Math.max(0, Math.min(e.clientY - drag.dy, window.innerHeight - r.height));
    overlay.style.left = ui.x + 'px';
    overlay.style.top = ui.y + 'px';
    overlay.style.right = 'auto';
  }

  function endDrag(save) {
    if (!drag) return;
    drag = null;
    window.removeEventListener('mousemove', onDragMove, true);
    window.removeEventListener('mouseup', onDragEnd, true);
    // Клік, що слідує за відпусканням кнопки миші після перетягування, не записується
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    if (save) saveUi();
  }

  function onDragEnd() {
    endDrag(true);
  }

  async function showOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;top:8px;right:8px;z-index:2147483647;color:#fff;max-width:360px;' +
      'font:13px Segoe UI,Arial,sans-serif;padding:10px 12px;border-radius:8px;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.4);text-shadow:0 0 2px rgba(0,0,0,.7);background:rgba(176,0,32,.72)';
    // Дії на панелі не доходять до сторінки; за заголовок (data-drag) панель можна тягнути
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach((type) => {
      overlay.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type !== 'mousedown' || e.button !== 0) return;
        const h = e.target instanceof Element ? e.target.closest('[data-drag]') : null;
        if (!h) return;
        const r = overlay.getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        e.preventDefault(); // щоб не виділявся текст
        window.addEventListener('mousemove', onDragMove, true);
        window.addEventListener('mouseup', onDragEnd, true);
      }, true);
    });
    overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const b = e.target instanceof Element ? e.target.closest('button') : null;
      if (!b) return;
      if (b.dataset.act === 'stop') {
        stopRecording();
      } else if (b.dataset.act === 'toggle') {
        ui.collapsed = !ui.collapsed;
        saveUi();
        renderOverlay();
      }
    }, true);
    document.documentElement.appendChild(overlay);
    // Положення і стан (згорнута чи ні) пам'ятаються між сторінками
    const saved = await chrome.storage.local.get('panelUi');
    if (!overlay) return;
    ui = saved.panelUi || {};
    if (ui.x != null) {
      overlay.style.left = ui.x + 'px';
      overlay.style.top = ui.y + 'px';
      overlay.style.right = 'auto';
    }
    renderOverlay();
  }


  // ---------- Звіт після «Стоп» ----------
  function plural(n, one, few, many) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  // Прибирає звіт негайно (наприклад, коли одразу починається новий запис)
  function dismissReport() {
    reportTimers.forEach(clearTimeout);
    reportTimers = [];
    reportMode = false;
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
  }

  // Панель не зникає відразу: коротко показує підсумок («3 кліки, 2 тексти») і плавно щезає
  function showReport() {
    // Через ту саму чергу, щоб підрахунок врахував усі кроки, які ще дописуються у сховище
    queue = queue.then(async () => {
      const data = await chrome.storage.local.get('job');
      const steps = (data.job && data.job.steps) || [];
      if (!overlay) return;
      const nText = steps.filter((s) => s.type === 'text').length;
      const nClick = steps.length - nText;
      const parts = [];
      if (nClick) parts.push(nClick + ' ' + plural(nClick, 'клік', 'кліки', 'кліків'));
      if (nText) parts.push(nText + ' ' + plural(nText, 'текст', 'тексти', 'текстів'));
      reportMode = true;
      overlay.style.background = steps.length ? 'rgba(46,125,50,.88)' : 'rgba(110,110,110,.88)';
      overlay.style.padding = '10px 12px';
      overlay.style.pointerEvents = 'none'; // сторінка під панеллю знову клікабельна
      overlay.style.transition = 'opacity .7s ease';
      overlay.style.opacity = '1';
      overlay.textContent = '';
      const title = document.createElement('div');
      title.style.cssText = 'font-size:16px;font-weight:bold';
      title.textContent = steps.length ? '✓ Запис кліків збережено' : 'Запис порожній';
      overlay.appendChild(title);
      const line = document.createElement('div');
      line.style.cssText = 'font-size:14px;margin-top:4px';
      line.textContent = steps.length ? parts.join(', ') : 'Кроків не записано';
      overlay.appendChild(line);
      reportTimers.push(setTimeout(() => { if (overlay) overlay.style.opacity = '0'; }, 2500));
      reportTimers.push(setTimeout(dismissReport, 3300));
    });
  }

  const KEY_EVENTS = ['keydown', 'keypress', 'keyup'];
  const BLOCK_EVENTS = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'auxclick'];

  function startRecording() {
    if (recording) return;
    dismissReport();
    recording = true;
    captureField = null;
    captureSlot = 0;
    pendingField = null;
    ctrlAlone = false;
    notice = '';
    lastClickTs = 0;
    document.addEventListener('click', onClick, true);
    document.addEventListener('input', onInput, true);
    KEY_EVENTS.forEach((t) => document.addEventListener(t, onKey, true));
    BLOCK_EVENTS.forEach((t) => document.addEventListener(t, onBlock, true));
    showOverlay();
  }

  function stopRecording() {
    flushPending();
    endDrag(false);
    recording = false;
    captureField = null;
    captureSlot = 0;
    ctrlAlone = false;
    notice = '';
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('input', onInput, true);
    KEY_EVENTS.forEach((t) => document.removeEventListener(t, onKey, true));
    BLOCK_EVENTS.forEach((t) => document.removeEventListener(t, onBlock, true));
    clearMarks();
    chrome.storage.local.set({ recording: { active: false } });
    if (overlay) showReport();
  }

  // ---------- Виконання ----------
  async function waitFor(sel, timeout) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      let el = null;
      try {
        el = document.querySelector(sel);
      } catch (e) {
        return null;
      }
      if (el) return el;
      await sleep(250);
    }
    return null;
  }

  function clickEl(el) {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = el.getBoundingClientRect();
    const opts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    };
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
  }

  function typeText(el, text, enter) {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.focus();
    if (el.isContentEditable) {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
    } else {
      const isArea = typeof HTMLTextAreaElement !== 'undefined' && el instanceof HTMLTextAreaElement;
      const isInput = typeof HTMLInputElement !== 'undefined' && el instanceof HTMLInputElement;
      if (!isArea && !isInput) throw new Error('елемент не є полем вводу');
      // Нативний setter, щоб сайти на React/Vue побачили зміну значення
      const desc = Object.getOwnPropertyDescriptor(isArea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value');
      if (desc && desc.set) desc.set.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (enter) {
      ['keydown', 'keypress', 'keyup'].forEach((type) => {
        el.dispatchEvent(new KeyboardEvent(type, {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
        }));
      });
    }
  }

  async function finish(ok, text) {
    await chrome.storage.local.remove('run');
    await chrome.storage.local.set({ lastResult: { ok: ok, text: text, ts: Date.now() } });
  }

  // Стан виконання (run.idx) лежить у сховищі: якщо крок переводить на нову сторінку,
  // скрипт знищується, а фоновий скрипт вставляє його знову і виконання продовжується з наступного кроку.
  async function runLoop() {
    if (running) return;
    running = true;
    try {
      while (true) {
        const data = await chrome.storage.local.get('run');
        const run = data.run;
        if (!run) break;
        if (run.idx >= run.steps.length) {
          await finish(true, 'Виконано кроків: ' + run.steps.length);
          break;
        }
        const step = run.steps[run.idx];
        await sleep(step.delayMs || 0);
        const el = await waitFor(step.sel, 8000);
        if (!el) {
          await finish(false, 'Не знайдено елемент кроку ' + (run.idx + 1) + ': ' + step.label);
          break;
        }
        // Крок із номером тексту бере актуальний текст зі сховища; старі кроки мають власний текст
        let text = step.text || '';
        let enter = !!step.enter;
        if (step.type === 'text' && step.slot) {
          const td = await chrome.storage.local.get('texts');
          const t = (td.texts || [])[step.slot - 1] || {};
          text = t.text || '';
          enter = !!t.enter;
          if (!text.trim()) {
            await finish(false, 'Крок ' + (run.idx + 1) + ': «Текст ' + step.slot + '» порожній');
            break;
          }
        }
        const num = run.idx + 1;
        run.idx += 1;
        await chrome.storage.local.set({ run: run });
        try {
          if (step.type === 'text') typeText(el, text, enter);
          else clickEl(el);
        } catch (e) {
          await finish(false, 'Крок ' + num + ': ' + (e && e.message));
          break;
        }
      }
    } finally {
      running = false;
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === 'record-start') startRecording();
    if (msg.type === 'run-resume') runLoop();
  });
})();
