import {
  MouseEvent as ReactMouseEvent,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, animate, motion, useMotionValue } from 'framer-motion';
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
import {
  isGlassMaterial,
  nextViewMode,
  normalizeViewMode,
  type ViewMode,
} from '../viewMode';

export type IslandMode = 'collapsed' | 'peek' | 'expanded';
type EdgeOrFree = 'top' | 'bottom' | 'left' | 'right' | 'free';
type IconFiles = Record<string, { id: string; name: string; ext: 'svg' | 'png' }[]>;
type PanelTab =
  | 'tasks'
  | 'map'
  | 'notes'
  | 'links'
  | 'shots'
  | 'clipboard'
  | 'translate'
  | 'focus';

/** Порог драга в CSS-пикселях (по clientX/Y, не по экрану — DPI не влияет) */
const DRAG_THRESHOLD = 4;
/** Дольше этого нажатие без движения уже не клик */
const CLICK_MAX_MS = 300;
/** Сколько гонять геометрию подложки по кадрам после смены режима */
const BACKDROP_FOLLOW_MS = 400;
const DEFAULT_VIEW: ViewMode = { material: 'black', layout: 'minimal' };

/** Пружины Glass-HQ (core/spring.ts): одна «материя» для всех движений стекла */
const SPRING_MORPH = { type: 'spring', duration: 0.42, bounce: 0.18 } as const;
const SPRING_COLLAPSE = { type: 'spring', duration: 0.34, bounce: 0 } as const;
const SPRING_LAYOUT = { type: 'spring', duration: 0.4, bounce: 0.16 } as const;

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
  onUpdateTitle: (id: string, title: string) => void;
  onUpdateSubtaskTitle: (taskId: string, subtaskId: string, title: string) => void;
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

/**
 * Значок слота: встроенный или файл из %AppData%\pc-dynamic-island\icons\<слот>\.
 * SVG красится в currentColor через маску, PNG рисуется как есть.
 */
function SlotIcon({
  slot,
  files,
  choice,
  className,
  builtin,
}: {
  slot: string;
  files: IconFiles;
  choice: Record<string, string>;
  className: string;
  builtin: ReactNode;
}) {
  try {
    const id = choice[slot];
    const file =
      id && id !== 'builtin'
        ? (files[slot] ?? []).find((item) => item.id === id)
        : undefined;
    if (!file) {
      return <>{builtin}</>;
    }
    const url = `island-icon://${slot}/${encodeURIComponent(file.id)}`;
    if (file.ext === 'svg') {
      return (
        <span
          className={`${className} icon-mask`}
          aria-hidden="true"
          style={{
            WebkitMaskImage: `url("${url}")`,
            maskImage: `url("${url}")`,
          }}
        />
      );
    }
    return (
      <img
        className={`${className} icon-png`}
        src={url}
        alt=""
        draggable={false}
      />
    );
  } catch (err) {
    console.error(err);
    return <>{builtin}</>;
  }
}

/** Кольцо прогресса бегущего времени для правого круга extended */
function ProgressRing({ progress }: { progress: number }) {
  const r = 9;
  const length = 2 * Math.PI * r;
  const value = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return (
    <svg className="live-ring" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="live-ring-track" cx="12" cy="12" r={r} />
      <circle
        className="live-ring-value"
        cx="12"
        cy="12"
        r={r}
        strokeDasharray={`${length * value} ${length}`}
      />
    </svg>
  );
}

