import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  screen,
  shell,
  Tray,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { appendCompletedTask, appendNote, ensureWorkbookExists, getWorkbookPath } from './excelJournal';
import {
  clearClipboardHistory,
  getClipboardHistory,
  pasteClipboardText,
  setClipboardChangeHandler,
  startClipboardWatch,
  stopClipboardWatch,
  writeClipboardSilent,
} from './clipboardHistory';
import {
  deleteScreenshot,
  getScreenshotDataUrl,
  getSystemQuickPaths,
  listScreenshots,
  reorderScreenshots,
  copyScreenshotToClipboard,
  getScreenshotFilePath,
  setScreenshotChangeHandler,
  startScreenshotWatch,
  stopScreenshotWatch,
} from './screenshotStore';

/** Один экземпляр: повторный клик по ярлыку поднимает уже запущенный остров */
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  /** Повторный запуск с ярлыка — показать окно первого процесса */
  app.on('second-instance', () => {
    try {
      showIsland();
      if (mainWindow) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.show();
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        mainWindow.moveTop();
        mainWindow.focus();
        applyLayout('peek');
      }
    } catch (error) {
      console.error('second-instance failed:', error);
    }
  });
}

/** Компактность idle-вида */
type CompactView = 'info' | 'timer' | 'minimal' | 'glass' | 'cactus';
type IslandMode = 'collapsed' | 'peek' | 'expanded';
type Edge = 'top' | 'bottom' | 'left' | 'right';
type EdgeOrFree = Edge | 'free';

/** Размеры Dynamic Island (компактнее: ~1/4 площади прежних) */
const BASE = {
  pill: { width: 70, height: 20 },
  timer: { width: 58, height: 20 },
  peekInfo: { width: 148, height: 20 },
  peekTimer: { width: 66, height: 20 },
  cactus: { width: 72, height: 72 },
  expanded: { width: 560, height: 320 },
} as const;

/** Свободный остров в режиме маски (кактус) */
function isMascotView(view: CompactView): boolean {
  return view === 'cactus';
}

