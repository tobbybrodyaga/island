import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppSettings,
  createId,
  dayKey,
  DayStroke,
  defaultSettings,
  defaultTasksState,
  getTaskElapsedMs,
  normalizeTask,
  PIXELS_BY_WEIGHT,
  Subtask,
  Task,
  TaskCategory,
  TasksState,
  TaskWeight,
  weightFromElapsed,
} from './types';

/** Добавляет фокус / закрытия / мазки в карту эффективности */
function bumpActivity(
  state: TasksState,
  patch: {
    focusMs?: number;
    doneCount?: number;
    stroke?: DayStroke;
  },
  at = Date.now(),
): TasksState {
  const key = dayKey(new Date(at));
  const prev = state.activityByDay?.[key] ?? {
    focusMs: 0,
    doneCount: 0,
    strokes: [],
  };
  const strokes = Array.isArray(prev.strokes) ? [...prev.strokes] : [];
  if (patch.stroke) {
    strokes.push(patch.stroke);
  }
  return {
    ...state,
    activityByDay: {
      ...(state.activityByDay ?? {}),
      [key]: {
        focusMs: prev.focusMs + Math.max(0, patch.focusMs ?? 0),
        doneCount: prev.doneCount + Math.max(0, patch.doneCount ?? 0),
        strokes,
      },
    },
  };
}

/** Убирает мазки задачи со всех дней карты */
function stripTaskStrokes(
  activityByDay: TasksState['activityByDay'],
  taskId: string,
): TasksState['activityByDay'] {
  const next: TasksState['activityByDay'] = { ...activityByDay };
  try {
    for (const key of Object.keys(next)) {
      const day = next[key];
      const strokes = Array.isArray(day.strokes) ? day.strokes : [];
      const kept = strokes.filter((s) => s.taskId !== taskId);
      if (kept.length === strokes.length) continue;
      next[key] = {
        ...day,
        strokes: kept,
        doneCount: Math.max(
          0,
          (day.doneCount ?? 0) - (strokes.length - kept.length),
        ),
      };
    }
  } catch (err) {
    console.error(err);
  }
  return next;
}

interface UseIslandStoreResult {
  ready: boolean;
  error: string | null;
  tasksState: TasksState;
  settings: AppSettings;
  now: number;
  activeTask: Task | null;
  addTask: (title: string) => void;
  updateTaskTitle: (id: string, title: string) => void;
  setTaskCategory: (id: string, category: TaskCategory) => void;
  setTaskWeight: (id: string, weight: TaskWeight) => void;
  removeTask: (id: string) => void;
  removeMapStroke: (dayKeyValue: string, strokeId: string) => void;
  toggleTaskDone: (id: string) => void;
  setActiveTask: (id: string | null) => void;
  addSubtask: (taskId: string, title: string) => void;
  toggleSubtaskDone: (taskId: string, subtaskId: string) => void;
  removeSubtask: (taskId: string, subtaskId: string) => void;
  updateSubtaskTitle: (taskId: string, subtaskId: string, title: string) => void;
  startStopwatch: (taskId: string) => void;
  pauseStopwatch: (taskId: string) => void;
  resetStopwatch: (taskId: string) => void;
  startPomodoro: () => void;
  pausePomodoro: () => void;
  stopPomodoro: () => void;
  startBreak: () => void;
  updateFocusMinutes: (minutes: number) => void;
  updateBreakMinutes: (minutes: number) => void;
}

