import { formatDuration, getTaskElapsedMs, Task } from '../store/types';

interface TimerControlsProps {
  task: Task;
  now: number;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
}

/** Кнопки секундомера для одной задачи */
export function TimerControls({
  task,
  now,
  onStart,
  onPause,
  onReset,
}: TimerControlsProps) {
  const running = task.runningSince != null;
  const elapsed = getTaskElapsedMs(task, now);

  return (
    <div className="task-meta">
      <span className="timer-chip">{formatDuration(elapsed)}</span>
      <div className="timer-actions">
        {running ? (
          <button type="button" className="tiny-btn" onClick={onPause}>
            Пауза
          </button>
        ) : (
          <button
            type="button"
            className="tiny-btn"
            onClick={onStart}
            disabled={task.done}
          >
            Старт
          </button>
        )}
        <button type="button" className="tiny-btn" onClick={onReset}>
          Сброс
        </button>
      </div>
    </div>
  );
}
