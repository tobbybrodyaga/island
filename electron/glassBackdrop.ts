// island/electron/glassBackdrop.ts
//
// Подложка живого блюра для compactView === 'glass'.
// Запускает native/backdrop/IslandBackdrop.exe и шлёт ему геометрию капсулы
// по stdin (одна строка JSON на команду), в физических пикселях.
//
// Что НЕ делает (сознательно, см. вводные):
//   - не трогает SetWindowRgn / setShape на окне Electron;
//   - не лезет в child-HWND Chromium;
//   - не использует koffi / GetClientRect: размер берётся из bounds через screen.dipToScreenRect.
//
// ВАЖНО: имена команд ('show' / 'hide') и формат tint сверить с Program.cs.

import { app, BrowserWindow, Rectangle, screen } from 'electron';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type DockEdge = 'free' | 'top' | 'bottom' | 'left' | 'right';

export interface BackdropState {
  edge: DockEdge;
  expanded: boolean;
  /**
   * Прямоугольник капсулы в DIP относительно окна.
   * Не задан — капсула занимает всё окно.
   */
  capsule?: Rectangle;
  /** Радиус в DIP с элемента основы. Если задан, константы R_* не используются. */
  radius?: number;
  /** Несколько фигур разворота в DIP относительно окна. Пусто — одна капсула через show. */
  shapes?: BackdropShape[];
}

export interface BackdropShape {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

// Радиусы в DIP, переводятся в физические пиксели при отправке.
const R_EDGE_COMPACT = 10;
const R_FREE_EXPANDED = 24;
const R_EDGE_EXPANDED = 22;

// Program.cs ждёт double 0..1 и сам красит RGB 12,12,14.
// Раскрытая панель: альфа из задуманного '#99141414' (0x99 / 255).
// Компакт светлее, чтобы капсула читалась как стекло, а не как тёмная плашка.
const TINT_EXPANDED = 0x99 / 255;
const TINT_COMPACT = 0x66 / 255;
const MAX_RESTARTS = 3;

function resolveExe(): string {
  // dev: `electron .` из island/ → getAppPath() = island/
  // packaged: положить exe через extraResources в resources/backdrop/
  return app.isPackaged
    ? path.join(process.resourcesPath, 'backdrop', 'IslandBackdrop.exe')
    : path.join(app.getAppPath(), 'native', 'backdrop', 'IslandBackdrop.exe');
}

/** Десятичный HWND числом: System.Text.Json не приводит строку к long. */
function hwndOf(win: BrowserWindow): number {
  const buf = win.getNativeWindowHandle();
  const v = buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
  return Number(v);
}

export class GlassBackdrop {
  private proc: ChildProcess | null = null;
  private lastLine = '';
  private restarts = 0;
  private active = false;
  private disposed = false;
  private unavailable = false;
  private state: BackdropState = { edge: 'free', expanded: false };
  private readonly exePath = resolveExe();
  private readonly onDisplayChange = () => this.push();

  constructor(private readonly win: BrowserWindow) {
    const push = () => this.push();
    // 'move' на Windows приходит и во время перетаскивания, 'moved' — в конце.
    win.on('move', push);
    win.on('moved', push);
    win.on('resize', push);
    win.on('show', push);
    win.on('restore', push);
    win.on('focus', push); // заново поставить подложку под окно в Z-порядке
    win.on('hide', () => this.sendHide());
    win.on('minimize', () => this.sendHide());
    win.on('closed', () => this.dispose());
    screen.on('display-metrics-changed', this.onDisplayChange);
    app.on('before-quit', () => this.dispose());
  }

  /** Включить подложку. false — exe нет или он не держится; тогда оставь Acrylic как фолбэк. */
  enable(state?: Partial<BackdropState>): boolean {
    if (this.disposed || this.unavailable) return false;
    if (!fs.existsSync(this.exePath)) {
      console.warn('[backdrop] не найден', this.exePath);
      this.unavailable = true;
      return false;
    }
    if (state) this.state = { ...this.state, ...state };
    this.active = true;
    this.push();
    return true;
  }

