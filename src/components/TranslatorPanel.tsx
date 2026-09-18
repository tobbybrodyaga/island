import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  LangCode,
  swapLang,
  translateText,
} from '../integrations/translator';

const DEBOUNCE_MS = 450;

/** Панель переводчика RU↔EN */
export function TranslatorPanel() {
  const [from, setFrom] = useState<LangCode>('ru');
  const [to, setTo] = useState<LangCode>('en');
  const [source, setSource] = useState('');
  const [result, setResult] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const trimmed = source.trim();
    if (!trimmed) {
      setResult('');
      setNote('');
      setLoading(false);
      return;
    }

    setLoading(true);
    const requestId = ++requestIdRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const next = await translateText(source, from, to);
          if (requestId !== requestIdRef.current) {
            return;
          }
          setResult(next.text);
          setNote(next.note);
        } catch (err) {
          console.error(err);
          if (requestId !== requestIdRef.current) {
            return;
          }
          setResult('');
          setNote('Не удалось перевести');
        } finally {
          if (requestId === requestIdRef.current) {
            setLoading(false);
          }
        }
      })();
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [source, from, to]);

  /** Меняет направление перевода */
  function handleSwap() {
    try {
      const next = swapLang(from, to);
      setFrom(next.from);
      setTo(next.to);
      setSource(result || source);
    } catch (err) {
      console.error(err);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
  }

  return (
    <form className="translator" onSubmit={handleSubmit}>
      <div className="translator-dirs">
        <span>{from === 'ru' ? 'Русский' : 'English'}</span>
        <button type="button" className="tiny-btn" onClick={handleSwap}>
          ⇄
        </button>
        <span>{to === 'ru' ? 'Русский' : 'English'}</span>
      </div>

      <textarea
        className="translator-input"
        value={source}
        onChange={(e) => setSource(e.target.value)}
        placeholder={
          from === 'ru' ? 'Текст для перевода…' : 'Text to translate…'
        }
        rows={3}
      />

      <div className="translator-out" aria-live="polite">
        {loading && !result ? 'Перевожу…' : result || '—'}
      </div>

      {note ? <p className="translator-note">{note}</p> : null}
    </form>
  );
}
