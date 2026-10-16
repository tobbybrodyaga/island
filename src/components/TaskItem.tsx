import {
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  SyntheticEvent,
  useRef,
  useState,
} from 'react';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  Task,
  TaskCategory,
  TaskWeight,
} from '../store/types';
import { TimerControls } from './TimerControls';

interface TaskItemProps {
  task: Task;
  active: boolean;
  now: number;
  onActivate: () => void;
  onToggleDone: () => void;
  onRemove: () => void;
  onSetCategory: (category: TaskCategory) => void;
  onSetWeight: (weight: TaskWeight) => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onRemoveSubtask: (subtaskId: string) => void;
  onUpdateTitle: (title: string) => void;
  onUpdateSubtaskTitle: (subtaskId: string, title: string) => void;
  onStartTimer: () => void;
  onPauseTimer: () => void;
  onResetTimer: () => void;
}

/** Гасит событие, чтобы оно не ушло в onActivate строки и в драг острова */
function stopEvent(e: SyntheticEvent) {
  e.stopPropagation();
}

/**
 * Название, которое правится двойным кликом.
 * Enter и потеря фокуса сохраняют, Esc отменяет, пустая строка не сохраняется.
 */
function EditableTitle({
  value,
  className,
  inputClassName,
  ariaLabel,
  onSave,
}: {
  value: string;
  className: string;
  inputClassName: string;
  ariaLabel: string;
  onSave: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  /** Esc уже закрыл поле — blur после него не сохраняет */
  const closedRef = useRef(false);

  function startEditing(e: MouseEvent) {
    e.stopPropagation();
    closedRef.current = false;
    setDraft(value);
    setEditing(true);
  }

  function commit() {
    if (closedRef.current) {
      return;
    }
    closedRef.current = true;
    setEditing(false);
    try {
      const next = draft.trim();
      if (next && next !== value) {
        onSave(next);
      }
    } catch (err) {
      console.error('Не удалось переименовать:', err);
    }
  }

  function cancel() {
    closedRef.current = true;
    setDraft(value);
    setEditing(false);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Esc не должен свернуть остров, Enter — отправить чужую форму
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }

  if (editing) {
    return (
      <input
        className={inputClassName}
        value={draft}
        autoFocus
        data-no-drag
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        onPointerDown={stopEvent}
        onClick={stopEvent}
        onDoubleClick={stopEvent}
        onFocus={(e) => e.currentTarget.select()}
      />
    );
  }

  return (
    <div
      className={className}
      title="Двойной клик — переименовать"
      onDoubleClick={startEditing}
    >
      {value}
    </div>
  );
}

/** Строка задачи с подзадачами, категорией и сложностью */
export function TaskItem({
  task,
  active,
  now,
  onActivate,
  onToggleDone,
  onRemove,
  onSetCategory,
  onSetWeight,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
  onUpdateTitle,
  onUpdateSubtaskTitle,
  onStartTimer,
  onPauseTimer,
  onResetTimer,
}: TaskItemProps) {
  const [subOpen, setSubOpen] = useState(false);
  const [subTitle, setSubTitle] = useState('');
  const subInputRef = useRef<HTMLInputElement | null>(null);

  function openSubComposer(e: MouseEvent) {
    e.stopPropagation();
    setSubOpen(true);
    window.setTimeout(() => subInputRef.current?.focus(), 0);
  }

  function handleSubSubmit(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      const value = subTitle.trim();
      if (!value) {
        setSubOpen(false);
        return;
      }
      onAddSubtask(value);
      setSubTitle('');
      setSubOpen(false);
    } catch (err) {
      console.error(err);
    }
  }

  /** Циклически меняет категорию задачи */
  function cycleCategory(e: MouseEvent) {
    e.stopPropagation();
    const idx = CATEGORY_ORDER.indexOf(task.category ?? 'work');
    const next = CATEGORY_ORDER[(idx + 1) % CATEGORY_ORDER.length];
    onSetCategory(next);
  }

  /** Циклически меняет сложность 1→5 */
  function cycleWeight(e: MouseEvent) {
    e.stopPropagation();
    const current = task.weight ?? 2;
    const next = ((current % 5) + 1) as TaskWeight;
    onSetWeight(next);
  }

  return (
    <article
      className={`task-item${active ? ' task-item--active' : ''}`}
      onClick={onActivate}
    >
      <div className="task-main">
        <button
          type="button"
          className={`task-check${task.done ? ' task-check--on' : ''}`}
          aria-label={
            task.done ? 'Отметить невыполненной' : 'Отметить выполненной'
          }
          onClick={(e) => {
            e.stopPropagation();
            onToggleDone();
          }}
        >
          {task.done ? '✓' : ''}
        </button>

        <div className="task-body">
          <EditableTitle
            value={task.title}
            className={`task-title${task.done ? ' task-title--done' : ''}`}
            inputClassName="title-edit title-edit--task"
            ariaLabel="Название задачи"
            onSave={onUpdateTitle}
          />

          <div className="task-meta" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={`task-cat task-cat--${task.category ?? 'work'}`}
              title="Категория для карты"
              onClick={cycleCategory}
            >
              {CATEGORY_LABELS[task.category ?? 'work']}
            </button>
            <button
              type="button"
              className="task-weight"
              title="Сложность (размер пятна на карте)"
              onClick={cycleWeight}
            >
              {'●'.repeat(task.weight ?? 2)}
              <span className="task-weight-empty">
                {'○'.repeat(5 - (task.weight ?? 2))}
              </span>
            </button>
            <TimerControls
              task={task}
              now={now}
              onStart={onStartTimer}
              onPause={onPauseTimer}
              onReset={onResetTimer}
            />
          </div>

          {task.subtasks.length > 0 && (
            <div className="subtasks">
              {task.subtasks.map((sub) => (
                <div
                  key={sub.id}
                  className={`subtask-row${sub.done ? ' subtask-row--done' : ''}`}
                >
                  <button
                    type="button"
                    className={`task-check${sub.done ? ' task-check--on' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSubtask(sub.id);
                    }}
                  >
                    {sub.done ? '✓' : ''}
                  </button>
                  <EditableTitle
                    value={sub.title}
                    className="subtask-title"
                    inputClassName="title-edit title-edit--subtask"
                    ariaLabel="Название подзадачи"
                    onSave={(title) => onUpdateSubtaskTitle(sub.id, title)}
                  />
                  <button
                    type="button"
                    className="tiny-btn tiny-btn--danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveSubtask(sub.id);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {subOpen && (
            <form
              className="subtask-add"
              onClick={(e) => e.stopPropagation()}
              onSubmit={handleSubSubmit}
            >
              <input
                ref={subInputRef}
                value={subTitle}
                onChange={(e) => setSubTitle(e.target.value)}
                onBlur={() => {
                  if (!subTitle.trim()) {
                    setSubOpen(false);
                  }
                }}
                placeholder="Подзадача…"
                aria-label="Новая подзадача"
              />
              <button type="submit" className="tiny-btn">
                OK
              </button>
            </form>
          )}
        </div>

        <div className="task-side">
          <button
            type="button"
            className="icon-btn task-plus"
            title="Подзадача"
            aria-label="Добавить подзадачу"
            onClick={openSubComposer}
          >
            +
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Удалить"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            ×
          </button>
        </div>
      </div>
    </article>
  );
}
