import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export interface CompletedTaskPayload {
  title: string;
  elapsedMs: number;
  subtasks?: string[];
}

export interface NotePayload {
  text: string;
}

type JournalResult = { ok: boolean; path: string; sheet: string; error?: string };

const SHEET_NAME = 'Задачник';
const DAY_FILL = 'FF2A2115';
const DAY_FONT = 'FFD4A017';
const HEADER_FILL = 'FFD4A017';
const HEADER_FONT = 'FF1A1408';

/** Путь к Excel-файлу «Задачник.xlsx» */
export function getWorkbookPath(): string {
  try {
    const projectRoot = app.isPackaged
      ? app.getPath('documents')
      : path.resolve(__dirname, '..');
    return path.join(projectRoot, 'Задачник.xlsx');
  } catch {
    return path.join(process.cwd(), 'Задачник.xlsx');
  }
}

/** Дата для заголовка блока: 09.09.2026 */
function formatDayLabel(date = new Date()): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

/** Потраченное время чч:мм:сс */
function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Минуты для удобного фильтра в Excel */
function elapsedMinutes(ms: number): number {
  return Math.round(Math.max(0, ms) / 60000 * 10) / 10;
}

/** Настраивает ширину колонок основного листа */
function applyColumnWidths(sheet: ExcelJS.Worksheet): void {
  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 12;
  sheet.getColumn(3).width = 44;
  sheet.getColumn(4).width = 14;
  sheet.getColumn(5).width = 12;
  sheet.getColumn(6).width = 40;
  sheet.getColumn(7).width = 14;
}

/** Пишет шапку таблицы колонок */
function writeTableHeader(sheet: ExcelJS.Worksheet, rowNumber: number): void {
  const row = sheet.getRow(rowNumber);
  row.values = [
    'Дата',
    'Время',
    'Задача',
    'Потрачено',
    'Минут',
    'Подзадачи',
    'Статус',
  ];
  row.font = { bold: true, color: { argb: HEADER_FONT } };
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: HEADER_FILL },
  };
  row.commit();
}

/** Пишет разделитель дня */
function writeDaySeparator(
  sheet: ExcelJS.Worksheet,
  rowNumber: number,
  dayLabel: string,
): void {
  const row = sheet.getRow(rowNumber);
  row.values = [`▸ ${dayLabel}`, '', '', '', '', '', ''];
  row.font = { bold: true, size: 12, color: { argb: DAY_FONT } };
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: DAY_FILL },
  };
  sheet.mergeCells(rowNumber, 1, rowNumber, 7);
  row.commit();
}

/** Создаёт или возвращает единый лист журнала */
function ensureJournalSheet(workbook: ExcelJS.Workbook): ExcelJS.Worksheet {
  let sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) {
    // если остались старые листы-дни — всё равно ведём новый единый журнал
    sheet = workbook.addWorksheet(SHEET_NAME);
    applyColumnWidths(sheet);
    writeTableHeader(sheet, 1);
  } else if (!sheet.getRow(1).getCell(1).value) {
    applyColumnWidths(sheet);
    writeTableHeader(sheet, 1);
  } else {
    applyColumnWidths(sheet);
  }
  return sheet;
}

/** Ищет последнюю строку-разделитель текущего дня */
function findLastDayLabel(sheet: ExcelJS.Worksheet): string | null {
  for (let i = sheet.rowCount; i >= 1; i -= 1) {
    const value = sheet.getRow(i).getCell(1).value;
    const text = typeof value === 'string' ? value : String(value ?? '');
    if (text.startsWith('▸ ')) {
      return text.slice(2).trim();
    }
  }
  return null;
}

/** Загружает книгу с диска */
async function loadWorkbook(filePath: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Island';
  try {
    if (fs.existsSync(filePath)) {
      await workbook.xlsx.readFile(filePath);
    }
  } catch (error) {
    console.error('Не удалось прочитать Задачник, создаём новый:', error);
  }
  return workbook;
}

