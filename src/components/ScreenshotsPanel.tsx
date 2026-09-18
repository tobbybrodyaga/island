import { DragEvent, useEffect, useRef, useState } from 'react';

interface ShotItem {
  id: string;
  createdAt: number;
  thumbDataUrl: string;
}

/** Вкладка хранилища скриншотов из буфера (Win+Shift+S и т.п.) */
export function ScreenshotsPanel() {
  const [items, setItems] = useState<ShotItem[]>([]);
  const dragIdRef = useRef<string | null>(null);
  const itemsRef = useRef<ShotItem[]>([]);
  itemsRef.current = items;

  useEffect(() => {
    async function load() {
      try {
        const result = await window.island?.listScreenshots();
        if (result?.ok) {
          setItems(result.items);
        }
      } catch (err) {
        console.error(err);
      }
    }
    void load();

    try {
      return window.island?.onScreenshotsChanged((next) => {
        setItems(next);
      });
    } catch (err) {
      console.error(err);
      return undefined;
    }
  }, []);

  /** Удаляет скрин из коллекции */
  async function handleDelete(id: string) {
    try {
      await window.island?.deleteScreenshot(id);
    } catch (err) {
      console.error(err);
    }
  }

  /** Копирует полный скрин обратно в буфер */
  async function handleCopy(id: string) {
    try {
      await window.island?.copyScreenshot(id);
    } catch (err) {
      console.error(err);
    }
  }

  /**
   * Старт drag: копирует в буфер (Ctrl+V) и отдаёт файл в ОС
   * (вставка/бросок в другие окна). Alt — только порядок внутри сетки.
   */
  function handleDragStart(e: DragEvent, id: string) {
    try {
      dragIdRef.current = id;
      void window.island?.copyScreenshot(id);

      if (e.altKey) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-island-shot', id);
        return;
      }

      e.preventDefault();
      window.island?.startScreenshotDrag(id);
    } catch (err) {
      console.error(err);
    }
  }

  function handleDragOver(e: DragEvent, overId: string) {
    e.preventDefault();
    const fromId = dragIdRef.current;
    if (!fromId || fromId === overId) {
      return;
    }
    setItems((prev) => {
      const fromIndex = prev.findIndex((item) => item.id === fromId);
      const toIndex = prev.findIndex((item) => item.id === overId);
      if (fromIndex < 0 || toIndex < 0) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }

  async function handleDragEnd() {
    try {
      const fromId = dragIdRef.current;
      dragIdRef.current = null;
      if (!fromId) {
        return;
      }
      const orderedIds = itemsRef.current.map((item) => item.id);
      await window.island?.reorderScreenshots(orderedIds);
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="shots-pane" data-no-drag>
      <p className="shots-hint">
        Win+Shift+S · клик/drag → буфер · в другое окно → файл · Alt+drag —
        порядок
      </p>

      {items.length === 0 ? (
        <div className="empty-state">Пока нет скриншотов</div>
      ) : (
        <div className="shots-grid" aria-label="Скриншоты">
          {items.map((item) => (
            <div
              key={item.id}
              className="shot-card"
              draggable
              onDragStart={(e) => handleDragStart(e, item.id)}
              onDragOver={(e) => handleDragOver(e, item.id)}
              onDragEnd={() => void handleDragEnd()}
            >
              <button
                type="button"
                className="shot-delete"
                aria-label="Удалить скрин"
                title="Удалить"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => void handleDelete(item.id)}
              >
                ×
              </button>
              <button
                type="button"
                className="shot-preview"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => void handleCopy(item.id)}
                title="Скопировать в буфер"
              >
                <img src={item.thumbDataUrl} alt="" draggable={false} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
