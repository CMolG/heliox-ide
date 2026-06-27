"""
Flow importer — parses a canonical Heliox flow JSON (HelioxFlowExport v1)
into an in-memory DAG of StepConfig objects.

Mirrors the semantics of the Java FlowImport class.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class StepConfig:
    """Immutable configuration for a single DAG step."""

    id: str
    prompt_template: str
    depends_on: list[str] = field(default_factory=list)
    system_prompt: str | None = None
    context: dict[str, Any] = field(default_factory=dict)
    tools: list[str] = field(default_factory=list)

    def render_user_prompt(self) -> str:
        """Return the prompt template (context interpolation is a future capability)."""
        return self.prompt_template


@dataclass(frozen=True)
class FlowDefinition:
    """An in-memory DAG produced by FlowImport."""

    id: str
    steps: list[StepConfig]


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
        return FlowDefinition(id=flow_id, steps=steps)

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

        return StepConfig(
            id=step_id,
            prompt_template=prompt,
            depends_on=depends_on,
            system_prompt=system_prompt,
            context=context,
            tools=tools,
        )