/** Обрезает название задачи для компакта task */
function clipTaskTitle(title: string, max = 28): string {
  const text = title.trim().replace(/\s+/g, ' ');
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Внешний радиус фигуры: у прилипшей к краю часть углов нулевая */
function outerRadius(el: Element, width: number, height: number): number {
  try {
    const style = getComputedStyle(el);
    const radius = Math.max(
      parseFloat(style.borderTopLeftRadius) || 0,
      parseFloat(style.borderTopRightRadius) || 0,
      parseFloat(style.borderBottomLeftRadius) || 0,
      parseFloat(style.borderBottomRightRadius) || 0,
    );
    return Math.min(radius, Math.min(width, height) / 2);
  } catch {
    return Math.min(width, height) / 2;
  }
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
  const [viewMode, setViewModeState] = useState<ViewMode>(DEFAULT_VIEW);
  const [edge, setEdge] = useState<EdgeOrFree>('top');
  const [topCenter, setTopCenter] = useState(true);
  const [tab, setTab] = useState<PanelTab>('tasks');
  const [phrase, setPhrase] = useState(() => pickMotivationPhrase());
  const [isDragging, setIsDragging] = useState(false);
  const [iconFiles, setIconFiles] = useState<IconFiles>({});
  const [iconChoice, setIconChoice] = useState<Record<string, string>>({});
  const shellRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  /** Зум окна (Ctrl+колесо): CSS-пиксели × sizeScale = DIP */
  const sizeScaleRef = useRef(1);
  const edgeRef = useRef(edge);
  edgeRef.current = edge;
  /** Прогресс морфа: 0 — капсула, 1 — панель */
  const morphProgress = useMotionValue(1);
  /** Откуда растёт панель: прямоугольник компакта в CSS-пикселях нового окна */
  const morphFromRef = useRef<{ x: number; y: number; w: number; h: number; r: number } | null>(
    null,
  );
  /** Идёт морф: клип и фигура подложки считаются из прогресса, а не из DOM */
  const morphActiveRef = useRef(false);
  const morphBusyRef = useRef(false);
  /** Режим, уже отправленный в main: эффект не шлёт его второй раз */
  const sentModeRef = useRef<IslandMode | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const iconFilesRef = useRef(iconFiles);
  iconFilesRef.current = iconFiles;
  const iconChoiceRef = useRef(iconChoice);
  iconChoiceRef.current = iconChoice;

  /** Одна сессия нажатия: клик или драг */
  const dragRef = useRef<{
    tracking: boolean;
    dragging: boolean;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    lastScreenX: number;
    lastScreenY: number;
    startT: number;
  }>({
    tracking: false,
    dragging: false,
    pointerId: -1,
    startClientX: 0,
    startClientY: 0,
    lastScreenX: 0,
    lastScreenY: 0,
    startT: 0,
  });

  /**
   * Шлёт в main прямоугольники видимых фигур в DIP относительно окна.
   * Только для artic: подложка блюра повторяет форму элементов, а не окна.
   */
  const pushBackdropShapes = useCallback(() => {
    try {
      if (morphActiveRef.current) {
        applyMorph(morphProgress.get());
        return;
      }
      if (!isGlassMaterial(viewModeRef.current.material)) {
        return;
      }
      const root = shellRef.current;
      if (!root || !window.island?.sendBackdropShapes) {
        return;
      }
      const marked = Array.from(
        root.querySelectorAll<HTMLElement>('[data-backdrop-shape]'),
      );
      const targets = marked.length ? marked : [root];
      const zoom = sizeScaleRef.current || 1;
      const shapes = targets
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const radius = outerRadius(el, rect.width, rect.height);
          return {
            x: rect.left * zoom,
            y: rect.top * zoom,
            width: rect.width * zoom,
            height: rect.height * zoom,
            radius: radius * zoom,
          };
        })
        .filter((shape) => shape.width > 1 && shape.height > 1);
      if (shapes.length) {
        window.island.sendBackdropShapes(shapes);
      }
    } catch (err) {
      console.error('pushBackdropShapes failed:', err);
    }
  }, []);

  /** Пока идёт анимация раскрытия — геометрия подложки каждый кадр */
  const followBackdrop = useCallback(() => {
    try {
      const until = performance.now() + BACKDROP_FOLLOW_MS;
      const tick = () => {
        pushBackdropShapes();
        if (performance.now() < until) {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    } catch (err) {
      console.error(err);
    }
  }, [pushBackdropShapes]);

  /** Значки слотов из папки icons и выбор из файла состояния */
  useEffect(() => {
    try {
      if (!window.island?.getIcons) {
        return;
      }
      void window.island.getIcons().then((result) => {
        if (result.ok) {
          setIconFiles(result.files);
          setIconChoice(result.choice);
        }
      });
      return window.island.onIconsChanged((payload) => {
        setIconFiles(payload.files);
        setIconChoice(payload.choice);
      });
    } catch (err) {
      console.error(err);
    }
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
    // Раскрытие и сворачивание с морфом сами шлют режим в main
    if (sentModeRef.current === mode) {
      return;
    }
    sentModeRef.current = mode;
    void syncWindowMode(mode);
  }, [mode, syncWindowMode]);

  /**
   * Форма в момент t морфа: клип корня, прозрачность панели и фигура подложки.
   * t = 0 — прямоугольник капсулы внутри большого окна, t = 1 — всё окно.
   */
  function applyMorph(t: number) {
    try {
      const root = shellRef.current;
      const from = morphFromRef.current;
      if (!root || !from) {
        return;
      }
      const W = root.clientWidth || window.innerWidth;
      const H = root.clientHeight || window.innerHeight;
      const k = Math.max(0, Math.min(1, t));
      const x = from.x * (1 - k);
      const y = from.y * (1 - k);
      const w = from.w + (W - from.w) * k;
      const h = from.h + (H - from.h) * k;
      const edgeNow = edgeRef.current;
      const panelRadius = edgeNow === 'free' ? 24 : 22;
      const r = Math.min(from.r + (panelRadius - from.r) * k, Math.min(w, h) / 2);
      // Плоская сторона к краю экрана — как у капсулы и панели в CSS
      const tl = edgeNow === 'top' || edgeNow === 'left' ? 0 : r;
      const tr = edgeNow === 'top' || edgeNow === 'right' ? 0 : r;
      const br = edgeNow === 'bottom' || edgeNow === 'right' ? 0 : r;
      const bl = edgeNow === 'bottom' || edgeNow === 'left' ? 0 : r;
      root.style.clipPath = `inset(${y}px ${W - x - w}px ${H - y - h}px ${x}px round ${tl}px ${tr}px ${br}px ${bl}px)`;
      if (panelRef.current) {
        panelRef.current.style.opacity = String(Math.max(0, Math.min(1, (k - 0.4) / 0.6)));
      }
      if (isGlassMaterial(viewModeRef.current.material) && window.island?.sendBackdropShapes) {
        const zoom = sizeScaleRef.current || 1;
        window.island.sendBackdropShapes([
          { x: x * zoom, y: y * zoom, width: w * zoom, height: h * zoom, radius: r * zoom },
        ]);
      }
    } catch (err) {
      console.error('applyMorph failed:', err);
    }
  }

  /** Конец морфа: клип снят, форма снова целиком из CSS */
  function clearMorph() {
    morphActiveRef.current = false;
    if (shellRef.current) {
      shellRef.current.style.clipPath = '';
    }
    if (panelRef.current) {
      panelRef.current.style.opacity = '';
    }
  }

  /** Каждый кадр пружины — новая форма */
  useEffect(() => {
    return morphProgress.on('change', (value) => {
      if (morphActiveRef.current) {
        applyMorph(value);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyMorph читает только ref
  }, [morphProgress]);

  useEffect(() => {
    try {
      if (!window.island?.onEdgeChanged) {
        return;
      }
      return window.island.onEdgeChanged((payload) => {
        setEdge(payload.edge);
        const next = normalizeViewMode(payload.viewMode);
        if (next) {
          setViewModeState(next);
        }
        if (typeof payload.topCenter === 'boolean') {
          setTopCenter(payload.topCenter);
        }
        if (typeof payload.sizeScale === 'number' && payload.sizeScale > 0) {
          const scaleChanged = payload.sizeScale !== sizeScaleRef.current;
          sizeScaleRef.current = payload.sizeScale;
          // Ctrl+колесо: CSS-размер корня не меняется, ResizeObserver молчит —
          // без этого стекло остаётся прежнего размера
          if (scaleChanged) {
            requestAnimationFrame(() => pushBackdropShapes());
          }
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
        if (modeRef.current !== 'collapsed') {
          void collapseAnimated();
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
        const stored = normalizeViewMode(result.viewMode);
        if (stored) {
          setViewModeState(stored);
        }
        if (result.edge) {
          setEdge(result.edge);
        }
        if (typeof result.sizeScale === 'number' && result.sizeScale > 0) {
          sizeScaleRef.current = result.sizeScale;
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
        void collapseAnimated();
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

  /**
   * Раскрытие: main сразу растит окно, а видимая форма вырастает
   * из капсулы на пружине morph (Glass-HQ). Подложка стекла идёт следом.
   */
  async function openExpanded() {
    setTab('tasks');
    if (modeRef.current === 'expanded' || morphBusyRef.current) {
      return;
    }
    morphBusyRef.current = true;
    try {
      const root = shellRef.current;
      const compactW = root?.clientWidth || window.innerWidth;
      const compactH = root?.clientHeight || window.innerHeight;
      const compactR = root ? outerRadius(root, compactW, compactH) : compactH / 2;
      // Пока окно растёт, форма не должна на миг заполнить весь прямоугольник
      if (root) {
        root.style.clipPath = 'inset(50%)';
      }
      morphActiveRef.current = true;
      morphProgress.set(0);
      sentModeRef.current = 'expanded';
      const result = await window.island?.setMode('expanded');
      const zoom = sizeScaleRef.current || 1;
      morphFromRef.current =
        result?.from && result?.to
          ? {
              x: (result.from.x - result.to.x) / zoom,
              y: (result.from.y - result.to.y) / zoom,
              w: result.from.width / zoom,
              h: result.from.height / zoom,
              r: compactR,
            }
          : null;
      modeRef.current = 'expanded';
      setMode('expanded');
      if (!morphFromRef.current) {
        clearMorph();
        return;
      }
      requestAnimationFrame(() => {
        applyMorph(0);
        void animate(morphProgress, 1, SPRING_MORPH).then(() => {
          if (modeRef.current === 'expanded') {
            clearMorph();
            pushBackdropShapes();
          }
        });
      });
    } catch (err) {
      console.error('openExpanded failed:', err);
      clearMorph();
      setMode('expanded');
    } finally {
      morphBusyRef.current = false;
    }
  }

  /**
   * Сворачивание: форма стягивается обратно в капсулу,
   * потом main уменьшает окно. Esc, потеря фокуса и ручка идут сюда же.
   */
  async function collapseAnimated() {
    if (modeRef.current !== 'expanded' || morphBusyRef.current) {
      return;
    }
    morphBusyRef.current = true;
    try {
      if (morphFromRef.current) {
        morphActiveRef.current = true;
        await animate(morphProgress, 0, SPRING_COLLAPSE);
      }
      sentModeRef.current = 'collapsed';
      await window.island?.setMode('collapsed');
    } catch (err) {
      console.error('collapseAnimated failed:', err);
    } finally {
      modeRef.current = 'collapsed';
      setMode('collapsed');
      clearMorph();
      morphBusyRef.current = false;
    }
  }

  /**
   * Один клик ЛКМ: компакт раскрывается в любом режиме,
   * клик по ручке раскрытой панели сворачивает остров.
   */
  function handlePillActivate() {
    if (modeRef.current === 'expanded') {
      void collapseAnimated();
      return;
    }
    void openExpanded();
  }

  /** Следующий из восьми режимов по кругу; main ресайзит окно и пишет viewMode */
  async function cycleViewMode() {
    const next = nextViewMode(viewModeRef.current);
    setViewModeState(next);
    if (next.material === 'cactus') {
      setEdge('free');
    }
    try {
      if (!window.island?.setViewMode) {
        return;
      }
      const result = await window.island.setViewMode(next);
      const confirmed = normalizeViewMode(result.viewMode);
      if (result.ok && confirmed) {
        setViewModeState(confirmed);
      }
      if (result.edge) {
        setEdge(result.edge);
      }
      if (typeof result.sizeScale === 'number' && result.sizeScale > 0) {
        sizeScaleRef.current = result.sizeScale;
      }
    } catch (err) {
      console.error('Не удалось сменить вид:', err);
    }
  }

  /** ПКМ по значку: следующий значок слота (встроенный, затем файлы по алфавиту) */
  async function cycleSlotIcon(slot: string) {
    try {
      const ids = [
        'builtin',
        ...(iconFilesRef.current[slot] ?? []).map((file) => file.id),
      ];
      const current = iconChoiceRef.current[slot] ?? 'builtin';
      const next = ids[(ids.indexOf(current) + 1) % ids.length] ?? 'builtin';
      if (next === current || !window.island?.setIconChoice) {
        return;
      }
      setIconChoice((prev) => ({ ...prev, [slot]: next }));
      const result = await window.island.setIconChoice(slot, next);
      if (result.ok && result.choice) {
        setIconChoice(result.choice);
      }
    } catch (err) {
      console.error('Не удалось сменить значок:', err);
    }
  }

  /** Явно сворачивает остров */
  function collapseIsland(e?: ReactMouseEvent) {
    e?.stopPropagation();
    e?.preventDefault();
    void collapseAnimated();
  }

  /** Переключает вкладку панели */
  function selectTab(next: PanelTab, e: ReactMouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setTab(next);
  }

  /** ПКМ по значку меняет значок, ПКМ по остальному компакту — режим */
  function handleContextMenu(e: ReactMouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      const slotEl = (e.target as Element | null)?.closest?.('[data-icon-slot]');
      const slot = slotEl?.getAttribute('data-icon-slot');
      if (slot) {
        void cycleSlotIcon(slot);
        return;
      }
      if (modeRef.current === 'expanded') {
        return;
      }
      void cycleViewMode();
    } catch (err) {
      console.error(err);
    }
  }

  /**
   * Закрывает сессию нажатия. Драг завершается в main (там прилипание к краю),
   * клик засчитывается только если click = true.
   */
  function finishPointerSession(click: boolean) {
    const state = dragRef.current;
    if (!state.tracking) {
      return;
    }
    const wasDragging = state.dragging;
    const pointerId = state.pointerId;
    state.tracking = false;
    state.dragging = false;
    state.pointerId = -1;
    try {
      if (pointerId >= 0 && shellRef.current?.hasPointerCapture?.(pointerId)) {
        shellRef.current.releasePointerCapture(pointerId);
      }
    } catch {
      /* захват уже снят */
    }

    if (wasDragging) {
      setIsDragging(false);
      void (async () => {
        try {
          const result = await window.island?.dragEnd();
          if (result?.edge) {
            setEdge(result.edge as EdgeOrFree);
          }
        } catch (err) {
          console.error(err);
        }
      })();
      return;
    }

    if (click) {
      handlePillActivate();
    }
  }

  /**
   * Драг с компакта или с ручки панели.
   * Кнопки и поля всегда вне драга, иначе вкладки и «свернуть» ломаются.
   */
  function handlePointerDown(e: React.PointerEvent) {
    if (e.button !== 0) {
      return;
    }
    if (isInteractiveTarget(e.target)) {
      return;
    }
    if (modeRef.current === 'expanded') {
      const handle = (e.target as Element | null)?.closest?.('[data-drag-handle]');
      if (!handle) {
        return;
      }
    }
    // Хвост прошлой сессии (потерянный pointerup) не должен тащить остров
    finishPointerSession(false);

    dragRef.current = {
      tracking: true,
      dragging: false,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      lastScreenX: e.screenX,
      lastScreenY: e.screenY,
      startT: performance.now(),
    };
    try {
      shellRef.current?.setPointerCapture?.(e.pointerId);
    } catch {
      /* без захвата сессию закроют buttons === 0 и blur */
    }
  }

  function handlePointerMove(e: React.PointerEvent) {
    const state = dragRef.current;
    if (!state.tracking || e.pointerId !== state.pointerId) {
      return;
    }
    // Кнопка уже отпущена, а pointerup не дошёл — закрываем, а не едем за мышью
    if (e.buttons === 0) {
      finishPointerSession(false);
      return;
    }

    if (!state.dragging) {
      const moved = Math.hypot(
        e.clientX - state.startClientX,
        e.clientY - state.startClientY,
      );
      if (moved < DRAG_THRESHOLD) {
        return;
      }
      state.dragging = true;
      setIsDragging(true);
      try {
        void window.island?.dragStart();
      } catch (err) {
        console.error(err);
      }
    }

    const dx = e.screenX - state.lastScreenX;
    const dy = e.screenY - state.lastScreenY;
    state.lastScreenX = e.screenX;
    state.lastScreenY = e.screenY;
    // Не await: иначе IPC блокирует pointermove и драг «залипает»
    try {
      if (dx !== 0 || dy !== 0) {
        void window.island?.dragMove(dx, dy);
      }
    } catch (err) {
      console.error(err);
    }
  }

  function handlePointerUp(e: React.PointerEvent) {
    const state = dragRef.current;
    if (!state.tracking || e.pointerId !== state.pointerId) {
      return;
    }
    const moved = Math.hypot(
      e.clientX - state.startClientX,
      e.clientY - state.startClientY,
    );
    const quick = performance.now() - state.startT < CLICK_MAX_MS;
    finishPointerSession(!state.dragging && quick && moved < DRAG_THRESHOLD);
  }

  /** pointercancel / потеря захвата: сессия закрывается без клика */
  function handlePointerAbort() {
    finishPointerSession(false);
  }

  /** Потеря фокуса окна закрывает сессию драга */
  useEffect(() => {
    const onBlur = () => finishPointerSession(false);
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- функция читает только ref
  }, []);

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
  /** Как compactHasTimer в main: от него зависит правый круг extended */
  const hasTimer =
    showPomodoroInPill || props.tasks.some((task) => task.runningSince != null);

  const displayTime = showPomodoroInPill
    ? formatDuration(pomodoroMs)
    : formatDuration(activeElapsed);
  const timerCaption = showPomodoroInPill
    ? props.settings.pomodoroPhase === 'break'
      ? 'ПЕРЕРЫВ'
      : 'ФОКУС'
    : 'ЗАДАЧА';
  /** Прогресс кольца: Pomodoro — доля фазы, секундомер — доля текущего часа */
  const ringProgress = (() => {
    try {
      if (showPomodoroInPill) {
        const minutes =
          props.settings.pomodoroPhase === 'break'
            ? props.settings.breakMinutes
            : props.settings.focusMinutes;
        const total = Math.max(1, minutes * 60 * 1000);
        return 1 - pomodoroMs / total;
      }
      return (activeElapsed % 3_600_000) / 3_600_000;
    } catch {
      return 0;
    }
  })();

  const { material, layout } = viewMode;
  const vertical = edge === 'left' || edge === 'right';
  const isGlass = isGlassMaterial(material);
  const showCactus = material === 'cactus' && edge === 'free' && mode !== 'expanded';
  /** Три отдельные фигуры: только компакт extended */
  const isLive = layout === 'extended' && mode !== 'expanded' && !showCactus;
  /** Значок левого круга: задача, фокус или текущая вкладка */
  const liveSlot = showPomodoroInPill ? 'focus' : props.activeTask ? 'tasks' : tab;

  useEffect(() => {
    try {
      document.documentElement.classList.toggle('glass-mode', isGlass);
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
  }, [isGlass]);

  /** Геометрия подложки: смена режима, края, раскладки, таймера; потом кадры анимации */
  useEffect(() => {
    pushBackdropShapes();
    followBackdrop();
  }, [mode, edge, material, layout, hasTimer, pushBackdropShapes, followBackdrop]);

  /** Окно или фигуры поменяли размер — новая геометрия подложки */
  useEffect(() => {
    const root = shellRef.current;
    if (!root || typeof ResizeObserver === 'undefined') {
      return;
    }
    try {
      const observer = new ResizeObserver(() => pushBackdropShapes());
      observer.observe(root);
      root
        .querySelectorAll('[data-backdrop-shape]')
        .forEach((el) => observer.observe(el));
      const onTransitionEnd = () => pushBackdropShapes();
      root.addEventListener('transitionend', onTransitionEnd);
      return () => {
        observer.disconnect();
        root.removeEventListener('transitionend', onTransitionEnd);
      };
    } catch (err) {
      console.error(err);
    }
  }, [mode, layout, hasTimer, pushBackdropShapes]);

  const islandClass = [
    'island',
    `island--${mode}`,
    `island--material-${material}`,
    `island--layout-${layout}`,
    `island--edge-${edge}`,
    isGlass ? 'island--glass' : '',
    isGlass && isDragging ? 'island--glass-moving' : '',
    isLive ? 'island--live' : '',
    showCactus ? 'island--cactus' : '',
    topCenter ? 'island--top-center' : '',
    vertical ? 'island--vertical' : 'island--horizontal',
  ]
    .filter(Boolean)
    .join(' ');

  const pillLabel = props.activeTask
    ? excerptTitle(props.activeTask.title, topCenter ? 22 : 14)
    : excerptTitle(phrase, topCenter ? 22 : 14);

  /** Крупные цифры и мелкая подпись справа */
  function renderHeroTime() {
    return (
      <div className="pill-activity pill-activity--timer">
        <span
          className={
            showPomodoroInPill
              ? 'pill-time pill-time--hero pill-time--focus'
              : 'pill-time pill-time--hero'
          }
        >
          {displayTime}
        </span>
        <span className="pill-caption">{timerCaption}</span>
      </div>
    );
  }

  /** Зелёная точка и название активной задачи */
  function renderTaskLine() {
    const running = isTimerRunning || showPomodoroInPill;
    return (
      <div className="pill-activity pill-activity--task">
        <span
          className={running ? 'task-dot task-dot--on' : 'task-dot'}
          aria-hidden="true"
        />
        <span className="pill-title">
          {props.activeTask
            ? clipTaskTitle(props.activeTask.title)
            : 'Нет активной задачи'}
        </span>
      </div>
    );
  }

  /** Компакт extended: левый круг, центральный pill, правый круг с кольцом */
  function renderLiveRow() {
    const builtin =
      PANEL_TABS.find((item) => item.id === liveSlot)?.icon ?? <PillTaskIcon />;
    return (
      <div className="live-row">
        <div
          className="live-shape live-shape--circle"
          data-backdrop-shape
          data-icon-slot={liveSlot}
        >
          <SlotIcon
            slot={liveSlot}
            files={iconFiles}
            choice={iconChoice}
            className="live-icon"
            builtin={<span className="live-icon live-icon--builtin">{builtin}</span>}
          />
        </div>
        <div className="live-shape live-shape--pill" data-backdrop-shape>
          {hasTimer ? (
            renderHeroTime()
          ) : (
            <div className="pill-activity pill-activity--task">
              <span className="pill-title">{pillLabel}</span>
            </div>
          )}
        </div>
        {hasTimer ? (
          <div className="live-shape live-shape--circle" data-backdrop-shape>
            <ProgressRing progress={ringProgress} />
          </div>
        ) : null}
      </div>
    );
  }

  /** Содержимое компакта по раскладке; материал задаёт только фон */
  function renderPillContent() {
    if (showCactus) {
      return <PillCactus />;
    }
    if (layout === 'extended') {
      return renderLiveRow();
    }
    if (layout === 'task') {
      return renderTaskLine();
    }
    if (layout === 'timer') {
      return renderHeroTime();
    }
    // minimal: пустая капсула, при бегущем времени — только цифры
    if (!isTimerRunning && !showPomodoroInPill) {
      return null;
    }
    return (
      <div className="pill-activity pill-activity--timer">
        <span
          className={
            showPomodoroInPill ? 'pill-time pill-time--focus' : 'pill-time'
          }
        >
          {displayTime}
        </span>
      </div>
    );
  }

  return (
    <div className="app-root">
      <motion.div
        ref={shellRef}
        className={islandClass}
        initial={isGlass ? false : { opacity: 0.92, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        onContextMenu={handleContextMenu}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerAbort}
        onLostPointerCapture={handlePointerAbort}
        style={{ width: '100%', height: '100%' }}
      >
        {/* Без mode="wait": панель монтируется сразу, её форму ведёт морф */}
        <AnimatePresence initial={false}>
          {mode !== 'expanded' ? (
            <motion.div
              key={`pill-${material}-${layout}`}
              className="pill-inner"
              initial={{ opacity: 0.75 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={
                isLive
                  ? { opacity: 0, scale: 0.86, transition: { duration: 0.12 } }
                  : { opacity: 0, transition: { duration: 0.12 } }
              }
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              {renderPillContent()}
            </motion.div>
          ) : (
            <motion.div
              key="panel"
              ref={panelRef}
              className="panel-inner"
              initial={false}
              exit={{ opacity: 0, transition: { duration: 0 } }}
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
                    data-icon-slot={item.id}
                  >
                    {/* Стеклянная плашка выбора перетекает между вкладками (GlassTabsIndicator) */}
                    {tab === item.id ? (
                      <motion.span
                        layoutId="rail-lens"
                        className="rail-lens"
                        transition={SPRING_LAYOUT}
                        aria-hidden="true"
                      />
                    ) : null}
                    <span className="rail-btn-icon">
                      <SlotIcon
                        slot={item.id}
                        files={iconFiles}
                        choice={iconChoice}
                        className="rail-slot-icon"
                        builtin={item.icon}
                      />
                    </span>
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
                      onUpdateTitle={props.onUpdateTitle}
                      onUpdateSubtaskTitle={props.onUpdateSubtaskTitle}
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