  /** Выход из glass. Процесс не убиваем — следующий enable будет мгновенным. */
  disable(): void {
    this.active = false;
    this.sendHide();
  }

  /** Сменился край, разворот или прямоугольник капсулы. */
  setState(patch: Partial<BackdropState>): void {
    this.state = { ...this.state, ...patch };
    this.push();
  }

  /** Отправить текущую геометрию. Вызывать и сразу после своего setPosition/setBounds в драге. */
  push(): void {
    const w = this.win;
    if (!this.active || this.disposed || w.isDestroyed()) return;
    if (!w.isVisible() || w.isMinimized()) return;

    const b = w.getBounds();
    const shapes = this.state.shapes?.filter((shape) => shape.width > 1 && shape.height > 1);
    if (shapes && shapes.length > 0) {
      this.pushShapes(w, b, shapes);
      return;
    }
    const c = this.state.capsule ?? { x: 0, y: 0, width: b.width, height: b.height };
    const dip: Rectangle = { x: b.x + c.x, y: b.y + c.y, width: c.width, height: c.height };
    if (dip.width <= 0 || dip.height <= 0) return;

    // dipToScreenRect учитывает смешанный DPI на нескольких мониторах —
    // простое bounds × scaleFactor на втором мониторе даёт сдвиг.
    const phys = process.platform === 'win32' ? screen.dipToScreenRect(w, dip) : dip;
    const scale = phys.width / dip.width || 1;

    const { edge, expanded } = this.state;
    let rDip: number;
    if (typeof this.state.radius === 'number' && Number.isFinite(this.state.radius)) {
      rDip = Math.max(0, this.state.radius);
    } else if (edge === 'free') {
      rDip = expanded ? R_FREE_EXPANDED : Math.min(dip.width, dip.height) / 2;
    } else {
      rDip = expanded ? R_EDGE_EXPANDED : R_EDGE_COMPACT;
    }

    // 1 физический пиксель внутрь: сглаживание блюра не вылезает за CSS-край
    const x = Math.round(phys.x) + 1;
    const y = Math.round(phys.y) + 1;
    const wPx = Math.round(phys.width) - 2;
    const hPx = Math.round(phys.height) - 2;
    if (wPx < 1 || hPx < 1) return;

    this.send({
      cmd: 'show',
      x,
      y,
      w: wPx,
      h: hPx,
      r: Math.max(0, Math.round(rDip * scale) - 1),
      edge,
      owner: hwndOf(w),
      tint: this.state.expanded ? TINT_EXPANDED : TINT_COMPACT,
    });
  }

