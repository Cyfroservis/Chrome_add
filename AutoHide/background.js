const DEFAULTS = {
  enabled: true,
  idleMinutes: 5,
  collapseGroups: true,
  minimizeWindows: true,
  restoreGroups: true,
  restoreWindows: true,
  noRestoreAfterMinutes: 0,
  switchToLastTab: true, // застаріле: читається лише для міграції в switchMode
  switchMode: '',        // '' = не вибрано (береться зі switchToLastTab); none | rightmost | media
  pauseMedia: false
};

// Старе налаштування switchToLastTab (так/ні) перетворюється на режим
function effectiveSwitchMode(s) {
  if (s.switchMode === 'none' || s.switchMode === 'rightmost' || s.switchMode === 'media') return s.switchMode;
  return s.switchToLastTab === false ? 'none' : 'rightmost';
}

async function applyInterval() {
  const s = await chrome.storage.local.get(DEFAULTS);
  const seconds = Math.max(15, Math.round(Number(s.idleMinutes) * 60) || 300);
  chrome.idle.setDetectionInterval(seconds);
}

applyInterval();
chrome.runtime.onInstalled.addListener(applyInterval);
chrome.runtime.onStartup.addListener(applyInterval);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.idleMinutes) applyInterval();
});

// Для кожного вікна обирає вкладку, на яку перейти:
//  rightmost: крайня права поза групою (а якщо всі в групах, то просто остання);
//  media: перша вкладка, що зараз видає звук, а якщо таких немає, то як rightmost.
// Обирається ДО паузи медіа: після паузи вкладка перестає «звучати».
async function pickTargets(mode) {
  if (mode === 'none') return [];
  const targets = [];
  const wins = await chrome.windows.getAll({ windowTypes: ['normal'] });
  for (const w of wins) {
    try {
      const tabs = await chrome.tabs.query({ windowId: w.id });
      if (!tabs.length) continue;
      tabs.sort((a, b) => a.index - b.index);
      let target = null;
      if (mode === 'media') target = tabs.find((t) => t.audible) || null;
      const isMedia = !!target;
      if (!target) {
        const ungrouped = tabs.filter((t) => t.groupId === -1);
        target = ungrouped.length ? ungrouped[ungrouped.length - 1] : tabs[tabs.length - 1];
      }
      targets.push({ tab: target, media: isMedia });
    } catch (e) {
      console.warn('Не вдалось обрати вкладку у вікні:', w.id, e && e.message);
    }
  }
  return targets;
}

// Виконується всередині сторінки (тому має бути самодостатньою)
function pauseAllMedia() {
  let n = 0;
  document.querySelectorAll('video,audio').forEach((m) => {
    if (!m.paused && !m.ended) {
      try {
        m.pause();
        n++;
      } catch (e) {}
    }
  });
  return n;
}

async function pauseMedia() {
  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  let paused = 0;
  for (const t of tabs) {
    if (!t.url || !/^https?:/.test(t.url) || t.discarded) continue;
    try {
      const res = await chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, func: pauseAllMedia });
      (res || []).forEach((r) => { paused += Number(r && r.result) || 0; });
    } catch (e) {
      // сторінка недоступна для скриптів (магазин Chrome, службові сторінки): пропускаємо
    }
  }
  return paused;
}

async function hide(s) {
  const saved = await chrome.storage.local.get({ hiddenGroups: [], hiddenWindows: {}, hiddenAt: 0 });
  const hiddenGroups = new Set(saved.hiddenGroups);
  const hiddenWindows = saved.hiddenWindows;
  const hiddenAt = saved.hiddenAt || Date.now();

  const targets = await pickTargets(effectiveSwitchMode(s));

  if (s.pauseMedia) {
    try {
      await pauseMedia();
    } catch (e) {
      console.warn('Помилка паузи медіа:', e && e.message);
    }
  }

  // Група, у якій лежить вкладка з відтворенням, не згортається: інакше Chrome сам перекине активну вкладку
  const keepOpen = new Set();
  for (const t of targets) {
    if (!t.tab.active) {
      try {
        await chrome.tabs.update(t.tab.id, { active: true });
      } catch (e) {
        console.warn('Не вдалось перемкнути вкладку:', t.tab.id, e && e.message);
      }
    }
    if (t.media && t.tab.groupId !== -1) keepOpen.add(t.tab.groupId);
  }

  if (s.collapseGroups) {
    const groups = await chrome.tabGroups.query({});
    for (const g of groups) {
      if (!g.collapsed && !keepOpen.has(g.id)) {
        try {
          await chrome.tabGroups.update(g.id, { collapsed: true });
          const check = await chrome.tabGroups.get(g.id);
          if (check.collapsed) {
            hiddenGroups.add(g.id);
          } else {
            console.warn('Група не згорнулась (без помилки):', g.id, g.title);
          }
        } catch (e) {
          console.warn('Помилка згортання групи:', g.id, g.title, e && e.message);
        }
      }
    }
  }

  if (s.minimizeWindows) {
    const wins = await chrome.windows.getAll({ windowTypes: ['normal'] });
    for (const w of wins) {
      if (w.state !== 'minimized') {
        hiddenWindows[w.id] = w.state;
        try {
          await chrome.windows.update(w.id, { state: 'minimized' });
        } catch (e) {}
      }
    }
  }

  await chrome.storage.local.set({
    hiddenGroups: Array.from(hiddenGroups),
    hiddenWindows: hiddenWindows,
    hiddenAt: hiddenAt,
    lastHideAt: Date.now()
  });
}

async function restore(s) {
  const saved = await chrome.storage.local.get({ hiddenGroups: [], hiddenWindows: {}, hiddenAt: 0 });

  // Повний простій = хвилини до спрацювання idle + час від моменту приховування
  const limit = Number(s.noRestoreAfterMinutes) || 0;
  let tooLong = false;
  if (limit > 0 && saved.hiddenAt) {
    const idleTotal = Number(s.idleMinutes) + (Date.now() - saved.hiddenAt) / 60000;
    tooLong = idleTotal >= limit;
  }

  if (!tooLong) {
    if (s.restoreGroups) {
      for (const id of saved.hiddenGroups) {
        try {
          await chrome.tabGroups.update(id, { collapsed: false });
        } catch (e) {}
      }
    }
    if (s.restoreWindows) {
      for (const id of Object.keys(saved.hiddenWindows)) {
        try {
          const w = await chrome.windows.get(Number(id));
          if (w.state === 'minimized') {
            await chrome.windows.update(w.id, { state: saved.hiddenWindows[id] });
          }
        } catch (e) {}
      }
    }
  }

  await chrome.storage.local.set({ hiddenGroups: [], hiddenWindows: {}, hiddenAt: 0 });
}

chrome.idle.onStateChanged.addListener(async (state) => {
  const s = await chrome.storage.local.get(DEFAULTS);
  if (state === 'idle' || state === 'locked') {
    if (s.enabled) await hide(s);
  } else if (state === 'active') {
    // Відновлення працює і при вимкненому розширенні: воно повертає лише те, що згорнуло саме розширення
    await restore(s);
  }
});
