import { FormEvent, useEffect, useRef, useState } from 'react';

interface QuickItem {
  id: string;
  label: string;
  value: string;
}

const CUSTOM_KEY = 'island-quick-data';
const SEEDED_KEY = 'island-quick-data-seeded';

/** Генерирует id записи */
function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Вкладка полезных ссылок и данных: копирование, правка, удаление */
export function QuickDataPanel() {
  const [items, setItems] = useState<QuickItem[]>([]);
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [switchOn, setSwitchOn] = useState(false);
  const [ready, setReady] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const resetTimerRef = useRef<number | null>(null);
  const labelRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const raw = window.localStorage.getItem(CUSTOM_KEY);
        const seeded = window.localStorage.getItem(SEEDED_KEY) === '1';

        if (raw) {
          const parsed = JSON.parse(raw) as QuickItem[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            setItems(parsed);
            setReady(true);
            return;
          }
        }

        if (!seeded || !raw) {
          const result = await window.island?.getQuickPaths();
          const seed =
            result?.ok
              ? result.items.map((item) => ({
                  id: makeId(),
                  label: item.label,
                  value: item.value,
                }))
              : [];
          setItems(seed);
          window.localStorage.setItem(SEEDED_KEY, '1');
          window.localStorage.setItem(CUSTOM_KEY, JSON.stringify(seed));
        }
      } catch (err) {
        console.error(err);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!ready) {
      return;
    }
    try {
      window.localStorage.setItem(CUSTOM_KEY, JSON.stringify(items));
    } catch (err) {
      console.error(err);
    }
  }, [items, ready]);

  useEffect(() => {
    if (composerOpen) {
      labelRef.current?.focus();
    }
  }, [composerOpen]);

  /** Копирует значение в буфер */
  async function copyValue(text: string, name: string) {
    try {
      await window.island?.copyText(text);
      setStatus(`Скопировано: ${name}`);
      window.setTimeout(() => setStatus(null), 1200);
    } catch (err) {
      console.error(err);
      setStatus('Не удалось скопировать');
    }
  }

  /** Сбрасывает свич в выкл после зелёной фазы */
  function armReset() {
    if (resetTimerRef.current != null) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => {
      setSwitchOn(false);
      resetTimerRef.current = null;
    }, 420);
  }

  /** Сбрасывает форму добавления / редактирования */
  function resetForm() {
    setLabel('');
    setValue('');
    setEditingId(null);
  }

  /** Закрывает композер, если нечего сохранять */
  function closeComposerIfIdle() {
    if (!label.trim() && !value.trim() && !editingId && !switchOn) {
      setComposerOpen(false);
    }
  }

  /** Сохраняет новую или изменённую запись и включает зелёную фазу свича */
  function commitSave() {
    try {
      const nextLabel = label.trim();
      const nextValue = value.trim();
      if (!nextLabel || !nextValue) {
        setSwitchOn(false);
        return;
      }

      if (editingId) {
        setItems((prev) =>
          prev.map((item) =>
            item.id === editingId
              ? { ...item, label: nextLabel, value: nextValue }
              : item,
          ),
        );
      } else {
        setItems((prev) => [
          { id: makeId(), label: nextLabel, value: nextValue },
          ...prev,
        ]);
      }
      resetForm();
      setSwitchOn(true);
      armReset();
      setComposerOpen(false);
    } catch (err) {
      console.error(err);
      setSwitchOn(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    commitSave();
  }

  /** Переключает свич: вкл = сохранить запись */
  function handleSwitchToggle() {
    try {
      if (switchOn) {
        setSwitchOn(false);
        return;
      }
      commitSave();
    } catch (err) {
      console.error(err);
    }
  }

  /** Открывает запись на редактирование */
  function startEdit(item: QuickItem) {
    try {
      setEditingId(item.id);
      setLabel(item.label);
      setValue(item.value);
      setSwitchOn(false);
      setComposerOpen(true);
    } catch (err) {
      console.error(err);
    }
  }

  /** Удаляет запись из списка */
  function removeItem(id: string) {
    try {
      setItems((prev) => prev.filter((item) => item.id !== id));
      if (editingId === id) {
        resetForm();
        setComposerOpen(false);
      }
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div
      className={`quick-pane${composerOpen ? ' quick-pane--composer-open' : ''}`}
      data-no-drag
    >
      <p className="quick-hint">Клик копирует · карандаш правит · × удаляет</p>

      <ul className="quick-list">
        {items.length === 0 ? (
          <li className="quick-empty">
            Список пуст. Ткни снизу, чтобы добавить.
          </li>
        ) : (
          items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`quick-item${editingId === item.id ? ' quick-item--editing' : ''}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => void copyValue(item.value, item.label)}
                title={item.value}
              >
                <span className="quick-label">{item.label}</span>
                <span className="quick-value">{item.value}</span>
              </button>
              <button
                type="button"
                className="tiny-btn"
                aria-label="Редактировать"
                title="Редактировать"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => startEdit(item)}
              >
                ✎
              </button>
              <button
                type="button"
                className="tiny-btn tiny-btn--danger"
                aria-label="Удалить"
                title="Удалить"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => removeItem(item.id)}
              >
                ×
              </button>
            </li>
          ))
        )}
      </ul>

      {status ? <p className="quick-status">{status}</p> : null}

      {composerOpen ? (
        <form className="quick-add quick-add--bottom" onSubmit={handleSubmit}>
          <input
            ref={labelRef}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={() => {
              window.setTimeout(closeComposerIfIdle, 0);
            }}
            placeholder="Название"
            aria-label="Название"
          />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={() => {
              window.setTimeout(closeComposerIfIdle, 0);
            }}
            placeholder="Путь / ссылка / данные"
            aria-label="Значение"
          />
          <button
            type="button"
            className={`add-switch${switchOn ? ' add-switch--on' : ''}`}
            role="switch"
            aria-checked={switchOn}
            aria-label={editingId ? 'Сохранить запись' : 'Добавить запись'}
            title={
              editingId ? 'Свайпни, чтобы сохранить' : 'Свайпни, чтобы добавить'
            }
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleSwitchToggle}
          >
            <span className="add-switch-knob" />
          </button>
          {editingId ? (
            <button
              type="button"
              className="quick-cancel"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                resetForm();
                setComposerOpen(false);
              }}
            >
              ✕
            </button>
          ) : null}
        </form>
      ) : (
        <button
          type="button"
          className="tasks-edge-hit"
          aria-label="Показать добавление ссылки"
          title="Новая запись"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            resetForm();
            setComposerOpen(true);
          }}
        />
      )}
    </div>
  );
}
