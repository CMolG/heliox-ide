"""
Step executor — drives a single DAG step through the tool loop.

Mirrors the Java StepExecutor's tool-loop semantics (synchronous version):
1. Seed the conversation with SYSTEM (if present) + USER messages.
2. Call the provider.
3. If the response contains tool calls: invoke each tool, append results as TOOL
   messages, loop back (tool loop).
4. When the provider returns a plain text response: that is the step's output.

The schema-validation retry loop from the Java version is intentionally omitted
here — the conformance test exercises the plain-text path (executeAllText), which
does not perform JSON-schema extraction. This matches the Python runtime's v1 scope.
"""

from __future__ import annotations

from .flow_import import StepConfig
from .provider import (
    ChatMessage,
    LlmProvider,
    LlmRequest,
    LlmResponse,
    ToolCallRequest,
)
from .tool_registry import ToolRegistry

_DEFAULT_TOOL_BUDGET = 8


class StepExecutor:
    """Executes a single step through the provider, running the tool loop as needed."""

    def __init__(
        self,
        provider: LlmProvider,
        tool_registry: ToolRegistry | None = None,
    ) -> None:
        self._provider = provider
        self._registry = tool_registry if tool_registry is not None else ToolRegistry()

    def execute_step_text(self, step: StepConfig) -> str:
        """Run a step and return its final text output (no JSON-schema extraction).

        This is the canonical conformance path, mirroring Java's
        ``FlowExecutor.executeAllText`` → ``StepExecutor.executeStepText``.
        """
        messages = self._seed_text_messages(step)
        result = self._run_tool_loop(messages, tool_budget=_DEFAULT_TOOL_BUDGET)
        return result.final_text

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _seed_text_messages(self, step: StepConfig) -> list[ChatMessage]:
        messages: list[ChatMessage] = []
        if step.system_prompt:
            messages.append(ChatMessage.system(step.system_prompt))
        messages.append(ChatMessage.user(step.render_user_prompt()))
        return messages

    def _run_tool_loop(
        self, history: list[ChatMessage], tool_budget: int
    ) -> "_ConversationResult":
        """Drive the conversation until the provider returns a final text response."""
        request = LlmRequest(messages=list(history))
        response: LlmResponse = self._provider.complete(request)

        assistant_msg = (
            ChatMessage.assistant_tool_calls(response.content, response.tool_calls)
            if response.has_tool_calls
            else ChatMessage.assistant(response.content)
        )
        with_assistant = list(history) + [assistant_msg]

        if response.has_tool_calls and tool_budget > 0:
            tool_messages = self._execute_tool_calls(response.tool_calls)
            next_history = with_assistant + tool_messages
            return self._run_tool_loop(next_history, tool_budget - 1)

        return _ConversationResult(history=with_assistant, final_text=response.content)

    def _execute_tool_calls(self, calls: list[ToolCallRequest]) -> list[ChatMessage]:
        """Invoke each tool and return TOOL messages (one per call)."""
        messages: list[ChatMessage] = []
        for call in calls:
            try:
                result = self._registry.invoke(call.name, call.arguments_json)
            except Exception as exc:  # noqa: BLE001
                result = f"ERROR executing tool '{call.name}': {exc}"
            messages.append(ChatMessage.tool(tool_call_id=call.id, content=result))
        return messages


class _ConversationResult:
    __slots__ = ("history", "final_text")

    def __init__(self, history: list[ChatMessage], final_text: str) -> None:
        self.history = history
        self.final_text = final_text
