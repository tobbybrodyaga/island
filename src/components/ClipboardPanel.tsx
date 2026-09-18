import { MouseEvent, useEffect, useState } from 'react';

export interface ClipboardItemView {
  id: string;
  text: string;
  createdAt: number;
}

/** Панель истории буфера обмена (последние 5) */
export function ClipboardPanel() {
  const [items, setItems] = useState<ClipboardItemView[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await window.island.getClipboardHistory();
        if (!cancelled && result.ok) {
          setItems(result.items);
        }
      } catch (err) {
        console.error(err);
      }
    }

    void load();

    try {
      const off = window.island.onClipboardChanged((next) => {
        setItems(next);
      });
      return () => {
        cancelled = true;
        off();
      };
    } catch (err) {
      console.error(err);
      return () => {
        cancelled = true;
      };
    }
  }, []);

  /** Клик: вставить в предыдущее окно */
  async function handlePaste(item: ClipboardItemView) {
    setBusyId(item.id);
    setStatus(null);
    try {
      const result = await window.island.pasteClipboardItem(item.id);
      if (result.ok) {
        setStatus('Вставлено');
      } else {
        setStatus('Скопировано в буфер — нажмите Ctrl+V');
      }
    } catch (err) {
      console.error(err);
      setStatus('Не удалось вставить');
    } finally {
      setBusyId(null);
      window.setTimeout(() => setStatus(null), 1800);
    }
  }

  /** Только копирует, без авто-вставки */
  async function handleCopyOnly(item: ClipboardItemView, e: MouseEvent) {
    e.stopPropagation();
    try {
      await window.island.copyClipboardItem(item.id);
      setStatus('Скопировано');
      window.setTimeout(() => setStatus(null), 1400);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleClear() {
    try {
      await window.island.clearClipboardHistory();
      setItems([]);
      setStatus('Очищено');
      window.setTimeout(() => setStatus(null), 1400);
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="clipboard-pane" data-no-drag>
      <div className="clipboard-toolbar">
        <span className="clipboard-hint">Последние 5 копирований</span>
        <button type="button" className="tiny-btn" onClick={() => void handleClear()}>
          Очистить
        </button>
      </div>

      {items.length === 0 ? (
        <div className="empty-state">
          Скопируйте текст где угодно — он появится здесь.
        </div>
      ) : (
        <ul className="clipboard-list">
          {items.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                className={`clipboard-item${busyId === item.id ? ' clipboard-item--busy' : ''}`}
                onClick={() => void handlePaste(item)}
                title="Клик — вставить в активное окно"
              >
                <span className="clipboard-index">{index + 1}</span>
                <span className="clipboard-text">
                  {item.text.replace(/\s+/g, ' ').trim()}
                </span>
              </button>
              <button
                type="button"
                className="tiny-btn clipboard-copy"
                onClick={(e) => void handleCopyOnly(item, e)}
                title="Только скопировать"
              >
                Копир.
              </button>
            </li>
          ))}
        </ul>
      )}

      {status ? <p className="clipboard-status">{status}</p> : null}
    </div>
  );
}
