/**
 * harness-compiler.ts — Visual canvas → agentic AST compiler
 *
 * Keeps xyflow/desktop layout concerns out of the execution contract.
 */
import type {
  CanvasGraphNode,
  FrameGraphNode,
  MentalGraphEdge,
  MentalGraphNode,
  PhaseGraphNode,
  StepGraphNode,
} from '@/types/desktop';
import {
  clampLoopIterations,
  LOOP_DEFAULT_MAX_ITERATIONS,
  type AgenticFlow,
  type AgenticLoop,
  type AgenticMentalContext,
  type AgenticMod,
  type AgenticPhase,
  type AgenticRole,
  type AgenticStep,
  type AgenticStepType,
  type AgenticTool,
} from '@/types/harness';

type UnknownRecord = Record<string, unknown>;

export interface CompileFlowOptions {
  flowId?: string;
  name?: string;
  /**
   * Force this step id to be treated as the compiled flow's root, bypassing the
   * zero-in-degree root inference below. Used by scoped (single-step / downstream)
   * compiles where the step's real canvas predecessors are intentionally excluded.
   * Must be a member of the compiled step set (either `includeIds`, or all Step
   * nodes on the canvas when `includeIds` is omitted) or compilation throws.
   */
  rootStepId?: string;
  /**
   * Restrict compilation to this subset of Step node ids. Step-to-step edges are
   * only honored when BOTH endpoints are included, so prev/next lists come out
   * pre-trimmed to the included set. Omit to compile every Step node on the
   * canvas (existing whole-flow behavior).
   */
  includeIds?: Set<string>;
}

export class HarnessCompilerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HarnessCompilerError';
  }
}

const VISUAL_METADATA_KEYS = new Set([
  'icon',
  'iconLibrary',
  'color',
  'position',
  'width',
  'height',
  'shape',
  'createdAt',
]);

const MOD_TYPES = new Set<AgenticMod['type']>([
  'pre_process',
  'post_process',
  'system_override',
]);

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStepGraphNode(node: CanvasGraphNode): node is StepGraphNode {
  return node.type === 'step';
}

function isMentalGraphNode(node: CanvasGraphNode): node is MentalGraphNode {
  return node.type !== 'step';
}

function isFrameGraphNode(node: CanvasGraphNode): node is FrameGraphNode {
  return node.type === 'frame';
}

function isPhaseGraphNode(node: CanvasGraphNode): node is PhaseGraphNode {
  return node.type === 'phase';
}

/**
 * Finds the Frame that visually owns `stepId` — either by listing it in
 * `childIds`, or via the step's own `parentId` pointing back at the frame.
 * Shared by `compileFlowFromCanvas` (flow metadata passthrough below) and any
 * renderer surface that needs a step's owning Frame's canvas data without
 * recompiling the whole flow (e.g. StepRunEvidence.tsx's Rosetta context-mode
 * badge, which reads `.data.contextMode` off the result).
 */
export function findOwningFrame(stepId: string, nodes: CanvasGraphNode[]): FrameGraphNode | undefined {
  const step = nodes.find((n): n is StepGraphNode => isStepGraphNode(n) && n.id === stepId);
  return nodes.find(
    (n): n is FrameGraphNode =>
      isFrameGraphNode(n) && (n.data.childIds.includes(stepId) || step?.parentId === n.id),
  );
}

/**
 * Finds the Phase node that owns `stepId` via the step's own `parentId`
 * pointing at a PhaseGraphNode — the second nesting level (frame > phase >
 * step, spec §3.2). Unlike findOwningFrame there is no childIds-based
 * fallback: a step's membership in the COMPILED AgenticPhase.stepIds is
 * authored directly on the phase node's own `data.childIds` (see the phase
 * validation block below), not derived from this lookup — this helper is for
 * canvas/UI consumers that need "which phase, if any, visually owns this
 * step" (mirrors findOwningFrame's own role serving StepRunEvidence.tsx).
 */
export function findOwningPhase(stepId: string, nodes: CanvasGraphNode[]): PhaseGraphNode | undefined {
  const step = nodes.find((n): n is StepGraphNode => isStepGraphNode(n) && n.id === stepId);
  if (!step?.parentId) return undefined;
  return nodes.find((n): n is PhaseGraphNode => isPhaseGraphNode(n) && n.id === step.parentId);
}

