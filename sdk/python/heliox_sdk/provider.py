"""
Provider interface and scripted (fake) provider for deterministic testing.

Mirrors Java's LlmProvider / FakeProvider pair.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections import deque
from dataclasses import dataclass, field
from typing import Callable


@dataclass
class ToolCallRequest:
    """A single tool invocation request returned by the provider."""

    id: str
    name: str
    arguments_json: str


@dataclass
class LlmResponse:
    """Response from an LLM provider."""

    content: str
    tool_calls: list[ToolCallRequest] = field(default_factory=list)

    @property
    def has_tool_calls(self) -> bool:
        return bool(self.tool_calls)

    @staticmethod
    def of(content: str) -> "LlmResponse":
        return LlmResponse(content=content)

    @staticmethod
    def with_tool_calls(content: str, calls: list[ToolCallRequest]) -> "LlmResponse":
        return LlmResponse(content=content, tool_calls=list(calls))


@dataclass
class ChatMessage:
    """A single message in an LLM conversation."""

    role: str  # "system" | "user" | "assistant" | "tool"
    content: str
    tool_calls: list[ToolCallRequest] = field(default_factory=list)
    tool_call_id: str | None = None

    @staticmethod
    def system(content: str) -> "ChatMessage":
        return ChatMessage(role="system", content=content)

    @staticmethod
    def user(content: str) -> "ChatMessage":
        return ChatMessage(role="user", content=content)

    @staticmethod
    def assistant(content: str) -> "ChatMessage":
        return ChatMessage(role="assistant", content=content)

    @staticmethod
    def assistant_tool_calls(content: str, calls: list[ToolCallRequest]) -> "ChatMessage":
        return ChatMessage(role="assistant", content=content, tool_calls=list(calls))

    @staticmethod
    def tool(tool_call_id: str, content: str) -> "ChatMessage":
        return ChatMessage(role="tool", content=content, tool_call_id=tool_call_id)


@dataclass
class LlmRequest:
    """A request sent to an LLM provider."""

    messages: list[ChatMessage]


class LlmProvider(ABC):
    """Minimal LLM provider interface."""

    @abstractmethod
    def complete(self, request: LlmRequest) -> LlmResponse:
        """Send a request and return a response (synchronous in this stdlib-only runtime)."""


class ScriptedProvider(LlmProvider):
    """Deterministic, offline LLM provider for tests.

    Supports two modes (mirroring Java's FakeProvider):
    - Queue mode: pre-scripted responses consumed in FIFO order.
    - Responder mode: a callable that derives a response from each request.

    The ``requests`` list records every request received (useful for assertions).
    """

    def __init__(self) -> None:
        self._queue: deque[LlmResponse] = deque()
        self._responder: Callable[[LlmRequest], LlmResponse] | None = None
        self.requests: list[LlmRequest] = []

    def respond_with(self, *contents: str) -> "ScriptedProvider":
        """Enqueue plain-text responses."""
        for content in contents:
            self._queue.append(LlmResponse.of(content))
        return self

    def respond_with_tool_call(
        self, call_id: str, name: str, arguments_json: str
    ) -> "ScriptedProvider":
        """Enqueue a tool-call response."""
        self._queue.append(
            LlmResponse.with_tool_calls("", [ToolCallRequest(id=call_id, name=name, arguments_json=arguments_json)])
        )
        return self

    def set_responder(self, fn: Callable[[LlmRequest], LlmResponse]) -> "ScriptedProvider":
        """Set a dynamic responder function (overrides the queue)."""
        self._responder = fn
        return self

    def complete(self, request: LlmRequest) -> LlmResponse:
        self.requests.append(request)
        if self._responder is not None:
            return self._responder(request)
        if self._queue:
            return self._queue.popleft()
        return LlmResponse.of("")
