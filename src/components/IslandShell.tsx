import {
  MouseEvent as ReactMouseEvent,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  formatDuration,
  getTaskElapsedMs,
  DayActivity,
  Task,
  TaskCategory,
  TaskWeight,
} from '../store/types';
import { AppSettings } from '../store/types';
import { getPomodoroDisplayMs } from '../store/tasksStore';
import { pickMotivationPhrase } from '../store/phrases';
import { TaskList } from './TaskList';
import { PomodoroPanel } from './PomodoroPanel';
import { TranslatorPanel } from './TranslatorPanel';
import { ClipboardPanel } from './ClipboardPanel';
import { NotesPanel } from './NotesPanel';
import { QuickDataPanel } from './QuickDataPanel';
import { ScreenshotsPanel } from './ScreenshotsPanel';
import { EfficiencyMap } from './EfficiencyMap';

export type IslandMode = 'collapsed' | 'peek' | 'expanded';
type CompactView = 'info' | 'timer' | 'minimal' | 'glass' | 'cactus';
type EdgeOrFree = 'top' | 'bottom' | 'left' | 'right' | 'free';
type PanelTab =
  | 'tasks'
  | 'map'
  | 'notes'
  | 'links'
  | 'shots'
  | 'clipboard'
  | 'translate'
  | 'focus';

const COMPACT_CYCLE: CompactView[] = [
  'info',
  'timer',
  'minimal',
  'glass',
  'cactus',
];

/** Старый moon из сохранений → glass */
function normalizeCompactView(raw: unknown): CompactView {
  if (raw === 'moon') return 'glass';
  if (
    raw === 'info' ||
    raw === 'timer' ||
    raw === 'minimal' ||
    raw === 'glass' ||
    raw === 'cactus'
  ) {
    return raw;
  }
  return 'info';
}

const DRAG_THRESHOLD = 7;

