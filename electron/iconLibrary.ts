// Папки своих иконок: %AppData%/pc-dynamic-island/icons/<слот>/
// Слот совпадает с видом или вкладкой, у которой есть значок.

import { app, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export const ICON_SLOTS = [
  'info',
  'timer',
  'cactus',
  'tasks',
  'map',
  'notes',
  'links',
  'shots',
  'clipboard',
  'translate',
  'focus',
] as const;

export type IconSlot = (typeof ICON_SLOTS)[number];

export interface IconFile {
  id: string;
  name: string;
  ext: 'svg' | 'png';
}

const BUILTIN_ID = 'builtin';

/** Корень icons рядом с island-state.json */
export function iconsRoot(): string {
  return path.join(app.getPath('userData'), 'icons');
}

/** Создаёт папку каждого слота, если её ещё нет */
export function ensureIconFolders(): void {
  try {
    for (const slot of ICON_SLOTS) {
      fs.mkdirSync(path.join(iconsRoot(), slot), { recursive: true });
    }
  } catch (error) {
    console.error('ensureIconFolders failed:', error);
  }
}

function isSlot(value: string): value is IconSlot {
  return (ICON_SLOTS as readonly string[]).includes(value);
}

/** Список svg/png в папках слотов, по алфавиту внутри слота */
export function listIconFiles(): Record<string, IconFile[]> {
  const out: Record<string, IconFile[]> = {};
  try {
    for (const slot of ICON_SLOTS) {
      const dir = path.join(iconsRoot(), slot);
      let names: string[] = [];
      try {
        names = fs.readdirSync(dir);
      } catch {
        names = [];
      }
      const files: IconFile[] = [];
      for (const name of names) {
        const ext = path.extname(name).toLowerCase();
        if (ext !== '.svg' && ext !== '.png') {
          continue;
        }
        if (name !== path.basename(name)) {
          continue;
        }
        files.push({ id: name, name, ext: ext.slice(1) as 'svg' | 'png' });
      }
      files.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      out[slot] = files;
    }
  } catch (error) {
    console.error('listIconFiles failed:', error);
  }
  return out;
}

/**
 * Читает файл иконки, только если путь остаётся внутри icons/<слот>.
 * null — чужой путь или не svg/png.
 */
export function readIconFile(
  slot: string,
  name: string,
): { body: Buffer; mime: string } | null {
  try {
    if (!isSlot(slot)) {
      return null;
    }
    const base = path.basename(name);
    if (!base || base !== name || base.includes('..')) {
      return null;
    }
    const ext = path.extname(base).toLowerCase();
    if (ext !== '.svg' && ext !== '.png') {
      return null;
    }
    const root = path.resolve(iconsRoot());
    const full = path.resolve(root, slot, base);
    const slotDir = path.resolve(root, slot) + path.sep;
    if (!full.startsWith(slotDir)) {
      return null;
    }
    if (!fs.existsSync(full)) {
      return null;
    }
    return {
      body: fs.readFileSync(full),
      mime: ext === '.svg' ? 'image/svg+xml' : 'image/png',
    };
  } catch (error) {
    console.error('readIconFile failed:', error);
    return null;
  }
}

/** Если выбранный файл исчез, выбор слота возвращается на встроенный значок */
export function reconcileIconChoice(
  choice: Record<string, string>,
  files: Record<string, IconFile[]>,
): { choice: Record<string, string>; changed: boolean } {
  const next = { ...choice };
  let changed = false;
  try {
    for (const [slot, id] of Object.entries(choice)) {
      if (!id || id === BUILTIN_ID) {
        continue;
      }
      const known = files[slot] ?? [];
      if (!known.some((file) => file.id === id)) {
        next[slot] = BUILTIN_ID;
        changed = true;
      }
    }
  } catch (error) {
    console.error('reconcileIconChoice failed:', error);
  }
  return { choice: next, changed };
}

/** Отдаёт файлы по island-icon://слот/имя */
export function registerIconProtocol(): void {
  try {
    protocol.handle('island-icon', (request) => {
      try {
        const url = new URL(request.url);
        const slot = url.hostname;
        const name = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
        const file = readIconFile(slot, name);
        if (!file) {
          return new Response('not found', { status: 404 });
        }
        return new Response(new Uint8Array(file.body), {
          headers: {
            'Content-Type': file.mime,
            'Cache-Control': 'no-store',
          },
        });
      } catch (error) {
        console.error('island-icon handle failed:', error);
        return new Response('bad icon', { status: 400 });
      }
    });
  } catch (error) {
    console.error('registerIconProtocol failed:', error);
  }
}

/** Следит за папками и сообщает рендереру новый список */
export function watchIconFolders(
  onChange: () => void,
): fs.FSWatcher | null {
  try {
    ensureIconFolders();
    let timer: NodeJS.Timeout | null = null;
    const watcher = fs.watch(iconsRoot(), { recursive: true }, () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        try {
          onChange();
        } catch (error) {
          console.error('icon watch callback failed:', error);
        }
      }, 150);
    });
    return watcher;
  } catch (error) {
    console.error('watchIconFolders failed:', error);
    return null;
  }
}