  /** Каждая фигура отдельно: dipToScreenRect и сжатие на 1 физический пиксель. */
  private pushShapes(win: BrowserWindow, bounds: Rectangle, shapes: BackdropShape[]): void {
    try {
      const items = shapes.map((shape) => {
        const dip: Rectangle = {
          x: bounds.x + shape.x,
          y: bounds.y + shape.y,
          width: shape.width,
          height: shape.height,
        };
        const phys = process.platform === 'win32' ? screen.dipToScreenRect(win, dip) : dip;
        const scale = phys.width / dip.width || 1;
        return {
          x: Math.round(phys.x) + 1,
          y: Math.round(phys.y) + 1,
          w: Math.round(phys.width) - 2,
          h: Math.round(phys.height) - 2,
          r: Math.max(0, Math.round(Math.max(0, shape.radius) * scale) - 1),
        };
      }).filter((item) => item.w >= 1 && item.h >= 1);
      if (!items.length) return;
      this.send({
        cmd: 'shapes',
        owner: hwndOf(win),
        tint: this.state.expanded ? TINT_EXPANDED : TINT_COMPACT,
        edge: this.state.edge,
        items,
      });
    } catch (error) {
      console.warn('[backdrop] shapes failed', error);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    screen.removeListener('display-metrics-changed', this.onDisplayChange);
    const p = this.proc;
    this.proc = null;
    if (!p) return;
    try {
      // hide, затем quit и закрытие stdin: EOF тоже ставит quit, процесс не остаётся.
      p.stdin?.write(JSON.stringify({ cmd: 'hide' }) + '\n');
      p.stdin?.write(JSON.stringify({ cmd: 'quit' }) + '\n');
      p.stdin?.end();
    } catch { /* процесс уже умер */ }
    setTimeout(() => { if (p.exitCode === null) p.kill(); }, 500);
  }

  // ---------- внутреннее ----------

  private sendHide(): void {
    if (!this.proc) return;
    this.lastLine = ''; // чтобы следующий show ушёл даже с той же геометрией
    this.write(JSON.stringify({ cmd: 'hide' }));
  }

  private send(obj: object): void {
    const line = JSON.stringify(obj);
    if (line === this.lastLine) return; // не спамим одинаковым
    if (!this.ensureProc()) return;
    this.lastLine = line;
    this.write(line);
  }

  private write(line: string): void {
    try {
      this.proc?.stdin?.write(line + '\n');
    } catch (e) {
      console.warn('[backdrop] write failed', e);
    }
  }

  private ensureProc(): boolean {
    if (this.proc) return true;
    if (this.disposed || this.unavailable) return false;

    const p = spawn(this.exePath, [], {
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true,
    });
    p.stdin?.on('error', () => { /* EPIPE при падении — обработает 'exit' */ });
    p.stderr?.on('data', d => console.warn('[backdrop]', String(d).trim()));
    p.on('error', e => console.warn('[backdrop] spawn error', e));
    p.on('exit', code => {
      if (this.proc !== p) return;
      this.proc = null;
      this.lastLine = '';
      if (this.disposed || !this.active) return;
      console.warn('[backdrop] exited', code);
      if (++this.restarts > MAX_RESTARTS) {
        console.warn('[backdrop] слишком много падений, выключаю');
        this.unavailable = true;
        return;
      }
      setTimeout(() => this.push(), 300 * this.restarts);
    });

    this.proc = p;
    return true;
  }
}

/*
──────────────── Подключение в island/electron/main.ts ────────────────

import { GlassBackdrop } from './glassBackdrop';

// после создания окна острова:
const backdrop = new GlassBackdrop(islandWin);

function syncGlassMaterial() {
  const glass = state.compactView === 'glass';
  if (glass && backdrop.enable({ edge: currentDockEdge(), expanded: isExpanded })) {
    islandWin.setBackgroundMaterial('none');   // иначе прямоугольная полка поверх подложки
  } else if (glass) {
    islandWin.setBackgroundMaterial('acrylic'); // фолбэк, как сейчас
  } else {
    backdrop.disable();
    islandWin.setBackgroundMaterial('none');
  }
  islandWin.showInactive();
}

// syncGlassWindowRegion() оставить как есть: снимает shape/регион, больше ничего.

// Разворот / сворачивание:
backdrop.setState({ expanded: true });

// Прилипание к краю / отлипание:
backdrop.setState({ edge: 'top' });   // 'free' | 'top' | 'bottom' | 'left' | 'right'

// Если драг самописный (setPosition в mousemove) — сразу после него:
islandWin.setPosition(x, y);
backdrop.push();

// Если окно больше капсулы или разворот анимируется CSS внутри окна фиксированного
// размера — из рендерера по IPC слать прямоугольник капсулы (getBoundingClientRect, DIP):
ipcMain.on('island:capsule-rect', (_e, rect) => backdrop.setState({ capsule: rect }));

// Для сборки (electron-builder):
// "extraResources": [{ "from": "native/backdrop", "to": "backdrop" }]
*/
