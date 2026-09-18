import { AppSettings } from '../store/types';
import { formatDuration } from '../store/types';
import { getPomodoroDisplayMs } from '../store/tasksStore';
import { isBitrixConfigured } from '../integrations/bitrix';

interface PomodoroPanelProps {
  settings: AppSettings;
  now: number;
  hasActiveTask: boolean;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  onStartBreak: () => void;
  onFocusMinutes: (minutes: number) => void;
  onBreakMinutes: (minutes: number) => void;
}

/** Панель Pomodoro, привязанная к активной задаче */
export function PomodoroPanel({
  settings,
  now,
  hasActiveTask,
  onStart,
  onPause,
  onStop,
  onStartBreak,
  onFocusMinutes,
  onBreakMinutes,
}: PomodoroPanelProps) {
  const remaining = getPomodoroDisplayMs(settings, now);
  const phaseLabel =
    settings.pomodoroPhase === 'focus'
      ? 'Фокус'
      : settings.pomodoroPhase === 'break'
        ? 'Перерыв'
        : 'Pomodoro';

  return (
    <section className="pomodoro">
      <div className="pomodoro-row">
        <span className="pomodoro-label">{phaseLabel}</span>
        <span className="pomodoro-time">{formatDuration(remaining)}</span>
      </div>

      <div className="pomodoro-actions">
        {settings.pomodoroRunning ? (
          <button type="button" onClick={onPause}>
            Пауза
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            onClick={onStart}
            disabled={!hasActiveTask}
            title={
              hasActiveTask
                ? 'Старт фокуса для активной задачи'
                : 'Сначала выберите задачу'
            }
          >
            Фокус
          </button>
        )}
        {settings.pomodoroPhase === 'break' && !settings.pomodoroRunning && (
          <button type="button" className="primary" onClick={onStartBreak}>
            Перерыв
          </button>
        )}
        <button type="button" onClick={onStop}>
          Стоп
        </button>
      </div>

      <div className="settings-row">
        <label>
          Фокус
          <input
            type="number"
            min={1}
            max={90}
            value={settings.focusMinutes}
            onChange={(e) => onFocusMinutes(Number(e.target.value))}
          />
          мин
        </label>
        <label>
          Перерыв
          <input
            type="number"
            min={1}
            max={30}
            value={settings.breakMinutes}
            onChange={(e) => onBreakMinutes(Number(e.target.value))}
          />
          мин
        </label>
      </div>

      <p className="bitrix-hint">
        {isBitrixConfigured()
          ? 'Bitrix24 подключён'
          : 'Выполненные задачи → Задачник.xlsx (один лист, дни блоками). Закройте файл в Excel перед записью, если он открыт.'}
      </p>
    </section>
  );
}
