/** Подзадача внутри задачи */
export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

/** Категория задачи для карты (цвет пятна) */
export type TaskCategory = 'work' | 'personal' | 'thesis';

/** Сложность 1..5 → сколько пикселей займёт на дневной мозаике */
export type TaskWeight = 1 | 2 | 3 | 4 | 5;

/** Один «мазок» на дневном холсте после закрытия задачи */
export interface DayStroke {
  id: string;
  taskId: string;
  title: string;
  category: TaskCategory;
  weight: TaskWeight;
  /** Сколько клеток сетки закрашено */
  pixels: number;
  at: number;
}

/** Активность одного дня на карте эффективности */
export interface DayActivity {
  focusMs: number;
  doneCount: number;
  strokes: DayStroke[];
}

/** Задача с секундомером и опциональными подзадачами */
export interface Task {
  id: string;
  title: string;
  done: boolean;
  elapsedMs: number;
  /** Момент старта секундомера, если он бежит */
  runningSince: number | null;
  subtasks: Subtask[];
  category: TaskCategory;
  weight: TaskWeight;
}

/** Состояние списка задач */
export interface TasksState {
  tasks: Task[];
  activeTaskId: string | null;
  /** Карта эффективности по дням (YYYY-MM-DD) */
  activityByDay: Record<string, DayActivity>;
}

/** Настройки Pomodoro и приложения */
export interface AppSettings {
  focusMinutes: number;
  breakMinutes: number;
  pomodoroPhase: 'idle' | 'focus' | 'break';
  pomodoroRemainingMs: number;
  pomodoroRunning: boolean;
  pomodoroTickAt: number | null;
}

export const defaultSettings: AppSettings = {
  focusMinutes: 25,
  breakMinutes: 5,
  pomodoroPhase: 'idle',
  pomodoroRemainingMs: 25 * 60 * 1000,
  pomodoroRunning: false,
  pomodoroTickAt: null,
};

export const defaultTasksState: TasksState = {
  tasks: [],
  activeTaskId: null,
  activityByDay: {},
};

/**
 * Радиус гекс-карты дня (кольца от центра).
 * R=14 → 631 клеток, на экране ~180px.
 */
export const DAY_HEX_RADIUS = 14;

/** Радиус мини-превью в клетке календаря */
export const PREVIEW_HEX_RADIUS = 3;

/** Число клеток в гекс-карте радиуса R: 3R(R+1)+1 */
export function hexCellCount(radius: number): number {
  return 3 * radius * (radius + 1) + 1;
}

/** Клетки мозаики по сложности (площадь пятна на карте) */
export const PIXELS_BY_WEIGHT: Record<TaskWeight, number> = {
  1: 9,
  2: 16,
  3: 36,
  4: 64,
  5: 100,
};

/** Цвета категорий: работа чёрная на светло-сером поле, диссертация темнее */
export const CATEGORY_COLORS: Record<TaskCategory, string> = {
  work: '#141416',
  personal: '#ff9f0a',
  thesis: '#1a6b38',
};

/** Фон пустых гексов — как hover у tiny-btn */
export const HEX_FIELD_EMPTY = 'rgba(255, 255, 255, 0.14)';

/** Одна клетка гекс-карты после раскладки мазков */
export interface HexPaintCell {
  q: number;
  r: number;
  color: string | null;
}

export const CATEGORY_LABELS: Record<TaskCategory, string> = {
  work: 'Работа',
  personal: 'Личное',
  thesis: 'Диссертация',
};

export const CATEGORY_ORDER: TaskCategory[] = ['work', 'personal', 'thesis'];

/** Ключ дня для карты эффективности */
export function dayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Генерирует короткий id */
export function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Актуальное накопленное время задачи с учётом текущего забега */
export function getTaskElapsedMs(task: Task, now = Date.now()): number {
  if (task.runningSince == null) {
    return task.elapsedMs;
  }
  return task.elapsedMs + (now - task.runningSince);
}

/** Оценка сложности по потраченному времени (если вес не задавали руками) */
export function weightFromElapsed(ms: number): TaskWeight {
  const min = ms / 60000;
  if (min < 15) return 1;
  if (min < 40) return 2;
  if (min < 90) return 3;
  if (min < 180) return 4;
  return 5;
}

/** Нормализует задачу из старых сохранений */
export function normalizeTask(raw: Partial<Task> & { id: string; title: string }): Task {
  const weight = ([1, 2, 3, 4, 5] as TaskWeight[]).includes(
    raw.weight as TaskWeight,
  )
    ? (raw.weight as TaskWeight)
    : 2;
  const category = CATEGORY_ORDER.includes(raw.category as TaskCategory)
    ? (raw.category as TaskCategory)
    : 'work';
  return {
    id: raw.id,
    title: raw.title,
    done: Boolean(raw.done),
    elapsedMs: typeof raw.elapsedMs === 'number' ? raw.elapsedMs : 0,
    runningSince:
      typeof raw.runningSince === 'number' ? raw.runningSince : null,
    subtasks: Array.isArray(raw.subtasks) ? raw.subtasks : [],
    category,
    weight,
  };
}

