/**
 * Материал фона острова. На форму не влияет.
 * artic — матовое стекло (живой блюр + преломление кромки),
 * clear — прозрачное стекло в духе Glass-HQ clear (фон виден, преломляется у кромки).
 */
export type Material = 'black' | 'artic' | 'clear' | 'cactus';

/** Стеклянные материалы: у них подложка IslandBackdrop.exe. */
export function isGlassMaterial(material: Material): boolean {
  return material === 'artic' || material === 'clear';
}

/** Что показано в компактном виде. */
export type Layout = 'minimal' | 'timer' | 'extended' | 'task';

/** Пара осей вместо плоского compactView. */
export interface ViewMode {
  material: Material;
  layout: Layout;
}

/**
 * Режимы по кругу: чёрные, матовое стекло, прозрачное стекло, кактус.
 * Кактус в цикле с раскладкой minimal, рисуется своим силуэтом.
 */
export const VIEW_CYCLE: ViewMode[] = [
  { material: 'black', layout: 'minimal' },
  { material: 'black', layout: 'timer' },
  { material: 'black', layout: 'extended' },
  { material: 'artic', layout: 'minimal' },
  { material: 'artic', layout: 'timer' },
  { material: 'artic', layout: 'extended' },
  { material: 'artic', layout: 'task' },
  { material: 'clear', layout: 'minimal' },
  { material: 'clear', layout: 'timer' },
  { material: 'clear', layout: 'extended' },
  { material: 'clear', layout: 'task' },
  { material: 'cactus', layout: 'minimal' },
];

/** Проверяет строку материала. */
function isMaterial(value: unknown): value is Material {
  return (
    value === 'black' ||
    value === 'artic' ||
    value === 'clear' ||
    value === 'cactus'
  );
}

/** Проверяет строку раскладки. */
function isLayout(value: unknown): value is Layout {
  return (
    value === 'minimal' ||
    value === 'timer' ||
    value === 'extended' ||
    value === 'task'
  );
}

/** Принимает только полную пару material + layout. */
export function normalizeViewMode(raw: unknown): ViewMode | null {
  try {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const material = (raw as ViewMode).material;
    const layout = (raw as ViewMode).layout;
    if (!isMaterial(material) || !isLayout(layout)) {
      return null;
    }
    return { material, layout };
  } catch {
    return null;
  }
}

/**
 * Первый запуск после старого compactView.
 * info и minimal становятся black+minimal, glass и moon — artic+minimal.
 */
export function migrateCompactView(raw: unknown): ViewMode {
  if (raw === 'timer') {
    return { material: 'black', layout: 'timer' };
  }
  if (raw === 'glass' || raw === 'moon') {
    return { material: 'artic', layout: 'minimal' };
  }
  if (raw === 'cactus') {
    return { material: 'cactus', layout: 'minimal' };
  }
  return { material: 'black', layout: 'minimal' };
}

/** Берёт viewMode из файла, иначе мигрирует compactView. Старый ключ не стирает. */
export function resolveStoredView(windowState: {
  viewMode?: unknown;
  compactView?: unknown;
} | null | undefined): ViewMode {
  return (
    normalizeViewMode(windowState?.viewMode) ??
    migrateCompactView(windowState?.compactView)
  );
}

/** Следующий режим по кругу. Неизвестная пара начинает цикл с начала. */
export function nextViewMode(current: ViewMode): ViewMode {
  const idx = VIEW_CYCLE.findIndex(
    (item) => item.material === current.material && item.layout === current.layout,
  );
  return VIEW_CYCLE[(idx < 0 ? 0 : idx + 1) % VIEW_CYCLE.length];
}