/** Нормализует старые сохранённые виды (moon → glass) */
function normalizeCompactView(raw: unknown): CompactView {
  if (raw === 'moon') {
    return 'glass';
  }
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

const SNAP_THRESHOLD = 52;
/** Насколько близко к горизонтальному центру считаем «верхний центр» */
const TOP_CENTER_SLACK = 90;
const SIZE_SCALE_MIN = 0.7;
const SIZE_SCALE_MAX = 3;
const SIZE_SCALE_STEP = 0.08;

interface PersistedAppState {
  tasks: unknown;
  settings: unknown;
  window: {
    edge: EdgeOrFree;
    offset: number;
    x?: number;
    y?: number;
    compactView?: CompactView;
    sizeScale?: number;
  };
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let currentMode: IslandMode = 'collapsed';
let currentEdge: EdgeOrFree = 'top';
let edgeOffset = 0;
let freeX = 0;
let freeY = 0;
let isDragging = false;
let compactView: CompactView = 'info';
/** Масштаб острова (Ctrl + колесо) */
let sizeScale = 1;
let isQuitting = false;
/** Чтобы before-quit не зациклился после flush */
let quitPrepared = false;
/** Путь к файлу локального состояния */
function getStatePath(): string {
  return path.join(app.getPath('userData'), 'island-state.json');
}

/** Читает сохранённое состояние с диска */
function readState(): PersistedAppState | null {
  try {
    const filePath = getStatePath();
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as PersistedAppState;
  } catch (error) {
    console.error('Не удалось прочитать состояние:', error);
    return null;
  }
}

/** Пишет состояние на диск (не затирает tasks/settings null-ом) */
function writeState(partial: Partial<PersistedAppState>): void {
  try {
    const current = readState() ?? {
      tasks: null,
      settings: null,
      window: {
        edge: currentEdge,
        offset: edgeOffset,
        x: freeX,
        y: freeY,
        compactView,
        sizeScale,
      },
    };
    const next: PersistedAppState = {
      ...current,
      ...partial,
      // Явная защита: null из partial не должен стереть сохранённые данные
      tasks:
        partial.tasks === null || partial.tasks === undefined
          ? current.tasks
          : partial.tasks,
      settings:
        partial.settings === null || partial.settings === undefined
          ? current.settings
          : partial.settings,
      window: {
        ...current.window,
        ...(partial.window ?? {}),
        edge: currentEdge,
        offset: edgeOffset,
        x: freeX,
        y: freeY,
        compactView,
        sizeScale,
      },
    };
    fs.writeFileSync(getStatePath(), JSON.stringify(next, null, 2), 'utf8');
  } catch (error) {
    console.error('Не удалось сохранить состояние:', error);
  }
}

/** Задача в сохранённом состоянии */
interface StoredTask {
  id?: string;
  title?: string;
  done?: boolean;
  elapsedMs?: number;
  runningSince?: number | null;
  subtasks?: unknown;
}

interface StoredTasksState {
  tasks?: StoredTask[];
  activeTaskId?: string | null;
}

interface StoredSettings {
  focusMinutes?: number;
  breakMinutes?: number;
  pomodoroPhase?: string;
  pomodoroRemainingMs?: number;
  pomodoroRunning?: boolean;
  pomodoroTickAt?: number | null;
}

/**
 * Останавливает секундомеры и Pomodoro в файле состояния.
 * Важно делать это в main до сна/выхода, иначе набежит время простоя.
 */
function freezePersistedTimers(at = Date.now()): {
  tasks: StoredTasksState | null;
  settings: StoredSettings | null;
  changed: boolean;
} {
  try {
    const state = readState();
    if (!state) {
      return { tasks: null, settings: null, changed: false };
    }

    let changed = false;
    let tasksOut: StoredTasksState | null =
      state.tasks && typeof state.tasks === 'object'
        ? (state.tasks as StoredTasksState)
        : null;
    let settingsOut: StoredSettings | null =
      state.settings && typeof state.settings === 'object'
        ? (state.settings as StoredSettings)
        : null;

    if (tasksOut && Array.isArray(tasksOut.tasks)) {
      tasksOut = {
        ...tasksOut,
        tasks: tasksOut.tasks.map((task) => {
          if (task == null || typeof task !== 'object') {
            return task;
          }
          if (task.runningSince == null || typeof task.runningSince !== 'number') {
            return task;
          }
          changed = true;
          const base =
            typeof task.elapsedMs === 'number' && Number.isFinite(task.elapsedMs)
              ? task.elapsedMs
              : 0;
          return {
            ...task,
            elapsedMs: base + Math.max(0, at - task.runningSince),
            runningSince: null,
          };
        }),
      };
    }

    if (settingsOut) {
      if (
        settingsOut.pomodoroRunning &&
        typeof settingsOut.pomodoroTickAt === 'number'
      ) {
        changed = true;
        const remaining =
          typeof settingsOut.pomodoroRemainingMs === 'number'
            ? settingsOut.pomodoroRemainingMs
            : 0;
        const spent = Math.max(0, at - settingsOut.pomodoroTickAt);
        settingsOut = {
          ...settingsOut,
          pomodoroRunning: false,
          pomodoroRemainingMs: Math.max(0, remaining - spent),
          pomodoroTickAt: null,
        };
      }
    }

    if (changed) {
      writeState({
        tasks: tasksOut,
        settings: settingsOut,
      });
    }

    return { tasks: tasksOut, settings: settingsOut, changed };
  } catch (error) {
    console.error('freezePersistedTimers failed:', error);
    return { tasks: null, settings: null, changed: false };
  }
}

/** Останавливает активность при сне / выходе / завершении сеанса */
function pauseActivityForSystemEvent(reason: string): void {
  try {
    const at = Date.now();
    const frozen = freezePersistedTimers(at);
    mainWindow?.webContents.send('island:pause-activity', {
      reason,
      at,
      tasks: frozen.tasks,
      settings: frozen.settings,
    });
  } catch (error) {
    console.error('pauseActivityForSystemEvent failed:', error);
  }
}

/** После пробуждения подтягивает уже замороженное состояние с диска */
function syncStateAfterResume(): void {
  try {
    const state = readState();
    mainWindow?.webContents.send('island:pause-activity', {
      reason: 'resume',
      at: Date.now(),
      tasks: state?.tasks ?? null,
      settings: state?.settings ?? null,
    });
  } catch (error) {
    console.error('syncStateAfterResume failed:', error);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Дисплей под окном (или ближайший к курсору во время перетаскивания) */
function getDisplay(): Electron.Display {
  try {
    if (isDragging) {
      return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    }
    if (!mainWindow || mainWindow.isDestroyed()) {
      return screen.getPrimaryDisplay();
    }
    return screen.getDisplayMatching(mainWindow.getBounds());
  } catch {
    return screen.getPrimaryDisplay();
  }
}

/** Вписывает прямоугольник в заданную рабочую область */
function clampRectToArea(
  rect: Electron.Rectangle,
  area: Electron.Rectangle,
): Electron.Rectangle {
  const width = Math.min(rect.width, area.width);
  const height = Math.min(rect.height, area.height);
  const x = clamp(rect.x, area.x, area.x + area.width - width);
  const y = clamp(rect.y, area.y, area.y + area.height - height);
  return { x, y, width, height };
}

/** Держит прямоугольник внутри рабочей области текущего/целевого дисплея */
function clampToWorkArea(rect: Electron.Rectangle): Electron.Rectangle {
  return clampRectToArea(rect, getDisplay().workArea);
}

/**
 * Во время drag: экран под курсором, чтобы остров мог уехать на другой монитор.
 * Курсор пересекает границу раньше центра окна — иначе clamp не даёт «перепрыгнуть».
 */
function clampForDrag(rect: Electron.Rectangle): Electron.Rectangle {
  try {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    return clampRectToArea(rect, display.workArea);
  } catch {
    return clampToWorkArea(rect);
  }
}

/** Остров у верхнего центра экрана — делаем вытянутее */
function isNearTopCenter(bounds?: Electron.Rectangle | null): boolean {
  try {
    const area = getDisplay().workArea;
    const b = bounds ?? mainWindow?.getBounds() ?? null;
    if (!b) {
      return currentEdge === 'top' && Math.abs(edgeOffset) <= TOP_CENTER_SLACK;
    }
    const cx = b.x + b.width / 2;
    const areaCx = area.x + area.width / 2;
    const nearX = Math.abs(cx - areaCx) <= TOP_CENTER_SLACK;
    const nearTop = b.y - area.y <= 56;
    return nearX && nearTop;
  } catch {
    return false;
  }
}

/** Размер окна под режим и положение */
function resolveSize(
  mode: IslandMode,
  edge: EdgeOrFree,
  view: CompactView,
  topCenter: boolean,
): { width: number; height: number } {
  let base: { width: number; height: number } = BASE.pill;
  if (mode === 'expanded') {
    base = BASE.expanded;
  } else if (isMascotView(view) && edge === 'free') {
    base = BASE.cactus;
  } else if (view === 'glass') {
    // Та же геометрия, что у тёмного peek info
    base = BASE.peekInfo;
  } else if (mode === 'peek') {
    if (view === 'info') {
      base = BASE.peekInfo;
    } else if (view === 'timer') {
      base = BASE.peekTimer;
    } else {
      base = BASE.pill;
    }
  } else if (view === 'timer') {
    base = BASE.timer;
  } else {
    base = BASE.pill;
  }

  let width: number = base.width;
  let height: number = base.height;

  /** У верхнего центра — заметно вытянутее, как у Apple DI */
  const isMascotFree =
    isMascotView(view) && edge === 'free' && mode !== 'expanded';
  if (
    !isMascotFree &&
    mode !== 'expanded' &&
    topCenter &&
    edge !== 'left' &&
    edge !== 'right'
  ) {
    const stretch =
      mode === 'peek' && view === 'info'
        ? 1.38
        : view === 'glass'
          ? 1.38
          : 1.28;
    width = Math.round(width * stretch);
  }

  width = Math.max(16, Math.round(width * sizeScale));
  height = Math.max(10, Math.round(height * sizeScale));

  if (
    !isMascotFree &&
    (edge === 'left' || edge === 'right') &&
    mode !== 'expanded'
  ) {
    return { width: height, height: width };
  }
  return { width, height };
}

/** Применяет зум контента под текущий масштаб */
function applyZoomFactor(): void {
  try {
    mainWindow?.webContents.setZoomFactor(sizeScale);
  } catch (error) {
    console.error('applyZoomFactor failed:', error);
  }
}

/** Нормализует и применяет масштаб острова */
function setSizeScale(next: number): number {
  sizeScale = clamp(
    Math.round(next * 100) / 100,
    SIZE_SCALE_MIN,
    SIZE_SCALE_MAX,
  );
  applyZoomFactor();
  applyLayout(currentMode);
  writeState({});
  return sizeScale;
}

function emitEdge(): void {
  try {
    mainWindow?.webContents.send('island:edge-changed', {
      edge: currentEdge,
      compactView,
      topCenter: isNearTopCenter(),
      sizeScale,
    });
  } catch (error) {
    console.error('emitEdge failed:', error);
  }
}

/** Win32 API: только клип главного HWND по капсуле (без child/accent — они крашат Chromium) */
type WinClipApi = {
  createRectRgn: (
    left: number,
    top: number,
    right: number,
    bottom: number,
  ) => unknown;
  createRoundRectRgn: (
    left: number,
    top: number,
    right: number,
    bottom: number,
    ellipseW: number,
    ellipseH: number,
  ) => unknown;
  combineRgn: (
    dest: unknown,
    src1: unknown,
    src2: unknown,
    mode: number,
  ) => number;
  deleteObject: (obj: unknown) => number;
  setWindowRgn: (hwnd: number, hrgn: unknown, redraw: number) => number;
  readClientSize: (hwnd: number) => { w: number; h: number };
};

const RGN_OR = 2;

let winClipApi: WinClipApi | null = null;

/** Ленивая загрузка gdi32/user32 через koffi */
function getWinClipApi(): WinClipApi | null {
  try {
    if (process.platform !== 'win32') {
      return null;
    }
    if (winClipApi) {
      return winClipApi;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as typeof import('koffi');
    const gdi32 = koffi.load('gdi32.dll');
    const user32 = koffi.load('user32.dll');
    const RectType = koffi.struct('IslandRECT', {
      left: 'long',
      top: 'long',
      right: 'long',
      bottom: 'long',
    });
    const CreateRectRgn = gdi32.func('CreateRectRgn', 'void *', [
      'int',
      'int',
      'int',
      'int',
    ]);
    const CreateRoundRectRgn = gdi32.func(
      'CreateRoundRectRgn',
      'void *',
      ['int', 'int', 'int', 'int', 'int', 'int'],
    );
    const CombineRgn = gdi32.func('CombineRgn', 'int', [
      'void *',
      'void *',
      'void *',
      'int',
    ]);
    const DeleteObject = gdi32.func('DeleteObject', 'int', ['void *']);
    const SetWindowRgn = user32.func('SetWindowRgn', 'int', [
      'uintptr',
      'void *',
      'int',
    ]);
    const GetClientRect = user32.func('GetClientRect', 'bool', [
      'uintptr',
      koffi.out(koffi.pointer(RectType)),
    ]);

    winClipApi = {
      createRectRgn: CreateRectRgn,
      createRoundRectRgn: CreateRoundRectRgn,
      combineRgn: CombineRgn,
      deleteObject: DeleteObject,
      setWindowRgn: SetWindowRgn as WinClipApi['setWindowRgn'],
      readClientSize: (hwnd: number) => {
        const rect = { left: 0, top: 0, right: 0, bottom: 0 };
        const ok = GetClientRect(hwnd, rect) as boolean;
        if (!ok) {
          return { w: 0, h: 0 };
        }
        return {
          w: Math.max(0, rect.right - rect.left),
          h: Math.max(0, rect.bottom - rect.top),
        };
      },
    };
    return winClipApi;
  } catch (error) {
    console.error('getWinClipApi failed:', error);
    return null;
  }
}

/** HWND текущего BrowserWindow как Number (надёжнее BigInt для koffi) */
function getMainHwnd(): number | null {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return null;
    }
    const buf = mainWindow.getNativeWindowHandle();
    if (process.arch === 'ia32') {
      return buf.readUInt32LE(0);
    }
    return Number(buf.readBigUInt64LE(0));
  } catch (error) {
    console.error('getMainHwnd failed:', error);
    return null;
  }
}

/**
 * HRGN капсулы / скруглённой панели в физических пикселях.
 * Геометрия как у CSS: free=stadium, edge=только «наружные» углы.
 */
function createIslandRegion(
  api: WinClipApi,
  physW: number,
  physH: number,
  radiusPx: number,
): unknown {
  const w = Math.max(1, physW);
  const h = Math.max(1, physH);
  const r = Math.max(
    1,
    Math.min(Math.floor(radiusPx), Math.floor(w / 2), Math.floor(h / 2)),
  );
  const edge = currentEdge;

  // Полная капсула / панель со всеми углами
  if (edge === 'free' || currentMode === 'expanded') {
    return api.createRoundRectRgn(0, 0, w + 1, h + 1, r * 2, r * 2);
  }

  // Сборка региона по scanline — совпадает с CSS (квадратные углы у края экрана)
  const dest = api.createRectRgn(0, 0, 0, 0);
  for (let y = 0; y < h; y += 1) {
    let leftInset = 0;
    let rightInset = 0;
    const inTopCap = y < r;
    const inBottomCap = y >= h - r;

    if (edge === 'top') {
      // Плоский верх, скругление снизу
      if (inBottomCap) {
        const dy = y - (h - r) + 0.5;
        const inset = Math.ceil(r - Math.sqrt(Math.max(0, r * r - dy * dy)));
        leftInset = inset;
        rightInset = inset;
      }
    } else if (edge === 'bottom') {
      if (inTopCap) {
        const dy = r - y - 0.5;
        const inset = Math.ceil(r - Math.sqrt(Math.max(0, r * r - dy * dy)));
        leftInset = inset;
        rightInset = inset;
      }
    } else if (edge === 'left') {
      // Плоский левый край, скругление справа
      if (inTopCap) {
        const dy = r - y - 0.5;
        rightInset = Math.ceil(r - Math.sqrt(Math.max(0, r * r - dy * dy)));
      } else if (inBottomCap) {
        const dy = y - (h - r) + 0.5;
        rightInset = Math.ceil(r - Math.sqrt(Math.max(0, r * r - dy * dy)));
      }
    } else if (edge === 'right') {
      if (inTopCap) {
        const dy = r - y - 0.5;
        leftInset = Math.ceil(r - Math.sqrt(Math.max(0, r * r - dy * dy)));
      } else if (inBottomCap) {
        const dy = y - (h - r) + 0.5;
        leftInset = Math.ceil(r - Math.sqrt(Math.max(0, r * r - dy * dy)));
      }
    }

    const x0 = leftInset;
    const x1 = w - rightInset;
    if (x1 > x0) {
      const row = api.createRectRgn(x0, y, x1, y + 1);
      api.combineRgn(dest, dest, row, RGN_OR);
      api.deleteObject(row);
    }
  }
  return dest;
}

/**
 * Радиус в DIP — строго как в theme.css у капсулы / панели.
 */
function islandCornerRadiusDip(): number {
  if (currentMode === 'expanded') {
    return currentEdge === 'free' ? 24 : 22;
  }
  if (currentEdge === 'free') {
    const bounds = mainWindow?.getBounds();
    const h = bounds?.height ?? 20;
    return Math.max(1, Math.floor(h / 2));
  }
  return 10;
}

/**
 * Scanline для win.setShape — та же геометрия, что у createIslandRegion (в DIP).
 */
function buildCapsuleShapeRects(
  width: number,
  height: number,
  radius: number,
): Electron.Rectangle[] {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const r = Math.max(
    1,
    Math.min(Math.floor(radius), Math.floor(w / 2), Math.floor(h / 2)),
  );
  const edge = currentEdge;
  const rects: Electron.Rectangle[] = [];

  for (let y = 0; y < h; y += 1) {
    let leftInset = 0;
    let rightInset = 0;
    const inTopCap = y < r;
    const inBottomCap = y >= h - r;

    if (edge === 'free' || currentMode === 'expanded') {
      let inset = 0;
      if (inTopCap) {
        const dy = r - y - 0.5;
        inset = Math.ceil(r - Math.sqrt(Math.max(0, r * r - dy * dy)));
      } else if (inBottomCap) {
        const dy = y - (h - r) + 0.5;
        inset = Math.ceil(r - Math.sqrt(Math.max(0, r * r - dy * dy)));
      }
      leftInset = inset;
      rightInset = inset;
    } else if (edge === 'top' && inBottomCap) {
      const dy = y - (h - r) + 0.5;
      const inset = Math.ceil(r - Math.sqrt(Math.max(0, r * r - dy * dy)));
      leftInset = inset;
      rightInset = inset;
    } else if (edge === 'bottom' && inTopCap) {
      const dy = r - y - 0.5;
      const inset = Math.ceil(r - Math.sqrt(Math.max(0, r * r - dy * dy)));
      leftInset = inset;
      rightInset = inset;
    } else if (edge === 'left') {
      if (inTopCap) {
        const dy = r - y - 0.5;
        rightInset = Math.ceil(r - Math.sqrt(Math.max(0, r * r - dy * dy)));
      } else if (inBottomCap) {
        const dy = y - (h - r) + 0.5;
        rightInset = Math.ceil(r - Math.sqrt(Math.max(0, r * r - dy * dy)));
      }
    } else if (edge === 'right') {
      if (inTopCap) {
        const dy = r - y - 0.5;
        leftInset = Math.ceil(r - Math.sqrt(Math.max(0, r * r - dy * dy)));
      } else if (inBottomCap) {
        const dy = y - (h - r) + 0.5;
        leftInset = Math.ceil(r - Math.sqrt(Math.max(0, r * r - dy * dy)));
      }
    }

    const rw = w - leftInset - rightInset;
    if (rw > 0) {
      rects.push({ x: leftInset, y, width: rw, height: 1 });
    }
  }
  return rects;
}

/**
 * Физический размер HWND в пикселях (не путать с DIP).
 * GetClientRect через koffi может молча дать 0 — тогда fallback на bounds×DPI.
 */
function readPhysicalWindowSize(hwnd: number): { w: number; h: number } {
  const bounds = mainWindow!.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const scale = display.scaleFactor || 1;
  const fallback = {
    w: Math.max(1, Math.round(bounds.width * scale)),
    h: Math.max(1, Math.round(bounds.height * scale)),
  };

  try {
    const api = getWinClipApi();
    if (!api) {
      return fallback;
    }
    const fromApi = api.readClientSize(hwnd);
    if (fromApi.w > 0 && fromApi.h > 0) {
      return fromApi;
    }
  } catch (error) {
    console.error('readPhysicalWindowSize api failed:', error);
  }
  return fallback;
}

/**
 * Физический размер только из bounds×DPI.
 * GetClientRect через koffi иногда даёт 0 → пустой регион → окно исчезает.
 */
function physicalBoundsSize(): { w: number; h: number } {
  const bounds = mainWindow!.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const scale = display.scaleFactor || 1;
  return {
    w: Math.max(1, Math.round(bounds.width * scale)),
    h: Math.max(1, Math.round(bounds.height * scale)),
  };
}

/**
 * Снимает клип окна (shape + Win32 region).
 */
function clearGlassWindowClip(): void {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    try {
      mainWindow.setShape([]);
    } catch {
      /* ignore */
    }
    try {
      const api = getWinClipApi();
      const hwnd = getMainHwnd();
      if (api && hwnd != null) {
        api.setWindowRgn(hwnd, null, 1);
      }
    } catch {
      /* ignore */
    }
  } catch (error) {
    console.error('clearGlassWindowClip failed:', error);
  }
}

/**
 * Клип Acrylic по капсуле: SetWindowRgn только на главный HWND.
 * Размер строго из bounds×DPI; при сомнении регион не ставим.
 */
function syncGlassWindowRegion(): void {
  try {
    if (
      process.platform !== 'win32' ||
      !mainWindow ||
      mainWindow.isDestroyed()
    ) {
      return;
    }

    if (compactView !== 'glass') {
      clearGlassWindowClip();
      try {
        mainWindow.setMinimumSize(1, 1);
        mainWindow.setMaximumSize(4096, 4096);
      } catch {
        /* ignore */
      }
      return;
    }

    const bounds = mainWindow.getBounds();
    if (bounds.width < 8 || bounds.height < 8) {
      // Слишком рано / окно ещё не готово — не клипаем, иначе «пропадёт»
      return;
    }

    const api = getWinClipApi();
    const hwnd = getMainHwnd();
    if (!api || hwnd == null) {
      console.error('syncGlassWindowRegion: no api/hwnd');
      return;
    }

    const { w: physW, h: physH } = physicalBoundsSize();
    if (physW < 8 || physH < 8) {
      return;
    }

    const display = screen.getDisplayMatching(bounds);
    const scale = display.scaleFactor || 1;
    const radiusPx = Math.max(
      1,
      Math.min(
        Math.round(islandCornerRadiusDip() * scale),
        Math.floor(physW / 2),
        Math.floor(physH / 2),
      ),
    );

    try {
      // Без setShape: он конфликтует с SetWindowRgn на части сборок
      try {
        mainWindow.setShape([]);
      } catch {
        /* ignore */
      }

      const clipRgn = createIslandRegion(api, physW, physH, radiusPx);
      const ok = api.setWindowRgn(hwnd, clipRgn, 1);
      if (!ok) {
        console.error('SetWindowRgn failed', { physW, physH, radiusPx });
        clearGlassWindowClip();
        return;
      }

      // Страховка: если клип «съел» окно — откат
      setTimeout(() => {
        try {
          if (!mainWindow || mainWindow.isDestroyed()) {
            return;
          }
          const b = mainWindow.getBounds();
          if (!mainWindow.isVisible() || b.width < 8 || b.height < 8) {
            clearGlassWindowClip();
            mainWindow.setOpacity(1);
            mainWindow.show();
            mainWindow.moveTop();
          }
        } catch (guardErr) {
          console.error('glass clip guard failed:', guardErr);
        }
      }, 40);
    } catch (rgnErr) {
      console.error('SetWindowRgn threw:', rgnErr);
      clearGlassWindowClip();
    }
  } catch (error) {
    console.error('syncGlassWindowRegion failed:', error);
  }
}

/**
 * Glass: Acrylic + безопасный клип капсулы.
 */
function syncGlassMaterial(): void {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    if (process.platform !== 'win32') {
      return;
    }
    const useGlass = compactView === 'glass';
    try {
      mainWindow.setBackgroundMaterial(useGlass ? 'acrylic' : 'none');
    } catch (matErr) {
      console.error('setBackgroundMaterial failed:', matErr);
    }
    syncGlassWindowRegion();
    if (useGlass) {
      setTimeout(() => syncGlassWindowRegion(), 50);
      setTimeout(() => syncGlassWindowRegion(), 180);
    }
    try {
      mainWindow.setOpacity(1);
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
    } catch {
      /* ignore */
    }
  } catch (error) {
    console.error('syncGlassMaterial failed:', error);
  }
}

let frostCaptureBusy = false;

/**
 * Снимок рабочего стола под окном (запасной frost).
 * Без opacity=0: на части GPU DXGI после этого отдаёт пустой кадр.
 */
async function captureFrostBehind(): Promise<{ ok: boolean; dataUrl?: string }> {
  if (frostCaptureBusy || !mainWindow || mainWindow.isDestroyed() || isDragging) {
    return { ok: false };
  }
  frostCaptureBusy = true;
  try {
    const bounds = mainWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const scale = display.scaleFactor || 1;

    const maxEdge = 1280;
    const nativeW = Math.max(1, Math.round(display.size.width * scale));
    const nativeH = Math.max(1, Math.round(display.size.height * scale));
    const thumbScale = Math.min(1, maxEdge / Math.max(nativeW, nativeH));
    const thumbW = Math.max(1, Math.round(nativeW * thumbScale));
    const thumbH = Math.max(1, Math.round(nativeH * thumbScale));

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: thumbW, height: thumbH },
    });
    if (!sources.length) {
      console.error('captureFrostBehind: no sources');
      return { ok: false };
    }

    const displayId = String(display.id);
    let source =
      sources.find((s) => String(s.display_id) === displayId) || null;

    // Если display_id не совпал — берём кадр с похожим соотношением сторон
    if (!source) {
      const targetRatio = display.size.width / Math.max(1, display.size.height);
      let best = sources[0];
      let bestDiff = Number.POSITIVE_INFINITY;
      for (const s of sources) {
        if (s.thumbnail.isEmpty()) continue;
        const sz = s.thumbnail.getSize();
        const ratio = sz.width / Math.max(1, sz.height);
        const diff = Math.abs(ratio - targetRatio);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = s;
        }
      }
      source = best;
    }

    if (!source || source.thumbnail.isEmpty()) {
      console.error('captureFrostBehind: empty thumbnail');
      return { ok: false };
    }

    const full = source.thumbnail;
    const fullSize = full.getSize();
    const fx = fullSize.width / Math.max(1, display.size.width);
    const fy = fullSize.height / Math.max(1, display.size.height);

    const pad = 64;
    const captureX = Math.round((bounds.x - display.bounds.x - pad) * fx);
    const captureY = Math.round((bounds.y - display.bounds.y - pad) * fy);
    const captureW = Math.round((bounds.width + pad * 2) * fx);
    const captureH = Math.round((bounds.height + pad * 2) * fy);

    const x = Math.max(0, Math.min(captureX, fullSize.width - 1));
    const y = Math.max(0, Math.min(captureY, fullSize.height - 1));
    const w = Math.max(1, Math.min(captureW, fullSize.width - x));
    const h = Math.max(1, Math.min(captureH, fullSize.height - y));

    const cropped = full.crop({ x, y, width: w, height: h });
    const maxW = 360;
    const size = cropped.getSize();
    const resized =
      size.width > maxW
        ? cropped.resize({
            width: maxW,
            height: Math.max(1, Math.round((size.height * maxW) / size.width)),
            quality: 'good',
          })
        : cropped;

    const dataUrl = resized.toDataURL();
    if (!dataUrl || dataUrl.length < 64) {
      return { ok: false };
    }
    return { ok: true, dataUrl };
  } catch (error) {
    console.error('captureFrostBehind failed:', error);
    return { ok: false };
  } finally {
    frostCaptureBusy = false;
  }
}

