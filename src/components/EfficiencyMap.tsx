import { useMemo, useState } from 'react';
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  DayActivity,
  dayKey,
  DAY_HEX_RADIUS,
  formatDuration,
  hexCellCount,
  HEX_FIELD_EMPTY,
  hexPixelCenter,
  HexPaintCell,
  paintDayHexMap,
  PIXELS_BY_WEIGHT,
  PREVIEW_HEX_RADIUS,
  TaskCategory,
} from '../store/types';

interface EfficiencyMapProps {
  activityByDay: Record<string, DayActivity>;
  onRemoveStroke: (dayKeyValue: string, strokeId: string) => void;
}

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const MONTHS = [
  'янв',
  'фев',
  'мар',
  'апр',
  'май',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
];

function levelFromMs(ms: number): number {
  const min = ms / 60000;
  if (min <= 0) return 0;
  if (min < 15) return 1;
  if (min < 45) return 2;
  if (min < 90) return 3;
  return 4;
}

function startOfWeekMonday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}

interface DayCell {
  key: string;
  dayNum: number;
  inMonth: boolean;
  isToday: boolean;
  focusMs: number;
  doneCount: number;
  level: number;
  preview: HexPaintCell[];
}

function buildMonthGrid(
  year: number,
  month: number,
  activityByDay: EfficiencyMapProps['activityByDay'],
  todayKey: string,
): DayCell[] {
  const first = new Date(year, month, 1);
  const gridStart = startOfWeekMonday(first);
  const cells: DayCell[] = [];

  for (let i = 0; i < 42; i += 1) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + i);
    const key = dayKey(date);
    const entry = activityByDay[key] ?? {
      focusMs: 0,
      doneCount: 0,
      strokes: [],
    };
    const inMonth = date.getMonth() === month;
    const strokes = Array.isArray(entry.strokes) ? entry.strokes : [];
    cells.push({
      key,
      dayNum: date.getDate(),
      inMonth,
      isToday: key === todayKey,
      focusMs: entry.focusMs,
      doneCount: entry.doneCount,
      level: inMonth ? levelFromMs(entry.focusMs) : 0,
      preview: inMonth ? paintDayHexMap(strokes, PREVIEW_HEX_RADIUS) : [],
    });
  }

  const lastWeek = cells.slice(35);
  if (lastWeek.every((c) => !c.inMonth)) {
    return cells.slice(0, 35);
  }
  return cells;
}

/**
 * Гекс-поле: клетки от центра к краям, pointy-top.
 * Пустые скрываем (showEmpty=false), чтобы не было сетки границ.
 */
function HexField({
  cells,
  radius,
  className,
  showEmpty = true,
}: {
  cells: HexPaintCell[];
  radius: number;
  className?: string;
  showEmpty?: boolean;
}) {
  const layout = useMemo(() => {
    try {
      // size подгоняем под квадрат 100×100 логических единиц
      const size = 50 / (radius * 1.5 + 1);
      const hexW = Math.sqrt(3) * size;
      const hexH = 2 * size;
      const placed = cells.map((cell) => {
        const { x, y } = hexPixelCenter(cell.q, cell.r, size);
        return { ...cell, x, y };
      });
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of placed) {
        minX = Math.min(minX, p.x - hexW / 2);
        maxX = Math.max(maxX, p.x + hexW / 2);
        minY = Math.min(minY, p.y - hexH / 2);
        maxY = Math.max(maxY, p.y + hexH / 2);
      }
      const pad = 1;
      const width = maxX - minX + pad * 2;
      const height = maxY - minY + pad * 2;
      return {
        hexW,
        hexH,
        width,
        height,
        items: placed.map((p) => ({
          q: p.q,
          r: p.r,
          color: p.color,
          left: ((p.x - hexW / 2 - minX + pad) / width) * 100,
          top: ((p.y - hexH / 2 - minY + pad) / height) * 100,
          w: (hexW / width) * 100,
          h: (hexH / height) * 100,
        })),
      };
    } catch (err) {
      console.error(err);
      return { hexW: 0, hexH: 0, width: 1, height: 1, items: [] };
    }
  }, [cells, radius]);

  if (!layout.items.length) return null;

  return (
    <div
      className={['map-hex-field', className].filter(Boolean).join(' ')}
      style={{ aspectRatio: `${layout.width} / ${layout.height}` }}
      aria-hidden={className?.includes('preview') ? true : undefined}
    >
      {layout.items.map((item) => {
        if (!item.color && !showEmpty) return null;
        return (
          <span
            key={`${item.q},${item.r}`}
            className={
              item.color ? 'map-hex' : 'map-hex map-hex--empty'
            }
            style={{
              left: `${item.left}%`,
              top: `${item.top}%`,
              width: `${item.w}%`,
              height: `${item.h}%`,
              background: item.color || HEX_FIELD_EMPTY,
            }}
          />
        );
      })}
    </div>
  );
}