function stringField(record: UnknownRecord, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function cloneJsonValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map(cloneJsonValue)
      .filter((item) => item !== undefined);
  }

  if (isRecord(value)) {
    const result: UnknownRecord = {};
    for (const [key, entry] of Object.entries(value)) {
      const nextValue = cloneJsonValue(entry);
      if (nextValue !== undefined) result[key] = nextValue;
    }
    return result;
  }

  return undefined;
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const cloned = cloneJsonValue(value);
  if (!isRecord(cloned)) return undefined;
  return Object.keys(cloned).length > 0 ? cloned : undefined;
}

function logicalFallbackConfig(record: UnknownRecord, reservedKeys: string[]): Record<string, unknown> | undefined {
  const reserved = new Set([...reservedKeys, ...VISUAL_METADATA_KEYS]);
  const config: UnknownRecord = {};

  for (const [key, value] of Object.entries(record)) {
    if (reserved.has(key)) continue;
    const nextValue = cloneJsonValue(value);
    if (nextValue !== undefined) config[key] = nextValue;
  }

  return Object.keys(config).length > 0 ? config : undefined;
}

function normalizeTools(value: unknown): AgenticTool[] {
  if (!Array.isArray(value)) return [];

  return value.filter(isRecord).map((tool, index) => {
    const id = stringField(tool, 'id') ?? stringField(tool, 'name') ?? `tool-${index + 1}`;
    const name = stringField(tool, 'name') ?? id;
    const config = plainRecord(tool.config) ?? logicalFallbackConfig(tool, ['id', 'name', 'config']);

    return {
      id,
      name,
      ...(config ? { config } : {}),
    };
  });
}

function normalizeMods(value: unknown): AgenticMod[] {
  if (!Array.isArray(value)) return [];

  return value.filter(isRecord).map((mod, index) => {
    const id = stringField(mod, 'id') ?? stringField(mod, 'name') ?? `mod-${index + 1}`;
    const name = stringField(mod, 'name') ?? id;
    const rawType = mod.type;
    const type: AgenticMod['type'] = typeof rawType === 'string' && MOD_TYPES.has(rawType as AgenticMod['type'])
      ? rawType as AgenticMod['type']
      : 'system_override';
    const config = plainRecord(mod.config) ?? logicalFallbackConfig(mod, ['id', 'name', 'type', 'config']);

    return {
      id,
      name,
      type,
      ...(config ? { config } : {}),
    };
  });
}

function normalizeRoles(value: unknown): AgenticRole[] {
  if (!Array.isArray(value)) return [];

  return value.filter(isRecord).map((role, index) => {
    const id = stringField(role, 'id') ?? stringField(role, 'name') ?? `role-${index + 1}`;
    const name = stringField(role, 'name') ?? id;
    const roleConfig = plainRecord(role.roleConfig) ?? plainRecord(role.config);
    const systemPrompt =
      stringField(role, 'systemPrompt') ??
      (roleConfig ? stringField(roleConfig, 'systemPrompt') : null) ??
      stringField(role, 'description') ??
      name;

    return { id, name, systemPrompt };
  });
}

function normalizeStepType(data: UnknownRecord): AgenticStepType {
  return stringField(data, 'stepType') ?? stringField(data, 'type') ?? 'llm_call';
}

function normalizePrompt(node: StepGraphNode): string {
  const data = node.data as UnknownRecord;
  return stringField(data, 'prompt') ?? stringField(data, 'description') ?? stringField(data, 'title') ?? node.text;
}

function appendUnique(map: Map<string, string[]>, key: string, value: string): void {
  const values = map.get(key);
  if (!values) {
    map.set(key, [value]);
    return;
  }
  if (!values.includes(value)) values.push(value);
}

/** BFS over `adjacency`, inclusive of `start`. Used for forward/backward reachability. */
function reachableSet(start: string, adjacency: Map<string, string[]>): Set<string> {
  const visited = new Set<string>([start]);
  const queue: string[] = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return visited;
}

function intersectSets<T>(a: Set<T>, b: Set<T>): Set<T> {
  const result = new Set<T>();
  for (const item of a) {
    if (b.has(item)) result.add(item);
  }
  return result;
}

