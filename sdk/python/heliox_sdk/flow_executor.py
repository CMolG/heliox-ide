"""
Flow executor — orchestrates a FlowDefinition as a DAG.

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
"""

from __future__ import annotations

from collections import deque
from typing import Any

from .flow_import import FlowDefinition, StepConfig
from .provider import LlmProvider
from .step_executor import StepExecutor
from .tool_registry import ToolRegistry


class FlowExecutor:
    """Orchestrates a FlowDefinition as a sequentially executed DAG."""

    def __init__(self, step_executor: StepExecutor) -> None:
        self._step_executor = step_executor

    # ------------------------------------------------------------------
    # Public API — execute_all_text (canonical default)
    # ------------------------------------------------------------------

    def execute_all_text(
        self,
        flow: FlowDefinition,
        seed_context: dict[str, Any] | None = None,
    ) -> dict[str, str]:
        """Execute every step as plain text, returning stepId → output in DAG order.

        This is the Python mirror of Java's ``FlowExecutor.executeAllText`` —
        the canonical conformance path where no JSON-schema extraction is performed.

        Returns:
            A dict of stepId → raw text output, in topological execution order.
        """
        by_id = self._index(flow)
        self._validate_dependencies(by_id)
        order = self._topological_order(by_id)

        seed = seed_context or {}
        results: dict[str, str] = {}

        for step in order:
            # Build effective context: static context + seed + parent outputs.
            effective = self._with_parent_results(step, seed, results)
            output = self._step_executor.execute_step_text(effective)
            results[step.id] = output

        # Return in topological order.
        return {step.id: results[step.id] for step in order}

    # ------------------------------------------------------------------
    # Private helpers — graph utilities
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
        )