/** Атомарная запись: tmp → rename, при блокировке — запасной файл */
async function saveWorkbookSafe(
  workbook: ExcelJS.Workbook,
  filePath: string,
): Promise<string> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, '.xlsx');
  const tmpPath = path.join(dir, `${base}.tmp.xlsx`);
  const fallbackPath = path.join(dir, `${base}_Island.xlsx`);

  await workbook.xlsx.writeFile(tmpPath);

  try {
    fs.copyFileSync(tmpPath, filePath);
    fs.unlinkSync(tmpPath);
    return filePath;
  } catch (error) {
    console.error('Основной Задачник занят, пишем в запасной файл:', error);
    try {
      fs.copyFileSync(tmpPath, fallbackPath);
      fs.unlinkSync(tmpPath);
      return fallbackPath;
    } catch (fallbackError) {
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch {
        /* ignore */
      }
      throw fallbackError;
    }
  }
}

/**
 * Добавляет строку в журнал с разделителем дня при необходимости.
 */
async function appendJournalRow(values: (string | number)[]): Promise<JournalResult> {
  try {
    const primaryPath = getWorkbookPath();
    const workbook = await loadWorkbook(primaryPath);
    const sheet = ensureJournalSheet(workbook);
    const dayLabel = formatDayLabel();
    const lastDay = findLastDayLabel(sheet);

    if (lastDay !== dayLabel) {
      if (sheet.rowCount > 1) {
        sheet.addRow([]);
      }
      const sepRow = sheet.rowCount + 1;
      writeDaySeparator(sheet, sepRow, dayLabel);
    }

    // первая колонка даты уже в values[0] или подставим
    if (!values[0]) {
      values[0] = dayLabel;
    }

    const row = sheet.addRow(values);
    row.commit();

    const savedPath = await saveWorkbookSafe(workbook, primaryPath);
    return { ok: true, path: savedPath, sheet: SHEET_NAME };
  } catch (error) {
    console.error('appendJournalRow failed:', error);
    return {
      ok: false,
      path: getWorkbookPath(),
      sheet: SHEET_NAME,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Добавляет выполненную задачу в единый лист:
 * блоки дней идут сверху вниз, новый день — новый разделитель.
 */
export async function appendCompletedTask(
  payload: CompletedTaskPayload,
): Promise<JournalResult> {
  const now = new Date();
  const time = now.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return appendJournalRow([
    formatDayLabel(now),
    time,
    payload.title,
    formatElapsed(payload.elapsedMs),
    elapsedMinutes(payload.elapsedMs),
    (payload.subtasks ?? []).filter(Boolean).join('; '),
    'Выполнено',
  ]);
}

/** Добавляет заметку в тот же Excel-журнал */
export async function appendNote(payload: NotePayload): Promise<JournalResult> {
  const text = payload.text.trim();
  if (!text) {
    return {
      ok: false,
      path: getWorkbookPath(),
      sheet: SHEET_NAME,
      error: 'Пустая заметка',
    };
  }

  const now = new Date();
  const time = now.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // первая строка — кратко в «Задача», полный текст — в «Подзадачи» если длинный
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const title = lines[0] ?? text;
  const rest = lines.slice(1).join(' | ');

  return appendJournalRow([
    formatDayLabel(now),
    time,
    title.slice(0, 200),
    '',
    '',
    rest,
    'Заметка',
  ]);
}

/** Создаёт пустой Задачник, если файла ещё нет */
export async function ensureWorkbookExists(): Promise<string> {
  const filePath = getWorkbookPath();
  try {
    if (!fs.existsSync(filePath)) {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Island';
      const sheet = workbook.addWorksheet(SHEET_NAME);
      applyColumnWidths(sheet);
      writeTableHeader(sheet, 1);
      writeDaySeparator(sheet, 2, formatDayLabel());
      await saveWorkbookSafe(workbook, filePath);
    }
  } catch (error) {
    console.error('ensureWorkbookExists failed:', error);
    throw error;
  }
  return filePath;
}
