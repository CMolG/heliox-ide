/**
 * step-type-meta.ts — Visual metadata for AgenticStepType values
 *
 * Responsibility:
 * - Maps agentic step types to their icon, accent colour, and display label.
 * - Provides a safe fallback for unknown/undefined types.
 *
 * Boundaries:
 * - Pure function — no React, no store access.
 */

export interface StepTypeMeta {
  icon: string;
  accent: string;
  label: string;
}

const STEP_TYPE_MAP: Record<string, StepTypeMeta> = {
  llm_call:  { icon: 'Sparkles',   accent: '#A78BFA', label: 'LLM Call'   },
  tool_call: { icon: 'Wrench',     accent: '#4DA8FF', label: 'Tool Call'  },
  router:    { icon: 'GitBranch',  accent: '#FACC15', label: 'Router'     },
  retriever: { icon: 'Database',   accent: '#34D399', label: 'Retriever'  },
};

const DEFAULT_META: StepTypeMeta = STEP_TYPE_MAP['llm_call'];

export function stepTypeMeta(type?: string): StepTypeMeta {
  if (!type) return DEFAULT_META;
  return STEP_TYPE_MAP[type] ?? DEFAULT_META;
}