/** Отступ: у закреплённого края 0 (notch flush), иначе парящая капсула */
function edgeMargin(edge: EdgeOrFree, side: Edge): number {
  if (edge === side) {
    return 0;
  }
  if (edge === 'free') {
    return 10;
  }
  return 0;
}

/** Целевой прямоугольник с якорем у края / центра */
function boundsAnchored(mode: IslandMode): Electron.Rectangle {
  const area = getDisplay().workArea;
  const start =
    mainWindow?.getBounds() ??
    ({
      x: area.x + Math.round(area.width / 2),
      y: area.y + 10,
      width: BASE.pill.width,
      height: BASE.pill.height,
    } as Electron.Rectangle);
  const topCenter = isNearTopCenter(start);
  const size = resolveSize(mode, currentEdge, compactView, topCenter);

  let next: Electron.Rectangle;
  if (currentEdge === 'top') {
    const cx = start.x + start.width / 2;
    next = {
      x: Math.round(cx - size.width / 2),
      y: area.y + edgeMargin(currentEdge, 'top'),
      width: size.width,
      height: size.height,
    };
  } else if (currentEdge === 'bottom') {
    const cx = start.x + start.width / 2;
    next = {
      x: Math.round(cx - size.width / 2),
      y:
        area.y +
        area.height -
        size.height -
        edgeMargin(currentEdge, 'bottom'),
      width: size.width,
      height: size.height,
    };
  } else if (currentEdge === 'left') {
    const cy = start.y + start.height / 2;
    next = {
      x: area.x + edgeMargin(currentEdge, 'left'),
      y: Math.round(cy - size.height / 2),
      width: size.width,
      height: size.height,
    };
  } else if (currentEdge === 'right') {
    const cy = start.y + start.height / 2;
    next = {
      x:
        area.x + area.width - size.width - edgeMargin(currentEdge, 'right'),
      y: Math.round(cy - size.height / 2),
      width: size.width,
      height: size.height,
    };
  } else {
    next = {
      x: Math.round(start.x + start.width / 2 - size.width / 2),
      y: Math.round(start.y + start.height / 2 - size.height / 2),
      width: size.width,
      height: size.height,
    };
  }

  return clampToWorkArea(next);
}

