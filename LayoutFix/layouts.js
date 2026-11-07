/* Автор: Сивак Микола Володимирович, +380961179898, Цифросервіс */
// Розкладки клавіатури за фізичними позиціями клавіш.
// Кожна розкладка: 47 символів без Shift (normal) і 47 з Shift (shift) у порядку клавіш:
//   ряд 1 (13): ` 1 2 3 4 5 6 7 8 9 0 - =
//   ряд 2 (13): Q W E R T Y U I O P [ ] \
//   ряд 3 (11): A S D F G H J K L ; '
//   ряд 4 (10): Z X C V B N M , . /
// Розкладки en, uk, ru складені найретельніше. it, fr, de, es вважаються ЕКСПЕРИМЕНТАЛЬНИМИ (experimental: true):
// їх треба звірити з реальною клавіатурою.

(function () {
  const defs = {
    en: {
      name: 'English',
      normal: ['`1234567890-=', 'qwertyuiop[]\\', "asdfghjkl;'", 'zxcvbnm,./'],
      shift: ['~!@#$%^&*()_+', 'QWERTYUIOP{}|', 'ASDFGHJKL:"', 'ZXCVBNM<>?']
    },
    uk: {
      name: 'Українська',
      normal: ['ʼ1234567890-=', 'йцукенгшщзхїґ', 'фівапролджє', 'ячсмитьбю.'],
      shift: ['₴!"№;%:?*()_+', 'ЙЦУКЕНГШЩЗХЇҐ', 'ФІВАПРОЛДЖЄ', 'ЯЧСМИТЬБЮ,'],
      alias: { "'": 0, '’': 0 } // звичайний апостроф вважаємо клавішею ʼ (позиція 0)
    },
    ru: {
      name: 'Русский',
      normal: ['ё1234567890-=', 'йцукенгшщзхъ\\', 'фывапролджэ', 'ячсмитьбю.'],
      shift: ['Ё!"№;%:?*()_+', 'ЙЦУКЕНГШЩЗХЪ/', 'ФЫВАПРОЛДЖЭ', 'ЯЧСМИТЬБЮ,']
    },
    it: {
      name: 'Italiano',
      experimental: true,
      normal: ["\\1234567890'ì", 'qwertyuiopè+ù', 'asdfghjklòà', 'zxcvbnm,.-'],
      shift: ['|!"£$%&/()=?^', 'QWERTYUIOPé*§', 'ASDFGHJKLç°', 'ZXCVBNM;:_']
    },
    fr: {
      name: 'Français',
      experimental: true,
      normal: ["²&é\"'(-è_çà)=", 'azertyuiop^$*', 'qsdfghjklmù', 'wxcvbn,;:!'],
      shift: ['²1234567890°+', 'AZERTYUIOP¨£µ', 'QSDFGHJKLM%', 'WXCVBN?./§']
    },
    de: {
      name: 'Deutsch',
      experimental: true,
      normal: ['^1234567890ß´', 'qwertzuiopü+#', 'asdfghjklöä', 'yxcvbnm,.-'],
      shift: ['°!"§$%&/()=?`', "QWERTZUIOPÜ*'", 'ASDFGHJKLÖÄ', 'YXCVBNM;:_']
    },
    es: {
      name: 'Español',
      experimental: true,
      normal: ["º1234567890'¡", 'qwertyuiop`+ç', 'asdfghjklñ´', 'zxcvbnm,.-'],
      shift: ['ª!"·$%&/()=?¿', 'QWERTYUIOP^*Ç', 'ASDFGHJKLÑ¨', 'ZXCVBNM;:_']
    }
  };

  const out = {};
  Object.keys(defs).forEach((id) => {
    const d = defs[id];
    const normal = d.normal.join('');
    const shift = d.shift.join('');
    if (normal.length !== 47 || shift.length !== 47) {
      console.warn('LayoutFix: розкладка ' + id + ' має неправильну довжину', normal.length, shift.length);
    }
    // Зворотна таблиця: символ -> позиція клавіші (i) і чи був Shift. Якщо символ повторюється, береться перша позиція
    const rev = new Map();
    for (let i = 0; i < normal.length; i++) if (!rev.has(normal[i])) rev.set(normal[i], { i: i, shift: false });
    for (let i = 0; i < shift.length; i++) if (!rev.has(shift[i])) rev.set(shift[i], { i: i, shift: true });
    if (d.alias) Object.keys(d.alias).forEach((ch) => { if (!rev.has(ch)) rev.set(ch, { i: d.alias[ch], shift: false }); });
    out[id] = { id: id, name: d.name, experimental: !!d.experimental, normal: normal, shift: shift, rev: rev };
  });

  globalThis.LFX_LAYOUTS = out;
})();
