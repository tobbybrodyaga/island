import {
  DragEvent,
  KeyboardEvent,
  MouseEvent,
  useEffect,
  useRef,
  useState,
} from 'react';

interface ShotItem {
  id: string;
  createdAt: number;
  thumbDataUrl: string;
}

/** Вкладка хранилища скриншотов из буфера (Win+Shift+S и т.п.) */
export function ScreenshotsPanel() {
  const [items, setItems] = useState<ShotItem[]>([]);
  /** Выделенные карточки (Ctrl/Shift+клик, Ctrl+A) */
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  /** Кнопка удаления ждёт второго нажатия «Удалить N?» */
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const itemsRef = useRef<ShotItem[]>([]);
  itemsRef.current = items;
  /** Последняя выделенная карточка — начало диапазона для Shift+клика */
  const anchorRef = useRef<string | null>(null);
  const statusTimerRef = useRef<number | null>(null);

  /** Выделенные id в порядке сетки */
  function selectedIds(): string[] {
    return itemsRef.current
      .filter((item) => selected.has(item.id))
      .map((item) => item.id);
  }

  /** Короткое сообщение над сеткой, гаснет само */
  function flashStatus(text: string) {
    setStatus(text);
    if (statusTimerRef.current != null) {
      window.clearTimeout(statusTimerRef.current);
    }
    statusTimerRef.current = window.setTimeout(() => {
      setStatus(null);
      statusTimerRef.current = null;
    }, 2600);
  }

  function clearSelection() {
    setSelected(new Set());
    setConfirmDelete(false);
    anchorRef.current = null;
  }

  /** Удалённые снаружи скрины выпадают из выделения */
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) {
        return prev;
      }
      const alive = new Set(items.map((item) => item.id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  /** Любая смена выделения отменяет ожидание подтверждения удаления */
  useEffect(() => {
    setConfirmDelete(false);
  }, [selected]);

  useEffect(() => {
    return () => {
      if (statusTimerRef.current != null) {
        window.clearTimeout(statusTimerRef.current);
      }
    };
  }, []);

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
   * Клик по карточке: обычный копирует один скрин и снимает выделение,
   * Ctrl — добавляет/убирает карточку, Shift — диапазон от последней выделенной.
   */
  function handleCardClick(e: MouseEvent, id: string) {
    try {
      if (e.ctrlKey || e.metaKey) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          return next;
        });
        anchorRef.current = id;
        return;
      }
      if (e.shiftKey) {
        const order = itemsRef.current.map((item) => item.id);
        const anchor = anchorRef.current;
        const from = anchor ? order.indexOf(anchor) : -1;
        const to = order.indexOf(id);
        if (to < 0) {
          return;
        }
        const [lo, hi] = from < 0 ? [to, to] : [Math.min(from, to), Math.max(from, to)];
        setSelected((prev) => new Set([...prev, ...order.slice(lo, hi + 1)]));
        if (!anchor) {
          anchorRef.current = id;
        }
        return;
      }
      clearSelection();
      void handleCopy(id);
    } catch (err) {
      console.error(err);
    }
  }

  /** Esc снимает выделение, Ctrl+A выделяет всё, пока панель в фокусе */
  function handleKeyDown(e: KeyboardEvent) {
    try {
      if (e.key === 'Escape' && selected.size > 0) {
        // Иначе тот же Esc свернёт остров
        e.preventDefault();
        e.stopPropagation();
        clearSelection();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A' || e.code === 'KeyA')) {
        e.preventDefault();
        e.stopPropagation();
        setSelected(new Set(itemsRef.current.map((item) => item.id)));
      }
    } catch (err) {
      console.error(err);
    }
  }

  /** Клик по пустому месту сетки снимает выделение */
  function handleGridClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      clearSelection();
    }
  }

  /** Копирует выделенные: один — картинкой, несколько — списком файлов */
  async function handleCopySelected() {
    const ids = selectedIds();
    if (!ids.length || busy) {
      return;
    }
    setBusy(true);
    try {
      const result = await window.island?.copyScreenshots(ids);
      flashStatus(
        result?.ok
          ? `Скопировано: ${result.count}`
          : 'Не удалось скопировать в буфер',
      );
    } catch (err) {
      console.error(err);
      flashStatus('Не удалось скопировать в буфер');
    } finally {
      setBusy(false);
    }
  }

  /** Сохраняет выделенные в папку, выбранную в системном диалоге */
  async function handleSaveSelected() {
    const ids = selectedIds();
    if (!ids.length || busy) {
      return;
    }
    setBusy(true);
    try {
      const result = await window.island?.saveScreenshotsTo(ids);
      if (!result || result.canceled) {
        return;
      }
      flashStatus(
        result.ok
          ? `Сохранено: ${result.saved}${result.failed ? `, ошибок: ${result.failed}` : ''}`
          : 'Не удалось сохранить',
      );
    } catch (err) {
      console.error(err);
      flashStatus('Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  }

  /** Удаление: первое нажатие спрашивает «Удалить N?», второе удаляет пачкой */
  async function handleDeleteSelected() {
    const ids = selectedIds();
    if (!ids.length || busy) {
      return;
    }
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    try {
      const result = await window.island?.deleteScreenshots(ids);
      clearSelection();
      if (result?.ok) {
        flashStatus(`Удалено: ${result.deleted}`);
      }
    } catch (err) {
      console.error(err);
      flashStatus('Не удалось удалить');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Старт drag: копирует в буфер (Ctrl+V) и отдаёт файл в ОС
   * (вставка/бросок в другие окна). Alt — только порядок внутри сетки.
   * Если тащат выделенную карточку — в ОС уходят все выделенные файлы.
   */
  function handleDragStart(e: DragEvent, id: string) {
    try {
      dragIdRef.current = id;

      if (e.altKey) {
        void window.island?.copyScreenshot(id);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-island-shot', id);
        return;
      }

      e.preventDefault();
      const group = selected.has(id) ? selectedIds() : [];
      if (group.length > 1) {
        dragIdRef.current = null;
        window.island?.startScreenshotsDrag(group);
        return;
      }
      void window.island?.copyScreenshot(id);
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
    <div
      className="shots-pane"
      data-no-drag
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {selected.size > 0 ? (
        <div className="shots-actions" role="toolbar" aria-label="Действия с выбранными">
          <span className="shots-actions-count">Выбрано {selected.size}</span>
          <button
            type="button"
            className="tiny-btn"
            disabled={busy}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void handleCopySelected()}
          >
            Копировать
          </button>
          <button
            type="button"
            className="tiny-btn"
            disabled={busy}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void handleSaveSelected()}
          >
            Сохранить в папку
          </button>
          <button
            type="button"
            className={
              confirmDelete
                ? 'tiny-btn tiny-btn--danger shots-delete-confirm'
                : 'tiny-btn tiny-btn--danger'
            }
            disabled={busy}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void handleDeleteSelected()}
          >
            {confirmDelete ? `Удалить ${selected.size}?` : 'Удалить'}
          </button>
          <button
            type="button"
            className="tiny-btn"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={clearSelection}
          >
            Снять выделение
          </button>
        </div>
      ) : (
        <p className="shots-hint">
          {status ??
            'Win+Shift+S · клик/drag → буфер · Ctrl/Shift+клик — выбрать · Alt+drag — порядок'}
        </p>
      )}
      {selected.size > 0 && status ? (
        <p className="shots-hint">{status}</p>
      ) : null}

      {items.length === 0 ? (
        <div className="empty-state">Пока нет скриншотов</div>
      ) : (
        <div
          className="shots-grid"
          aria-label="Скриншоты"
          onClick={handleGridClick}
        >
          {items.map((item) => (
            <div
              key={item.id}
              className={
                selected.has(item.id) ? 'shot-card shot-card--selected' : 'shot-card'
              }
              aria-selected={selected.has(item.id)}
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
                onClick={(e) => handleCardClick(e, item.id)}
                title="Клик — в буфер · Ctrl/Shift+клик — выбрать"
              >
                <img src={item.thumbDataUrl} alt="" draggable={false} />
              </button>
              {selected.has(item.id) ? (
                <span className="shot-check" aria-hidden="true">
                  ✓
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
