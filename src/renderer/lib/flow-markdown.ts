/**
 * flow-markdown.ts — Human-readable Markdown rendering of a compiled AgenticFlow
 *
 * Companion to the portable JSON interchange format
 * (src/main/flow-export/heliox-flow.ts) — while that module targets other
 * runtimes (Java/Python/SDK conformance), this one targets HUMANS: a flow
 * summary a developer can read in a PR description, paste into a doc, or
 * skim without opening the IDE. `flowToMarkdown` is pure (no IPC, no store
 * access) so it is trivially unit-testable and reusable from any caller that
 * already holds a compiled `AgenticFlow` (see `logic/flow-actions.ts`'s
 * `exportActiveFlowMarkdown`, the sole current caller).
 *
 * Module-graph note: this file lives in `src/renderer/lib`, so it must never
 * import RUNTIME code from `src/main` (only the main process may depend on
 * main-process modules — mixing bundles breaks the renderer/main split). The
 * deterministic topological sort below is therefore imported from
 * `src/types/harness.ts`'s `topoSortAgenticSteps` rather than duplicated here
 * or imported from `heliox-flow.ts` (a `src/main` module off-limits to the
 * renderer) — `types/harness.ts` is a pure, boundary-safe shared home for
 * both processes (it already exports `clampLoopIterations` for the same
 * reason), so both this module and `heliox-flow.ts` share one canonical
 * implementation instead of maintaining independent copies.
 *
 * Output contract (exercised byte-for-byte by flow-markdown.test.ts):
 *   - `# <flow.name>` as the H1.
 *   - Optional meta lines (Description / Tags (comma-joined) / Author /
 *     Version), each omitted when the matching `AgenticFlow` field is
 *     undefined, separated from the H1 by a blank line when at least one
 *     is present.
 *   - One `## <step.id>` section per step, in the same deterministic
 *     topological order as the JSON export (root first, then by dependency
 *     depth, stable tie-break by id). Note: `AgenticStep` carries no
 *     separate display "title" — canvas step titles never round-trip
 *     through compilation (see harness-compiler.ts) — so both the heading
 *     and every "Depends on" reference below use the step's stable `id`.
 *   - Per step (each omitted when absent): Type, Description, a fenced
 *     Prompt block, a fenced "Role prompt" block (roles' systemPrompts
 *     joined with '\n\n', mirroring heliox-flow.ts's flattening), a Tools
 *     bullet list, a "Depends on" bullet list (from `prevStepIds`), and a
 *     Model override line.
 *   - A trailing `## Loops` section (omitted when the flow has none), one
 *     `source → target ×maxIterations` line per loop.
 */
import { topoSortAgenticSteps, type AgenticFlow } from '@/types/harness';

// ---------------------------------------------------------------------------
// flowToMarkdown
// ---------------------------------------------------------------------------

/**
 * Render a compiled `AgenticFlow` as a human-readable Markdown document.
 * See this module's header doc-comment for the exact output contract.
 */
export function flowToMarkdown(flow: AgenticFlow): string {
  const lines: string[] = [];
  lines.push(`# ${flow.name}`);

  const metaLines: string[] = [];
  if (flow.description !== undefined) metaLines.push(`Description: ${flow.description}`);
  if (flow.tags !== undefined && flow.tags.length > 0) metaLines.push(`Tags: ${flow.tags.join(', ')}`);
  if (flow.author !== undefined) metaLines.push(`Author: ${flow.author}`);
  if (flow.version !== undefined) metaLines.push(`Version: ${flow.version}`);
  if (metaLines.length > 0) {
    lines.push('', ...metaLines);
  }

  const steps = topoSortAgenticSteps(Object.values(flow.stepsRecord));
  for (const step of steps) {
    lines.push('', `## ${step.id}`);
    lines.push('', `Type: ${step.type}`);

    if (step.description !== undefined) {
      lines.push('', `Description: ${step.description}`);
    }

    lines.push('', 'Prompt:', '```', step.prompt, '```');

    const systemPrompt = step.roles.length > 0
      ? step.roles.map((r) => r.systemPrompt).join('\n\n')
      : undefined;
    if (systemPrompt !== undefined) {
      lines.push('', 'Role prompt:', '```', systemPrompt, '```');
    }

    if (step.tools.length > 0) {
      lines.push('', 'Tools:', ...step.tools.map((t) => `- ${t.name}`));
    }

    if (step.prevStepIds.length > 0) {
      lines.push('', 'Depends on:', ...step.prevStepIds.map((id) => `- ${id}`));
    }

    if (step.model !== undefined) {
      lines.push('', `Model: ${step.model}`);
    }
  }

  if (flow.loops !== undefined && flow.loops.length > 0) {
    lines.push('', '## Loops', '');
    for (const loop of flow.loops) {
      lines.push(`${loop.sourceStepId} → ${loop.targetStepId} ×${loop.maxIterations}`);
    }
  }

  return lines.join('\n') + '\n';
}