/** Мгновенная смена размера без морфа — стабильно на Windows */
function applyLayout(mode: IslandMode): void {
  if (!mainWindow) {
    return;
  }
  currentMode = mode;
  const target = boundsAnchored(mode);
  freeX = target.x;
  freeY = target.y;
  mainWindow.setBounds(target, false);
  emitEdge();
  syncGlassMaterial();
  // После setBounds клиентский rect мог обновиться — клип ещё раз
  if (compactView === 'glass') {
    setTimeout(() => syncGlassWindowRegion(), 0);
  }
}

/** Магнит только у края (кактус всегда свободен) */
function snapIfNearEdge(): void {
  if (!mainWindow) {
    return;
  }

  /** Кактус не прилипает к краям, иначе схлопывается */
  if (isMascotView(compactView)) {
    currentEdge = 'free';
    applyLayout(currentMode);
    writeState({});
    return;
  }

  const bounds = mainWindow.getBounds();
  const area = getDisplay().workArea;
  const distTop = bounds.y - area.y;
  const distBottom = area.y + area.height - (bounds.y + bounds.height);
  const distLeft = bounds.x - area.x;
  const distRight = area.x + area.width - (bounds.x + bounds.width);
  const minDist = Math.min(distTop, distBottom, distLeft, distRight);

  if (minDist > SNAP_THRESHOLD) {
    currentEdge = 'free';
    applyLayout(currentMode);
    writeState({});
    return;
  }

  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  let edge: Edge = 'top';
  let offset = 0;

  if (minDist === distTop) {
    edge = 'top';
    offset = Math.round(cx - (area.x + area.width / 2));
  } else if (minDist === distBottom) {
    edge = 'bottom';
    offset = Math.round(cx - (area.x + area.width / 2));
  } else if (minDist === distLeft) {
    edge = 'left';
    offset = Math.round(cy - (area.y + area.height / 2));
  } else {
    edge = 'right';
    offset = Math.round(cy - (area.y + area.height / 2));
  }

  currentEdge = edge;
  edgeOffset = offset;
  applyLayout(currentMode);
  writeState({});
}

