import { FormEvent, useEffect, useRef, useState } from 'react';
import { Task, TaskCategory, TaskWeight } from '../store/types';
import { TaskItem } from './TaskItem';

interface TaskListProps {
  ready: boolean;
  error: string | null;
  tasks: Task[];
  activeTaskId: string | null;
  now: number;
  onAdd: (title: string) => void;
  onActivate: (id: string) => void;
  onToggleDone: (id: string) => void;
  onRemove: (id: string) => void;
  onSetCategory: (id: string, category: TaskCategory) => void;
  onSetWeight: (id: string, weight: TaskWeight) => void;
  onAddSubtask: (taskId: string, title: string) => void;
  onToggleSubtask: (taskId: string, subtaskId: string) => void;
  onRemoveSubtask: (taskId: string, subtaskId: string) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onUpdateSubtaskTitle: (taskId: string, subtaskId: string, title: string) => void;
  onStartTimer: (id: string) => void;
  onPauseTimer: (id: string) => void;
  onResetTimer: (id: string) => void;
}

/** Список задач: плотный блок, добавление по клику снизу */
export function TaskList({
  ready,
  error,
  tasks,
  activeTaskId,
  now,
  onAdd,
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
}: TaskListProps) {
  const [title, setTitle] = useState('');
  const [switchOn, setSwitchOn] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resetTimerRef = useRef<number | null>(null);

  const ordered = [...tasks].sort((a, b) => {
    if (a.done === b.done) {
      return 0;
    }
    return a.done ? 1 : -1;
  });

  useEffect(() => {
    if (composerOpen) {
      inputRef.current?.focus();
    }
  }, [composerOpen]);

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

  /** Добавляет задачу и включает зелёную фазу свича */
  function commitAdd() {
    try {
      const value = title.trim();
      if (!value) {
        setSwitchOn(false);
        return;
      }
      onAdd(value);
      setTitle('');
      setSwitchOn(true);
      armReset();
    } catch (err) {
      console.error(err);
      setSwitchOn(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    commitAdd();
  }

  /** Переключает свич: вкл = добавить задачу */
  function handleSwitchToggle() {
    try {
      if (switchOn) {
        setSwitchOn(false);
        return;
      }
      commitAdd();
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div
      className={`tasks-pane${composerOpen ? ' tasks-pane--composer-open' : ''}`}
      data-no-drag
    >
      <div className="task-scroll">
        {!ready && <div className="loading-state">Загрузка…</div>}
        {ready && error && <div className="error-state">{error}</div>}
        {ready && !error && ordered.length === 0 && (
          <div className="empty-state">Пока тихо. Ткни снизу, чтобы добавить.</div>
        )}
        {ready &&
          ordered.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              active={task.id === activeTaskId}
              now={now}
              onActivate={() => onActivate(task.id)}
              onToggleDone={() => onToggleDone(task.id)}
              onRemove={() => onRemove(task.id)}
              onSetCategory={(category) => onSetCategory(task.id, category)}
              onSetWeight={(weight) => onSetWeight(task.id, weight)}
              onAddSubtask={(sub) => onAddSubtask(task.id, sub)}
              onToggleSubtask={(subId) => onToggleSubtask(task.id, subId)}
              onRemoveSubtask={(subId) => onRemoveSubtask(task.id, subId)}
              onUpdateTitle={(value) => onUpdateTitle(task.id, value)}
              onUpdateSubtaskTitle={(subId, value) =>
                onUpdateSubtaskTitle(task.id, subId, value)
              }
              onStartTimer={() => onStartTimer(task.id)}
              onPauseTimer={() => onPauseTimer(task.id)}
              onResetTimer={() => onResetTimer(task.id)}
            />
          ))}
      </div>

      {composerOpen ? (
        <form
          className="add-row add-row--bottom"
          onSubmit={handleSubmit}
          data-no-drag
        >
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={() => {
              if (!title.trim() && !switchOn) {
                setComposerOpen(false);
              }
            }}
            placeholder="Новая задача…"
            aria-label="Новая задача"
          />
          <button
            type="button"
            className={`add-switch${switchOn ? ' add-switch--on' : ''}`}
            role="switch"
            aria-checked={switchOn}
            aria-label="Добавить задачу"
            title="Добавить"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleSwitchToggle}
          >
            <span className="add-switch-knob" />
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="tasks-edge-hit"
          aria-label="Показать добавление задачи"
          title="Новая задача"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setComposerOpen(true)}
        />
      )}
    </div>
  );
}
