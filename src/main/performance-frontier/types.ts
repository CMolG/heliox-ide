import type { AgenticFlow } from '../../types/harness';
import type { HarnessStepRunnerInput } from '../harness-engine/executor';
import type { LLMStepResult } from '../harness-engine/llm-runner';
import type { PipelineAssembly, PipelineDiscoveryCatalog } from '../meta-agent/pipeline-generator';
import type { McpToolTelemetryEvent } from './telemetry/tool-events';

export type PFSuite =
  | 'architecture'
  | 'analysis'
  | 'design'
  | 'business'
  | 'team-work'
  | 'flow-assembler'
  | 'development'
  | 'business-knowledge'
  | 'progression';

/**
 * A single mutation epoch in a brownfield (progression) case. Each epoch runs
 * its own agentic flow against the SAME, non-destroyed VFS, so later epochs can
 * regress earlier work.
 */
export interface PFEpoch {
  id: string;
  label: string;
  prompt: string;
  flow: AgenticFlow;
}

export interface PFCase {
  id: string;
  suite: PFSuite;
  seed: number;
  prompt: string;
  variables: Record<string, string | number | boolean>;
  flow: AgenticFlow;
  initialFiles?: Record<string, string>;
  /** Present for multi-epoch (progression) suites; `flow` mirrors the first epoch. */
  epochs?: PFEpoch[];
}

export interface PFConversationEntry {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface PFCognitiveTraceEntry {
  type: 'thought' | 'tool_call' | 'tool_result';
  content: string;
  stepId?: string;
  toolName?: string;
  /** Epoch id (e.g. "epoch-1") for progression runs, for grouped rendering. */
  epoch?: string;
}

export interface PFTelemetrySummary {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  latencyMs: number;
  stepCount: number;
  toolCallsCount: number;
  toolResultsCount: number;
  mcpToolCalls: number;
  mcpSuccessfulToolCalls: number;
  mcpInterceptedToolCalls: number;
  mcpSchemaErrors: number;
  mcpSyntaxPrecision: number;
}

export interface PFGeneratedArtifact {
  vfsPath: string;
  artifactPath: string;
  fileUrl: string;
  sizeBytes: number;
  /** Epoch id the artifact snapshot belongs to (progression runs only). */
  epoch?: string;
}

/** Snapshot of one progression epoch: what the agent saw and produced. */
export interface PFProgressionEpochEvidence {
  id: string;
  label: string;
  prompt: string;
  vfsSnapshot: Record<string, string>;
  cognitiveTrace: PFCognitiveTraceEntry[];
  generatedArtifacts?: PFGeneratedArtifact[];
}

export interface PFProgressionEvidence {
  epochs: PFProgressionEpochEvidence[];
}

export interface PFJudgeInput {
  runId: string;
  caseId: string;
  suite: PFSuite;
  modelUnderTest: string;
  userPrompt: string;
  conversation: PFConversationEntry[];
  vfsSnapshot: Record<string, string>;
  telemetry: PFTelemetrySummary;
  toolEvents: McpToolTelemetryEvent[];
  cognitiveTrace: PFCognitiveTraceEntry[];
  flowAssembler?: PFFlowAssemblerEvidence;
  progression?: PFProgressionEvidence;
  groundTruth?: PFGroundTruth;
}

export interface PFTelemetryEfficiencyEvaluation {
  score: number;
  justification: string;
  latencyMs: number;
  totalTokens: number;
}

export interface PFJudgeResult {
  runId: string;
  caseId: string;
  suite: PFSuite;
  modelUnderTest: string;
  verdict: 'pass' | 'partial' | 'fail';
  finalScore: number;
  semanticScore: number;
  semanticMaxScore?: number;
  telemetryScore: number;
  evaluations: Record<string, unknown> & {
    telemetryEfficiency: PFTelemetryEfficiencyEvaluation;
  };
  criticalFailures: string[];
  telemetry: PFTelemetrySummary;
  cognitiveTrace: PFCognitiveTraceEntry[];
  flowAssembler?: PFFlowAssemblerEvidence;
  progression?: PFProgressionEvidence;
  groundTruth?: PFGroundTruth;
  generatedArtifacts?: PFGeneratedArtifact[];
  artifactsDir?: string;
  /** Set to true when the judge itself failed to produce a valid evaluation (all retry attempts exhausted). The result is degraded: verdict='fail', finalScore=0. */
  judgeError?: boolean;
}

export interface PFRunResult extends PFJudgeResult {
  reportPath: string;
  ledgerPath: string;
  generatedArtifacts: PFGeneratedArtifact[];
  artifactsDir: string;
}

export type PFStepRunner = (input: HarnessStepRunnerInput) => Promise<LLMStepResult>;
export type PFJudgeRunner = (input: PFJudgeInput) => Promise<PFJudgeResult>;

export interface PFFlowAssemblerEvidence {
  userIntent: string;
  generatedAst: PipelineAssembly;
  discoveredCatalog: PipelineDiscoveryCatalog;
}

export interface PFGroundTruth {
  /** Real executed unit-test results (development suite). */
  tests?: {
    ran: boolean;
    passed: number;
    failed: number;
    total: number;
    errorMessage?: string;
  };
  /** Real axe-core WCAG accessibility results (design suite). */
  a11y?: {
    ran: boolean;
    violations: number;
    critical: string[];
    passes: number;
    errorMessage?: string;
  };
  /** Real HTTP verification results from booting the agent's Express app (progression suite). */
  api?: {
    booted: boolean;
    checks: Array<{ name: string; ok: boolean; status?: number; detail?: string }>;
    errorMessage?: string;
  };
}