/** Путь к иконке трея */
function getTrayIconPath(): string {
  const candidates = [
    path.join(__dirname, '../assets/icon.png'),
    path.join(__dirname, '../assets/icon.ico'),
    path.join(process.cwd(), 'assets/icon.png'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return '';
}

/** Показывает и фокусирует остров */
function showIsland(): void {
  try {
    if (!mainWindow) {
      createWindow();
      return;
    }
    // На случай «невидимого» региона после glass
    try {
      syncGlassWindowRegion();
    } catch {
      /* ignore */
    }
    try {
      mainWindow.setOpacity(1);
    } catch {
      /* ignore */
    }
    const primary = screen.getPrimaryDisplay().workArea;
    currentEdge = 'top';
    edgeOffset = 0;
    freeX = primary.x + Math.round(primary.width / 2) - 36;
    freeY = primary.y;
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.moveTop();
    applyLayout(currentMode === 'collapsed' ? 'peek' : currentMode);
    mainWindow.focus();
  } catch (error) {
    console.error('showIsland failed:', error);
  }
}

/** Перезапуск: у упакованного приложения через relaunch, иначе через silent-лаунчер */
function restartIsland(): void {
  try {
    pauseActivityForSystemEvent('quit');
    writeState({});

    if (app.isPackaged) {
      app.relaunch();
    } else {
      const candidates = [
        path.join(process.cwd(), 'start-island.vbs'),
        path.join(__dirname, '../start-island.vbs'),
        path.join(process.cwd(), 'scripts', 'start-island-silent.ps1'),
      ];
      const launcher = candidates.find((p) => fs.existsSync(p));

      if (launcher?.endsWith('.vbs')) {
        const child = spawn('wscript.exe', [launcher], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        child.unref();
      } else if (launcher?.endsWith('.ps1')) {
        const child = spawn(
          'powershell.exe',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', launcher],
          {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
          },
        );
        child.unref();
      } else {
        app.relaunch();
      }
    }

    isQuitting = true;
    quitPrepared = true;
    setTimeout(() => {
      try {
        app.exit(0);
      } catch (err) {
        console.error(err);
      }
    }, 250);
  } catch (error) {
    console.error('restartIsland failed:', error);
    try {
      app.relaunch();
      app.exit(0);
    } catch (err) {
      console.error(err);
    }
  }
}

/** Иконка в системном трее (шторка уведомлений) */
function createTray(): void {
  try {
    if (tray) {
      return;
    }

    const iconPath = getTrayIconPath();
    let image = iconPath
      ? nativeImage.createFromPath(iconPath)
      : nativeImage.createEmpty();
    if (image.isEmpty()) {
      // запасная жёлтая точка 16x16
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYGD4z0ABYBzVMKoBBgQYGRgY/qOJM+JSMzo0RjWMahiNBhgAADeWAwF3n6+qAAAAAElFTkSuQmCC',
        'base64',
      );
      image = nativeImage.createFromBuffer(png);
    }
    if (process.platform === 'win32') {
      image = image.resize({ width: 16, height: 16 });
    }

    tray = new Tray(image);
    tray.setToolTip('Island');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: 'Показать Island',
          click: () => showIsland(),
        },
        {
          label: 'Открыть Задачник',
          click: async () => {
            try {
              const filePath = await ensureWorkbookExists();
              await shell.openPath(filePath);
            } catch (error) {
              console.error(error);
            }
          },
        },
        {
          label: 'Перезапуск',
          click: () => restartIsland(),
        },
        { type: 'separator' },
        {
          label: 'Выход',
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ]),
    );
    tray.on('click', () => showIsland());
    tray.on('double-click', () => showIsland());
  } catch (error) {
    console.error('createTray failed:', error);
  }
}

