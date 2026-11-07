/* Автор: Сивак Микола Володимирович, +380961179898, Цифросервіс */
// Клік по іконці розширення відкриває сторінку налаштувань
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

// Надсилає скрипту сторінки (у тому кадрі, де викликано меню або натиснуто клавішу) команду
function send(tabId, msg, frameId) {
  const opt = typeof frameId === 'number' ? { frameId: frameId } : undefined;
  chrome.tabs.sendMessage(tabId, msg, opt).catch(() => {});
}

// Гаряча клавіша: просимо скрипт на активній вкладці перетворити виділений текст (відгукнеться лише кадр із фокусом)
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'convert-selection') return;
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tabs.length && tabs[0].id != null) send(tabs[0].id, { type: 'convert-selection' });
});

// Меню правої кнопки миші для виділеного тексту
function buildMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'lf-convert', title: 'Виправити розкладку', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'lf-replies', title: 'Готові відповіді', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'lf-trigger', title: 'Додати виділене як тригер відповідей', contexts: ['selection'] });
  });
}
chrome.runtime.onInstalled.addListener(buildMenus);
chrome.runtime.onStartup.addListener(buildMenus);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || tab.id == null) return;
  const text = info.selectionText || '';
  if (info.menuItemId === 'lf-convert') send(tab.id, { type: 'ctx-convert', text: text }, info.frameId);
  else if (info.menuItemId === 'lf-replies') send(tab.id, { type: 'ctx-replies', text: text }, info.frameId);
  else if (info.menuItemId === 'lf-trigger') send(tab.id, { type: 'ctx-trigger', text: text }, info.frameId);
});