function assertAcyclic(stepIds: string[], nextByStepId: Map<string, string[]>): void {
  const visitState = new Map<string, 'visiting' | 'visited'>();

  const visit = (stepId: string, path: string[]): void => {
    const state = visitState.get(stepId);
    if (state === 'visited') return;
    if (state === 'visiting') {
      const cycleStart = path.indexOf(stepId);
      const cycle = [...path.slice(Math.max(0, cycleStart)), stepId].join(' -> ');
      throw new HarnessCompilerError(`Cannot compile step graph with a cycle: ${cycle}`);
    }

    visitState.set(stepId, 'visiting');
    for (const nextStepId of nextByStepId.get(stepId) ?? []) {
      visit(nextStepId, [...path, stepId]);
    }
    visitState.set(stepId, 'visited');
  };

  for (const stepId of stepIds) {
    visit(stepId, []);
  }
}

function getMentalContext(
  stepId: string,
  edges: MentalGraphEdge[],
  mentalById: Map<string, MentalGraphNode>,
): AgenticMentalContext[] {
  const context: AgenticMentalContext[] = [];

  for (const edge of edges) {
    const incomingMentalNode = edge.targetId === stepId ? mentalById.get(edge.sourceId) : undefined;
    if (incomingMentalNode) {
      context.push({
        id: incomingMentalNode.id,
        text: incomingMentalNode.text,
        relationToStep: 'incoming',
      });
      continue;
    }

    const outgoingMentalNode = edge.sourceId === stepId ? mentalById.get(edge.targetId) : undefined;
    if (outgoingMentalNode) {
      context.push({
        id: outgoingMentalNode.id,
        text: outgoingMentalNode.text,
        relationToStep: 'outgoing',
      });
    }
  }

  return context;
}