/** Мини-превью гекс-карты в клетке календаря */
function DayPreview({ cells }: { cells: HexPaintCell[] }) {
  if (!cells.length || cells.every((c) => c.color == null)) {
    return null;
  }
  return (
    <HexField
      cells={cells}
      radius={PREVIEW_HEX_RADIUS}
      className="map-day-preview-hex"
      showEmpty={false}
    />
  );
}

/** Холст выбранного дня: гекс-карта от центра */
function DayCanvas({
  dayKeyValue,
  activity,
  onClose,
  onRemoveStroke,
}: {
  dayKeyValue: string;
  activity: DayActivity;
  onClose: () => void;
  onRemoveStroke: (strokeId: string) => void;
}) {
  const cells = useMemo(
    () => paintDayHexMap(activity.strokes ?? [], DAY_HEX_RADIUS),
    [activity.strokes],
  );
  const filled = cells.filter((c) => c.color).length;
  const total = hexCellCount(DAY_HEX_RADIUS);
  const byCat = useMemo(() => {
    const map: Record<TaskCategory, number> = {
      work: 0,
      personal: 0,
      thesis: 0,
    };
    for (const s of activity.strokes ?? []) {
      map[s.category] = (map[s.category] ?? 0) + s.pixels;
    }
    return map;
  }, [activity.strokes]);

  return (
    <div className="map-day-board">
      <div className="map-day-board-head">
        <div>
          <div className="map-day-board-title">{dayKeyValue}</div>
          <div className="map-day-board-sub">
            {activity.doneCount} задач · {formatDuration(activity.focusMs)} ·{' '}
            {filled}/{total} hex
          </div>
        </div>
        <button type="button" className="tiny-btn" onClick={onClose}>
          ←
        </button>
      </div>

      <HexField
        cells={cells}
        radius={DAY_HEX_RADIUS}
        className="map-hex-field--board"
        showEmpty={false}
      />

      <div className="map-legend">
        {(Object.keys(CATEGORY_LABELS) as TaskCategory[]).map((cat) => (
          <span key={cat} className="map-legend-item">
            <i style={{ background: CATEGORY_COLORS[cat] }} />
            {CATEGORY_LABELS[cat]} · {byCat[cat]}px
          </span>
        ))}
      </div>

      <ul className="map-stroke-list">
        {(activity.strokes ?? []).length === 0 && (
          <li className="map-stroke-empty">
            Пока пусто. Закрой задачу с категорией и сложностью — появится пятно
            от центра.
          </li>
        )}
        {(activity.strokes ?? []).map((s) => (
          <li key={s.id}>
            <i style={{ background: CATEGORY_COLORS[s.category] }} />
            <span className="map-stroke-title">{s.title}</span>
            <span className="map-stroke-meta">
              ×{s.weight} · {s.pixels || PIXELS_BY_WEIGHT[s.weight]}px
            </span>
            <button
              type="button"
              className="tiny-btn map-stroke-del"
              aria-label={`Удалить с карты: ${s.title}`}
              title="Убрать с карты"
              onClick={() => {
                try {
                  onRemoveStroke(s.id);
                } catch (err) {
                  console.error(err);
                }
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Карта эффективности: календарь + клик по дню открывает гекс-мозаику.
 * Цвет = категория, площадь = сложность; заливка органически от центра.
 */
export function EfficiencyMap({
  activityByDay,
  onRemoveStroke,
}: EfficiencyMapProps) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const data = useMemo(() => {
    const todayKey = dayKey(today);
    const cells = buildMonthGrid(viewYear, viewMonth, activityByDay, todayKey);

    const weekStart = startOfWeekMonday(today);
    let weekMs = 0;
    let weekDone = 0;
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      const e = activityByDay[dayKey(d)];
      if (e) {
        weekMs += e.focusMs;
        weekDone += e.doneCount;
      }
    }

    let monthMs = 0;
    let monthDone = 0;
    for (const cell of cells) {
      if (!cell.inMonth) continue;
      monthMs += cell.focusMs;
      monthDone += cell.doneCount;
    }

    const canGoNext =
      viewYear < today.getFullYear() ||
      (viewYear === today.getFullYear() && viewMonth < today.getMonth());

    return {
      title: `${MONTHS[viewMonth]} ${viewYear}`,
      todayKey,
      cells,
      todayMs: activityByDay[todayKey]?.focusMs ?? 0,
      todayDone: activityByDay[todayKey]?.doneCount ?? 0,
      weekMs,
      weekDone,
      monthMs,
      monthDone,
      canGoNext,
    };
  }, [activityByDay, today, viewYear, viewMonth]);

  /** Листает месяц назад / вперёд (не дальше текущего) */
  function shiftMonth(delta: number) {
    try {
      const d = new Date(viewYear, viewMonth + delta, 1);
      const nextY = d.getFullYear();
      const nextM = d.getMonth();
      if (
        nextY > today.getFullYear() ||
        (nextY === today.getFullYear() && nextM > today.getMonth())
      ) {
        return;
      }
      setViewYear(nextY);
      setViewMonth(nextM);
      setSelectedDay(null);
    } catch (err) {
      console.error(err);
    }
  }

  if (selectedDay) {
    const activity = activityByDay[selectedDay] ?? {
      focusMs: 0,
      doneCount: 0,
      strokes: [],
    };
    return (
      <div className="map-pane" data-no-drag>
        <DayCanvas
          dayKeyValue={selectedDay}
          activity={activity}
          onClose={() => setSelectedDay(null)}
          onRemoveStroke={(strokeId) => onRemoveStroke(selectedDay, strokeId)}
        />
      </div>
    );
  }

  return (
    <div className="map-pane" data-no-drag>
      <div className="map-stats">
        <div className="map-stat">
          <span className="map-stat-label">Сегодня</span>
          <span className="map-stat-value">{formatDuration(data.todayMs)}</span>
          <span className="map-stat-sub">{data.todayDone} закр.</span>
        </div>
        <div className="map-stat">
          <span className="map-stat-label">Неделя</span>
          <span className="map-stat-value">{formatDuration(data.weekMs)}</span>
          <span className="map-stat-sub">{data.weekDone} закр.</span>
        </div>
        <div className="map-stat">
          <span className="map-stat-label">Месяц</span>
          <span className="map-stat-value">{formatDuration(data.monthMs)}</span>
          <span className="map-stat-sub">{data.monthDone} закр.</span>
        </div>
      </div>

      <div className="map-calendar" aria-label={`Карта фокуса: ${data.title}`}>
        <div className="map-calendar-nav">
          <button
            type="button"
            className="tiny-btn"
            aria-label="Предыдущий месяц"
            onClick={() => shiftMonth(-1)}
          >
            ‹
          </button>
          <div className="map-calendar-title">{data.title}</div>
          <button
            type="button"
            className="tiny-btn"
            aria-label="Следующий месяц"
            disabled={!data.canGoNext}
            onClick={() => shiftMonth(1)}
          >
            ›
          </button>
        </div>
        <div className="map-calendar-head">
          {WEEKDAYS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="map-calendar-grid">
          {data.cells.map((cell) => (
            <button
              key={cell.key}
              type="button"
              disabled={!cell.inMonth}
              className={[
                'map-day',
                `map-day--l${cell.level}`,
                cell.inMonth ? '' : 'map-day--out',
                cell.isToday ? 'map-day--today' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              title={
                cell.inMonth
                  ? `${cell.key}: ${formatDuration(cell.focusMs)}, закрыто ${cell.doneCount}`
                  : undefined
              }
              onClick={() => {
                if (cell.inMonth) {
                  setSelectedDay(cell.key);
                }
              }}
            >
              <span className="map-day-num">{cell.dayNum}</span>
              <DayPreview cells={cell.preview} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
