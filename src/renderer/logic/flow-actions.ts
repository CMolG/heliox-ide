/**
 * flow-actions.ts — Shared "export the active flow" actions
 *
 * Responsibility:
 * - Extracted from `FrameNode.tsx`'s original `handleExport` so the exact
 *   same compile → export → toast behavior can be triggered from more than
 *   one surface (the Frame node's header button AND the Inspector's
 *   FlowInspector actions row) without duplicating the logic.
 * - `exportActiveFlow` is byte-for-byte the same behavior FrameNode has always
 *   had: compile the current canvas, then hand the result to
 *   `window.fluxorAPI.exportFlow` (the portable fluxor-flow.json interchange
 *   format — src/main/flow-export/fluxor-flow.ts).
 * - `exportActiveFlowMarkdown` mirrors that same shape but renders the
 *   compiled flow to Markdown (`lib/flow-markdown.ts`) and saves it via the
 *   generic `window.fluxorAPI.saveFile` dialog instead.
 *
 * Both functions pull the compiler off `harness-store` via `getState()`
 * rather than accepting it as a parameter — they are plain async functions,
 * not hooks, so they cannot call `useHarnessStore(selector)` themselves; any
 * zustand store created via `create()` exposes `getState()` as a static
 * method for exactly this out-of-component use case. This keeps the call
 * sites in both FrameNode and FlowInspector to a single argument (`addToast`).
 *
 * Boundaries:
 * - Does NOT own compilation itself (harness-store's `compileCurrentCanvas`
 *   does) or Markdown rendering (`lib/flow-markdown.ts` does) — this module
 *   only wires them together with the IPC calls and user-facing toasts.
 */
import { useHarnessStore } from '../store/harness-store';
import { flowToMarkdown } from '../lib/flow-markdown';

type AddToast = (message: string, type?: 'success' | 'error' | 'info') => void;

/**
 * Compile the current canvas and export it to the portable fluxor-flow.json
 * interchange format via a native save dialog. Identical behavior to
 * FrameNode's original inline `handleExport`:
 *   - Compile failure (or an empty/invalid canvas) -> error toast, no IPC call.
 *   - Missing IPC bridge -> error toast, no IPC call.
 *   - User cancels the save dialog -> no toast.
 *   - IPC failure -> error toast with the reported message.
 *   - Success -> success toast naming the saved path.
 */
export async function exportActiveFlow(addToast: AddToast): Promise<void> {
  const flow = useHarnessStore.getState().compileCurrentCanvas();
  if (!flow) {
    addToast('Fix compile errors before exporting this flow.', 'error');
    return;
  }
  const api = window.fluxorAPI;
  if (!api?.exportFlow) {
    addToast('Cannot export because the IPC bridge is unavailable.', 'error');
    return;
  }
  try {
    const result = await api.exportFlow(flow);
    if (result.success) {
      addToast(`Exported "${flow.name}" to ${result.path ?? 'disk'}.`, 'success');
    } else if (!result.canceled) {
      addToast(result.error ?? 'Flow export failed.', 'error');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[flow-actions] flow export failed:', message);
    addToast(`Flow export failed: ${message}`, 'error');
  }
}

/**
 * Compile the current canvas, render it to Markdown (`flowToMarkdown`), and
 * save it via the generic save-file dialog. Mirrors `exportActiveFlow`'s
 * toast vocabulary:
 *   - Compile failure -> error toast, `saveFile` never called.
 *   - Missing IPC bridge -> error toast, `saveFile` never called.
 *   - Saved -> success toast naming the default filename.
 *   - `saveFile` resolves `false` -> silent. Unlike `exportFlow`,
 *     `fluxor:save-file`'s main-process handler collapses "user canceled the
 *     dialog" and "write failed" into the same boolean `false` (no
 *     `canceled`/`error` discriminant is round-tripped) — treating it as a
 *     silent cancel, the more common case, avoids crying "error" on a plain
 *     dismiss.
 */
export async function exportActiveFlowMarkdown(addToast: AddToast): Promise<void> {
  const flow = useHarnessStore.getState().compileCurrentCanvas();
  if (!flow) {
    addToast('Fix compile errors before exporting this flow.', 'error');
    return;
  }
  const api = window.fluxorAPI;
  if (!api?.saveFile) {
    addToast('Cannot export because the IPC bridge is unavailable.', 'error');
    return;
  }
  const defaultName = `${flow.id}.md`;
  try {
    const saved = await api.saveFile(defaultName, flowToMarkdown(flow));
    if (saved) {
      addToast(`Exported "${flow.name}" markdown to ${defaultName}.`, 'success');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[flow-actions] markdown export failed:', message);
    addToast(`Markdown export failed: ${message}`, 'error');
  }
}
