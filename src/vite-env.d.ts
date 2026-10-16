export {};

import type { ViewMode } from './viewMode';

type IslandMode = 'collapsed' | 'peek' | 'expanded';
type CompactView = 'info' | 'timer' | 'minimal' | 'glass' | 'cactus';
type EdgeOrFree = 'top' | 'bottom' | 'left' | 'right' | 'free';

interface ClipboardItemDto {
  id: string;
  text: string;
  createdAt: number;
}

interface ScreenshotDto {
  id: string;
  createdAt: number;
  thumbDataUrl: string;
}

interface QuickPathDto {
  label: string;
  value: string;
}

interface IslandApi {
  setMode: (
    mode: IslandMode,
  ) => Promise<{
    ok: boolean;
    mode?: IslandMode;
    edge?: EdgeOrFree;
    viewMode?: ViewMode;
    /** Прямоугольник окна до и после смены режима, DIP */
    from?: { x: number; y: number; width: number; height: number };
    to?: { x: number; y: number; width: number; height: number };
  }>;
  setViewMode: (
    mode: ViewMode,
  ) => Promise<{ ok: boolean; viewMode?: ViewMode; edge?: EdgeOrFree; sizeScale?: number }>;
  adjustSizeScale: (
    delta: number,
  ) => Promise<{ ok: boolean; sizeScale?: number }>;
  setSizeScale: (
    scale: number,
  ) => Promise<{ ok: boolean; sizeScale?: number }>;
  setIgnoreMouse: (ignore: boolean) => Promise<{ ok: boolean }>;
  dragStart: () => Promise<{
    ok: boolean;
    glassStage?: {
      x: number;
      y: number;
      width: number;
      height: number;
      areaWidth: number;
      areaHeight: number;
    };
  }>;
  glassStageReady: () => Promise<{ ok: boolean }>;
  captureFrostBehind: () => Promise<{ ok: boolean; dataUrl?: string }>;
  dragMove: (
    dx: number,
    dy: number,
  ) => Promise<{
    ok: boolean;
    glassStage?: {
      x: number;
      y: number;
      width: number;
      height: number;
      areaWidth: number;
      areaHeight: number;
    };
  }>;
  dragEnd: () => Promise<{
    ok: boolean;
    edge?: string;
    offset?: number;
    glassStage?: null;
  }>;
  loadState: () => Promise<{
    ok: boolean;
    state: {
      tasks?: unknown;
      settings?: unknown;
      window?: {
        edge: string;
        offset: number;
        compactView?: CompactView;
        viewMode?: ViewMode;
        sizeScale?: number;
      };
    } | null;
    edge?: EdgeOrFree;
    viewMode?: ViewMode;
    compactView?: CompactView;
    sizeScale?: number;
    workbookPath?: string;
  }>;
  saveState: (payload: {
    tasks?: unknown;
    settings?: unknown;
  }) => Promise<{ ok: boolean }>;
  quit: () => Promise<{ ok: boolean }>;
  logCompletedTask: (payload: {
    title: string;
    elapsedMs: number;
    subtasks?: string[];
  }) => Promise<{ ok: boolean; path?: string; sheet?: string; error?: string }>;
  logNote: (payload: {
    text: string;
  }) => Promise<{ ok: boolean; path?: string; sheet?: string; error?: string }>;
  openWorkbook: () => Promise<{ ok: boolean; path?: string }>;
  getClipboardHistory: () => Promise<{
    ok: boolean;
    items: ClipboardItemDto[];
  }>;
  clearClipboardHistory: () => Promise<{ ok: boolean }>;
  copyClipboardItem: (id: string) => Promise<{ ok: boolean }>;
  pasteClipboardItem: (id: string) => Promise<{ ok: boolean }>;
  getQuickPaths: () => Promise<{ ok: boolean; items: QuickPathDto[] }>;
  copyText: (text: string) => Promise<{ ok: boolean }>;
  listScreenshots: () => Promise<{ ok: boolean; items: ScreenshotDto[] }>;
  deleteScreenshot: (id: string) => Promise<{ ok: boolean }>;
  reorderScreenshots: (orderedIds: string[]) => Promise<{ ok: boolean }>;
  getScreenshotData: (
    id: string,
  ) => Promise<{ ok: boolean; dataUrl: string | null }>;
  copyScreenshot: (id: string) => Promise<{ ok: boolean }>;
  startScreenshotDrag: (id: string) => void;
  deleteScreenshots: (ids: string[]) => Promise<{ ok: boolean; deleted: number }>;
  copyScreenshots: (
    ids: string[],
  ) => Promise<{ ok: boolean; mode: 'image' | 'files'; count: number }>;
  saveScreenshotsTo: (ids: string[]) => Promise<{
    ok: boolean;
    canceled: boolean;
    dir?: string;
    saved: number;
    failed: number;
  }>;
  startScreenshotsDrag: (ids: string[]) => void;
  sendCapsuleRect: (rect: {
    x: number;
    y: number;
    width: number;
    height: number;
    radius: number;
  }) => void;
  sendBackdropShapes: (
    shapes: { x: number; y: number; width: number; height: number; radius: number }[],
  ) => void;
  getIcons: () => Promise<{
    ok: boolean;
    files: Record<string, { id: string; name: string; ext: 'svg' | 'png' }[]>;
    choice: Record<string, string>;
  }>;
  setIconChoice: (
    slot: string,
    id: string,
  ) => Promise<{ ok: boolean; choice?: Record<string, string> }>;
  openIconsFolder: () => Promise<{ ok: boolean }>;
  onIconsChanged: (
    handler: (payload: {
      files: Record<string, { id: string; name: string; ext: 'svg' | 'png' }[]>;
      choice: Record<string, string>;
    }) => void,
  ) => () => void;
  onEdgeChanged: (
    handler: (payload: {
      edge: EdgeOrFree;
      viewMode: ViewMode;
      topCenter?: boolean;
      sizeScale?: number;
    }) => void,
  ) => () => void;
  onCollapseRequest: (handler: () => void) => () => void;
  onClipboardChanged: (
    handler: (items: ClipboardItemDto[]) => void,
  ) => () => void;
  onScreenshotsChanged: (
    handler: (items: ScreenshotDto[]) => void,
  ) => () => void;
  onPauseActivity: (
    handler: (payload: {
      reason: string;
      at: number;
      tasks?: unknown;
      settings?: unknown;
    }) => void,
  ) => () => void;
  onFlushState: (handler: () => void) => () => void;
}

declare global {
  interface Window {
    island: IslandApi;
  }
}