/** Создаёт главное окно */
function createWindow(): void {
  const saved = readState();
  const primary = screen.getPrimaryDisplay().workArea;

  if (saved?.window) {
    compactView = normalizeCompactView(saved.window.compactView);
    sizeScale = clamp(
      saved.window.sizeScale ?? 1,
      SIZE_SCALE_MIN,
      SIZE_SCALE_MAX,
    );
  }

  /** Холодный старт: всегда капсула у верхнего центра, иначе легко «потерять» остров */
  currentEdge = 'top';
  edgeOffset = 0;
  if (isMascotView(compactView)) {
    compactView = 'info';
  }
  freeX = primary.x + Math.round(primary.width / 2) - 36;
  freeY = primary.y;

  const initial = clampToWorkArea({
    x: freeX,
    y: freeY,
    ...resolveSize('collapsed', currentEdge, compactView, true),
  });

  mainWindow = new BrowserWindow({
    width: initial.width,
    height: initial.height,
    x: initial.x,
    y: initial.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    thickFrame: false,
    // false: форма только CSS-капсула, без второго DWM-контура
    roundedCorners: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setMenuBarVisibility(false);
  // Иначе Windows раздувает крошечное окно → «полка» снизу у glass
  try {
    mainWindow.setMinimumSize(1, 1);
  } catch (error) {
    console.error('setMinimumSize failed:', error);
  }

  // Держим клип капсулы после move/resize (DWM/Electron могут сбросить регион)
  mainWindow.on('move', () => {
    if (compactView === 'glass') {
      syncGlassWindowRegion();
    }
  });
  mainWindow.on('resize', () => {
    if (compactView === 'glass') {
      syncGlassWindowRegion();
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    try {
      currentEdge = 'top';
      edgeOffset = 0;
      if (isMascotView(compactView)) {
        compactView = 'info';
      }
      // Снять возможный «пустой» регион от прошлых экспериментов
      syncGlassWindowRegion();
      applyZoomFactor();
      applyLayout('peek');
      mainWindow?.setOpacity(1);
      mainWindow?.show();
      mainWindow?.setAlwaysOnTop(true, 'screen-saver');
      mainWindow?.moveTop();
      writeState({});
    } catch (error) {
      console.error('ready-to-show failed:', error);
    }
  });

  /** Если ready-to-show не сработал — всё равно показываем окно */
  setTimeout(() => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        syncGlassWindowRegion();
        mainWindow.setOpacity(1);
        if (!mainWindow.isVisible()) {
          mainWindow.show();
        }
        applyLayout('peek');
        mainWindow.moveTop();
      }
    } catch (error) {
      console.error('fallback show failed:', error);
    }
  }, 800);

  mainWindow.webContents.on('did-finish-load', () => {
    applyZoomFactor();
    emitEdge();
    try {
      if (mainWindow && !mainWindow.isVisible()) {
        mainWindow.show();
      }
    } catch (error) {
      console.error(error);
    }
  });

  mainWindow.on('blur', () => {
    try {
      if (currentMode === 'expanded' || currentMode === 'peek') {
        mainWindow?.webContents.send('island:collapse');
      }
    } catch (error) {
      console.error('blur collapse failed:', error);
    }
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.commandLine.appendSwitch('enable-transparent-visuals');

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) {
    return;
  }

  createTray();
  createWindow();
  startClipboardWatch();
  startScreenshotWatch();
  setClipboardChangeHandler((items) => {
    try {
      mainWindow?.webContents.send('island:clipboard-changed', items);
    } catch (error) {
      console.error(error);
    }
  });
  setScreenshotChangeHandler((items) => {
    try {
      mainWindow?.webContents.send('island:screenshots-changed', items);
    } catch (error) {
      console.error(error);
    }
  });

  /** Сон, выключение, завершение сеанса Windows / выход из учётки */
  try {
    powerMonitor.on('suspend', () => pauseActivityForSystemEvent('suspend'));
    powerMonitor.on('resume', () => syncStateAfterResume());
    powerMonitor.on('shutdown', () => pauseActivityForSystemEvent('shutdown'));
  } catch (error) {
    console.error('powerMonitor bind failed:', error);
  }

  // Windows: завершение сеанса (типов Electron может не быть в текущей версии)
  (app as NodeJS.EventEmitter).on('session-end', () => {
    pauseActivityForSystemEvent('session-end');
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      showIsland();
    }
  });
});

