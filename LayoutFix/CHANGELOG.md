# CHANGELOG — LayoutFix («Виправлення розкладки»)

## 2026-11-07 zannamaksimuk — v0.1.7 (НЕ ПЕРЕВІРЕНО, потрібна перевірка іншою сесією)
- Файли замінено на набір від користувача (v0.1.7): background.js, content.js, manifest.json, options.html, options.js (detect.js і layouts.js не змінились). Попередня v0.1.3 збережена в git-тезі `backup-LayoutFix-v0.1.3`.
- Нове за файлами: гаряча клавіша Ctrl+Shift+L «перетворити виділене» (commands у manifest, обробник у background.js і content.js); options.html зі згортними розділами (режим, гаряча клавіша, мови зі списком, сайти-винятки списком, тригери і відповіді).
- ЗНАЙДЕНІ НЕУЗГОДЖЕНОСТІ (не виправлялись, файли залито як приніс користувач):
  1. options.js шукає елементи `delaySec`, `minLetters`, `excluded`, яких немає в options.html: `load()` впаде на `$('delaySec').value`, сторінка налаштувань не працюватиме.
  2. В options.js немає коду для нових розділів options.html: згортання, список мов, список сайтів, тригери.
  3. options.html згадує тригери з відповідями й пункт меню правої кнопки миші, але в content.js цього немає, а в manifest.json немає дозволу `contextMenus`.
  4. Ключ паузи тепер `pauseSec` (був `delaySec`); content.js читає `pauseSec` і `excluded` (рядок).
- Перед подальшою роботою: звірити з актуальною версією у власника і узгодити options.js з options.html.

## 2026-11-07 zannamaksimuk — v0.1.3
- Розширення додано в репо як є (файли від користувача): background.js, content.js, detect.js, layouts.js, manifest.json, options.html, options.js.
- Розкладки en/uk/ru основні; it/fr/de/es експериментальні.
