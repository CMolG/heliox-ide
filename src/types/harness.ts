/**
 * harness.ts — Agentic execution AST types
 *
 * These interfaces describe the visual-canvas-free execution contract consumed
 * by the future harness runtime and SDK integrations.
 */

export type AgenticStepType = 'llm_call' | 'tool_call' | 'router' | string;

export type AgenticExecutionStatus = 'idle' | 'compiling' | 'running' | 'paused' | 'completed' | 'error';

export interface AgenticTool {
  id: string;
  name: string;
  config?: Record<string, unknown>;
}

export interface AgenticMod {
  id: string;
  name: string;
  type: 'pre_process' | 'post_process' | 'system_override' | 'tool_provider';
  config?: Record<string, unknown>;
}

export interface AgenticRole {
  id: string;
  name: string;
  systemPrompt: string;
}

export interface AgenticMentalContext {
  id: string;
  text: string;
  relationToStep: 'incoming' | 'outgoing';
}

/**
 * A single required output artifact for a step's completion contract. The
 * guardrail engine matches `pathPattern` against the workspace and asserts every
 * `mustContain` signature is present — deterministically, for any model.
 */
export interface StepArtifactRequirement {
  /** Human description surfaced in corrective feedback on failure. */
  description: string;
  /** RegExp (string) matched against workspace file paths. */
  pathPattern: string;
  /** RegExp (string) signatures at least one matching file must contain. */
  mustContain?: string[];
  /** Minimum byte size for at least one matching file (rejects empty stubs). */
  minBytes?: number;
}

/**
 * A model-agnostic "definition of done" for a step. After the step runs, the
 * executor verifies this contract against the workspace and re-runs the step
 * with concrete corrective feedback until it passes or the attempt budget is
 * spent — so output quality does not depend on the model's stamina.
 */
export interface StepContract {
  /** The step must create or modify at least one file. */
  mustWriteFiles?: boolean;
  /** Files the step wrote may not contain TODO/FIXME/placeholder stubs. */
  forbidStubMarkers?: boolean;
  /** Artifacts that must exist (with required content) when the step finishes. */
  requiredArtifacts?: StepArtifactRequirement[];
  /** Override the default verify-and-retry attempt budget for this step. */
  maxAttempts?: number;
}

export interface AgenticStep {
  id: string;
  type: AgenticStepType;
  prompt: string;
  tools: AgenticTool[];
  prevStepIds: string[];
  nextStepIds: string[];
  mods: AgenticMod[];
  roles: AgenticRole[];
  mentalContext: AgenticMentalContext[];
  /** Optional deterministic completion contract enforced by the guardrail engine. */
  contract?: StepContract;
}

export interface AgenticFlow {
  id: string;
  name: string;
  rootStepId: string;
  stepsRecord: Record<string, AgenticStep>;
}
