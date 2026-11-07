/* Автор: Сивак Микола Володимирович, +380961179898, Цифросервіс */
// Ядро: перетворення тексту між розкладками й визначення, що текст набрано не в тій розкладці.
// Нічого не надсилає в мережу, працює лише з текстом у пам'яті.
//
// Ідея: текст перетворюється з розкладки A у розкладку B за позиціями клавіш. Підказка з'являється, коли
// початковий текст виглядає як нісенітниця в УСІХ увімкнених мовах, а перетворений складається зі знайомих слів.

(function () {
  const LAYOUTS = globalThis.LFX_LAYOUTS;

  // Найчастіші слова кожної мови (нижній регістр). Це лише для оцінки, а не повний словник
  const WORD_LIST = {
    en: 'the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us is are was were been has had did said am hello hi thanks thank please yes okay world today tomorrow how are doing going where here help need love home name',
    uk: 'і в не на я що з він це як а але ми ви вони так то у до для був була було є мій твій наш який яка яке вона його її їх цей ця ці коли де чому будь ласка привіт дякую добрий день вечір ранок ні можна треба буде бути маю маєш немає також тут там тільки вже ще дуже один два три від по при про між або чи бо щоб якщо ось мене тебе тобі мені нас вас вам нам справи справа дуже гарно добре сьогодні завтра вчора зараз потім тоді роботи роботу робота',
    ru: 'и в не на я что с он это как а но мы вы они так то у до для был была было есть мой твой наш какой какая вот она его её их этот эта эти когда где почему пожалуйста привет спасибо добрый день вечер утро да нет можно нужно будет быть очень уже еще ещё тут там только от по при про между или чтобы если меня тебя тебе мне нас вас вам нам дела дело хорошо сегодня завтра вчера сейчас потом тогда работа работы',
    it: 'il lo la i gli le un uno una di a da in con su per tra fra e è che non si mi ti ci ma se come più ho hai ha abbiamo sono sei siamo ciao grazie prego buongiorno buonasera sì no questo questa quello molto anche tutto quando dove perché cosa chi io tu lui lei noi voi loro mio tuo suo nostro bene male oggi domani ieri adesso poi allora lavoro casa',
    fr: 'le la les un une des de du et est en que qui ne pas pour dans ce il elle je tu nous vous ils elles sur avec mais ou où au aux se sa son ses très bien bonjour bonsoir merci oui non salut comment pourquoi aussi être avoir fait mon ton notre votre leur aujourd demain hier maintenant puis alors travail maison',
    de: 'der die das und ist nicht ich du er sie es wir ihr ein eine zu von mit auf für den dem des im in an aber oder auch wie was wo wann warum danke bitte hallo ja nein gut sehr heute morgen gestern jetzt dann also arbeit haus mein dein sein unser euer',
    es: 'el la los las un una de del y es en que no se por con para su al lo como más pero hola gracias favor sí buenos días buenas noches muy también estoy está yo tú él ella nosotros vosotros ellos mi tu hoy mañana ayer ahora luego entonces trabajo casa'
  };
  const WORDS = {};
  Object.keys(WORD_LIST).forEach((l) => { WORDS[l] = new Set(WORD_LIST[l].split(/\s+/).filter(Boolean)); });

  // Літери, можливі в мові
  const ALPHA = {
    en: 'abcdefghijklmnopqrstuvwxyz',
    uk: 'абвгґдеєжзиіїйклмнопрстуфхцчшщьюя',
    ru: 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
    it: 'abcdefghijklmnopqrstuvwxyzàèéìòù',
    fr: 'abcdefghijklmnopqrstuvwxyzàâçéèêëîïôùûüÿœæ',
    de: 'abcdefghijklmnopqrstuvwxyzäöüß',
    es: 'abcdefghijklmnopqrstuvwxyzáéíóúüñ'
  };
  const VOWELS = {
    en: 'aeiouy',
    uk: 'аеєиіїоуюя',
    ru: 'аеёиоуыэюя',
    it: 'aeiouàèéìòù',
    fr: 'aeiouyàâéèêëîïôùûüÿœæ',
    de: 'aeiouyäöü',
    es: 'aeiouáéíóúü'
  };

  const LETTER = /\p{L}/u;

  // Оцінка одного слова: 1 = знайоме слово; 0.55 = схоже на слово; 0.1 = нісенітниця; null = надто коротке, не враховується
  function scoreWord(w, lang) {
    if (WORDS[lang] && WORDS[lang].has(w)) return 1;
    if (w.length < 3) return null;
    const alpha = ALPHA[lang];
    if (!alpha) return 0.1;
    for (const c of w) if (alpha.indexOf(c) < 0) return 0.1;
    const vowels = VOWELS[lang];
    let v = 0;
    let run = 0;
    let maxRun = 0;
    for (const c of w) {
      if (vowels.indexOf(c) >= 0) {
        v++;
        run = 0;
      } else {
        run++;
        if (run > maxRun) maxRun = run;
      }
    }
    const ratio = v / w.length;
    if (ratio < 0.3 || ratio > 0.75 || maxRun > 5) return 0.1;
    return 0.55;
  }

  // Середня оцінка тексту в мові. null, якщо немає жодного слова, яке можна оцінити
  function scoreText(text, lang) {
    const words = (text.toLowerCase().match(/\p{L}+/gu)) || [];
    let sum = 0;
    let n = 0;
    for (const w of words) {
      const s = scoreWord(w, lang);
      if (s !== null) {
        sum += s;
        n++;
      }
    }
    return n ? sum / n : null;
  }

  // Найкраща оцінка початкового тексту серед усіх увімкнених мов
  function actualScore(text, langs) {
    let best = null;
    for (const l of langs) {
      const s = scoreText(text, l);
      if (s !== null && (best === null || s > best)) best = s;
    }
    return best;
  }

  // Перетворює текст, набраний у розкладці from, на текст у розкладці to. null, якщо текст не схожий на набраний у from
  function convert(text, from, to) {
    const f = LAYOUTS[from];
    const t = LAYOUTS[to];
    if (!f || !t) return null;
    let letters = 0;
    let mapped = 0;
    let out = '';
    for (const ch of text) {
      const isLetter = LETTER.test(ch);
      const hit = f.rev.get(ch);
      if (hit) {
        out += hit.shift ? t.shift[hit.i] : t.normal[hit.i];
        if (isLetter) {
          letters++;
          mapped++;
        }
      } else {
        out += ch;
        if (isLetter) letters++;
      }
    }
    if (letters === 0 || mapped < letters) return null; // кожна літера має існувати в розкладці from
    return out;
  }

  // Головна функція. Повертає { from, to, text, score, current } або null, якщо підказувати не треба
  function analyze(text, langs, opts) {
    const o = opts || {};
    const minLetters = o.minLetters || 5;
    if (!text || langs.length < 2) return null;
    const letters = (text.match(/\p{L}/gu) || []).length;
    if (letters < minLetters) return null;

    const cur = actualScore(text, langs);
    if (cur === null || cur > 0.35) return null; // початковий текст схожий на нормальний: не чіпаємо

    let best = null;
    for (const from of langs) {
      for (const to of langs) {
        if (from === to) continue;
        const conv = convert(text, from, to);
        if (conv === null || conv === text) continue;
        const sc = scoreText(conv, to);
        if (sc === null) continue;
        if (!best || sc > best.score) best = { from: from, to: to, text: conv, score: sc, current: cur };
      }
    }
    if (!best || best.score < 0.6 || best.score - cur < 0.3) return null;
    return best;
  }

  globalThis.LFX = { analyze: analyze, convert: convert, scoreText: scoreText, actualScore: actualScore, LAYOUTS: LAYOUTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.LFX;
})();
