import { clipboard, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { createHash } from 'node:crypto';

export interface ScreenshotItem {
  id: string;
  fileName: string;
  createdAt: number;
}

export interface ScreenshotDto {
  id: string;
  createdAt: number;
  thumbDataUrl: string;
}

const MAX_SHOTS = 40;
const POLL_MS = 700;

let shots: ScreenshotItem[] = [];
let lastImageHash = '';
let pollTimer: ReturnType<typeof setInterval> | null = null;
let onChange: ((items: ScreenshotDto[]) => void) | null = null;

/** Папка хранения скриншотов */
function getShotsDir(): string {
  const dir = path.join(app.getPath('userData'), 'island-screenshots');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Путь к метаданным коллекции */
function getMetaPath(): string {
  return path.join(getShotsDir(), 'index.json');
}

/** Читает индекс с диска */
function readMeta(): ScreenshotItem[] {
  try {
    const filePath = getMetaPath();
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ScreenshotItem[];
    return Array.isArray(raw) ? raw : [];
  } catch (error) {
    console.error('readMeta screenshots failed:', error);
    return [];
  }
}

/** Пишет индекс на диск */
function writeMeta(): void {
  try {
    fs.writeFileSync(getMetaPath(), JSON.stringify(shots, null, 2), 'utf8');
  } catch (error) {
    console.error('writeMeta screenshots failed:', error);
  }
}

/** Собирает DTO с миниатюрой для UI */
function toDto(item: ScreenshotItem): ScreenshotDto | null {
  try {
    const filePath = path.join(getShotsDir(), item.fileName);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) {
      return null;
    }
    const size = image.getSize();
    const width = Math.min(220, Math.max(80, size.width));
    const thumb = image.resize({
      width,
      height: Math.round((size.height / Math.max(1, size.width)) * width),
      quality: 'better',
    });
    return {
      id: item.id,
      createdAt: item.createdAt,
      thumbDataUrl: thumb.toDataURL(),
    };
  } catch (error) {
    console.error('toDto screenshot failed:', error);
    return null;
  }
}

/** Уведомляет UI об изменениях */
function emit(): void {
  try {
    onChange?.(listScreenshots());
  } catch (error) {
    console.error('screenshot emit failed:', error);
  }
}

/** Список скринов для панели */
export function listScreenshots(): ScreenshotDto[] {
  return shots
    .map((item) => toDto(item))
    .filter((item): item is ScreenshotDto => item != null);
}

/** Путь к файлу скрина на диске */
export function getScreenshotFilePath(id: string): string | null {
  try {
    const item = shots.find((shot) => shot.id === id);
    if (!item) {
      return null;
    }
    const filePath = path.join(getShotsDir(), item.fileName);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return filePath;
  } catch (error) {
    console.error('getScreenshotFilePath failed:', error);
    return null;
  }
}

/** Кладёт скрин в буфер без повторного сохранения в коллекцию */
export function copyScreenshotToClipboard(id: string): boolean {
  try {
    const item = shots.find((shot) => shot.id === id);
    if (!item) {
      return false;
    }
    const filePath = path.join(getShotsDir(), item.fileName);
    if (!fs.existsSync(filePath)) {
      return false;
    }
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) {
      return false;
    }
    const png = image.toPNG();
    lastImageHash = createHash('sha1').update(png).digest('hex');
    // Свою же копию опрос не должен принять за новый скрин
    lastFingerprint = imageFingerprint(image);
    clipboard.writeImage(image);
    return true;
  } catch (error) {
    console.error('copyScreenshotToClipboard failed:', error);
    return false;
  }
}

/** Полный data URL скрина */
export function getScreenshotDataUrl(id: string): string | null {
  try {
    const item = shots.find((shot) => shot.id === id);
    if (!item) {
      return null;
    }
    const filePath = path.join(getShotsDir(), item.fileName);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) {
      return null;
    }
    return image.toDataURL();
  } catch (error) {
    console.error('getScreenshotDataUrl failed:', error);
    return null;
  }
}

/** Подписка на изменения коллекции */
export function setScreenshotChangeHandler(
  handler: ((items: ScreenshotDto[]) => void) | null,
): void {
  onChange = handler;
}

/** Сохраняет PNG из буфера обмена */
function saveImageBuffer(png: Buffer): void {
  try {
    const hash = createHash('sha1').update(png).digest('hex');
    if (hash === lastImageHash) {
      return;
    }
    lastImageHash = hash;

    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const fileName = `${id}.png`;
    const filePath = path.join(getShotsDir(), fileName);
    fs.writeFileSync(filePath, png);

    shots = [
      {
        id,
        fileName,
        createdAt: Date.now(),
      },
      ...shots,
    ].slice(0, MAX_SHOTS);

    // удаляем файлы, выпавшие за лимит
    const keep = new Set(shots.map((s) => s.fileName));
    for (const file of fs.readdirSync(getShotsDir())) {
      if (file.endsWith('.png') && !keep.has(file)) {
        try {
          fs.unlinkSync(path.join(getShotsDir(), file));
        } catch {
          /* ignore */
        }
      }
    }

    writeMeta();
    emit();
  } catch (error) {
    console.error('saveImageBuffer failed:', error);
  }
}