/** Плотные заполненные иконки в духе классических SF Symbols */
const PANEL_TABS: { id: PanelTab; label: string; icon: ReactNode }[] = [
  {
    id: 'tasks',
    label: 'Задачи',
    icon: (
      <span className="rail-emoji" aria-hidden="true">
        💀
      </span>
    ),
  },
  {
    id: 'map',
    label: 'Карта',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M4.5 4.5h3.2v3.2H4.5V4.5zm5.9 0h3.2v3.2h-3.2V4.5zm5.9 0H19.5v3.2h-3.2V4.5zM4.5 10.4h3.2v3.2H4.5v-3.2zm5.9 0h3.2v3.2h-3.2v-3.2zm5.9 0H19.5v3.2h-3.2v-3.2zM4.5 16.3h3.2V19.5H4.5v-3.2zm5.9 0h3.2V19.5h-3.2v-3.2zm5.9 0H19.5V19.5h-3.2v-3.2z"
        />
      </svg>
    ),
  },
  {
    id: 'notes',
    label: 'Заметки',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M6.2 2.8h8.1L19.2 7.7v12.5A2.8 2.8 0 0 1 16.4 23H6.2A2.8 2.8 0 0 1 3.4 20.2V5.6A2.8 2.8 0 0 1 6.2 2.8zm7.4 1.4v4.1h4.1l-4.1-4.1zM7.5 11.2a1 1 0 0 0 0 2h8a1 1 0 1 0 0-2h-8zm0 4a1 1 0 0 0 0 2h5.5a1 1 0 1 0 0-2H7.5z"
        />
      </svg>
    ),
  },
  {
    id: 'links',
    label: 'Ссылки и данные',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M10.4 13.6a1.1 1.1 0 0 1 0-1.6l2.3-2.3a3.6 3.6 0 0 1 5.1 5.1l-1.5 1.5a1.1 1.1 0 1 1-1.6-1.6l1.5-1.5a1.4 1.4 0 1 0-2-2l-2.3 2.3a1.1 1.1 0 0 1-1.5 0zm3.2-3.2a1.1 1.1 0 0 1 0 1.6l-2.3 2.3a3.6 3.6 0 1 1-5.1-5.1l1.5-1.5a1.1 1.1 0 0 1 1.6 1.6L6.8 9.8a1.4 1.4 0 1 0 2 2l2.3-2.3a1.1 1.1 0 0 1 1.5 0z"
        />
      </svg>
    ),
  },
  {
    id: 'shots',
    label: 'Скриншоты',
    icon: (
      <img
        className="rail-icon-img"
        src="/shots-icon.png?v=1"
        alt=""
        draggable={false}
      />
    ),
  },
  {
    id: 'clipboard',
    label: 'Буфер',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M9.1 3.2h5.8a1.4 1.4 0 0 1 1.4 1.4v.7h1.5A2.4 2.4 0 0 1 20.2 7.7v11.7a2.4 2.4 0 0 1-2.4 2.4H6.2a2.4 2.4 0 0 1-2.4-2.4V7.7A2.4 2.4 0 0 1 6.2 5.3h1.5v-.7A1.4 1.4 0 0 1 9.1 3.2zm0 2.1v.7h5.8v-.7H9.1z"
        />
      </svg>
    ),
  },
  {
    id: 'translate',
    label: 'Перевод',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M4.2 5.2h9.2a1.1 1.1 0 1 1 0 2.2H11c.5 1.7 1.5 3.2 2.9 4.5a1.1 1.1 0 1 1-1.5 1.6 11 11 0 0 1-2.3-2.8 11 11 0 0 1-2.3 2.8 1.1 1.1 0 0 1-1.5-1.6A9.6 9.6 0 0 0 8.8 7.4H4.2a1.1 1.1 0 1 1 0-2.2zm10.4 6.2h5.2a1.1 1.1 0 0 1 .95 1.65l-3.4 6.1a1.1 1.1 0 0 1-1.95-.05l-.7-1.45-.7 1.45a1.1 1.1 0 0 1-1.95.05l-1.2-2.15a1.1 1.1 0 0 1 1.9-1.1l.45.8.75-1.55a1.1 1.1 0 0 1 1.95 0l.75 1.55.95-1.7H14.6a1.1 1.1 0 1 1 0-2.2z"
        />
      </svg>
    ),
  },
  {
    id: 'focus',
    label: 'Фокус',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 2.6a1.2 1.2 0 0 1 1.2 1.2v.35a8.4 8.4 0 1 1-2.4 0V3.8A1.2 1.2 0 0 1 12 2.6zm0 4.3a6.1 6.1 0 1 0 0 12.2 6.1 6.1 0 0 0 0-12.2zm.1 2.1a1.1 1.1 0 0 1 1.1 1.1v2.3l1.5.9a1.1 1.1 0 1 1-1.1 1.9l-2.1-1.25a1.1 1.1 0 0 1-.55-.95V10.1a1.1 1.1 0 0 1 1.15-1.1z"
        />
      </svg>
    ),
  },
];

interface IslandShellProps {
  ready: boolean;
  error: string | null;
  tasks: Task[];
  activityByDay: Record<string, DayActivity>;
  activeTask: Task | null;
  activeTaskId: string | null;
  settings: AppSettings;
  now: number;
  onAdd: (title: string) => void;
  onActivate: (id: string) => void;
  onToggleDone: (id: string) => void;
  onRemove: (id: string) => void;
  onRemoveMapStroke: (dayKeyValue: string, strokeId: string) => void;
  onSetCategory: (id: string, category: TaskCategory) => void;
  onSetWeight: (id: string, weight: TaskWeight) => void;
  onAddSubtask: (taskId: string, title: string) => void;
  onToggleSubtask: (taskId: string, subtaskId: string) => void;
  onRemoveSubtask: (taskId: string, subtaskId: string) => void;
  onStartTimer: (id: string) => void;
  onPauseTimer: (id: string) => void;
  onResetTimer: (id: string) => void;
  onStartPomodoro: () => void;
  onPausePomodoro: () => void;
  onStopPomodoro: () => void;
  onStartBreak: () => void;
  onFocusMinutes: (minutes: number) => void;
  onBreakMinutes: (minutes: number) => void;
}

