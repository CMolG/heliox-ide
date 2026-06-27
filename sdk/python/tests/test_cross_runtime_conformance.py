"""
Cross-runtime conformance test — Python runtime (ARCH-076).

Proves that the Python HelioxRuntime:
  (a) imports the canonical conformance-chain.flow.json correctly,
  (b) traverses the DAG in the same deterministic topological order as
      the TypeScript and Java runtimes,
  (c) reproduces the golden per-step outputs from golden-trace.json
      (byte-identical to TS + Java), and
  (d) calls the uppercase tool with the canonical arguments and integrates
      the same result — matching golden-tool-calls.json.

Shared fixtures are read from sdk/conformance/ relative to the repo root.
The test resolves the repo root by walking up from this file's location
until it finds the sdk/conformance/ directory.

No network calls are made — the ScriptedProvider delivers deterministic
responses that mirror scripted-responses.json.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Fixture path resolution — mirrors Java's resolveConformanceFile logic
# ---------------------------------------------------------------------------

def _find_repo_root() -> Path:
    """Walk up from this file until sdk/conformance/ is found."""
    candidate = Path(__file__).resolve().parent
    for _ in range(10):
        if (candidate / "sdk" / "conformance").is_dir():
            return candidate
        parent = candidate.parent
        if parent == candidate:
            break
        candidate = parent
    raise FileNotFoundError(
        f"Cannot locate sdk/conformance/ — searched up to {candidate}. "
        "Run pytest from the repo root or any subdirectory."
    )


_REPO_ROOT = _find_repo_root()
_CONFORMANCE_DIR = _REPO_ROOT / "sdk" / "conformance"


def _load_fixture(name: str) -> str:
    path = _CONFORMANCE_DIR / name
    if not path.exists():
        raise FileNotFoundError(f"Fixture not found: {path}")
    return path.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Make sure the heliox_sdk package is importable when running from repo root
# ---------------------------------------------------------------------------

_SDK_PYTHON = _REPO_ROOT / "sdk" / "python"
if str(_SDK_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SDK_PYTHON))

from heliox_sdk import (  # noqa: E402
    FlowImport,
    FlowExecutor,
    StepExecutor,
    ScriptedProvider,
    ToolRegistry,
    LlmRequest,
    LlmResponse,
    ToolCallRequest,
)

# ---------------------------------------------------------------------------
# Golden constants (must match golden-tool-calls.json exactly)
# ---------------------------------------------------------------------------

UPPERCASE_TOOL_ARGS = '{"text":"hello conformance"}'
UPPERCASE_TOOL_RESULT = "HELLO CONFORMANCE"
STEP_E_FINAL_TEXT = "Result: HELLO CONFORMANCE"

# Expected DAG order — must match golden-trace.json order
GOLDEN_ORDER = ["step-a", "step-b", "step-c", "step-d", "step-e"]


# ---------------------------------------------------------------------------
# Conformance tool — uppercase
#
# Pure, deterministic: uppercase(text) = text.upper()
# Identical semantics to the Java UppercaseTool and the TS uppercase function.
# ---------------------------------------------------------------------------

def _uppercase_tool(text: str) -> str:
    return text.upper() if text else ""


# ---------------------------------------------------------------------------
# Helper: build a ScriptedProvider that mirrors the Java FakeProvider logic
#   - steps a-d: return canned text from scripted-responses.json
#   - step-e, turn 1: return a tool-call request for uppercase
#   - step-e, turn 2 (TOOL message present): return the post-tool final text
# ---------------------------------------------------------------------------

def _build_scripted_provider(
    prompt_to_id: dict[str, str],
    scripted_responses: dict[str, str],
) -> ScriptedProvider:
    """Build a dynamic-responder ScriptedProvider mirroring the Java FakeProvider."""

    provider = ScriptedProvider()

    def responder(request: LlmRequest) -> LlmResponse:
        # Find the USER message to identify which step this is.
        user_content = next(
            (m.content for m in request.messages if m.role == "user"),
            "",
        )

        matched_id: str | None = None
        for prompt, step_id in prompt_to_id.items():
            if prompt in user_content:
                matched_id = step_id
                break

        # Detect post-tool turn: a TOOL-role message is present in history.
        is_tool_result_turn = any(m.role == "tool" for m in request.messages)

        if is_tool_result_turn:
            # Second call for step-e: return the post-tool final text.
            text = scripted_responses.get("step-e", "")
            return LlmResponse.of(text)

        if matched_id == "step-e":
            # First call for step-e: request the uppercase tool.
            return LlmResponse.with_tool_calls(
                "",
                [ToolCallRequest(
                    id="call_conformance_1",
                    name="uppercase",
                    arguments_json=UPPERCASE_TOOL_ARGS,
                )],
            )

        # Steps a-d: return canned text.
        text = scripted_responses.get(matched_id, "") if matched_id else ""
        return LlmResponse.of(text)

    provider.set_responder(responder)
    return provider


# ---------------------------------------------------------------------------
# Test 1: Flow import is structurally correct
# ---------------------------------------------------------------------------

def test_imports_fixture_structurally_correct() -> None:
    """The importer maps the canonical JSON fields to StepConfig correctly."""
    raw = _load_fixture("conformance-chain.flow.json")
    flow = FlowImport.from_canonical_json(raw)

    assert flow.id == "conformance-chain"
    assert len(flow.steps) == 5

    ids = [s.id for s in flow.steps]
    assert ids == ["step-a", "step-b", "step-c", "step-d", "step-e"]

    assert "Step A" in flow.steps[0].prompt_template
    assert "Step B" in flow.steps[1].prompt_template
    assert "Step E" in flow.steps[4].prompt_template

    assert flow.steps[0].depends_on == []
    assert flow.steps[1].depends_on == ["step-a"]
    assert flow.steps[2].depends_on == ["step-b"]
    assert flow.steps[3].depends_on == ["step-c"]
    assert flow.steps[4].depends_on == ["step-d"]

    assert flow.steps[0].system_prompt is None
    assert flow.steps[0].context == {}


# ---------------------------------------------------------------------------
# Test 2: DAG execution order matches the golden order
# ---------------------------------------------------------------------------

def test_dag_order_matches_golden_order() -> None:
    """The Python runtime traverses the conformance DAG in the canonical golden order."""
    raw = _load_fixture("conformance-chain.flow.json")
    flow = FlowImport.from_canonical_json(raw)

    scripted_responses: dict[str, str] = json.loads(_load_fixture("scripted-responses.json"))

    prompt_to_id = {step.prompt_template: step.id for step in flow.steps}

    observed_order: list[str] = []

    registry = ToolRegistry()
    registry.register("uppercase", _uppercase_tool)

    base_provider = _build_scripted_provider(prompt_to_id, scripted_responses)

    # Wrap the responder to capture first-visit order.
    original_responder = base_provider._responder  # noqa: SLF001

    def order_tracking_responder(request: LlmRequest) -> LlmResponse:
        user_content = next(
            (m.content for m in request.messages if m.role == "user"),
            "",
        )
        for prompt, step_id in prompt_to_id.items():
            if prompt in user_content and step_id not in observed_order:
                observed_order.append(step_id)
                break
        return original_responder(request)  # type: ignore[misc]

    base_provider.set_responder(order_tracking_responder)

    executor = FlowExecutor(StepExecutor(provider=base_provider, tool_registry=registry))
    executor.execute_all_text(flow)

    assert observed_order == GOLDEN_ORDER, (
        f"Python DAG execution order must match {GOLDEN_ORDER} but got {observed_order}. "
        "Cross-runtime conformance failure (ARCH-076)."
    )


# ---------------------------------------------------------------------------
# Test 3: Per-step outputs match golden-trace.json (semantic parity)
# ---------------------------------------------------------------------------

def test_semantic_parity_matches_golden_trace() -> None:
    """The Python runtime produces the same per-step outputs as TS and Java."""
    raw = _load_fixture("conformance-chain.flow.json")
    flow = FlowImport.from_canonical_json(raw)

    scripted_responses: dict[str, str] = json.loads(_load_fixture("scripted-responses.json"))
    golden_trace: list[dict[str, str]] = json.loads(_load_fixture("golden-trace.json"))

    prompt_to_id = {step.prompt_template: step.id for step in flow.steps}

    registry = ToolRegistry()
    registry.register("uppercase", _uppercase_tool)

    provider = _build_scripted_provider(prompt_to_id, scripted_responses)

    executor = FlowExecutor(StepExecutor(provider=provider, tool_registry=registry))
    execution_results = executor.execute_all_text(flow)

    # Build captured trace in golden-trace order.
    captured_trace = [
        {"stepId": step.id, "output": execution_results.get(step.id, "")}
        for step in flow.steps
    ]

    assert len(captured_trace) == len(golden_trace), (
        f"Trace length mismatch. Golden={len(golden_trace)} Observed={len(captured_trace)}"
    )

    for i, (expected, actual) in enumerate(zip(golden_trace, captured_trace)):
        assert expected["stepId"] == actual["stepId"], (
            f"Trace entry[{i}] stepId mismatch. "
            f"Expected={expected['stepId']} Actual={actual['stepId']}"
        )
        assert expected["output"] == actual["output"], (
            f"Trace entry[{i}] output mismatch for stepId='{expected['stepId']}'. "
            f"Expected=\"{expected['output']}\" Actual=\"{actual['output']}\". "
            "Both runtimes must propagate identical raw provider text (ARCH-074 + ARCH-075 + ARCH-076)."
        )


# ---------------------------------------------------------------------------
# Test 4: Tool-calling parity matches golden-tool-calls.json
# ---------------------------------------------------------------------------

def test_tool_calling_parity_matches_golden_tool_calls() -> None:
    """The Python runtime calls the uppercase tool with the canonical args and result."""
    golden_tool_calls: list[dict[str, str]] = json.loads(
        _load_fixture("golden-tool-calls.json")
    )

    raw = _load_fixture("conformance-chain.flow.json")
    flow = FlowImport.from_canonical_json(raw)
    step_e = next(s for s in flow.steps if s.id == "step-e")

    registry = ToolRegistry()
    registry.register("uppercase", _uppercase_tool)

    # Queue-mode scripted provider: turn 1 → tool call; turn 2 → final text.
    provider = ScriptedProvider()
    provider.respond_with_tool_call("call_conformance_1", "uppercase", UPPERCASE_TOOL_ARGS)
    provider.respond_with(STEP_E_FINAL_TEXT)

    step_executor = StepExecutor(provider=provider, tool_registry=registry)
    output = step_executor.execute_step_text(step_e)

    # Assert post-tool output.
    assert output == STEP_E_FINAL_TEXT, (
        f"step-e post-tool output must be '{STEP_E_FINAL_TEXT}', got '{output}'"
    )

    # Assert provider was called exactly twice.
    assert len(provider.requests) == 2, (
        f"Provider must be called exactly twice for step-e (tool-call + final-text), "
        f"got {len(provider.requests)}"
    )

    # Assert the tool result was threaded back as a TOOL message in the second request.
    second_request = provider.requests[1]
    tool_result_fed_back = any(
        m.role == "tool" and UPPERCASE_TOOL_RESULT in m.content
        for m in second_request.messages
    )
    assert tool_result_fed_back, (
        f"The tool result '{UPPERCASE_TOOL_RESULT}' must be fed back as a TOOL message "
        "in the second provider call."
    )

    # Assert against golden-tool-calls.json.
    assert len(golden_tool_calls) == 1, (
        f"golden-tool-calls.json must contain exactly one entry, got {len(golden_tool_calls)}"
    )
    golden = golden_tool_calls[0]

    assert golden["stepId"] == "step-e"
    assert golden["toolName"] == "uppercase", (
        f"Tool name must match the golden fixture, got '{golden['toolName']}'"
    )
    assert golden["arguments"] == UPPERCASE_TOOL_ARGS, (
        f"Tool arguments must match golden fixture.\n"
        f"Expected: {UPPERCASE_TOOL_ARGS}\nGot: {golden['arguments']}"
    )
    assert golden["result"] == UPPERCASE_TOOL_RESULT, (
        f"Tool result must match golden fixture.\n"
        f"Expected: {UPPERCASE_TOOL_RESULT}\nGot: {golden['result']}"
    )

    # Cross-check by calling the tool directly.
    direct_result = _uppercase_tool(text="hello conformance")
    assert direct_result == UPPERCASE_TOOL_RESULT, (
        f"The golden result must equal uppercase('hello conformance'). "
        f"Got '{direct_result}'"
    )
