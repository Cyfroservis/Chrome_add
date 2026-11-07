// Автор: Сивак Микола Володимирович, +380961179898, Цифросервіс
require('./layouts.js');
const LFX = require('./detect.js');

let fail = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) fail++;
  console.log((ok ? 'OK   ' : 'FAIL ') + name + ' => ' + JSON.stringify(got) + (ok ? '' : '  (очікували ' + JSON.stringify(want) + ')'));
}
function suggest(text, langs, minLetters) {
  const r = LFX.analyze(text, langs, { minLetters: minLetters || 5 });
  return r ? r.to + ':' + r.text : null;
}

// Довжини розкладок
Object.keys(LFX.LAYOUTS).forEach((id) => {
  const l = LFX.LAYOUTS[id];
  check('довжина ' + id, l.normal.length + '/' + l.shift.length, '47/47');
});

// Перетворення
check('en->uk привіт', LFX.convert('ghbdsn', 'en', 'uk'), 'привіт');
check('en->uk речення', LFX.convert('Ghbdsn! Zr cghfdb&', 'en', 'uk'), 'Привіт! Як справи?');
check('en->uk апостроф', LFX.convert("v'zx", 'en', 'uk'), 'мєяч'); // ' на en = клавіша є
check('uk->en hello', LFX.convert('руддщ', 'uk', 'en'), 'hello');
check('uk->ru (і -> ы на тій самій клавіші)', LFX.convert('привіт', 'uk', 'ru'), 'привыт');
check('en->fr salut', LFX.convert('sqlut', 'en', 'fr'), 'salut');

// Підказки: мають з'явитись
check('привіт (en->uk)', suggest('ghbdsn', ['en', 'uk']), 'uk:привіт');
check('речення (en->uk)', suggest('Ghbdsn! Zr cghfdb&', ['en', 'uk']), 'uk:Привіт! Як справи?');
check('hello (uk->en)', suggest('руддщ цщкдв', ['en', 'uk']), 'en:hello world');
check('дякую (en->uk)', suggest('lzre.', ['en', 'uk'], 4), 'uk:дякую');
check('добрий день (en->uk)', suggest('lj,hbq ltym', ['en', 'uk']), 'uk:добрий день');
check('salut (en->fr)', suggest('sqlut', ['en', 'fr']), 'fr:salut');
check('привет (en->ru)', suggest('ghbdtn', ['en', 'ru']), 'ru:привет');

// Підказки: НЕ мають з'явитись
check('hello world', suggest('hello world', ['en', 'uk']), null);
check('привіт як справи', suggest('привіт як справи', ['en', 'uk']), null);
check('ciao come stai', suggest('ciao come stai', ['en', 'uk']), null);
check('css', suggest('css', ['en', 'uk'], 3), null);
check('html', suggest('html', ['en', 'uk'], 3), null);
check('json', suggest('json', ['en', 'uk'], 3), null);
check('kubernetes deployment', suggest('kubernetes deployment', ['en', 'uk']), null);
check('змішаний hello ghbdsn', suggest('hello ghbdsn', ['en', 'uk']), null);
check('одна мова', suggest('ghbdsn', ['en']), null);
check('занадто коротко', suggest('rf', ['en', 'uk']), null);
check('bonjour (en,fr)', suggest('bonjour', ['en', 'fr']), null);

console.log(fail ? ('\nПровалів: ' + fail) : '\nУсі перевірки пройдено');
process.exit(fail ? 1 : 0);