/** Выжимка длинного заголовка для сжатой инфы в pill */
function excerptTitle(title: string, max = 26): string {
  const text = title.trim().replace(/\s+/g, ' ');
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** Пиксельный силуэт кактуса (чёткий при любом масштабе) */
const CACTUS_PIXELS = [
  '................................',
  '................................',
  '.............#####..............',
  '............########............',
  '............###..###............',
  '...........###....###...........',
  '...#####...##......##...........',
  '..#######..##......##...........',
  '..###.###..##......##...........',
  '..##...##..##......##...........',
  '..##...###.##......##...........',
  '..###..######......##...#####...',
  '..###...#####......##..#######..',
  '...###.............##..###.###..',
  '...####............##..##...##..',
  '....#####..........##.###...##..',
  '.....########......######..###..',
  '.......######......#####...###..',
  '...........##.............###...',
  '...........##............####...',
  '...........##.........######....',
  '...........##......########.....',
  '...........##......######.......',
  '...........##......##...........',
  '...........##......##...........',
  '...........##......##...........',
  '....########################....',
  '....########################....',
  '................................',
  '................................',
  '................................',
  '................................',
];

/** Чёрный кактус без фона */
function PillCactus() {
  const rects: ReactNode[] = [];
  try {
    for (let y = 0; y < CACTUS_PIXELS.length; y += 1) {
      const row = CACTUS_PIXELS[y];
      for (let x = 0; x < row.length; x += 1) {
        if (row[x] === '#') {
          rects.push(
            <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />,
          );
        }
      }
    }
  } catch (err) {
    console.error(err);
  }

  return (
    <motion.div
      className="pill-cactus"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <svg
        className="pill-cactus-svg"
        viewBox="0 0 32 32"
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        <g fill="#000">{rects}</g>
      </svg>
    </motion.div>
  );
}

/** Иконка задачи в миниатюре (как во вкладке) */
function PillTaskIcon() {
  return (
    <span className="pill-emoji" aria-hidden="true">
      💀
    </span>
  );
}

/** Иконка фокуса / таймера в стиле SF Symbol */
function PillFocusIcon() {
  return (
    <svg className="pill-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle
        cx="12"
        cy="13"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M12 9.8V13l2.2 1.5M9.8 4.6h4.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Интерактивные элементы не должны начинать drag */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(
    target.closest(
      'input, textarea, button, select, a, label, [data-no-drag]',
    ),
  );
}

/** Оболочка Dynamic Island */
export function IslandShell(props: IslandShellProps) {
  const [mode, setMode] = useState<IslandMode>('collapsed');
  const [compactView, setCompactView] = useState<CompactView>('info');
  const [edge, setEdge] = useState<EdgeOrFree>('top');
  const [topCenter, setTopCenter] = useState(true);
  const [tab, setTab] = useState<PanelTab>('tasks');
  const [phrase, setPhrase] = useState(() => pickMotivationPhrase());
  const [isDragging, setIsDragging] = useState(false);
  const [glassMotion, setGlassMotion] = useState({
    activity: 0,
    dx: 0,
    dy: 0,
  });
  /** Снимок фона под капсулой для CSS-frost (клипается overflow) */
  const [frostUrl, setFrostUrl] = useState<string | null>(null);
  const frostBusyRef = useRef(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const glassMotionRef = useRef({ activity: 0, dx: 0, dy: 0 });
  const glassDecayRaf = useRef(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const dragRef = useRef<{
    tracking: boolean;
    dragging: boolean;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    lastT: number;
  }>({
    tracking: false,
    dragging: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    lastT: 0,
  });

  /** Параметры кромки/блика от скорости перетаскивания */
  function applyGlassMotion(partial: {
    activity?: number;
    dx?: number;
    dy?: number;
  }) {
    const prev = glassMotionRef.current;
    const next = {
      activity: Math.max(0, Math.min(1, partial.activity ?? prev.activity)),
      dx: Math.max(-1, Math.min(1, partial.dx ?? prev.dx)),
      dy: Math.max(-1, Math.min(1, partial.dy ?? prev.dy)),
    };
    glassMotionRef.current = next;
    setGlassMotion(next);
  }

  /** Плавно гасит реакцию стекла после отпускания */
  function decayGlassMotion() {
    if (glassDecayRaf.current) {
      cancelAnimationFrame(glassDecayRaf.current);
    }
    const tick = () => {
      const cur = glassMotionRef.current;
      if (cur.activity <= 0.02) {
        applyGlassMotion({ activity: 0, dx: 0, dy: 0 });
        glassDecayRaf.current = 0;
        return;
      }
      applyGlassMotion({
        activity: cur.activity * 0.82,
        dx: cur.dx * 0.82,
        dy: cur.dy * 0.82,
      });
      glassDecayRaf.current = requestAnimationFrame(tick);
    };
    glassDecayRaf.current = requestAnimationFrame(tick);
  }

  /** Обновляет frost-подложку; при неудаче пробует ещё раз */
  async function refreshGlassFrost(attempt = 0) {
    try {
      if (frostBusyRef.current || isDragging) {
        return;
      }
      if (compactView !== 'glass' || !window.island?.captureFrostBehind) {
        return;
      }
      frostBusyRef.current = true;
      const result = await window.island.captureFrostBehind();
      if (result.ok && result.dataUrl) {
        setFrostUrl(result.dataUrl);
        return;
      }
      if (attempt < 2) {
        frostBusyRef.current = false;
        window.setTimeout(() => {
          void refreshGlassFrost(attempt + 1);
        }, 120 + attempt * 80);
        return;
      }
    } catch (err) {
      console.error(err);
      if (attempt < 2) {
        frostBusyRef.current = false;
        window.setTimeout(() => {
          void refreshGlassFrost(attempt + 1);
        }, 150);
        return;
      }
    } finally {
      frostBusyRef.current = false;
    }
  }

  useEffect(() => {
    return () => {
      if (glassDecayRaf.current) {
        cancelAnimationFrame(glassDecayRaf.current);
      }
    };
  }, []);

  const syncWindowMode = useCallback(async (next: IslandMode) => {
    try {
      if (window.island) {
        await window.island.setMode(next);
      }
    } catch (err) {
      console.error('Не удалось сменить режим окна:', err);
    }
  }, []);

  useEffect(() => {
    void syncWindowMode(mode);
  }, [mode, syncWindowMode]);

  useEffect(() => {
    try {
      if (!window.island?.onEdgeChanged) {
        return;
      }
      return window.island.onEdgeChanged((payload) => {
        setEdge(payload.edge);
        setCompactView(normalizeCompactView(payload.compactView));
        if (typeof payload.topCenter === 'boolean') {
          setTopCenter(payload.topCenter);
        }
      });
    } catch (err) {
      console.error(err);
    }
  }, []);

  /** Клик мимо окна сворачивает панель */
  useEffect(() => {
    try {
      if (!window.island?.onCollapseRequest) {
        return;
      }
      return window.island.onCollapseRequest(() => {
        if (modeRef.current === 'expanded' || modeRef.current === 'peek') {
          setMode('collapsed');
        }
      });
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    const node = shellRef.current;
    if (!node) {
      return;
    }

    /** Ctrl + колесо меняет размер острова */
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      try {
        const direction = e.deltaY < 0 ? 1 : -1;
        void window.island?.adjustSizeScale(direction * 0.08);
      } catch (err) {
        console.error(err);
      }
    }

    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    async function hydrateView() {
      try {
        if (!window.island) {
          return;
        }
        const result = await window.island.loadState();
        if (result.compactView) {
          setCompactView(normalizeCompactView(result.compactView));
        }
        if (result.edge) {
          setEdge(result.edge);
        }
      } catch (err) {
        console.error(err);
      }
    }
    void hydrateView();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && modeRef.current === 'expanded') {
        setMode('collapsed');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Новая фраза при каждом раскрытии панели */
  useEffect(() => {
    if (mode === 'expanded') {
      setPhrase((prev) => pickMotivationPhrase(prev));
    }
  }, [mode]);

  function openExpanded() {
    setMode('expanded');
    setTab('tasks');
  }

  /** ЛКМ: collapsed → сжатая инфа (peek), peek → полная панель */
  function handlePillActivate() {
    if (modeRef.current === 'collapsed') {
      setMode('peek');
      return;
    }
    if (modeRef.current === 'peek') {
      openExpanded();
    }
  }

  /** Явно сворачивает остров */
  function collapseIsland(e?: ReactMouseEvent) {
    e?.stopPropagation();
    e?.preventDefault();
    setMode('collapsed');
  }

  /** Переключает вкладку панели */
  function selectTab(next: PanelTab, e: ReactMouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setTab(next);
  }

  async function handleContextMenu(e: ReactMouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (modeRef.current === 'expanded') {
      return;
    }
    const idx = COMPACT_CYCLE.indexOf(compactView);
    const next = COMPACT_CYCLE[(idx + 1) % COMPACT_CYCLE.length];
    setCompactView(next);
    if (next === 'cactus') {
      setEdge('free');
    }
    try {
      if (window.island) {
        const result = await window.island.setCompactView(next);
        if (result.ok && result.compactView) {
          setCompactView(normalizeCompactView(result.compactView));
        }
        if (result.edge) {
          setEdge(result.edge);
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  /**
   * Drag только с pill / ручки.
   * Кнопки и поля всегда вне drag, иначе вкладки и «свернуть» ломаются.
   */
  function handlePointerDown(e: React.PointerEvent) {
    if (e.button !== 0) {
      return;
    }

    if (isInteractiveTarget(e.target)) {
      return;
    }

    if (modeRef.current === 'expanded') {
      const handle = (e.target as Element | null)?.closest?.(
        '[data-drag-handle]',
      );
      if (!handle) {
        return;
      }
    }

    dragRef.current = {
      tracking: true,
      dragging: false,
      startX: e.screenX,
      startY: e.screenY,
      lastX: e.screenX,
      lastY: e.screenY,
      lastT: performance.now(),
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  async function handlePointerMove(e: React.PointerEvent) {
    const state = dragRef.current;
    if (!state.tracking) {
      return;
    }

    const totalDx = e.screenX - state.startX;
    const totalDy = e.screenY - state.startY;

    if (!state.dragging) {
      if (Math.hypot(totalDx, totalDy) < DRAG_THRESHOLD) {
        return;
      }
      state.dragging = true;
      setIsDragging(true);
      try {
        if (compactView === 'glass') {
          shellRef.current?.classList.add('island--glass-moving');
          if (glassDecayRaf.current) {
            cancelAnimationFrame(glassDecayRaf.current);
            glassDecayRaf.current = 0;
          }
        }
      } catch (err) {
        console.error(err);
      }
      try {
        if (window.island) {
          await window.island.dragStart();
        }
      } catch (err) {
        console.error(err);
      }
    }

    const now = performance.now();
    const dt = Math.max(8, now - state.lastT);
    const dx = e.screenX - state.lastX;
    const dy = e.screenY - state.lastY;
    state.lastX = e.screenX;
    state.lastY = e.screenY;
    state.lastT = now;

    if (compactView === 'glass' && (dx !== 0 || dy !== 0)) {
      try {
        const speed = Math.hypot(dx, dy) / dt;
        // Чувствительнее: даже медленное движение заметно «живит» край
        const burst = Math.min(1, speed * 22 + 0.2);
        const len = Math.hypot(dx, dy) || 1;
        applyGlassMotion({
          activity: Math.max(glassMotionRef.current.activity * 0.55, burst),
          dx: (dx / len) * Math.max(burst, 0.35),
          dy: (dy / len) * Math.max(burst, 0.35),
        });
      } catch (err) {
        console.error(err);
      }
    }

    // Не await: иначе IPC блокирует pointermove и стекло/drag «залипают»
    try {
      if (window.island && (dx !== 0 || dy !== 0)) {
        void window.island.dragMove(dx, dy);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handlePointerUp(e: React.PointerEvent) {
    const state = dragRef.current;
    if (!state.tracking) {
      return;
    }
    state.tracking = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }

    if (state.dragging) {
      try {
        if (window.island) {
          const result = await window.island.dragEnd();
          if (result.edge) {
            setEdge(result.edge as EdgeOrFree);
          }
        }
      } catch (err) {
        console.error(err);
      }
      state.dragging = false;
      setIsDragging(false);
      try {
        shellRef.current?.classList.remove('island--glass-moving');
        if (compactView === 'glass') {
          decayGlassMotion();
          window.setTimeout(() => {
            void refreshGlassFrost();
          }, 40);
        }
      } catch (err) {
        console.error(err);
      }
      return;
    }

    if (modeRef.current === 'expanded') {
      return;
    }
    handlePillActivate();
  }

  async function handleQuit(e: ReactMouseEvent) {
    e.stopPropagation();
    try {
      if (window.island) {
        await window.island.quit();
      }
    } catch (err) {
      console.error(err);
    }
  }

  const pomodoroMs = getPomodoroDisplayMs(props.settings, props.now);
  const activeElapsed = props.activeTask
    ? getTaskElapsedMs(props.activeTask, props.now)
    : 0;
  const isTimerRunning = props.activeTask?.runningSince != null;
  const showPomodoroInPill =
    props.settings.pomodoroPhase !== 'idle' || props.settings.pomodoroRunning;

  const displayTime = showPomodoroInPill
    ? formatDuration(pomodoroMs)
    : formatDuration(activeElapsed);

  const vertical = edge === 'left' || edge === 'right';
  const showCactus =
    compactView === 'cactus' && edge === 'free' && mode !== 'expanded';
  /** Режим «мутного стекла»: и pill, и развёрнутая панель */
  const isGlassView = compactView === 'glass';

  useEffect(() => {
    try {
      document.documentElement.classList.toggle('glass-mode', isGlassView);
    } catch (err) {
      console.error(err);
    }
    return () => {
      try {
        document.documentElement.classList.remove('glass-mode');
      } catch {
        /* ignore */
      }
    };
  }, [isGlassView]);

  // Снимок фона при входе в glass / смене режима / края
  useEffect(() => {
    if (!isGlassView) {
      setFrostUrl(null);
      return;
    }
    const t = window.setTimeout(() => {
      void refreshGlassFrost();
    }, 60);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh по ключевым сменам геометрии
  }, [isGlassView, mode, edge]);

  const islandClass = [
    'island',
    `island--${mode}`,
    `island--view-${compactView}`,
    `island--edge-${edge}`,
    isGlassView ? 'island--glass' : '',
    isGlassView && isDragging ? 'island--glass-moving' : '',
    showCactus ? 'island--cactus' : '',
    topCenter ? 'island--top-center' : '',
    vertical ? 'island--vertical' : 'island--horizontal',
  ]
    .filter(Boolean)
    .join(' ');

  const pillLabel = props.activeTask
    ? excerptTitle(props.activeTask.title, topCenter ? 22 : 14)
    : excerptTitle(phrase, topCenter ? 22 : 14);

  /** Контент сжатой инфы в pill */
  function renderPillContent() {
    if (showCactus) {
      return <PillCactus />;
    }

    if (compactView === 'glass') {
      return (
        <div className="pill-activity pill-activity--glass">
          <span className="pill-left">
            <span className="pill-glass-dot" aria-hidden="true" />
            <span className="pill-title">{pillLabel}</span>
          </span>
        </div>
      );
    }

    if (compactView === 'minimal') {
      return null;
    }

    const showContent =
      mode === 'peek' ||
      compactView === 'timer' ||
      (compactView === 'info' && (isTimerRunning || showPomodoroInPill));

    if (!showContent) {
      return null;
    }

    if (compactView === 'timer') {
      return (
        <div className="pill-activity pill-activity--timer">
          {showPomodoroInPill ? (
            <span className="pill-left pill-left--focus">
              <PillFocusIcon />
              <span className="pill-time pill-time--focus">{displayTime}</span>
            </span>
          ) : (
            <span className="pill-time">{displayTime}</span>
          )}
        </div>
      );
    }

    if (showPomodoroInPill) {
      return (
        <div className="pill-activity">
          <span className="pill-left pill-left--focus">
            <PillFocusIcon />
            <span className="pill-time pill-time--focus">{displayTime}</span>
          </span>
          <span className="pill-wave" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        </div>
      );
    }

    return (
      <div className="pill-activity">
        <span className="pill-left">
          <PillTaskIcon />
          <span className="pill-title">{pillLabel}</span>
        </span>
        <span className="pill-time">{displayTime}</span>
      </div>
    );
  }

  return (
    <div className="app-root">
      <motion.div
        ref={shellRef}
        className={islandClass}
        initial={isGlassView ? false : { opacity: 0.92, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        onContextMenu={handleContextMenu}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          width: '100%',
          height: '100%',
          ...(isGlassView
            ? {
                ['--glass-activity' as string]: glassMotion.activity,
                ['--glass-dx' as string]: glassMotion.dx,
                ['--glass-dy' as string]: glassMotion.dy,
              }
            : {}),
        }}
      >
        {isGlassView ? (
          <span className="glass-stack glass-stack--shell" aria-hidden="true">
            <span
              className={
                frostUrl ? 'glass-frost' : 'glass-frost glass-frost--pending'
              }
              style={
                frostUrl
                  ? { backgroundImage: `url("${frostUrl}")` }
                  : undefined
              }
            />
            <span className="glass-body" />
          </span>
        ) : null}
        <AnimatePresence mode="wait">
          {mode !== 'expanded' ? (
            <motion.div
              key={`pill-${compactView}-${mode}`}
              className="pill-inner"
              initial={{ opacity: 0.75 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0.8 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              {renderPillContent()}
            </motion.div>
          ) : (
            <motion.div
              key="panel"
              className="panel-inner"
              initial={isGlassView ? false : { opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={isGlassView ? undefined : { opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <nav className="panel-rail" data-no-drag aria-label="Разделы">
                {PANEL_TABS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={
                      tab === item.id ? 'rail-btn rail-btn--active' : 'rail-btn'
                    }
                    title={item.label}
                    aria-label={item.label}
                    aria-current={tab === item.id ? 'page' : undefined}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => selectTab(item.id, e)}
                  >
                    {item.icon}
                  </button>
                ))}
              </nav>

              <div className="panel-main">
                <header className="panel-header">
                  <div
                    className="panel-drag"
                    data-drag-handle
                    title="Перетащить"
                  >
                    <p className="motivation">{phrase}</p>
                  </div>
                  <div className="panel-actions" data-no-drag>
                    <button
                      type="button"
                      className="traffic traffic--excel"
                      aria-label="Открыть Задачник"
                      title="Задачник Excel"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        try {
                          void window.island?.openWorkbook();
                        } catch (err) {
                          console.error(err);
                        }
                      }}
                    >
                      <span>XL</span>
                    </button>
                    <button
                      type="button"
                      className="traffic traffic--min"
                      aria-label="Свернуть"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={collapseIsland}
                    />
                    <button
                      type="button"
                      className="traffic traffic--close"
                      aria-label="Закрыть"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={handleQuit}
                    />
                  </div>
                </header>

                <div className="panel-content" data-no-drag>
                  {tab === 'tasks' && (
                    <TaskList
                      ready={props.ready}
                      error={props.error}
                      tasks={props.tasks}
                      activeTaskId={props.activeTaskId}
                      now={props.now}
                      onAdd={props.onAdd}
                      onActivate={props.onActivate}
                      onToggleDone={props.onToggleDone}
                      onRemove={props.onRemove}
                      onSetCategory={props.onSetCategory}
                      onSetWeight={props.onSetWeight}
                      onAddSubtask={props.onAddSubtask}
                      onToggleSubtask={props.onToggleSubtask}
                      onRemoveSubtask={props.onRemoveSubtask}
                      onStartTimer={props.onStartTimer}
                      onPauseTimer={props.onPauseTimer}
                      onResetTimer={props.onResetTimer}
                    />
                  )}

                  {tab === 'map' && (
                    <EfficiencyMap
                      activityByDay={props.activityByDay}
                      onRemoveStroke={props.onRemoveMapStroke}
                    />
                  )}

                  {tab === 'notes' && <NotesPanel />}

                  {tab === 'links' && <QuickDataPanel />}

                  {tab === 'shots' && <ScreenshotsPanel />}

                  {tab === 'clipboard' && <ClipboardPanel />}

                  {tab === 'translate' && <TranslatorPanel />}

                  {tab === 'focus' && (
                    <PomodoroPanel
                      settings={props.settings}
                      now={props.now}
                      hasActiveTask={Boolean(
                        props.activeTask && !props.activeTask.done,
                      )}
                      onStart={props.onStartPomodoro}
                      onPause={props.onPausePomodoro}
                      onStop={props.onStopPomodoro}
                      onStartBreak={props.onStartBreak}
                      onFocusMinutes={props.onFocusMinutes}
                      onBreakMinutes={props.onBreakMinutes}
                    />
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

