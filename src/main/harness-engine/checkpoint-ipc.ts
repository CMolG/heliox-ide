/**
 * checkpoint-ipc.ts — IPC handlers for time-travel checkpoint operations
 *
 * Responsibility:
 * - Register `harness:list-checkpoints` and `harness:replay-from` on ipcMain.
 * - Delegate to `checkpoints.ts` (listCheckpoints) and `replay.ts` (replayFrom).
 *
 * Boundaries:
 * - Additive only: does NOT modify any existing handler.
 * - Called once from `registerIpcHandlers` after all existing handlers are set up.
 *
 * Architecture note:
 * The handlers follow the {success, data?, error?} return convention used by
 * every other handler in `ipc-handlers.ts` so the renderer can consume them
 * uniformly.
 */
import { ipcMain } from 'electron';
import type { AgenticFlow } from '../../types/harness';
import { listCheckpoints } from './checkpoints';
import { replayFrom } from './replay';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

let registered = false;

/** Register checkpoint + replay IPC handlers (idempotent). */
export function registerCheckpointIpcHandlers(): void {
  if (registered) return;
  registered = true;

  // ── harness:list-checkpoints ───────────────────────────────────────────────
  // Request: { runId: string }
  // Response: { success, data?: CheckpointRecord[], error? }
  ipcMain.handle('harness:list-checkpoints', (_event, runId: string) => {
    if (typeof runId !== 'string' || runId.trim().length === 0) {
      return { success: false, error: 'runId must be a non-empty string.' };
    }
    try {
      const data = listCheckpoints(runId);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });

  // ── harness:replay-from ────────────────────────────────────────────────────
  // Request: { flow: AgenticFlow, checkpointId: string, editedOutput?: string }
  // Response: { success, data?: ReplayFromResult, error? }
  ipcMain.handle(
    'harness:replay-from',
    async (
      _event,
      flow: AgenticFlow,
      checkpointId: string,
      editedOutput?: string,
    ) => {
      if (!flow || typeof flow !== 'object') {
        return { success: false, error: 'Invalid AgenticFlow payload.' };
      }
      if (typeof checkpointId !== 'string' || checkpointId.trim().length === 0) {
        return { success: false, error: 'checkpointId must be a non-empty string.' };
      }

      try {
        const data = await replayFrom(
          flow,
          checkpointId,
          typeof editedOutput === 'string' ? editedOutput : undefined,
        );
        return { success: true, data };
      } catch (err) {
        return { success: false, error: errMsg(err) };
      }
    },
  );
}