app.on('before-quit', (event) => {
  if (quitPrepared) {
    isQuitting = true;
    pauseActivityForSystemEvent('quit');
    stopClipboardWatch();
    stopScreenshotWatch();
    return;
  }

  /** Сначала сбрасываем память рендерера на диск, потом гасим таймеры */
  event.preventDefault();
  isQuitting = true;

  const finishQuit = () => {
    if (quitPrepared) {
      return;
    }
    quitPrepared = true;
    pauseActivityForSystemEvent('quit');
    stopClipboardWatch();
    stopScreenshotWatch();
    app.quit();
  };

  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      finishQuit();
      return;
    }
    const timeout = setTimeout(() => {
      try {
        ipcMain.removeListener('island:state-flushed', onFlushed);
      } catch {
        /* ignore */
      }
      finishQuit();
    }, 500);
    const onFlushed = () => {
      clearTimeout(timeout);
      finishQuit();
    };
    ipcMain.once('island:state-flushed', onFlushed);
    mainWindow.webContents.send('island:flush-state');
  } catch (error) {
    console.error('before-quit flush failed:', error);
    finishQuit();
  }
});

app.on('window-all-closed', () => {
  // На Windows оставляем процесс в трее
  if (process.platform === 'darwin') {
    app.quit();
  }
});

ipcMain.handle('island:set-mode', (_event, mode: IslandMode) => {
  try {
    if (!mainWindow || !['collapsed', 'peek', 'expanded'].includes(mode)) {
      return { ok: false };
    }
    applyLayout(mode);
    if (mode === 'expanded') {
      mainWindow.focus();
    }
    return { ok: true, mode, edge: currentEdge, compactView };
  } catch (error) {
    console.error('set-mode failed:', error);
    return { ok: false };
  }
});

ipcMain.handle('island:set-compact-view', (_event, view: CompactView) => {
  try {
    if (!['info', 'timer', 'minimal', 'glass', 'cactus', 'moon'].includes(view)) {
      return { ok: false };
    }
    compactView = normalizeCompactView(view);
    /** Маски живут только в свободном полёте */
    if (isMascotView(view)) {
      currentEdge = 'free';
    }
    applyZoomFactor();
    if (currentMode !== 'expanded') {
      applyLayout(currentMode === 'peek' ? 'peek' : 'collapsed');
    } else {
      applyLayout('expanded');
      emitEdge();
    }
    writeState({});
    syncGlassMaterial();
    return { ok: true, compactView, edge: currentEdge, sizeScale };
  } catch (error) {
    console.error('set-compact-view failed:', error);
    return { ok: false };
  }
});

/** Меняет масштаб острова (Ctrl + колесо) */
ipcMain.handle('island:adjust-size-scale', (_event, delta: number) => {
  try {
    const step =
      typeof delta === 'number' && Number.isFinite(delta)
        ? delta
        : SIZE_SCALE_STEP;
    const next = setSizeScale(sizeScale + step);
    return { ok: true, sizeScale: next };
  } catch (error) {
    console.error('adjust-size-scale failed:', error);
    return { ok: false };
  }
});

ipcMain.handle('island:set-size-scale', (_event, scale: number) => {
  try {
    if (typeof scale !== 'number' || !Number.isFinite(scale)) {
      return { ok: false };
    }
    const next = setSizeScale(scale);
    return { ok: true, sizeScale: next };
  } catch (error) {
    console.error('set-size-scale failed:', error);
    return { ok: false };
  }
});

ipcMain.handle('island:set-ignore-mouse', (_event, ignore: boolean) => {
  try {
    if (!mainWindow) {
      return { ok: false };
    }
    if (ignore) {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      mainWindow.setIgnoreMouseEvents(false);
    }
    return { ok: true };
  } catch (error) {
    console.error('set-ignore-mouse failed:', error);
    return { ok: false };
  }
});

ipcMain.handle('island:drag-start', () => {
  try {
    isDragging = true;
    syncGlassMaterial();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setOpacity(1);
    }
    return { ok: true };
  } catch (error) {
    console.error('drag-start failed:', error);
    isDragging = true;
    syncGlassMaterial();
    return { ok: true };
  }
});

/** Заглушка совместимости: fullscreen glass-stage отключён (ломал DPI/zoom) */
ipcMain.handle('island:glass-stage-ready', () => ({ ok: true }));

/** Фон под капсулой для CSS-blur frost (без Acrylic за границами) */
ipcMain.handle('island:capture-frost-behind', async () => {
  try {
    return await captureFrostBehind();
  } catch (error) {
    console.error('island:capture-frost-behind failed:', error);
    return { ok: false };
  }
});

ipcMain.handle('island:drag-end', () => {
  try {
    isDragging = false;
    try {
      mainWindow?.setOpacity(1);
    } catch {
      /* ignore */
    }
    snapIfNearEdge();
    syncGlassMaterial();
    return {
      ok: true,
      edge: currentEdge,
      offset: edgeOffset,
      glassStage: null,
    };
  } catch (error) {
    console.error('drag-end failed:', error);
    isDragging = false;
    syncGlassMaterial();
    try {
      mainWindow?.setOpacity(1);
    } catch {
      /* ignore */
    }
    return { ok: false, glassStage: null };
  }
});

ipcMain.handle('island:drag-move', (_event, dx: number, dy: number) => {
  try {
    if (!mainWindow) {
      return { ok: false };
    }
    const bounds = mainWindow.getBounds();
    const next = clampForDrag({
      x: Math.round(bounds.x + dx),
      y: Math.round(bounds.y + dy),
      width: bounds.width,
      height: bounds.height,
    });
    freeX = next.x;
    freeY = next.y;
    currentEdge = 'free';
    if (next.width === bounds.width && next.height === bounds.height) {
      mainWindow.setPosition(next.x, next.y, false);
    } else {
      mainWindow.setBounds(next, false);
    }
    return { ok: true };
  } catch (error) {
    console.error('drag-move failed:', error);
    return { ok: false };
  }
});

