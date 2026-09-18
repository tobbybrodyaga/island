export {};

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
    compactView?: CompactView;
  }>;
  setCompactView: (
    view: CompactView,
  ) => Promise<{ ok: boolean; compactView?: CompactView; edge?: EdgeOrFree }>;
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
        sizeScale?: number;
      };
    } | null;
    edge?: EdgeOrFree;
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
  onEdgeChanged: (
    handler: (payload: {
      edge: EdgeOrFree;
      compactView: CompactView;
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
