import { FormEvent, useEffect, useState } from 'react';

interface LocalNote {
  id: string;
  text: string;
  createdAt: number;
}

const NOTES_KEY = 'island-notes-draft';
const NOTES_HISTORY_KEY = 'island-notes-history';

/** Панель заметок с отправкой в Excel */
export function NotesPanel() {
  const [text, setText] = useState('');
  const [history, setHistory] = useState<LocalNote[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    try {
      const draft = window.localStorage.getItem(NOTES_KEY);
      if (draft) {
        setText(draft);
      }
      const raw = window.localStorage.getItem(NOTES_HISTORY_KEY);
      if (raw) {
        setHistory(JSON.parse(raw) as LocalNote[]);
      }
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(NOTES_KEY, text);
    } catch (err) {
      console.error(err);
    }
  }, [text]);

  /** Сохраняет список локальных заметок */
  function persistHistory(next: LocalNote[]) {
    setHistory(next);
    try {
      window.localStorage.setItem(NOTES_HISTORY_KEY, JSON.stringify(next.slice(0, 30)));
    } catch (err) {
      console.error(err);
    }
  }

  /** Отправляет заметку в Excel */
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value || saving) {
      return;
    }

    setSaving(true);
    setStatus(null);
    try {
      const result = await window.island.logNote({ text: value });
      if (!result.ok) {
        setStatus(result.error ?? 'Не удалось сохранить в Excel');
        return;
      }

      const note: LocalNote = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        text: value,
        createdAt: Date.now(),
      };
      persistHistory([note, ...history].slice(0, 30));
      setText('');
      window.localStorage.removeItem(NOTES_KEY);
      setStatus(
        result.path?.includes('_Island')
          ? 'Сохранено в Задачник_Island.xlsx (основной файл был занят)'
          : 'Сохранено в Задачник.xlsx',
      );
    } catch (err) {
      console.error(err);
      setStatus('Ошибка сохранения');
    } finally {
      setSaving(false);
      window.setTimeout(() => setStatus(null), 2500);
    }
  }

  return (
    <form className="notes-pane" data-no-drag onSubmit={(e) => void handleSubmit(e)}>
      <textarea
        className="notes-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Быстрая заметка… После сохранения улетит в Excel."
        rows={5}
      />

      <div className="notes-actions">
        <button type="submit" className="notes-save" disabled={saving || !text.trim()}>
          {saving ? 'Сохраняю…' : 'В Excel'}
        </button>
        <button
          type="button"
          className="tiny-btn"
          onClick={() => {
            setText('');
            window.localStorage.removeItem(NOTES_KEY);
          }}
        >
          Очистить
        </button>
      </div>

      {status ? <p className="notes-status">{status}</p> : null}

      {history.length > 0 && (
        <div className="notes-history">
          <p className="clipboard-hint">Недавно сохранённые</p>
          <ul className="notes-list">
            {history.slice(0, 8).map((note) => (
              <li key={note.id} className="notes-item">
                {note.text.replace(/\s+/g, ' ').trim()}
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}
