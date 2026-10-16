import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { ViewMode } from '../src/viewMode';

export type IslandMode = 'collapsed' | 'peek' | 'expanded';
export type CompactView = 'info' | 'timer' | 'minimal' | 'glass' | 'cactus';
export type EdgeOrFree = 'top' | 'bottom' | 'left' | 'right' | 'free';

export interface ClipboardItemDto {
  id: string;
  text: string;
  createdAt: number;
}

export interface ScreenshotDto {
  id: string;
  createdAt: number;
  thumbDataUrl: string;
}

export interface QuickPathDto {
  label: string;
  value: string;
}

const islandApi = {
  setMode: (mode: IslandMode) => ipcRenderer.invoke('island:set-mode', mode),
  setViewMode: (mode: ViewMode) =>
    ipcRenderer.invoke('island:set-view-mode', mode),
  adjustSizeScale: (delta: number) =>
    ipcRenderer.invoke('island:adjust-size-scale', delta),
  setSizeScale: (scale: number) =>
    ipcRenderer.invoke('island:set-size-scale', scale),
  setIgnoreMouse: (ignore: boolean) =>
    ipcRenderer.invoke('island:set-ignore-mouse', ignore),
  dragStart: () =>
    ipcRenderer.invoke('island:drag-start') as Promise<{
      ok: boolean;
      glassStage?: {
        x: number;
        y: number;
        width: number;
        height: number;
        areaWidth: number;
        areaHeight: number;
      };
    }>,
  glassStageReady: () => ipcRenderer.invoke('island:glass-stage-ready'),
  /** Снимок фона под окном для мутного стекла (blur внутри формы) */
  captureFrostBehind: () =>
    ipcRenderer.invoke('island:capture-frost-behind') as Promise<{
      ok: boolean;
      dataUrl?: string;
    }>,
  dragMove: (dx: number, dy: number) =>
    ipcRenderer.invoke('island:drag-move', dx, dy) as Promise<{
      ok: boolean;
      glassStage?: {
        x: number;
        y: number;
        width: number;
        height: number;
        areaWidth: number;
        areaHeight: number;
      };
    }>,
  dragEnd: () =>
    ipcRenderer.invoke('island:drag-end') as Promise<{
      ok: boolean;
      edge?: EdgeOrFree;
      offset?: number;
      glassStage?: null;
    }>,
  loadState: () => ipcRenderer.invoke('island:load-state'),
  saveState: (payload: { tasks?: unknown; settings?: unknown }) =>
    ipcRenderer.invoke('island:save-state', payload),
  quit: () => ipcRenderer.invoke('island:quit'),
  logCompletedTask: (payload: {
    title: string;
    elapsedMs: number;
    subtasks?: string[];
  }) => ipcRenderer.invoke('island:log-completed-task', payload),
  logNote: (payload: { text: string }) =>
    ipcRenderer.invoke('island:log-note', payload),
  openWorkbook: () => ipcRenderer.invoke('island:open-workbook'),

  getClipboardHistory: () =>
    ipcRenderer.invoke('island:get-clipboard-history') as Promise<{
      ok: boolean;
      items: ClipboardItemDto[];
    }>,
  clearClipboardHistory: () =>
    ipcRenderer.invoke('island:clear-clipboard-history'),
  copyClipboardItem: (id: string) =>
    ipcRenderer.invoke('island:copy-clipboard-item', id),
  pasteClipboardItem: (id: string) =>
    ipcRenderer.invoke('island:paste-clipboard-item', id),

  getQuickPaths: () =>
    ipcRenderer.invoke('island:get-quick-paths') as Promise<{
      ok: boolean;
      items: QuickPathDto[];
    }>,
  copyText: (text: string) => ipcRenderer.invoke('island:copy-text', text),

  listScreenshots: () =>
    ipcRenderer.invoke('island:list-screenshots') as Promise<{
      ok: boolean;
      items: ScreenshotDto[];
    }>,
  deleteScreenshot: (id: string) =>
    ipcRenderer.invoke('island:delete-screenshot', id),
  reorderScreenshots: (orderedIds: string[]) =>
    ipcRenderer.invoke('island:reorder-screenshots', orderedIds),
  getScreenshotData: (id: string) =>
    ipcRenderer.invoke('island:get-screenshot-data', id) as Promise<{
      ok: boolean;
      dataUrl: string | null;
    }>,
  copyScreenshot: (id: string) =>
    ipcRenderer.invoke('island:copy-screenshot', id),

  /** Нативный drag скрина в другие приложения */
  startScreenshotDrag: (id: string) => {
    ipcRenderer.send('island:drag-screenshot', id);
  },

  /** Прямоугольник и радиус основы капсулы в DIP */
  sendCapsuleRect: (rect: {
    x: number;
    y: number;
    width: number;
    height: number;
    radius: number;
  }) => {
    ipcRenderer.send('island:capsule-rect', rect);
  },
  sendBackdropShapes: (
    shapes: { x: number; y: number; width: number; height: number; radius: number }[],
  ) => {
    ipcRenderer.send('island:backdrop-shapes', shapes);
  },

  getIcons: () =>
    ipcRenderer.invoke('island:get-icons') as Promise<{
      ok: boolean;
      files: Record<string, { id: string; name: string; ext: 'svg' | 'png' }[]>;
      choice: Record<string, string>;
    }>,
  setIconChoice: (slot: string, id: string) =>
    ipcRenderer.invoke('island:set-icon-choice', slot, id) as Promise<{
      ok: boolean;
      choice?: Record<string, string>;
    }>,
  openIconsFolder: () => ipcRenderer.invoke('island:open-icons-folder'),
  onIconsChanged: (
    handler: (payload: {
      files: Record<string, { id: string; name: string; ext: 'svg' | 'png' }[]>;
      choice: Record<string, string>;
    }) => void,
  ) => {
    const listener = (
      _event: IpcRendererEvent,
      payload: {
        files: Record<string, { id: string; name: string; ext: 'svg' | 'png' }[]>;
        choice: Record<string, string>;
      },
    ) => handler(payload);
    ipcRenderer.on('island:icons-changed', listener);
    return () => ipcRenderer.removeListener('island:icons-changed', listener);
  },

  onEdgeChanged: (
    handler: (payload: {
      edge: EdgeOrFree;
      viewMode: ViewMode;
      topCenter?: boolean;
      sizeScale?: number;
    }) => void,
  ) => {
    const listener = (
      _event: IpcRendererEvent,
      payload: {
        edge: EdgeOrFree;
        viewMode: ViewMode;
        topCenter?: boolean;
        sizeScale?: number;
      },
    ) => handler(payload);
    ipcRenderer.on('island:edge-changed', listener);
    return () => ipcRenderer.removeListener('island:edge-changed', listener);
  },

  onCollapseRequest: (handler: () => void) => {
    const listener = () => handler();
    ipcRenderer.on('island:collapse', listener);
    return () => ipcRenderer.removeListener('island:collapse', listener);
  },

  onClipboardChanged: (handler: (items: ClipboardItemDto[]) => void) => {
    const listener = (
      _event: IpcRendererEvent,
      items: ClipboardItemDto[],
    ) => handler(items);
    ipcRenderer.on('island:clipboard-changed', listener);
    return () =>
      ipcRenderer.removeListener('island:clipboard-changed', listener);
  },

  onScreenshotsChanged: (handler: (items: ScreenshotDto[]) => void) => {
    const listener = (
      _event: IpcRendererEvent,
      items: ScreenshotDto[],
    ) => handler(items);
    ipcRenderer.on('island:screenshots-changed', listener);
    return () =>
      ipcRenderer.removeListener('island:screenshots-changed', listener);
  },

  /** Сон / выход / завершение сеанса — остановить таймеры */
  onPauseActivity: (
    handler: (payload: {
      reason: string;
      at: number;
      tasks?: unknown;
      settings?: unknown;
    }) => void,
  ) => {
    const listener = (
      _event: IpcRendererEvent,
      payload: {
        reason: string;
        at: number;
        tasks?: unknown;
        settings?: unknown;
      },
    ) => handler(payload);
    ipcRenderer.on('island:pause-activity', listener);
    return () =>
      ipcRenderer.removeListener('island:pause-activity', listener);
  },

  /** Перед выходом main просит сбросить состояние из памяти на диск */
  onFlushState: (handler: () => void) => {
    const listener = () => {
      try {
        handler();
      } finally {
        ipcRenderer.send('island:state-flushed');
      }
    };
    ipcRenderer.on('island:flush-state', listener);
    return () => ipcRenderer.removeListener('island:flush-state', listener);
  },
};

contextBridge.exposeInMainWorld('island', islandApi);
export type IslandApi = typeof islandApi;
