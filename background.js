const DEFAULTS = {
  idleMinutes: 5,
  collapseGroups: true,
  minimizeWindows: true,
  restoreGroups: true,
  restoreWindows: true,
  noRestoreAfterMinutes: 0,
  switchToLastTab: true
};

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

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

// Перемикає кожне вікно на крайню праву вкладку (поза групою, якщо така є)
async function switchToLastTabs() {
  const wins = await chrome.windows.getAll({ windowTypes: ['normal'] });
  for (const w of wins) {
    try {
      const tabs = await chrome.tabs.query({ windowId: w.id });
      if (!tabs.length) continue;
      tabs.sort((a, b) => a.index - b.index);
      const ungrouped = tabs.filter((t) => t.groupId === -1);
      const target = ungrouped.length ? ungrouped[ungrouped.length - 1] : tabs[tabs.length - 1];
      if (!target.active) await chrome.tabs.update(target.id, { active: true });
    } catch (e) {
      console.warn('Не вдалось перемкнути вкладку у вікні:', w.id, e && e.message);
    }
  }
}

async function hide(s) {
  const saved = await chrome.storage.local.get({ hiddenGroups: [], hiddenWindows: {}, hiddenAt: 0 });
  const hiddenGroups = new Set(saved.hiddenGroups);
  const hiddenWindows = saved.hiddenWindows;
  const hiddenAt = saved.hiddenAt || Date.now();

  if (s.switchToLastTab) await switchToLastTabs();

  if (s.collapseGroups) {
    const groups = await chrome.tabGroups.query({});
    for (const g of groups) {
      if (!g.collapsed) {
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
    hiddenAt: hiddenAt
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
    await hide(s);
  } else if (state === 'active') {
    await restore(s);
  }
});