ipcMain.handle('island:load-state', () => {
  try {
    /** Если таймер остался «бегущим» после сна/краша — гасим по mtime файла */
    try {
      const statePath = getStatePath();
      if (fs.existsSync(statePath)) {
        const mtime = fs.statSync(statePath).mtimeMs;
        freezePersistedTimers(mtime);
      }
    } catch (freezeError) {
      console.error('load-state freeze failed:', freezeError);
    }
    return {
      ok: true,
      state: readState(),
      edge: currentEdge,
      compactView,
      sizeScale,
      workbookPath: getWorkbookPath(),
    };
  } catch (error) {
    console.error('load-state failed:', error);
    return { ok: false, state: null };
  }
});

ipcMain.handle(
  'island:save-state',
  (_event, payload: { tasks?: unknown; settings?: unknown }) => {
    try {
      writeState({
        tasks: payload.tasks,
        settings: payload.settings,
      });
      return { ok: true };
    } catch (error) {
      console.error('save-state failed:', error);
      return { ok: false };
    }
  },
);

/** Запись выполненной задачи в Excel «Задачник» */
ipcMain.handle(
  'island:log-completed-task',
  async (
    _event,
    payload: {
      title: string;
      elapsedMs: number;
      subtasks?: string[];
    },
  ) => {
    try {
      const result = await appendCompletedTask(payload);
      return result;
    } catch (error) {
      console.error('log-completed-task failed:', error);
      return { ok: false, error: String(error) };
    }
  },
);

/** Запись заметки в Excel «Задачник» */
ipcMain.handle(
  'island:log-note',
  async (_event, payload: { text: string }) => {
    try {
      const result = await appendNote(payload);
      return result;
    } catch (error) {
      console.error('log-note failed:', error);
      return { ok: false, error: String(error) };
    }
  },
);

ipcMain.handle('island:open-workbook', async () => {
  try {
    const filePath = await ensureWorkbookExists();
    await shell.openPath(filePath);
    return { ok: true, path: filePath };
  } catch (error) {
    console.error('open-workbook failed:', error);
    return { ok: false };
  }
});

ipcMain.handle('island:get-clipboard-history', () => {
  try {
    return { ok: true, items: getClipboardHistory() };
  } catch (error) {
    console.error(error);
    return { ok: false, items: [] };
  }
});

ipcMain.handle('island:clear-clipboard-history', () => {
  try {
    clearClipboardHistory();
    return { ok: true };
  } catch (error) {
    console.error(error);
    return { ok: false };
  }
});

ipcMain.handle('island:copy-clipboard-item', (_event, id: string) => {
  try {
    const item = getClipboardHistory().find((entry) => entry.id === id);
    if (!item) {
      return { ok: false };
    }
    writeClipboardSilent(item.text);
    return { ok: true };
  } catch (error) {
    console.error(error);
    return { ok: false };
  }
});

/** Вставляет элемент буфера в окно под Island */
ipcMain.handle('island:paste-clipboard-item', async (_event, id: string) => {
  try {
    const item = getClipboardHistory().find((entry) => entry.id === id);
    if (!item || !mainWindow) {
      return { ok: false };
    }

    currentMode = 'collapsed';
    applyLayout('collapsed');
    mainWindow.hide();

    const result = await pasteClipboardText(item.text);

    // чуть подождать после SendKeys, затем вернуть остров свёрнутым
    await new Promise((resolve) => setTimeout(resolve, 180));
    if (!isQuitting) {
      mainWindow.show();
      applyLayout('collapsed');
      mainWindow.webContents.send('island:collapse');
    }
    return result;
  } catch (error) {
    console.error('paste-clipboard-item failed:', error);
    try {
      mainWindow?.show();
    } catch {
      /* ignore */
    }
    return { ok: false };
  }
});

ipcMain.handle('island:get-quick-paths', () => {
  try {
    return { ok: true, items: getSystemQuickPaths() };
  } catch (error) {
    console.error('get-quick-paths failed:', error);
    return { ok: false, items: [] };
  }
});

ipcMain.handle('island:copy-text', (_event, text: string) => {
  try {
    if (typeof text !== 'string' || !text) {
      return { ok: false };
    }
    writeClipboardSilent(text);
    return { ok: true };
  } catch (error) {
    console.error('copy-text failed:', error);
    return { ok: false };
  }
});

ipcMain.handle('island:list-screenshots', () => {
  try {
    return { ok: true, items: listScreenshots() };
  } catch (error) {
    console.error('list-screenshots failed:', error);
    return { ok: false, items: [] };
  }
});

ipcMain.handle('island:delete-screenshot', (_event, id: string) => {
  try {
    return { ok: deleteScreenshot(id) };
  } catch (error) {
    console.error('delete-screenshot failed:', error);
    return { ok: false };
  }
});

ipcMain.handle(
  'island:reorder-screenshots',
  (_event, orderedIds: string[]) => {
    try {
      if (!Array.isArray(orderedIds)) {
        return { ok: false };
      }
      return { ok: reorderScreenshots(orderedIds) };
    } catch (error) {
      console.error('reorder-screenshots failed:', error);
      return { ok: false };
    }
  },
);

ipcMain.handle('island:get-screenshot-data', (_event, id: string) => {
  try {
    const dataUrl = getScreenshotDataUrl(id);
    return { ok: Boolean(dataUrl), dataUrl };
  } catch (error) {
    console.error('get-screenshot-data failed:', error);
    return { ok: false, dataUrl: null };
  }
});

ipcMain.handle('island:copy-screenshot', (_event, id: string) => {
  try {
    return { ok: copyScreenshotToClipboard(id) };
  } catch (error) {
    console.error('copy-screenshot failed:', error);
    return { ok: false };
  }
});

/**
 * Нативный drag файла скрина в другие окна (Telegram, Проводник, Word…).
 * Вызывается из renderer dragstart с preventDefault.
 */
ipcMain.on('island:drag-screenshot', (event, id: string) => {
  try {
    if (typeof id !== 'string' || !id) {
      return;
    }
    const filePath = getScreenshotFilePath(id);
    if (!filePath) {
      return;
    }
    copyScreenshotToClipboard(id);
    const icon = nativeImage.createFromPath(filePath);
    const dragIcon = icon.isEmpty()
      ? nativeImage.createEmpty()
      : icon.resize({ width: 64, height: 64, quality: 'better' });
    event.sender.startDrag({
      file: filePath,
      icon: dragIcon,
    });
  } catch (error) {
    console.error('drag-screenshot failed:', error);
  }
});

ipcMain.handle('island:quit', () => {
  try {
    isQuitting = true;
    app.quit();
    return { ok: true };
  } catch (error) {
    console.error('quit failed:', error);
    return { ok: false };
  }
});
