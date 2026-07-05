"""
Flow executor — orchestrates a FlowDefinition as a DAG, with bounded
loop-back edge support.

Topological ordering algorithm is a deterministic Kahn's algorithm that mirrors
the Java FlowExecutor exactly:

  1. Compute in-degree and children maps by iterating steps in JSON declaration order.
  2. Seed a FIFO queue with all degree-0 steps, in id-ascending order
     (Java iterates a LinkedHashMap which preserves insertion order; the tie-break
     is effectively id ascending because steps that are free at the same wave are
     discovered together and added to the queue. For the conformance chain this is
     always a single step per wave, so the linear order is deterministic without
     any explicit sort. We still sort by id ascending to honour the documented
     tie-break for non-linear DAGs.)
  3. Process the queue in FIFO order; when a child's in-degree reaches zero, add
     it to the tail of the queue (sorted by id ascending for tie-breaking).

The executor runs steps sequentially (not concurrently) because the Python runtime
v1 targets conformance parity, not production throughput.

Bounded loop-back edges (Phase 4a)
-----------------------------------
``execute_all_text_trace`` additionally expands ``flow.loops`` into a
per-iteration instance graph before scheduling — one ``(stepId, iteration)``
pass per step inside a loop body, and exactly one pass for every other step.
This is a faithful Python port of the normative TypeScript algorithm in
``src/main/harness-engine/loop-plan.ts`` (see ``_expand_instances`` below), so
all three Heliox runtimes reproduce the same execution order for the same
flow. ``execute_all_text`` delegates to ``execute_all_text_trace`` and folds
the trace down to a stepId -> last-pass-output map, so a loop-free flow's
output is byte-identical to the pre-loop implementation.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Any

from .flow_import import FlowDefinition, LoopConfig, StepConfig
from .provider import LlmProvider
from .step_executor import StepExecutor
from .tool_registry import ToolRegistry

#: A single scheduled pass of a step — the unique node id in the expanded
#: instance graph. Equivalent to the TS `` `${stepId}@${iteration}` `` string
#: key, kept as a tuple here since Python tuples are natively hashable/orderable.
InstanceKey = tuple[str, int]


class FlowExecutor:
    """Orchestrates a FlowDefinition as a sequentially executed DAG."""

    def __init__(self, step_executor: StepExecutor) -> None:
        self._step_executor = step_executor

    # ------------------------------------------------------------------
    # Public API — execute_all_text (canonical default; loop-free-identical)
    # ------------------------------------------------------------------

    def execute_all_text(
        self,
        flow: FlowDefinition,
        seed_context: dict[str, Any] | None = None,
    ) -> dict[str, str]:
        """Execute every step (expanding bounded loops) as plain text, returning
        stepId → LAST-PASS output, in forward topological (DAG) order.

        This is the Python mirror of Java's ``FlowExecutor.executeAllText`` —
        the canonical conformance path where no JSON-schema extraction is
        performed. Delegates to ``execute_all_text_trace``: a loop-free flow
        has exactly one pass per step, so the returned map and its key order
        are byte-identical to the pre-loop implementation.

        Returns:
            A dict of stepId → raw text output (the LAST pass, for steps
            inside a loop body), in topological execution order.
        """
        by_id = self._index(flow)
        self._validate_dependencies(by_id)
        order = self._topological_order(by_id)

        trace = self.execute_all_text_trace(flow, seed_context)
        last_output_by_step: dict[str, str] = {}
        for entry in trace:
            last_output_by_step[entry["stepId"]] = entry["output"]

        return {step.id: last_output_by_step[step.id] for step in order}

    # ------------------------------------------------------------------
    # Public API — execute_all_text_trace (ordered per-instance trace)
    # ------------------------------------------------------------------

    def execute_all_text_trace(
        self,
        flow: FlowDefinition,
        seed_context: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """Execute every step PASS (expanding ``flow.loops`` into bounded
        per-iteration instances) as plain text, returning an ordered trace of
        ``{"stepId": str, "iteration": int, "output": str}`` entries in the
        exact order instances complete.

        A loop-free flow yields exactly one entry per step (``iteration=1``),
        in the same order ``execute_all_text`` has always produced.

        Raises:
            ValueError: if ``flow.loops`` is structurally invalid — see
                ``_expand_instances`` / ``_validate_loops`` (missing or
                self-referential source/target, a source that is not a
                forward-descendant of its target, or overlapping loop bodies).
        """
        by_id = self._index(flow)
        self._validate_dependencies(by_id)

        _, remaining_deps, next_keys, ready_keys = _expand_instances(by_id, flow.loops)

        seed = seed_context or {}
        results: dict[str, str] = {}
        trace: list[dict[str, Any]] = []

        indegree = dict(remaining_deps)
        ready: deque[InstanceKey] = deque(ready_keys)

        while ready:
            key = ready.popleft()
            step_id, iteration = key
            step = by_id[step_id]

            effective = self._with_parent_results(step, seed, results)
            output = self._step_executor.execute_step_text(effective)
            results[step_id] = output  # keyed by real step id — final pass wins
            trace.append({"stepId": step_id, "iteration": iteration, "output": output})

            newly_free: list[InstanceKey] = []
            for child_key in next_keys.get(key, []):
                indegree[child_key] -= 1
                if indegree[child_key] == 0:
                    newly_free.append(child_key)
            for child_key in sorted(newly_free):
                ready.append(child_key)

        return trace

    # ------------------------------------------------------------------
    # Private helpers — graph utilities (forward graph, loop-free order)
    # ------------------------------------------------------------------

    @staticmethod
    def _index(flow: FlowDefinition) -> dict[str, StepConfig]:
        by_id: dict[str, StepConfig] = {}
        for step in flow.steps:
            if step.id in by_id:
                raise ValueError(f"Duplicate step id in flow '{flow.id}': {step.id}")
            by_id[step.id] = step
        if not by_id:
            raise ValueError(f"Flow '{flow.id}' has no steps.")
        return by_id

    @staticmethod
    def _validate_dependencies(by_id: dict[str, StepConfig]) -> None:
        for step in by_id.values():
            for dep in step.depends_on:
                if dep not in by_id:
                    raise ValueError(
                        f"Step '{step.id}' depends on unknown step '{dep}'."
                    )

    @staticmethod
    def _topological_order(by_id: dict[str, StepConfig]) -> list[StepConfig]:
        """Kahn's algorithm with id-ascending tie-break (mirrors Java FlowExecutor).

        Steps that are ready (in-degree == 0) at the same wave are added to the
        FIFO queue sorted by id ascending, reproducing the documented cross-runtime
        tie-break contract.
        """
        indegree: dict[str, int] = {sid: 0 for sid in by_id}
        children: dict[str, list[str]] = {sid: [] for sid in by_id}

        for step in by_id.values():
            for dep in step.depends_on:
                indegree[step.id] += 1
                children[dep].append(step.id)

        # Seed queue with all degree-0 steps, sorted by id ascending.
        ready: deque[str] = deque(
            sorted(sid for sid, deg in indegree.items() if deg == 0)
        )

        order: list[StepConfig] = []
        while ready:
            sid = ready.popleft()
            order.append(by_id[sid])
            # When a child reaches in-degree 0, add it in id-ascending order
            # relative to other newly-freed siblings (sort before extending).
            newly_free = []
            for child_id in children[sid]:
                indegree[child_id] -= 1
                if indegree[child_id] == 0:
                    newly_free.append(child_id)
            for child_id in sorted(newly_free):
                ready.append(child_id)

        if len(order) != len(by_id):
            raise ValueError("Flow has a dependency cycle.")

        return order

    @staticmethod
    def _with_parent_results(
        step: StepConfig,
        seed: dict[str, Any],
        results: dict[str, str],
    ) -> StepConfig:
        """Build effective context: static context < seed < parent outputs."""
        from .flow_import import StepConfig as _SC

        context: dict[str, Any] = {}
        context.update(step.context)
        context.update(seed)
        for dep in step.depends_on:
            if dep in results:
                context[dep] = results[dep]

        return _SC(
            id=step.id,
            prompt_template=step.prompt_template,
            depends_on=list(step.depends_on),
            system_prompt=step.system_prompt,
            context=context,
            tools=list(step.tools),
            contract=step.contract,
            model=step.model,
        )


# ---------------------------------------------------------------------------
# Bounded loop-back edge expansion (Phase 4a)
#
# Faithful port of src/main/harness-engine/loop-plan.ts — keep both in sync.
# See that module's docstring for the full, normative algorithm description:
#
#   1. Validate every loop: source/target exist, source != target, target
#      forward-reaches source, and loop bodies are pairwise disjoint (bodies
#      are recomputed here, never trusted from the caller).
#   2. For every step `s`, N(s) = the (already-clamped) maxIterations of the
#      loop whose body contains it, else 1. Create one instance `(s, k)` for
#      k = 1..N(s).
#   3. Instance edges — for each forward edge a -> b: if a and b sit in the
#      SAME loop body, fan the edge out per-iteration ((a,k) -> (b,k));
#      otherwise connect a's LAST pass to b's FIRST pass. This single rule
#      uniformly covers plain edges, loop-entry edges, loop-exit edges, and
#      edges crossing between two disjoint loops.
#   4. Chain edges — for each loop (u -> t, N), add (u,k) -> (t,k+1) for
#      k = 1..N-1, i.e. completing a pass re-triggers the loop body.
#   5. Kahn-schedule the instance graph, tie-broken ascending by
#      (stepId, iteration).
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _ValidatedLoop:
    id: str
    source_step_id: str
    target_step_id: str
    max_iterations: int
    body: frozenset[str]


def _reachable_set(start: str, adjacency: dict[str, list[str]]) -> set[str]:
    """BFS over ``adjacency``, inclusive of ``start``."""
    visited = {start}
    queue: deque[str] = deque([start])
    while queue:
        current = queue.popleft()
        for nxt in adjacency.get(current, ()):
            if nxt in visited:
                continue
            visited.add(nxt)
            queue.append(nxt)
    return visited


def _validate_loops(
    by_id: dict[str, StepConfig], loops: list[LoopConfig]
) -> list[_ValidatedLoop]:
    """Defensively validate ``loops`` against ``by_id`` and recompute each
    loop's body. Bodies are required to be pairwise disjoint — nested or
    overlapping loops are not supported. Mirrors ``loop-plan.ts``'s
    ``validateLoops`` message-for-message.
    """
    if not loops:
        return []

    # next_by_step: stepId -> ids of steps that declare it as a dependency
    # (forward/children pointer, derived — StepConfig only stores parents).
    next_by_step: dict[str, list[str]] = {step_id: [] for step_id in by_id}
    for step in by_id.values():
        for dep in step.depends_on:
            next_by_step[dep].append(step.id)

    # prev_by_step: stepId -> its own depends_on (parents), i.e. a direct view.
    prev_by_step: dict[str, list[str]] = {step_id: step.depends_on for step_id, step in by_id.items()}

    validated: list[_ValidatedLoop] = []
    body_by_loop_id: dict[str, set[str]] = {}

    for loop in loops:
        if loop.source_step_id not in by_id:
            raise ValueError(
                f'loop-plan: loop "{loop.id}" source step "{loop.source_step_id}" does not exist in flow.'
            )
        if loop.target_step_id not in by_id:
            raise ValueError(
                f'loop-plan: loop "{loop.id}" target step "{loop.target_step_id}" does not exist in flow.'
            )
        if loop.source_step_id == loop.target_step_id:
            raise ValueError(
                f'loop-plan: loop "{loop.id}" source and target are the same step "{loop.source_step_id}".'
            )

        reach_from_target = _reachable_set(loop.target_step_id, next_by_step)
        if loop.source_step_id not in reach_from_target:
            raise ValueError(
                f'loop-plan: loop "{loop.id}" source is not a forward-descendant of target'
            )

        co_reach_to_source = _reachable_set(loop.source_step_id, prev_by_step)
        body = reach_from_target & co_reach_to_source

        for other_loop_id, other_body in body_by_loop_id.items():
            shared = sorted(body & other_body)
            if shared:
                raise ValueError(
                    "loop-plan: nested or overlapping loops are not supported: steps "
                    f"{', '.join(shared)} belong to both loop \"{other_loop_id}\" and loop \"{loop.id}\"."
                )
        body_by_loop_id[loop.id] = body

        validated.append(
            _ValidatedLoop(
                id=loop.id,
                source_step_id=loop.source_step_id,
                target_step_id=loop.target_step_id,
                # Already clamped to [1, 50] by FlowImport; re-clamping here is a
                # cheap no-op that also protects hand-built (non-FlowImport) callers.
                max_iterations=min(50, max(1, loop.max_iterations)),
                body=frozenset(body),
            )
        )

    return validated


def _expand_instances(
    by_id: dict[str, StepConfig], loops: list[LoopConfig]
) -> tuple[
    list[InstanceKey],
    dict[InstanceKey, int],
    dict[InstanceKey, list[InstanceKey]],
    list[InstanceKey],
]:
    """Expand ``by_id`` (the forward graph) + ``loops`` into a per-iteration
    instance graph, Kahn-ready.

    Returns ``(all_instances, remaining_deps, next_keys, ready_keys)``:
      - ``all_instances``: every ``(stepId, iteration)`` pair, one per pass.
      - ``remaining_deps``: in-degree per instance key.
      - ``next_keys``: children per instance key (instance edges + chain edges).
      - ``ready_keys``: the in-degree-0 seed, sorted ascending by
        ``(stepId, iteration)``.

    A loop-free flow yields exactly one instance per step with
    ``remaining_deps`` equal to ``len(step.depends_on)`` — structural parity
    with the pre-loop scheduler.
    """
    validated_loops = _validate_loops(by_id, loops)

    loop_by_step_id: dict[str, _ValidatedLoop] = {}
    for loop in validated_loops:
        for step_id in loop.body:
            loop_by_step_id[step_id] = loop

    count_by_step_id: dict[str, int] = {
        step_id: (loop_by_step_id[step_id].max_iterations if step_id in loop_by_step_id else 1)
        for step_id in by_id
    }

    all_instances: list[InstanceKey] = [
        (step_id, k) for step_id in by_id for k in range(1, count_by_step_id[step_id] + 1)
    ]

    next_keys: dict[InstanceKey, list[InstanceKey]] = {key: [] for key in all_instances}
    remaining_deps: dict[InstanceKey, int] = {key: 0 for key in all_instances}

    def add_edge(from_key: InstanceKey, to_key: InstanceKey) -> None:
        next_keys[from_key].append(to_key)
        remaining_deps[to_key] = remaining_deps.get(to_key, 0) + 1

    # Children (forward pointer) map, derived from depends_on.
    children_by_step: dict[str, list[str]] = {step_id: [] for step_id in by_id}
    for step in by_id.values():
        for dep in step.depends_on:
            children_by_step[dep].append(step.id)

    # Instance edges, derived from the forward graph.
    for a_id in by_id:
        a_loop = loop_by_step_id.get(a_id)
        a_count = count_by_step_id[a_id]

        for b_id in children_by_step[a_id]:
            b_loop = loop_by_step_id.get(b_id)
            same_body = a_loop is not None and b_loop is not None and a_loop.id == b_loop.id

            if same_body:
                for k in range(1, a_count + 1):
                    add_edge((a_id, k), (b_id, k))
            else:
                tail_k = a_count if a_loop else 1
                add_edge((a_id, tail_k), (b_id, 1))

    # Chain edges: completing pass k of the loop body re-triggers pass k+1.
    for loop in validated_loops:
        for k in range(1, loop.max_iterations):
            add_edge((loop.source_step_id, k), (loop.target_step_id, k + 1))

    ready_keys = sorted(key for key in all_instances if remaining_deps.get(key, 0) == 0)

    return all_instances, remaining_deps, next_keys, ready_keys
