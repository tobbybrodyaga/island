import { clipboard } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ClipboardItem {
  id: string;
  text: string;
  createdAt: number;
}

const MAX_ITEMS = 5;
const POLL_MS = 450;

let history: ClipboardItem[] = [];
let lastSeen = '';
let ignoreUntil = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let onChange: ((items: ClipboardItem[]) => void) | null = null;

/** Уведомляет подписчика об обновлении истории */
function emit(): void {
  try {
    onChange?.(getClipboardHistory());
  } catch (error) {
    console.error('clipboard emit failed:', error);
  }
}

/** Превью для UI */
export function previewText(text: string, max = 80): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) {
    return oneLine;
  }
  return `${oneLine.slice(0, max - 1)}…`;
}

/** Текущая история (копия) */
export function getClipboardHistory(): ClipboardItem[] {
  return history.map((item) => ({ ...item }));
}

/** Подписка на изменения истории */
export function setClipboardChangeHandler(
  handler: ((items: ClipboardItem[]) => void) | null,
): void {
  onChange = handler;
}

/** Добавляет текст в историю (новые сверху) */
export function pushClipboardText(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }
  // тот же текст уже наверху — не дублируем
  if (history[0]?.text === text) {
    return;
  }
  history = [
    {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      text,
      createdAt: Date.now(),
    },
    ...history.filter((item) => item.text !== text),
  ].slice(0, MAX_ITEMS);
  emit();
}

/** Очищает историю буфера */
export function clearClipboardHistory(): void {
  history = [];
  emit();
}

/** Пишет текст в системный буфер, не попадая обратно в историю */
export function writeClipboardSilent(text: string): void {
  ignoreUntil = Date.now() + 900;
  lastSeen = text;
  clipboard.writeText(text);
}

/**
 * Вставляет текст в активное окно: копирует и шлёт Ctrl+V.
 * Перед вызовом окно Island лучше скрыть, чтобы фокус вернулся.
 */
export async function pasteClipboardText(text: string): Promise<{ ok: boolean }> {
  try {
    writeClipboardSilent(text);
    // небольшая пауза, затем Ctrl+V через WinForms SendKeys
    const script = `
Start-Sleep -Milliseconds 120;
Add-Type -AssemblyName System.Windows.Forms;
[System.Windows.Forms.SendKeys]::SendWait('^v');
`;
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true },
    );
    return { ok: true };
  } catch (error) {
    console.error('pasteClipboardText failed:', error);
    return { ok: false };
  }
}

/** Тик опроса системного буфера */
function pollOnce(): void {
  try {
    if (Date.now() < ignoreUntil) {
      return;
    }
    const text = clipboard.readText();
    if (!text || text === lastSeen) {
      return;
    }
    lastSeen = text;
    pushClipboardText(text);
  } catch (error) {
    console.error('clipboard poll failed:', error);
  }
}

/** Запускает опрос буфера обмена */
export function startClipboardWatch(): void {
  if (pollTimer) {
    return;
  }
  try {
    lastSeen = clipboard.readText() || '';
  } catch {
    lastSeen = '';
  }
  pollTimer = setInterval(pollOnce, POLL_MS);
}

/** Останавливает опрос */
export function stopClipboardWatch(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
