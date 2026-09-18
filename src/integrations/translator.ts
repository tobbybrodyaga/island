/** Онлайн-переводчик RU↔EN через публичные API */

export type LangCode = 'ru' | 'en';

export interface TranslateResult {
  text: string;
  note: string;
}

/** Перевод через Google Translate (клиент gtx, без ключа) */
async function translateViaGoogle(
  text: string,
  from: LangCode,
  to: LangCode,
): Promise<string> {
  const url =
    'https://translate.googleapis.com/translate_a/single?' +
    new URLSearchParams({
      client: 'gtx',
      sl: from,
      tl: to,
      dt: 't',
      q: text,
    }).toString();

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Google translate HTTP ${response.status}`);
  }

  const data = (await response.json()) as unknown;
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error('Неожиданный ответ Google Translate');
  }

  const chunks = data[0] as unknown[];
  return chunks
    .map((chunk) =>
      Array.isArray(chunk) && typeof chunk[0] === 'string' ? chunk[0] : '',
    )
    .join('');
}

/** Запасной перевод через MyMemory */
async function translateViaMyMemory(
  text: string,
  from: LangCode,
  to: LangCode,
): Promise<string> {
  const url =
    'https://api.mymemory.translated.net/get?' +
    new URLSearchParams({
      q: text.slice(0, 500),
      langpair: `${from}|${to}`,
    }).toString();

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`MyMemory HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    responseData?: { translatedText?: string };
    responseStatus?: number;
  };

  const translated = data.responseData?.translatedText?.trim();
  if (!translated || (data.responseStatus ?? 200) !== 200) {
    throw new Error('MyMemory не вернул перевод');
  }
  return translated;
}

/**
 * Переводит текст RU↔EN.
 * Сначала Google, при сбое — MyMemory.
 */
export async function translateText(
  text: string,
  from: LangCode,
  to: LangCode,
): Promise<TranslateResult> {
  try {
    const trimmed = text.trim();
    if (!trimmed) {
      return { text: '', note: '' };
    }
    if (from === to) {
      return { text: trimmed, note: '' };
    }

    try {
      const translated = await translateViaGoogle(trimmed, from, to);
      return { text: translated, note: '' };
    } catch (primaryError) {
      console.warn('Google translate failed, fallback:', primaryError);
      const translated = await translateViaMyMemory(trimmed, from, to);
      return { text: translated, note: '' };
    }
  } catch (error) {
    console.error(error);
    return {
      text: '',
      note: 'Не удалось перевести. Проверь интернет и попробуй ещё раз.',
    };
  }
}

/** Меняет направление языков */
export function swapLang(from: LangCode, to: LangCode): {
  from: LangCode;
  to: LangCode;
} {
  return { from: to, to: from };
}
