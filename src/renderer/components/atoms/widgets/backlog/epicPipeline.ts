// atoms/widgets/backlog/epicPipeline.ts
//
// Deterministic épica→assembly mapper (F0 task decision 3 — no LLM call).
// One epic card = one PipelineAssemblyStep; prevStepIds come from related[]
// filtered to earlier-sorted epic siblings (dropping unknown/self/forward
// references the same way pipeline-generator.ts's sanitizeLoopBacks drops
// invalid loopBackTo targets), falling back to a linear chain against the
// immediately-preceding step when a card has no valid backward related[]
// entry — guarantees a single connected, acyclic, deterministic DAG.
import type { PipelineAssembly, PipelineAssemblyStep } from '@/types/meta-agent';
import type { BacklogCard, BacklogPriority } from '@/types/market';

const PRIORITY_RANK: Record<BacklogPriority, number> = {
  superHigh: 0, high: 1, medium: 2, low: 3, superLow: 4,
};

/** Exported so launchActions.ts's "flow por épica" wiring (F3 Task 6) can map the assembly's root step id back to its originating card without re-deriving the id scheme. */
export function slugify(taskId: string): string {
  return taskId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'step';
}

export function epicToPipelineAssembly(cards: BacklogCard[], epicName: string): PipelineAssembly {
  const sorted = [...cards].sort((a, b) => {
    const rank = (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
    return rank !== 0 ? rank : a.order - b.order;
  });

  const idByTaskId = new Map(sorted.map((c) => [c.taskId, slugify(c.taskId)]));
  const indexByTaskId = new Map(sorted.map((c, i) => [c.taskId, i]));

  const steps: PipelineAssemblyStep[] = sorted.map((c, i) => {
    const validRelated = c.related
      .filter((relTaskId) => {
        const relIndex = indexByTaskId.get(relTaskId);
        return relIndex !== undefined && relIndex < i; // must be an EARLIER step — drop forward/unknown/self
      })
      .map((relTaskId) => idByTaskId.get(relTaskId)!);

    const prevStepIds = validRelated.length > 0
      ? [...new Set(validRelated)]
      : (i > 0 ? [idByTaskId.get(sorted[i - 1].taskId)!] : []);

    return {
      id: idByTaskId.get(c.taskId)!,
      prompt: `${c.title}\n\n${c.description}`,
      roleId: '',
      modIds: [],
      prevStepIds,
    };
  });

  return {
    frameTitle: `Epic: ${epicName}`,
    description: `Deterministic flow generated from ${sorted.length} backlog card(s) in epic "${epicName}".`,
    missingCapabilitiesRequested: [],
    steps,
  };
}