export function compileFlowFromCanvas(
  nodes: CanvasGraphNode[],
  edges: MentalGraphEdge[],
  options: CompileFlowOptions = {},
): AgenticFlow {
  const allStepNodes = nodes.filter(isStepGraphNode);
  const stepNodes = options.includeIds
    ? allStepNodes.filter((step) => options.includeIds!.has(step.id))
    : allStepNodes;
  if (stepNodes.length === 0) {
    throw new HarnessCompilerError('Cannot compile canvas without Step nodes.');
  }

  const stepById = new Map(stepNodes.map((step) => [step.id, step]));
  const stepIds = stepNodes.map((step) => step.id);
  const mentalById = new Map(nodes.filter(isMentalGraphNode).map((node) => [node.id, node]));
  const prevByStepId = new Map(stepIds.map((id) => [id, [] as string[]]));
  const nextByStepId = new Map(stepIds.map((id) => [id, [] as string[]]));
  const loopEdges: MentalGraphEdge[] = [];

  for (const edge of edges) {
    if (!stepById.has(edge.sourceId) || !stepById.has(edge.targetId)) continue;
    if (edge.type === 'loop') {
      loopEdges.push(edge);
      continue;
    }
    appendUnique(nextByStepId, edge.sourceId, edge.targetId);
    appendUnique(prevByStepId, edge.targetId, edge.sourceId);
  }

  assertAcyclic(stepIds, nextByStepId);

  let rootStepId: string;
  if (options.rootStepId) {
    if (!stepById.has(options.rootStepId)) {
      throw new HarnessCompilerError(`Cannot compile flow: root step "${options.rootStepId}" is not part of the included step set.`);
    }
    rootStepId = options.rootStepId;
  } else {
    const rootStepIds = stepIds.filter((stepId) => (prevByStepId.get(stepId) ?? []).length === 0);
    if (rootStepIds.length === 0) {
      throw new HarnessCompilerError('Cannot compile flow without a root Step node.');
    }
    if (rootStepIds.length > 1) {
      throw new HarnessCompilerError(`Cannot compile flow with multiple root Step nodes: ${rootStepIds.join(', ')}`);
    }
    rootStepId = rootStepIds[0];
  }

  // Validate loop-back edges and derive `flow.loops`. Bodies are computed here
  // purely to check disjointness — never persisted on the compiled AgenticFlow;
  // each runtime (renderer preview, main executor) recomputes its own body from
  // `loops` + the forward graph.
  const loops: AgenticLoop[] = [];
  const bodyByLoopId = new Map<string, Set<string>>();
  for (const loopEdge of loopEdges) {
    const sourceStepId = loopEdge.sourceId;
    const targetStepId = loopEdge.targetId;
    if (sourceStepId === targetStepId) {
      throw new HarnessCompilerError(`Loop edge cannot connect a step to itself: "${sourceStepId}".`);
    }

    const reachFromTarget = reachableSet(targetStepId, nextByStepId);
    if (!reachFromTarget.has(sourceStepId)) {
      throw new HarnessCompilerError(
        `Loop edge must point back to an upstream step: "${targetStepId}" does not reach "${sourceStepId}" through forward edges.`,
      );
    }
    const coReachToSource = reachableSet(sourceStepId, prevByStepId);
    const body = intersectSets(reachFromTarget, coReachToSource);

    for (const [otherLoopId, otherBody] of bodyByLoopId) {
      const shared = [...body].filter((stepId) => otherBody.has(stepId));
      if (shared.length > 0) {
        throw new HarnessCompilerError(
          `Nested or overlapping loops are not supported: steps ${shared.join(', ')} belong to both loop "${otherLoopId}" and loop "${loopEdge.id}".`,
        );
      }
    }
    bodyByLoopId.set(loopEdge.id, body);

    loops.push({
      id: loopEdge.id,
      sourceStepId,
      targetStepId,
      maxIterations: clampLoopIterations(loopEdge.maxIterations ?? LOOP_DEFAULT_MAX_ITERATIONS),
    });
  }

  // Phase membership validation + passive assembly (spec §2.3, §4). Structurally
  // parallel to the loop-processing block above: same map reuse (stepById,
  // nextByStepId, prevByStepId, reachableSet), same "throw HarnessCompilerError
  // naming the offending phase(s)" discipline. Order relative to loops does
  // not matter for correctness (independent concerns) — kept after loops to
  // mirror the spec's own §2 (membership) → §3 (loop relationship) ordering.
  const allStepIds = new Set(allStepNodes.map((s) => s.id));
  const allPhaseNodes = nodes.filter(isPhaseGraphNode);
  const phaseNodesById = new Map(allPhaseNodes.map((p) => [p.id, p]));

  // Bounded-compile interaction (§4): a phase whose members are entirely REAL
  // steps but not 100% present in THIS compile's included set is silently
  // omitted (mirrors the loop-edge filter at the edge loop above) — its exit
  // gate could never be satisfied over an incomplete member set, and a scoped
  // compile is already, by design, a partial view. A phase referencing a
  // stepId that is not a real Step node ANYWHERE on the canvas is always a
  // hard error below, regardless of includeIds — that is a stale/authoring
  // bug, not a scoping artifact.
  const scopedPhaseNodes = allPhaseNodes.filter((phaseNode) => {
    const allMembersAreRealSteps = phaseNode.data.childIds.every((stepId) => allStepIds.has(stepId));
    if (!allMembersAreRealSteps) return true; // let the loop below throw "unknown step"
    return phaseNode.data.childIds.every((stepId) => stepById.has(stepId));
  });

  const phases: AgenticPhase[] = [];
  const phaseIds = new Set<string>();
  const stepIdOwner = new Map<string, string>(); // claimed stepId -> owning phase id

  for (const phaseNode of scopedPhaseNodes) {
    const phaseId = phaseNode.id;
    const phaseName = phaseNode.data.title;

    if (phaseIds.has(phaseId)) {
      throw new HarnessCompilerError(`Duplicate phase id "${phaseId}": phase ids must be unique within a flow.`);
    }
    phaseIds.add(phaseId);

    if (phaseNode.data.childIds.length === 0) {
      throw new HarnessCompilerError(`Phase "${phaseName}" (${phaseId}) has no member steps.`);
    }

    const uniqueStepIds = [...new Set(phaseNode.data.childIds)];
    for (const stepId of uniqueStepIds) {
      if (!stepById.has(stepId)) {
        throw new HarnessCompilerError(`Phase "${phaseName}" (${phaseId}) references unknown step "${stepId}".`);
      }
    }

    // Connectivity: undirected BFS (successors ∪ predecessors, restricted to
    // this phase's own member set) must reach every declared member from any
    // one of them — reuses the existing `reachableSet` helper.
    const memberSet = new Set(uniqueStepIds);
    const undirectedAdjacency = new Map<string, string[]>();
    for (const stepId of uniqueStepIds) {
      const neighbors = [...(nextByStepId.get(stepId) ?? []), ...(prevByStepId.get(stepId) ?? [])]
        .filter((neighborId) => memberSet.has(neighborId));
      undirectedAdjacency.set(stepId, neighbors);
    }
    const reached = reachableSet(uniqueStepIds[0], undirectedAdjacency);
    const unreached = uniqueStepIds.filter((id) => !reached.has(id));
    if (unreached.length > 0) {
      throw new HarnessCompilerError(
        `Phase "${phaseName}" (${phaseId}) is not a connected subgraph: {${[...reached].sort().join(', ')}} is disconnected from {${unreached.sort().join(', ')}}.`,
      );
    }

    // Disjointness: no stepId claimed by more than one phase.
    for (const stepId of uniqueStepIds) {
      const ownerId = stepIdOwner.get(stepId);
      if (ownerId && ownerId !== phaseId) {
        const ownerName = phaseNodesById.get(ownerId)?.data.title ?? ownerId;
        throw new HarnessCompilerError(
          `Phase "${ownerName}" and phase "${phaseName}" both claim step "${stepId}" — a step may belong to at most one phase.`,
        );
      }
      stepIdOwner.set(stepId, phaseId);
    }

    if (phaseNode.data.onError !== undefined && phaseNode.data.onError !== 'halt') {
      throw new HarnessCompilerError(`Phase "${phaseName}" (${phaseId}) declares onError "${phaseNode.data.onError}" — only "halt" is supported in v1.`);
    }

    phases.push({
      id: phaseId,
      name: phaseName,
      stepIds: uniqueStepIds,
      ...(phaseNode.data.exitContract ? { exitContract: phaseNode.data.exitContract } : {}),
      ...(phaseNode.data.onError ? { onError: phaseNode.data.onError } : {}),
    });
  }

  const rootStep = stepById.get(rootStepId)!;
  const flowName = options.name ?? rootStep.data.title ?? rootStep.text ?? 'Agentic Flow';
  const stepsRecord: Record<string, AgenticStep> = {};

  for (const step of stepNodes) {
    const data = step.data as UnknownRecord;
    // Per-step manual model override (StepInfoModal writes it to `data.model`).
    // Omitted when unset/blank so it stays optional and the routing precedence
    // (step manual > router > flow model) collapses correctly in the executor.
    const stepModel = stringField(data, 'model');
    // Optional human-facing description (StepNodeData.description). Purely
    // display metadata, kept separate from `prompt` — that fallback (prompt
    // ?? description ?? title) already resolved inside normalizePrompt above.
    // Omitted when unset/blank so it stays optional, matching `model` above.
    const stepDescription = stringField(data, 'description');
    stepsRecord[step.id] = {
      id: step.id,
      type: normalizeStepType(data),
      prompt: normalizePrompt(step),
      tools: normalizeTools(data.tools),
      prevStepIds: [...(prevByStepId.get(step.id) ?? [])],
      nextStepIds: [...(nextByStepId.get(step.id) ?? [])],
      mods: normalizeMods(data.mods),
      roles: normalizeRoles(data.roles),
      mentalContext: getMentalContext(step.id, edges, mentalById),
      ...(stepModel ? { model: stepModel } : {}),
      ...(stepDescription ? { description: stepDescription } : {}),
    };
  }

  // Optional human-facing flow metadata (description/tags/author/version) plus
  // the Rosetta contextMode toggle, all sourced from the Frame that visually
  // owns the root step — either by listing it in `childIds` or via the root
  // step's own `parentId` pointing back at the frame. When no frame owns the
  // root step (or the frame sets none of these fields), every key below is
  // omitted. The first four are purely display metadata, never consulted by
  // the execution pipeline; contextMode IS consulted (it selects the executor's
  // blind/feedback path) but is copied with the exact same omit-when-absent
  // shape as its siblings.
  const owningFrame = findOwningFrame(rootStepId, nodes);
  const flowDescription = owningFrame?.data.description;
  const flowTags = owningFrame?.data.tags;
  const flowAuthor = owningFrame?.data.author;
  const flowVersion = owningFrame?.data.version;
  // Rosetta context-mode (spec: docs/superpowers/specs/2026-07-10-rosetta-context-manifest.md).
  // Copied exactly like the other three flow-metadata fields above: omitted
  // when the owning frame never set it (undefined stays undefined — every
  // pre-existing flow with no Frame-level toggle keeps compiling byte-
  // identically, matching AgenticFlow.contextMode's own "absent ≡ blind"
  // contract). An explicit 'blind' selection is copied through too — it is
  // semantically identical to omission (see that same contract) and the
  // export layer (fluxor-flow.ts) is responsible for byte-identical omission
  // on write, not this compiler.
  const flowContextMode = owningFrame?.data.contextMode;

  return {
    id: options.flowId ?? `flow-${rootStepId}`,
    name: flowName,
    rootStepId,
    stepsRecord,
    ...(loops.length > 0 ? { loops } : {}),
    ...(flowDescription ? { description: flowDescription } : {}),
    ...(flowTags && flowTags.length > 0 ? { tags: [...flowTags] } : {}),
    ...(flowAuthor ? { author: flowAuthor } : {}),
    ...(flowVersion ? { version: flowVersion } : {}),
    ...(flowContextMode ? { contextMode: flowContextMode } : {}),
    ...(phases.length > 0 ? { phases } : {}),
  };
}

