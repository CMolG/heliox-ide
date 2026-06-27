"""
Tool registry — stores callable tools and dispatches invocations.

Mirrors the Java ToolRegistry's key semantics:
- Tools are registered by name with a callable.
- On invocation, arguments are parsed from a JSON string.
- String results are passed through; non-string results are JSON-serialized.
"""

from __future__ import annotations

import json
from typing import Callable, Any


class ToolRegistry:
    """Registry of named, callable tools."""

    def __init__(self) -> None:
        self._tools: dict[str, Callable[..., Any]] = {}

    def register(self, name: str, fn: Callable[..., Any]) -> "ToolRegistry":
        """Register a tool by name.

        Args:
            name: The canonical tool name (must match the name in the flow's tool list).
            fn:   A callable that accepts keyword arguments matching the JSON argument keys.
        """
        self._tools[name] = fn
        return self

    def invoke(self, name: str, arguments_json: str | None) -> str:
        """Invoke a tool by name, binding JSON arguments, and return the serialized result.

        Mirrors Java ToolRegistry.invoke() semantics:
        - Unknown tool → raises ValueError.
        - String result → returned as-is (not re-quoted).
        - Non-string result → JSON-serialized.

        Args:
            name:            The registered tool name.
            arguments_json:  A JSON-object string of arguments, or None/empty for no args.

        Returns:
            The serialized tool result.
        """
        fn = self._tools.get(name)
        if fn is None:
            raise ValueError(f"Unknown tool: {name}")

        if arguments_json and arguments_json.strip():
            try:
                args: dict[str, Any] = json.loads(arguments_json)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Cannot parse tool arguments JSON: {exc}") from exc
        else:
            args = {}

        result = fn(**args)

        if isinstance(result, str):
            return result
        try:
            return json.dumps(result)
        except (TypeError, ValueError):
            return str(result)

    def is_empty(self) -> bool:
        return len(self._tools) == 0
