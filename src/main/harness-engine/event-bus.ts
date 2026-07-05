/**
 * event-bus.ts — Main-process harness event router
 *
 * The harness runtime emits typed events here. The bus mirrors every payload to
 * the active Electron window so the renderer can update without awaiting the
 * full execution lifecycle.
 */
import { EventEmitter } from 'events';
import type { BrowserWindow } from 'electron';
import type { HarnessEventPayload } from '../../types/ipc-events';

export const HARNESS_EVENT_CHANNEL = 'heliox:harness-event' as const;
export const HARNESS_EVENT_NAME = 'harness-event' as const;

type HarnessEventWindow = Pick<BrowserWindow, 'webContents'> & {
  isDestroyed?: () => boolean;
};

class HarnessEventBus extends EventEmitter {
  private mainWindow: HarnessEventWindow | null = null;

  setMainWindow(mainWindow: HarnessEventWindow | null): void {
    this.mainWindow = mainWindow;
  }

  emitHarnessEvent(payload: HarnessEventPayload): void {
    this.emit(HARNESS_EVENT_NAME, payload);

    if (!this.mainWindow) return;
    if (this.mainWindow.isDestroyed?.()) return;

    this.mainWindow.webContents.send(HARNESS_EVENT_CHANNEL, payload);
  }
}

export const harnessEventBus = new HarnessEventBus();

export function setHarnessEventWindow(mainWindow: HarnessEventWindow | null): void {
  harnessEventBus.setMainWindow(mainWindow);
}