/**
 * Walks step-to-step edges forward, transitively, from `rootStepId` and returns
 * `rootStepId` plus every Step node reachable via outgoing `mentalEdges` — i.e.
 * the downstream subgraph a "run from here" action should execute.
 *
 * Non-step neighbors (mental-context nodes, frames) are ignored — only edges
 * whose source AND target are Step nodes are followed. Already-included ids
 * are never re-queued, which doubles as the cycle guard: a cycle simply stops
 * expanding once every node on it has been visited once.
 *
 * Returns an empty Set if `rootStepId` does not name a Step node on the canvas,
 * so callers can distinguish "unknown step" from "step with no descendants"
 * (the latter still returns a singleton Set containing just `rootStepId`).
 */
export function collectDownstreamStepIds(
  rootStepId: string,
  nodes: CanvasGraphNode[],
  edges: MentalGraphEdge[],
): Set<string> {
  const stepIds = new Set(nodes.filter(isStepGraphNode).map((node) => node.id));
  if (!stepIds.has(rootStepId)) return new Set();

  const nextByStepId = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.type === 'loop') continue; // "run from here" never follows a loop-back edge
    if (!stepIds.has(edge.sourceId) || !stepIds.has(edge.targetId)) continue;
    appendUnique(nextByStepId, edge.sourceId, edge.targetId);
  }

  const included = new Set<string>([rootStepId]);
  const queue: string[] = [rootStepId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const nextStepId of nextByStepId.get(current) ?? []) {
      if (included.has(nextStepId)) continue; // visited already — also the cycle guard
      included.add(nextStepId);
      queue.push(nextStepId);
    }
  }
  return included;
}

/**
 * Returns true iff adding a forward edge `sourceId → targetId` would create a
 * cycle in the forward step graph — i.e. `sourceId === targetId`, or
 * `targetId` already forward-reaches `sourceId` via the existing NON-loop
 * step↔step edges. Pure; both endpoints must name Step nodes on `nodes` or
 * this returns false. This is what the canvas uses at connect-time to decide
 * whether a new connection is an ordinary forward edge or a loop-back edge.
 */
export function wouldCreateStepCycle(
  sourceId: string,
  targetId: string,
  nodes: CanvasGraphNode[],
  edges: MentalGraphEdge[],
): boolean {
  const stepIds = new Set(nodes.filter(isStepGraphNode).map((node) => node.id));
  if (!stepIds.has(sourceId) || !stepIds.has(targetId)) return false;
  if (sourceId === targetId) return true;

  const nextByStepId = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.type === 'loop') continue;
    if (!stepIds.has(edge.sourceId) || !stepIds.has(edge.targetId)) continue;
    appendUnique(nextByStepId, edge.sourceId, edge.targetId);
  }

  return reachableSet(targetId, nextByStepId).has(sourceId);
}
