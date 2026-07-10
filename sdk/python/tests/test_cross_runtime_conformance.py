"""
Cross-runtime conformance test — Python runtime (ARCH-076).

Proves that the Python Fluxor runtime:
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
from collections import deque
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
# Make sure the fluxor_sdk package is importable when running from repo root
# ---------------------------------------------------------------------------

_SDK_PYTHON = _REPO_ROOT / "sdk" / "python"
if str(_SDK_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SDK_PYTHON))

from fluxor_sdk import (  # noqa: E402
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


# ---------------------------------------------------------------------------
# Test 5: Loop execution matches golden-loop-trace.json (Phase 4a)
# ---------------------------------------------------------------------------

def test_loop_execution_matches_golden_trace() -> None:
    """The Python runtime expands `conformance-loop.flow.json`'s bounded
    loop-back edge (loop-1: step-b2 -> step-b1, maxIterations=3) into the same
    per-iteration instance trace as the TS/Java runtimes.

    The loop body {step-b1, step-b2} interleaves pass-by-pass
    (b1@1, b2@1, b1@2, b2@2, b1@3, b2@3) rather than running all of step-b1's
    passes before any of step-b2's — see golden-loop-trace.json and
    sdk/conformance/README.md.
    """
    raw = _load_fixture("conformance-loop.flow.json")
    flow = FlowImport.from_canonical_json(raw)

    assert len(flow.loops) == 1
    assert flow.loops[0].id == "loop-1"
    assert flow.loops[0].source_step_id == "step-b2"
    assert flow.loops[0].target_step_id == "step-b1"
    assert flow.loops[0].max_iterations == 3

    scripted_loop_responses: dict[str, list[str]] = json.loads(
        _load_fixture("scripted-loop-responses.json")
    )
    golden_trace: list[dict[str, object]] = json.loads(_load_fixture("golden-loop-trace.json"))

    prompt_to_id = {step.prompt_template: step.id for step in flow.steps}

    # Per-step FIFO queues — the scripted provider pops the next entry for
    # whichever step matches the request's prompt on every call (one call per
    # iteration; the prompt text itself does not vary by iteration).
    queues: dict[str, deque[str]] = {
        step_id: deque(responses) for step_id, responses in scripted_loop_responses.items()
    }

    def responder(request: LlmRequest) -> LlmResponse:
        user_content = next(
            (m.content for m in request.messages if m.role == "user"),
            "",
        )
        matched_id = next(
            (step_id for prompt, step_id in prompt_to_id.items() if prompt in user_content),
            None,
        )
        queue = queues.get(matched_id) if matched_id else None
        text = queue.popleft() if queue else ""
        return LlmResponse.of(text)

    provider = ScriptedProvider()
    provider.set_responder(responder)

    executor = FlowExecutor(StepExecutor(provider=provider))
    trace = executor.execute_all_text_trace(flow)

    assert trace == golden_trace, (
        "Python loop execution trace must match golden-loop-trace.json exactly.\n"
        f"Expected={golden_trace}\nActual={trace}"
    )

    # Every per-step queue must be fully drained — proves each iteration
    # triggered exactly one provider call (no skipped/duplicated passes).
    for step_id, queue in queues.items():
        assert not queue, f"Step '{step_id}' has {len(queue)} unconsumed scripted response(s)."


# ---------------------------------------------------------------------------
# Test 6: contract/model survive parsing untouched (carry-opaque, Phase 4a)
# ---------------------------------------------------------------------------

def test_contract_and_model_are_carried() -> None:
    """`step-b`'s `contract` (StepContract) and `model` override survive
    FlowImport parsing byte-for-byte. This format never interprets either
    field — it only guarantees they are carried opaquely (see
    golden-contract-roundtrip.json, the TS-side proof of the same contract).
    """
    raw = _load_fixture("conformance-contract.flow.json")
    flow = FlowImport.from_canonical_json(raw)

    step_a = next(s for s in flow.steps if s.id == "step-a")
    step_b = next(s for s in flow.steps if s.id == "step-b")

    assert step_a.contract is None
    assert step_a.model is None

    assert step_b.contract == {"mustWriteFiles": True, "maxAttempts": 2}, (
        f"step-b.contract must survive parsing byte-for-byte, got {step_b.contract}"
    )
    assert step_b.model == "openai/gpt-4o-mini", (
        f"step-b.model must survive parsing byte-for-byte, got {step_b.model}"
    )


# ---------------------------------------------------------------------------
# Test 7: legacy flow-format compat shim (rebranding Heliox -> Fluxor)
#
# Frozen cross-runtime contract (orchestrator ruling 2026-07-10; canonical
# reference: warnIfLegacyFormat in src/main/flow-export/fluxor-flow.ts):
#   1. format == "fluxor-flow"   -> silence.
#   2. format absent/null        -> ONE DeprecationWarning, reported as the
#                                   assumed "heliox-flow" (no pre-rebrand
#                                   export ever stamped the field, so absence
#                                   IS the legacy format).
#   3. any other value (incl.    -> ONE DeprecationWarning mentioning the
#      the literal "heliox-flow")   seen value.
# The import NEVER blocks. Once-per-distinct-value dedup is delegated to the
# stdlib warnings filter (Python's native equivalent of the TS warnOnce);
# pytest installs an "always" filter, so each test observes its own warning.
# ---------------------------------------------------------------------------

def test_legacy_format_imports_with_deprecation_warning() -> None:
    """Rule 3, explicit legacy value: a flow exported under the pre-rebrand
    ``"heliox-flow"`` format marker still imports cleanly (structurally
    identical to a current export) and triggers exactly one
    ``DeprecationWarning`` mentioning the seen value. TS proof:
    fluxor-flow.test.ts suite 7 ("legacy format tag compat")."""
    raw = _load_fixture("conformance-legacy-heliox-flow.flow.json")

    with pytest.warns(DeprecationWarning, match="heliox-flow") as record:
        flow = FlowImport.from_canonical_json(raw)

    assert flow.id == "conformance-legacy-format"
    assert len(flow.steps) == 1
    assert flow.steps[0].id == "step-a"
    assert len(record) == 1, f"Expected exactly one DeprecationWarning, got {len(record)}"


def test_current_format_flows_never_warn(recwarn: pytest.WarningsRecorder) -> None:
    """Rule 1: the canonical fixtures carry ``"format": "fluxor-flow"`` (the
    current wire format, stamped by the TS exporter on every export) and must
    import in total silence."""
    raw = _load_fixture("conformance-chain.flow.json")
    FlowImport.from_canonical_json(raw)

    assert len(recwarn) == 0, (
        f"Expected no warnings for a current-format flow, got {[str(w.message) for w in recwarn]}"
    )


def test_absent_format_warns_assuming_legacy_heliox_flow() -> None:
    """Rule 2: a flow with NO ``format`` field at all (every real export of
    the Heliox era — the field did not exist before the rebrand) imports fine
    but warns, reporting the assumed legacy ``"heliox-flow"`` format."""
    raw = json.dumps(
        {
            "version": "1",
            "id": "legacy-absent-format",
            "name": "Legacy Absent Format",
            "rootStepId": "step-a",
            "steps": [
                {"id": "step-a", "type": "llm_call", "prompt": "Step A.", "dependsOn": [], "tools": []}
            ],
        }
    )

    with pytest.warns(DeprecationWarning, match="heliox-flow") as record:
        flow = FlowImport.from_canonical_json(raw)

    assert flow.id == "legacy-absent-format", "An absent format tag must never block parsing"
    assert len(record) == 1, f"Expected exactly one DeprecationWarning, got {len(record)}"


def test_unknown_format_warns_mentioning_seen_value() -> None:
    """Rule 3, arbitrary unknown value: any ``format`` other than
    ``"fluxor-flow"`` warns mentioning the value actually seen, and never
    blocks parsing."""
    raw = json.dumps(
        {
            "version": "1",
            "id": "unknown-format",
            "name": "Unknown Format",
            "format": "quantum-flow",
            "rootStepId": "step-a",
            "steps": [
                {"id": "step-a", "type": "llm_call", "prompt": "Step A.", "dependsOn": [], "tools": []}
            ],
        }
    )

    with pytest.warns(DeprecationWarning, match="quantum-flow"):
        flow = FlowImport.from_canonical_json(raw)

    assert flow.id == "unknown-format", "An unknown format tag must never block parsing"