/** Форматирует миллисекунды как mm:ss или h:mm:ss */
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Расстояние в кубических координатах гекса от (0,0) */
function hexDist(q: number, r: number): number {
  const s = -q - r;
  return (Math.abs(q) + Math.abs(r) + Math.abs(s)) / 2;
}

/** Соседи axial-гекса */
const HEX_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

function hexKey(q: number, r: number): string {
  return `${q},${r}`;
}

function parseHexKey(key: string): { q: number; r: number } {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

/** Все клетки радиуса (для перечисления / рендера) */
function listHexCells(radius: number): { q: number; r: number }[] {
  const cells: { q: number; r: number }[] = [];
  for (let q = -radius; q <= radius; q += 1) {
    for (let r = -radius; r <= radius; r += 1) {
      if (hexDist(q, r) <= radius) {
        cells.push({ q, r });
      }
    }
  }
  return cells;
}

const hexCellsCache = new Map<number, { q: number; r: number }[]>();

function hexCells(radius: number): { q: number; r: number }[] {
  let list = hexCellsCache.get(radius);
  if (!list) {
    list = listHexCells(radius);
    hexCellsCache.set(radius, list);
  }
  return list;
}

/** Детерминированный PRNG от строки (один и тот же мазок → та же форма) */
function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Раскладывает мазки по гекс-карте «диким» природным ростом:
 * несколько кластеров, прыжки, единичные точки-спекли, слабый центр.
 */
export function paintDayHexMap(
  strokes: DayStroke[],
  radius = DAY_HEX_RADIUS,
): HexPaintCell[] {
  const all = hexCells(radius);
  const inBounds = new Set(all.map((c) => hexKey(c.q, c.r)));
  const colorByKey = new Map<string, string | null>();
  for (const key of inBounds) {
    colorByKey.set(key, null);
  }
  const filled = new Set<string>();

  const neighborsOf = (q: number, r: number): [number, number][] => {
    const out: [number, number][] = [];
    for (const [dq, dr] of HEX_DIRS) {
      const nq = q + dq;
      const nr = r + dr;
      if (inBounds.has(hexKey(nq, nr))) {
        out.push([nq, nr]);
      }
    }
    return out;
  };

  const freeKeys = (): string[] =>
    [...inBounds].filter((k) => !filled.has(k));

  /** Случайная свободная клетка: лёгкий уклон к центру + сильный шум */
  const pickScattered = (rng: () => number, nearKeys?: string[]): string | null => {
    const free = freeKeys();
    if (free.length === 0) return null;

    // Иногда вообще случайная точка на карте
    if (rng() < 0.32 || !nearKeys?.length) {
      let best = free[0];
      let bestScore = -Infinity;
      const sample = Math.min(free.length, 28 + Math.floor(rng() * 40));
      for (let s = 0; s < sample; s += 1) {
        const k = free[Math.floor(rng() * free.length)];
        const { q, r } = parseHexKey(k);
        const score = rng() * 5.5 - hexDist(q, r) * 0.12;
        if (score > bestScore) {
          bestScore = score;
          best = k;
        }
      }
      return best;
    }

    // Спекл рядом с уже своим пятном, но не обязательно сосед (зазор 1–5)
    let best = free[0];
    let bestScore = -Infinity;
    const sample = Math.min(free.length, 36);
    for (let s = 0; s < sample; s += 1) {
      const k = free[Math.floor(rng() * free.length)];
      const { q, r } = parseHexKey(k);
      let minD = Infinity;
      for (const nk of nearKeys) {
        const p = parseHexKey(nk);
        const d = hexDist(q - p.q, r - p.r);
        if (d < minD) minD = d;
      }
      // Любим расстояние 1–4, одиночки на 3–6 тоже ок
      const ring =
        minD <= 1 ? 0.4 : minD <= 4 ? 2.8 : minD <= 7 ? 1.6 : 0.2;
      const score = ring + rng() * 4.2 - hexDist(q, r) * 0.08;
      if (score > bestScore) {
        bestScore = score;
        best = k;
      }
    }
    return best;
  };

  const paintCell = (key: string, color: string) => {
    filled.add(key);
    colorByKey.set(key, color);
  };

  /** Соседи множества клеток, ещё свободные */
  const localFrontier = (keys: Set<string>): string[] => {
    const fr = new Set<string>();
    for (const key of keys) {
      const { q, r } = parseHexKey(key);
      for (const [nq, nr] of neighborsOf(q, r)) {
        const nk = hexKey(nq, nr);
        if (!filled.has(nk)) fr.add(nk);
      }
    }
    return [...fr];
  };

  try {
    for (const stroke of strokes) {
      if (filled.size >= inBounds.size) break;
      const rng = mulberry32(hashSeed(`${stroke.id}:${stroke.at}`));
      const color = CATEGORY_COLORS[stroke.category] ?? CATEGORY_COLORS.work;
      let remaining = Math.min(
        stroke.pixels || PIXELS_BY_WEIGHT[stroke.weight] || 9,
        inBounds.size - filled.size,
      );
      if (remaining <= 0) break;

      // Несколько островков / спеклей вместо одного комка
      const maxClusters = Math.min(
        remaining,
        1 + Math.floor(rng() * (1 + Math.min(7, Math.ceil(remaining / 3)))),
      );
      const shares: number[] = [];
      let left = remaining;
      for (let c = 0; c < maxClusters; c += 1) {
        if (c === maxClusters - 1) {
          shares.push(left);
          break;
        }
        // Часто единичная точка или крошечный кусок
        const cap = Math.max(1, left - (maxClusters - c - 1));
        let take = 1;
        if (rng() < 0.45 && cap > 1) {
          take = 1 + Math.floor(rng() * Math.min(4, cap));
        } else if (rng() < 0.55) {
          take = Math.max(1, Math.floor(left / (maxClusters - c) + rng() * 3));
          take = Math.min(take, cap);
        }
        shares.push(take);
        left -= take;
      }

      const strokeKeys = new Set<string>();

      for (const share of shares) {
        if (filled.size >= inBounds.size) break;
        let budget = Math.min(share, inBounds.size - filled.size);
        if (budget <= 0) break;

        // Стартовая точка кластера: прыжок / рядом / почти случайно
        const seedRoll = rng();
        let seed: string | null = null;
        if (seedRoll < 0.38 || strokeKeys.size === 0) {
          seed = pickScattered(rng, undefined);
        } else if (seedRoll < 0.72) {
          seed = pickScattered(rng, [...strokeKeys]);
        } else {
          const fr = localFrontier(strokeKeys);
          seed =
            fr.length > 0
              ? fr[Math.floor(rng() * fr.length)]
              : pickScattered(rng, [...strokeKeys]);
        }
        if (!seed) break;

        paintCell(seed, color);
        strokeKeys.add(seed);
        budget -= 1;

        const cluster = new Set<string>([seed]);

        while (budget > 0 && filled.size < inBounds.size) {
          const roll = rng();

          // Единичная точка в стороне
          if (roll < 0.3) {
            const speck = pickScattered(rng, [...cluster, ...strokeKeys]);
            if (!speck) break;
            paintCell(speck, color);
            strokeKeys.add(speck);
            cluster.add(speck);
            budget -= 1;
            continue;
          }

          // Иногда вообще новая одиночка далеко
          if (roll < 0.42) {
            const far = pickScattered(rng, undefined);
            if (!far) break;
            paintCell(far, color);
            strokeKeys.add(far);
            cluster.add(far);
            budget -= 1;
            continue;
          }

          // Рост по соседям, но почти случайный выбор на фронтире
          let fr = localFrontier(cluster);
          if (fr.length === 0) {
            fr = localFrontier(strokeKeys);
          }
          if (fr.length === 0) {
            const speck = pickScattered(rng, [...strokeKeys]);
            if (!speck) break;
            paintCell(speck, color);
            strokeKeys.add(speck);
            cluster.add(speck);
            budget -= 1;
            continue;
          }

          let pickIdx = Math.floor(rng() * fr.length);
          // Слабое прилипание — иногда чуть предпочитаем «дыры» с 2+ соседями
          if (rng() < 0.35) {
            let best = -Infinity;
            for (let i = 0; i < fr.length; i += 1) {
              const { q, r } = parseHexKey(fr[i]);
              let glued = 0;
              for (const [nq, nr] of neighborsOf(q, r)) {
                if (cluster.has(hexKey(nq, nr)) || filled.has(hexKey(nq, nr))) {
                  glued += 1;
                }
              }
              const score = glued * 0.55 + rng() * 3.8;
              if (score > best) {
                best = score;
                pickIdx = i;
              }
            }
          }

          const chosen = fr[pickIdx];
          paintCell(chosen, color);
          strokeKeys.add(chosen);
          cluster.add(chosen);
          budget -= 1;
        }
      }
    }
  } catch (err) {
    console.error(err);
  }

  return all.map(({ q, r }) => ({
    q,
    r,
    color: colorByKey.get(hexKey(q, r)) ?? null,
  }));
}

/**
 * Пиксельная позиция центра гекса (pointy-top) относительно (0,0).
 * size — «радиус» гекса до вершины.
 */
export function hexPixelCenter(
  q: number,
  r: number,
  size: number,
): { x: number; y: number } {
  return {
    x: size * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r),
    y: size * ((3 / 2) * r),
  };
}