/** Удаляет скрин из коллекции */
export function deleteScreenshot(id: string): boolean {
  try {
    const item = shots.find((shot) => shot.id === id);
    if (!item) {
      return false;
    }
    shots = shots.filter((shot) => shot.id !== id);
    const filePath = path.join(getShotsDir(), item.fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    writeMeta();
    emit();
    return true;
  } catch (error) {
    console.error('deleteScreenshot failed:', error);
    return false;
  }
}

/**
 * Удаляет несколько скринов одной операцией:
 * index.json пишется один раз, UI получает одно обновление.
 */
export function deleteScreenshots(ids: string[]): number {
  try {
    const wanted = new Set(ids.filter((id) => typeof id === 'string'));
    if (!wanted.size) {
      return 0;
    }
    const removed = shots.filter((shot) => wanted.has(shot.id));
    if (!removed.length) {
      return 0;
    }
    shots = shots.filter((shot) => !wanted.has(shot.id));
    for (const item of removed) {
      try {
        const filePath = path.join(getShotsDir(), item.fileName);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        console.error('deleteScreenshots unlink failed:', error);
      }
    }
    writeMeta();
    emit();
    return removed.length;
  } catch (error) {
    console.error('deleteScreenshots failed:', error);
    return 0;
  }
}

/** Пути к файлам выбранных скринов в порядке сетки; отсутствующие пропускаются */
export function getScreenshotFilePaths(ids: string[]): string[] {
  try {
    const wanted = new Set(ids);
    return shots
      .filter((shot) => wanted.has(shot.id))
      .map((shot) => path.join(getShotsDir(), shot.fileName))
      .filter((filePath) => fs.existsSync(filePath));
  } catch (error) {
    console.error('getScreenshotFilePaths failed:', error);
    return [];
  }
}

/** Имя файла по времени снимка: screenshot-2026-10-16_12-47-05.png */
function exportFileName(createdAt: number): string {
  const d = new Date(createdAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `screenshot-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.png`;
}

/** Копирует выбранные скрины в папку; существующие файлы не перезаписывает */
export function saveScreenshotsTo(
  ids: string[],
  dir: string,
): { saved: number; failed: number } {
  let saved = 0;
  let failed = 0;
  try {
    const wanted = new Set(ids);
    for (const shot of shots.filter((item) => wanted.has(item.id))) {
      try {
        const source = path.join(getShotsDir(), shot.fileName);
        if (!fs.existsSync(source)) {
          failed += 1;
          continue;
        }
        const base = exportFileName(shot.createdAt).replace(/\.png$/, '');
        let target = path.join(dir, `${base}.png`);
        for (let n = 2; fs.existsSync(target); n += 1) {
          target = path.join(dir, `${base} (${n}).png`);
        }
        fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
        saved += 1;
      } catch (error) {
        console.error('saveScreenshotsTo file failed:', error);
        failed += 1;
      }
    }
  } catch (error) {
    console.error('saveScreenshotsTo failed:', error);
  }
  return { saved, failed };
}

/** Меняет порядок скринов после drag-and-drop */
export function reorderScreenshots(orderedIds: string[]): boolean {
  try {
    const map = new Map(shots.map((shot) => [shot.id, shot]));
    const next: ScreenshotItem[] = [];
    for (const id of orderedIds) {
      const item = map.get(id);
      if (item) {
        next.push(item);
        map.delete(id);
      }
    }
    for (const rest of map.values()) {
      next.push(rest);
    }
    shots = next;
    writeMeta();
    emit();
    return true;
  } catch (error) {
    console.error('reorderScreenshots failed:', error);
    return false;
  }
}

/** Отпечаток последней картинки буфера: без него PNG кодировался каждые 700 мс */
let lastFingerprint = '';

/**
 * Дешёвый отпечаток картинки без кодирования в PNG:
 * размер и выборка байтов сырого растра.
 */
function imageFingerprint(image: Electron.NativeImage): string {
  try {
    const size = image.getSize();
    const bitmap = image.toBitmap();
    const step = Math.max(4, Math.floor(bitmap.length / 8192));
    const hash = createHash('sha1');
    hash.update(`${size.width}x${size.height}:${bitmap.length}`);
    const sample = Buffer.alloc(Math.ceil(bitmap.length / step));
    for (let i = 0, j = 0; i < bitmap.length; i += step, j += 1) {
      sample[j] = bitmap[i];
    }
    hash.update(sample);
    return hash.digest('hex');
  } catch (error) {
    console.error('imageFingerprint failed:', error);
    return '';
  }
}

/** Опрашивает буфер на новые изображения (Win+Shift+S и т.п.) */
function pollClipboardImage(): void {
  try {
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      return;
    }
    // Та же картинка, что в прошлый раз: PNG не кодируем
    const fingerprint = imageFingerprint(image);
    if (fingerprint && fingerprint === lastFingerprint) {
      return;
    }
    lastFingerprint = fingerprint;
    const png = image.toPNG();
    if (!png.length) {
      return;
    }
    saveImageBuffer(png);
  } catch (error) {
    console.error('pollClipboardImage failed:', error);
  }
}

/** Загружает индекс и запускает наблюдение */
export function startScreenshotWatch(): void {
  try {
    shots = readMeta().filter((item) =>
      fs.existsSync(path.join(getShotsDir(), item.fileName)),
    );
    writeMeta();
    if (pollTimer) {
      clearInterval(pollTimer);
    }
    pollTimer = setInterval(pollClipboardImage, POLL_MS);
    pollClipboardImage();
  } catch (error) {
    console.error('startScreenshotWatch failed:', error);
  }
}

/** Останавливает наблюдение */
export function stopScreenshotWatch(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Полезные системные пути для вкладки данных */
export function getSystemQuickPaths(): { label: string; value: string }[] {
  try {
    return [
      { label: 'Домашняя папка', value: app.getPath('home') },
      { label: 'Рабочий стол', value: app.getPath('desktop') },
      { label: 'Документы', value: app.getPath('documents') },
      { label: 'Загрузки', value: app.getPath('downloads') },
      { label: 'Данные Island', value: app.getPath('userData') },
    ];
  } catch (error) {
    console.error('getSystemQuickPaths failed:', error);
    return [];
  }
}
