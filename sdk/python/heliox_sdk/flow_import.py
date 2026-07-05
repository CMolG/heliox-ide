"""
Flow importer — parses a canonical Heliox flow JSON (HelioxFlowExport v1)
into an in-memory DAG of StepConfig objects.

Mirrors the semantics of the Java FlowImport class.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Bounded loop-back edges (Phase 4a) — mirrors src/types/harness.ts constants.
# ---------------------------------------------------------------------------

LOOP_DEFAULT_MAX_ITERATIONS = 3
LOOP_MAX_ITERATIONS_CAP = 50


def _clamp_loop_iterations(value: Any) -> int:
    """Clamp a raw ``maxIterations`` value into [1, 50].

    Mirrors the TypeScript ``clampLoopIterations`` (src/types/harness.ts)
    exactly: a non-finite or non-numeric value (including JSON booleans, which
    are not "numbers" in the TS `typeof` sense) defaults to 3 passes before
    clamping, so every consumer of a parsed ``LoopConfig`` may assume a value
    in [1, 50] without re-validating.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        v = LOOP_DEFAULT_MAX_ITERATIONS
    else:
        v = math.floor(value)
    return min(LOOP_MAX_ITERATIONS_CAP, max(1, v))


@dataclass(frozen=True)
class LoopConfig:
    """A bounded loop-back edge: after ``source_step_id`` completes, control
    returns to ``target_step_id`` (an upstream step) and the loop body re-runs,
    up to ``max_iterations`` total passes (the first pass counts as iteration 1).

    Mirrors the TypeScript ``AgenticLoop`` (src/types/harness.ts) and the wire
    format's ``HelioxFlowLoop`` (src/main/flow-export/heliox-flow.ts).
    """

    id: str
    source_step_id: str
    target_step_id: str
    max_iterations: int


@dataclass(frozen=True)
class StepConfig:
    """Immutable configuration for a single DAG step."""

    id: str
    prompt_template: str
    depends_on: list[str] = field(default_factory=list)
    system_prompt: str | None = None
    context: dict[str, Any] = field(default_factory=dict)
    tools: list[str] = field(default_factory=list)
    # Carried opaquely — never interpreted by this runtime. See StepContract /
    # per-step model override in src/types/harness.ts and heliox-flow.ts.
    contract: dict[str, Any] | None = None
    model: str | None = None

    def render_user_prompt(self) -> str:
        """Return the prompt template (context interpolation is a future capability)."""
        return self.prompt_template


@dataclass(frozen=True)
class FlowDefinition:
    """An in-memory DAG produced by FlowImport."""

    id: str
    steps: list[StepConfig]
    loops: list[LoopConfig] = field(default_factory=list)


class FlowImport:
    """Parse canonical Heliox flow JSON into a FlowDefinition."""

    @staticmethod
    def from_canonical_json(json_text: str) -> FlowDefinition:
        """Parse a canonical flow JSON string.

        Raises:
            ValueError: if the JSON is malformed, the version is unsupported,
                        or required fields are missing.
        """
        try:
            root = json.loads(json_text)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Cannot parse flow JSON: {exc}") from exc

        version = root.get("version")
        if version is None:
            raise ValueError("Canonical flow JSON is missing the required 'version' field.")
        if str(version) != "1":
            raise ValueError(
                f"Unsupported canonical flow version: '{version}'. Expected \"1\"."
            )

        flow_id = root.get("id")
        if not flow_id:
            raise ValueError("Canonical flow JSON is missing the required 'id' field.")

        steps_node = root.get("steps")
        if not isinstance(steps_node, list):
            raise ValueError("Canonical flow JSON is missing the required 'steps' array.")

        steps = [FlowImport._parse_step(node, flow_id) for node in steps_node]

        loops_node = root.get("loops")
        loops: list[LoopConfig] = []
        if loops_node is not None:
            if not isinstance(loops_node, list):
                raise ValueError(
                    f"Canonical flow JSON 'loops' field must be an array when present, in flow '{flow_id}'."
                )
            loops = [FlowImport._parse_loop(node, flow_id) for node in loops_node]

        return FlowDefinition(id=flow_id, steps=steps, loops=loops)

    @staticmethod
    def from_canonical_file(path: str | Path) -> FlowDefinition:
        """Parse canonical flow JSON from a file on disk."""
        path = Path(path)
        try:
            content = path.read_text(encoding="utf-8")
        except OSError as exc:
            raise ValueError(f"Cannot read canonical flow file at '{path}': {exc}") from exc
        return FlowImport.from_canonical_json(content)

    @staticmethod
    def _parse_step(node: dict, flow_id: str) -> StepConfig:
        step_id = node.get("id")
        if not step_id:
            raise ValueError(f"Required field 'id' is missing in a step of flow '{flow_id}'.")

        prompt = node.get("prompt")
        if not prompt:
            raise ValueError(
                f"Required field 'prompt' is missing or null in step '{step_id}' of flow '{flow_id}'."
            )

        system_prompt: str | None = node.get("systemPrompt") or None
        depends_on: list[str] = list(node.get("dependsOn") or [])
        context: dict = dict(node.get("context") or {})
        tools: list[str] = list(node.get("tools") or [])

        contract_node = node.get("contract")
        if contract_node is not None and not isinstance(contract_node, dict):
            raise ValueError(
                f"Field 'contract' in step '{step_id}' of flow '{flow_id}' must be an object."
            )
        # Carried opaquely — copied verbatim, never interpreted here.
        contract: dict[str, Any] | None = dict(contract_node) if contract_node is not None else None
        model: str | None = node.get("model") or None

        return StepConfig(
            id=step_id,
            prompt_template=prompt,
            depends_on=depends_on,
            system_prompt=system_prompt,
            context=context,
            tools=tools,
            contract=contract,
            model=model,
        )

    @staticmethod
    def _parse_loop(node: dict, flow_id: str) -> LoopConfig:
        loop_id = node.get("id")
        if not loop_id:
            raise ValueError(f"Required field 'id' is missing in a loop of flow '{flow_id}'.")

        source_step_id = node.get("sourceStepId")
        if not source_step_id:
            raise ValueError(
                f"Required field 'sourceStepId' is missing in loop '{loop_id}' of flow '{flow_id}'."
            )

        target_step_id = node.get("targetStepId")
        if not target_step_id:
            raise ValueError(
                f"Required field 'targetStepId' is missing in loop '{loop_id}' of flow '{flow_id}'."
            )

        max_iterations = _clamp_loop_iterations(node.get("maxIterations"))

        return LoopConfig(
            id=loop_id,
            source_step_id=source_step_id,
            target_step_id=target_step_id,
            max_iterations=max_iterations,
        )
