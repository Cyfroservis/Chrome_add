/* Автор: Сивак Микола Володимирович, +380961179898, Цифросервіс */
// Клік по іконці розширення відкриває сторінку налаштувань
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

// Гаряча клавіша: просимо скрипт на активній вкладці перетворити виділений текст (відгукнеться лише кадр із фокусом)
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'convert-selection') return;
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tabs.length && tabs[0].id != null) {
    chrome.tabs.sendMessage(tabs[0].id, { type: 'convert-selection' }).catch(() => {});
  }
});
