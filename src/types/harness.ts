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
}

export interface AgenticFlow {
  id: string;
  name: string;
  rootStepId: string;
  stepsRecord: Record<string, AgenticStep>;
}