/** Хранилище задач, секундомеров и Pomodoro с persist через Electron IPC */
export function useIslandStore(): UseIslandStoreResult {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tasksState, setTasksState] = useState<TasksState>(defaultTasksState);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [now, setNow] = useState(Date.now());
  const hydrated = useRef(false);
  const skipNextSave = useRef(true);
  const tasksStateRef = useRef(tasksState);
  const settingsRef = useRef(settings);
  const saveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef(false);
  tasksStateRef.current = tasksState;
  settingsRef.current = settings;

  /** Сразу пишет задачи и настройки на диск (без debounce) */
  const persistNow = useCallback(() => {
    try {
      if (!window.island || !hydrated.current) {
        return;
      }
      pendingSaveRef.current = false;
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      void window.island.saveState({
        tasks: tasksStateRef.current,
        settings: settingsRef.current,
      });
    } catch (err) {
      console.error('Ошибка сохранения:', err);
      setError('Ошибка сохранения данных');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        if (!window.island) {
          setReady(true);
          hydrated.current = true;
          return;
        }
        const result = await window.island.loadState();
        if (cancelled) {
          return;
        }
        if (result.ok && result.state) {
          if (result.state.tasks && typeof result.state.tasks === 'object') {
            const loaded = result.state.tasks as TasksState;
            const tasks = Array.isArray(loaded.tasks)
              ? loaded.tasks.map((t) =>
                  normalizeTask(t as Partial<Task> & { id: string; title: string }),
                )
              : [];
            const activityByDay: TasksState['activityByDay'] = {};
            const rawActivity = loaded.activityByDay ?? {};
            for (const [key, value] of Object.entries(rawActivity)) {
              activityByDay[key] = {
                focusMs: value?.focusMs ?? 0,
                doneCount: value?.doneCount ?? 0,
                strokes: Array.isArray(value?.strokes) ? value.strokes : [],
              };
            }
            setTasksState({
              ...defaultTasksState,
              ...loaded,
              tasks,
              activityByDay,
            });
          }
          if (result.state.settings && typeof result.state.settings === 'object') {
            setSettings({
              ...defaultSettings,
              ...(result.state.settings as AppSettings),
            });
          }
        }
        setReady(true);
        hydrated.current = true;
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError('Не удалось загрузить сохранённые данные');
          setReady(true);
          hydrated.current = true;
        }
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Что-то идёт: секундомер или Pomodoro — тогда время на экране меняется */
  const hasRunning =
    settings.pomodoroRunning ||
    tasksState.tasks.some((task) => task.runningSince != null);

  /**
   * Тик часов. Каждый тик перерисовывает весь остров, поэтому
   * часто — только пока идёт время, в простое — редко.
   */
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), hasRunning ? 500 : 2000);
    return () => window.clearInterval(id);
  }, [hasRunning]);

  useEffect(() => {
    if (!hydrated.current || skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }

    pendingSaveRef.current = true;
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      persistNow();
    }, 200);
  }, [tasksState, settings, persistNow]);

  /** При выходе / размонтировании не теряем отложенное сохранение */
  useEffect(() => {
    const flushPending = () => {
      try {
        if (pendingSaveRef.current || saveTimerRef.current != null) {
          persistNow();
        }
      } catch (err) {
        console.error(err);
      }
    };

    const flushAll = () => {
      try {
        persistNow();
      } catch (err) {
        console.error(err);
      }
    };

    window.addEventListener('beforeunload', flushPending);
    let unsubFlush: (() => void) | undefined;
    try {
      unsubFlush = window.island?.onFlushState?.(flushAll);
    } catch (err) {
      console.error(err);
    }

    return () => {
      window.removeEventListener('beforeunload', flushPending);
      unsubFlush?.();
      flushPending();
    };
  }, [persistNow]);

  /** Тик Pomodoro и автозавершение фазы */
  useEffect(() => {
    if (!settings.pomodoroRunning || settings.pomodoroTickAt == null) {
      return;
    }

    const elapsed = now - settings.pomodoroTickAt;
    if (elapsed < 0) {
      return;
    }

    const remaining = Math.max(0, settings.pomodoroRemainingMs - elapsed);
    if (remaining > 0) {
      return;
    }

    try {
      if (settings.pomodoroPhase === 'focus') {
        setTasksState((prev) => ({
          ...prev,
          tasks: prev.tasks.map((task) => {
            if (task.id !== prev.activeTaskId || task.runningSince == null) {
              return task;
            }
            return {
              ...task,
              elapsedMs: getTaskElapsedMs(task, now),
              runningSince: null,
            };
          }),
        }));
        setSettings((prev) => ({
          ...prev,
          pomodoroPhase: 'break',
          pomodoroRunning: false,
          pomodoroRemainingMs: prev.breakMinutes * 60 * 1000,
          pomodoroTickAt: null,
        }));
        try {
          const ctx = new AudioContext();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.value = 880;
          gain.gain.value = 0.05;
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.2);
        } catch {
          /* звук необязателен */
        }
      } else if (settings.pomodoroPhase === 'break') {
        setSettings((prev) => ({
          ...prev,
          pomodoroPhase: 'idle',
          pomodoroRunning: false,
          pomodoroRemainingMs: prev.focusMinutes * 60 * 1000,
          pomodoroTickAt: null,
        }));
      }
    } catch (err) {
      console.error('Ошибка завершения Pomodoro:', err);
    }
  }, [now, settings]);

  const activeTask = useMemo(() => {
    if (!tasksState.activeTaskId) {
      return null;
    }
    return tasksState.tasks.find((t) => t.id === tasksState.activeTaskId) ?? null;
  }, [tasksState]);

  const addTask = useCallback((title: string) => {
    const trimmed = title.trim();
    if (!trimmed) {
      return;
    }
    const task: Task = {
      id: createId(),
      title: trimmed,
      done: false,
      elapsedMs: 0,
      runningSince: null,
      subtasks: [],
      category: 'work',
      weight: 2,
    };
    setTasksState((prev) => ({
      ...prev,
      tasks: [task, ...prev.tasks],
      activeTaskId: prev.activeTaskId ?? task.id,
    }));
  }, []);

  const updateTaskTitle = useCallback((id: string, title: string) => {
    setTasksState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) =>
        t.id === id ? { ...t, title: title.trim() || t.title } : t,
      ),
    }));
  }, []);

  const setTaskCategory = useCallback((id: string, category: TaskCategory) => {
    setTasksState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) => (t.id === id ? { ...t, category } : t)),
    }));
  }, []);

  const setTaskWeight = useCallback((id: string, weight: TaskWeight) => {
    setTasksState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) => (t.id === id ? { ...t, weight } : t)),
    }));
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasksState((prev) => {
      try {
        const tasks = prev.tasks.filter((t) => t.id !== id);
        const activeTaskId =
          prev.activeTaskId === id ? tasks[0]?.id ?? null : prev.activeTaskId;
        return {
          ...prev,
          tasks,
          activeTaskId,
          activityByDay: stripTaskStrokes(prev.activityByDay ?? {}, id),
        };
      } catch (err) {
        console.error(err);
        return prev;
      }
    });
  }, []);

  /** Удаляет один мазок с карты дня (не трогает список задач) */
  const removeMapStroke = useCallback((dayKeyValue: string, strokeId: string) => {
    setTasksState((prev) => {
      try {
        const day = prev.activityByDay?.[dayKeyValue];
        if (!day) return prev;
        const strokes = (day.strokes ?? []).filter((s) => s.id !== strokeId);
        if (strokes.length === (day.strokes ?? []).length) return prev;
        return {
          ...prev,
          activityByDay: {
            ...prev.activityByDay,
            [dayKeyValue]: {
              ...day,
              strokes,
              doneCount: Math.max(0, (day.doneCount ?? 0) - 1),
            },
          },
        };
      } catch (err) {
        console.error(err);
        return prev;
      }
    });
  }, []);

  const toggleTaskDone = useCallback((id: string) => {
    const current = tasksStateRef.current.tasks.find((task) => task.id === id);
    if (!current) {
      return;
    }
    const markingDone = !current.done;
    const runningDelta =
      markingDone && current.runningSince != null
        ? Math.max(0, Date.now() - current.runningSince)
        : 0;
    const elapsedMs =
      markingDone && current.runningSince != null
        ? getTaskElapsedMs(current)
        : current.elapsedMs;
    const subtasks = markingDone
      ? current.subtasks.map((s) => ({ ...s, done: true }))
      : current.subtasks;

    setTasksState((prev) => {
      let next: TasksState = {
        ...prev,
        tasks: prev.tasks.map((task) =>
          task.id !== id
            ? task
            : {
                ...task,
                done: markingDone,
                runningSince: markingDone ? null : task.runningSince,
                elapsedMs,
                subtasks,
              },
        ),
      };
      if (markingDone) {
        const weight =
          current.weight || weightFromElapsed(elapsedMs);
        const pixels = PIXELS_BY_WEIGHT[weight] ?? 16;
        const stroke: DayStroke = {
          id: createId(),
          taskId: current.id,
          title: current.title,
          category: current.category ?? 'work',
          weight,
          pixels,
          at: Date.now(),
        };
        next = bumpActivity(next, {
          doneCount: 1,
          focusMs: runningDelta,
          stroke,
        });
      }
      return next;
    });

    if (!markingDone) {
      return;
    }

    const payload = {
      title: current.title,
      elapsedMs,
      subtasks: subtasks.map((s) => s.title),
    };
    void (async () => {
      try {
        const result = await window.island?.logCompletedTask(payload);
        if (!result?.ok) {
          console.error('Excel не принял задачу:', result);
          setError(
            result?.error
              ? `Excel: ${result.error}`
              : 'Не удалось записать задачу в Excel',
          );
        }
      } catch (err) {
        console.error('Не удалось записать задачу в Excel:', err);
        setError('Не удалось записать задачу в Excel');
      }
    })();
  }, []);

  const setActiveTask = useCallback((id: string | null) => {
    setTasksState((prev) => ({ ...prev, activeTaskId: id }));
  }, []);

  const addSubtask = useCallback((taskId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) {
      return;
    }
    const subtask: Subtask = { id: createId(), title: trimmed, done: false };
    setTasksState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) =>
        task.id === taskId
          ? { ...task, done: false, subtasks: [...task.subtasks, subtask] }
          : task,
      ),
    }));
  }, []);

  const toggleSubtaskDone = useCallback((taskId: string, subtaskId: string) => {
    const current = tasksStateRef.current.tasks.find((task) => task.id === taskId);
    if (!current) {
      return;
    }
    const wasDone = current.done;
    const subtasks = current.subtasks.map((s) =>
      s.id === subtaskId ? { ...s, done: !s.done } : s,
    );
    const allDone = subtasks.length > 0 && subtasks.every((s) => s.done);
    const runningDelta =
      allDone && current.runningSince != null
        ? Math.max(0, Date.now() - current.runningSince)
        : 0;
    const elapsedMs =
      allDone && current.runningSince != null
        ? getTaskElapsedMs(current)
        : current.elapsedMs;

    setTasksState((prev) => {
      let next: TasksState = {
        ...prev,
        tasks: prev.tasks.map((task) =>
          task.id !== taskId
            ? task
            : {
                ...task,
                subtasks,
                done: allDone,
                runningSince: allDone ? null : task.runningSince,
                elapsedMs,
              },
        ),
      };
      if (allDone && !wasDone) {
        const weight = current.weight || weightFromElapsed(elapsedMs);
        const pixels = PIXELS_BY_WEIGHT[weight] ?? 16;
        const stroke: DayStroke = {
          id: createId(),
          taskId: current.id,
          title: current.title,
          category: current.category ?? 'work',
          weight,
          pixels,
          at: Date.now(),
        };
        next = bumpActivity(next, {
          doneCount: 1,
          focusMs: runningDelta,
          stroke,
        });
      }
      return next;
    });

    if (!(allDone && !wasDone)) {
      return;
    }

    const payload = {
      title: current.title,
      elapsedMs,
      subtasks: subtasks.map((s) => s.title),
    };
    void (async () => {
      try {
        const result = await window.island?.logCompletedTask(payload);
        if (!result?.ok) {
          console.error('Excel не принял задачу:', result);
          setError(
            result?.error
              ? `Excel: ${result.error}`
              : 'Не удалось записать задачу в Excel',
          );
        }
      } catch (err) {
        console.error('Не удалось записать задачу в Excel:', err);
        setError('Не удалось записать задачу в Excel');
      }
    })();
  }, []);

  const removeSubtask = useCallback((taskId: string, subtaskId: string) => {
    setTasksState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              subtasks: task.subtasks.filter((s) => s.id !== subtaskId),
            }
          : task,
      ),
    }));
  }, []);

  /** Переименовывает подзадачу; пустое название не сохраняется */
  const updateSubtaskTitle = useCallback(
    (taskId: string, subtaskId: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) {
        return;
      }
      setTasksState((prev) => ({
        ...prev,
        tasks: prev.tasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                subtasks: task.subtasks.map((s) =>
                  s.id === subtaskId ? { ...s, title: trimmed } : s,
                ),
              }
            : task,
        ),
      }));
    },
    [],
  );

  const startStopwatch = useCallback((taskId: string) => {
    setTasksState((prev) => {
      let focusMs = 0;
      const tasks = prev.tasks.map((task) => {
        if (task.id === taskId) {
          if (task.runningSince != null || task.done) {
            return task;
          }
          return { ...task, runningSince: Date.now() };
        }
        if (task.runningSince != null) {
          const nextElapsed = getTaskElapsedMs(task);
          focusMs += Math.max(0, nextElapsed - task.elapsedMs);
          return {
            ...task,
            elapsedMs: nextElapsed,
            runningSince: null,
          };
        }
        return task;
      });
      let next: TasksState = { ...prev, activeTaskId: taskId, tasks };
      if (focusMs > 0) {
        next = bumpActivity(next, { focusMs });
      }
      return next;
    });
  }, []);

  const pauseStopwatch = useCallback((taskId: string) => {
    setTasksState((prev) => {
      let focusMs = 0;
      const tasks = prev.tasks.map((task) => {
        if (task.id !== taskId || task.runningSince == null) {
          return task;
        }
        const nextElapsed = getTaskElapsedMs(task);
        focusMs += Math.max(0, nextElapsed - task.elapsedMs);
        return {
          ...task,
          elapsedMs: nextElapsed,
          runningSince: null,
        };
      });
      let next: TasksState = { ...prev, tasks };
      if (focusMs > 0) {
        next = bumpActivity(next, { focusMs });
      }
      return next;
    });
  }, []);

  const resetStopwatch = useCallback((taskId: string) => {
    setTasksState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) =>
        task.id === taskId
          ? { ...task, elapsedMs: 0, runningSince: null }
          : task,
      ),
    }));
  }, []);

  /** Запускает фокус-сессию Pomodoro для активной задачи */
  const startPomodoro = useCallback(() => {
    setSettings((prev) => {
      const remaining =
        prev.pomodoroPhase === 'focus' && prev.pomodoroRemainingMs > 0
          ? prev.pomodoroRemainingMs
          : prev.focusMinutes * 60 * 1000;
      return {
        ...prev,
        pomodoroPhase: 'focus',
        pomodoroRunning: true,
        pomodoroRemainingMs: remaining,
        pomodoroTickAt: Date.now(),
      };
    });
    setTasksState((prev) => {
      if (!prev.activeTaskId) {
        return prev;
      }
      return {
        ...prev,
        tasks: prev.tasks.map((task) => {
          if (task.id === prev.activeTaskId) {
            if (task.runningSince != null || task.done) {
              return task;
            }
            return { ...task, runningSince: Date.now() };
          }
          if (task.runningSince != null) {
            return {
              ...task,
              elapsedMs: getTaskElapsedMs(task),
              runningSince: null,
            };
          }
          return task;
        }),
      };
    });
  }, []);

  const pausePomodoro = useCallback(() => {
    setSettings((prev) => {
      if (!prev.pomodoroRunning || prev.pomodoroTickAt == null) {
        return { ...prev, pomodoroRunning: false, pomodoroTickAt: null };
      }
      const spent = Date.now() - prev.pomodoroTickAt;
      return {
        ...prev,
        pomodoroRunning: false,
        pomodoroRemainingMs: Math.max(0, prev.pomodoroRemainingMs - spent),
        pomodoroTickAt: null,
      };
    });
    setTasksState((prev) => {
      if (!prev.activeTaskId) {
        return prev;
      }
      let focusMs = 0;
      const tasks = prev.tasks.map((task) => {
        if (task.id !== prev.activeTaskId || task.runningSince == null) {
          return task;
        }
        const nextElapsed = getTaskElapsedMs(task);
        focusMs += Math.max(0, nextElapsed - task.elapsedMs);
        return {
          ...task,
          elapsedMs: nextElapsed,
          runningSince: null,
        };
      });
      let next: TasksState = { ...prev, tasks };
      if (focusMs > 0) {
        next = bumpActivity(next, { focusMs });
      }
      return next;
    });
  }, []);

  /**
   * Останавливает все секундомеры и Pomodoro.
   * at — момент остановки (из main до сна), чтобы не набежало время простоя.
   */
  const pauseAllTimers = useCallback((at = Date.now()) => {
    try {
      setTasksState((prev) => {
        let focusMs = 0;
        const tasks = prev.tasks.map((task) => {
          if (task.runningSince == null) {
            return task;
          }
          const nextElapsed = getTaskElapsedMs(task, at);
          focusMs += Math.max(0, nextElapsed - task.elapsedMs);
          return {
            ...task,
            elapsedMs: nextElapsed,
            runningSince: null,
          };
        });
        let next: TasksState = { ...prev, tasks };
        if (focusMs > 0) {
          next = bumpActivity(next, { focusMs }, at);
        }
        return next;
      });
      setSettings((prev) => {
        if (!prev.pomodoroRunning || prev.pomodoroTickAt == null) {
          return { ...prev, pomodoroRunning: false, pomodoroTickAt: null };
        }
        const spent = Math.max(0, at - prev.pomodoroTickAt);
        return {
          ...prev,
          pomodoroRunning: false,
          pomodoroRemainingMs: Math.max(0, prev.pomodoroRemainingMs - spent),
          pomodoroTickAt: null,
        };
      });
    } catch (err) {
      console.error('pauseAllTimers failed:', err);
    }
  }, []);

  /** Применяет уже замороженное состояние с диска / из main */
  const applyPausedSnapshot = useCallback(
    (payload: { at: number; tasks?: unknown; settings?: unknown }) => {
      try {
        const hasTasks = payload.tasks && typeof payload.tasks === 'object';
        const hasSettings =
          payload.settings && typeof payload.settings === 'object';

        if (!hasTasks && !hasSettings) {
          pauseAllTimers(payload.at);
          return;
        }

        skipNextSave.current = true;
        if (hasTasks) {
          setTasksState(payload.tasks as TasksState);
        } else {
          setTasksState((prev) => ({
            ...prev,
            tasks: prev.tasks.map((task) => {
              if (task.runningSince == null) {
                return task;
              }
              return {
                ...task,
                elapsedMs: getTaskElapsedMs(task, payload.at),
                runningSince: null,
              };
            }),
          }));
        }

        if (hasSettings) {
          setSettings({
            ...defaultSettings,
            ...(payload.settings as AppSettings),
          });
        } else {
          setSettings((prev) => {
            if (!prev.pomodoroRunning || prev.pomodoroTickAt == null) {
              return { ...prev, pomodoroRunning: false, pomodoroTickAt: null };
            }
            const spent = Math.max(0, payload.at - prev.pomodoroTickAt);
            return {
              ...prev,
              pomodoroRunning: false,
              pomodoroRemainingMs: Math.max(
                0,
                prev.pomodoroRemainingMs - spent,
              ),
              pomodoroTickAt: null,
            };
          });
        }
      } catch (err) {
        console.error('applyPausedSnapshot failed:', err);
        pauseAllTimers(payload.at);
      }
    },
    [pauseAllTimers],
  );

  useEffect(() => {
    try {
      if (!window.island?.onPauseActivity) {
        return;
      }
      return window.island.onPauseActivity((payload) => {
        applyPausedSnapshot(payload);
      });
    } catch (err) {
      console.error(err);
    }
  }, [applyPausedSnapshot]);

  const stopPomodoro = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      pomodoroPhase: 'idle',
      pomodoroRunning: false,
      pomodoroRemainingMs: prev.focusMinutes * 60 * 1000,
      pomodoroTickAt: null,
    }));
    setTasksState((prev) => {
      if (!prev.activeTaskId) {
        return prev;
      }
      return {
        ...prev,
        tasks: prev.tasks.map((task) => {
          if (task.id !== prev.activeTaskId || task.runningSince == null) {
            return task;
          }
          return {
            ...task,
            elapsedMs: getTaskElapsedMs(task),
            runningSince: null,
          };
        }),
      };
    });
  }, []);

  const startBreak = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      pomodoroPhase: 'break',
      pomodoroRunning: true,
      pomodoroRemainingMs: prev.breakMinutes * 60 * 1000,
      pomodoroTickAt: Date.now(),
    }));
  }, []);

  const updateFocusMinutes = useCallback((minutes: number) => {
    const safe = Math.min(90, Math.max(1, Math.round(minutes)));
    setSettings((prev) => ({
      ...prev,
      focusMinutes: safe,
      pomodoroRemainingMs:
        prev.pomodoroPhase === 'idle' || prev.pomodoroPhase === 'focus'
          ? safe * 60 * 1000
          : prev.pomodoroRemainingMs,
    }));
  }, []);

  const updateBreakMinutes = useCallback((minutes: number) => {
    const safe = Math.min(30, Math.max(1, Math.round(minutes)));
    setSettings((prev) => ({
      ...prev,
      breakMinutes: safe,
      pomodoroRemainingMs:
        prev.pomodoroPhase === 'break'
          ? safe * 60 * 1000
          : prev.pomodoroRemainingMs,
    }));
  }, []);

  return {
    ready,
    error,
    tasksState,
    settings,
    now,
    activeTask,
    addTask,
    updateTaskTitle,
    setTaskCategory,
    setTaskWeight,
    removeTask,
    removeMapStroke,
    toggleTaskDone,
    setActiveTask,
    addSubtask,
    toggleSubtaskDone,
    removeSubtask,
    updateSubtaskTitle,
    startStopwatch,
    pauseStopwatch,
    resetStopwatch,
    startPomodoro,
    pausePomodoro,
    stopPomodoro,
    startBreak,
    updateFocusMinutes,
    updateBreakMinutes,
  };
}

/** Актуальный remaining Pomodoro с учётом тика */
export function getPomodoroDisplayMs(settings: AppSettings, now: number): number {
  if (!settings.pomodoroRunning || settings.pomodoroTickAt == null) {
    return settings.pomodoroRemainingMs;
  }
  return Math.max(0, settings.pomodoroRemainingMs - (now - settings.pomodoroTickAt));
}
