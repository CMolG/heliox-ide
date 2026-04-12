/**
 * prompt-builder.ts — AI Adapter
 *
 * Responsibility:
 * - Public API for building enriched agent prompts
 * - Delegates all composition logic to AiComposer (src/renderer/logic/ai)
 *
 * Boundaries:
 * - Owns: the buildAgentPrompt function signature
 * - Does NOT own: composition logic (AiComposer), adapter execution (adapters/)
 */
import { Flow, AgentFeedbackPayload } from '../types';
import { AiComposer } from '../renderer/logic/ai';

/**
 * Builds the final prompt sent to any AI adapter.
 * Delegates to AiComposer for all composition steps.
 *
 * Layout: [PRELUDE] → [MASK] → [MANDATE] → [ALGORITHM] → [PRISON] → [OUTPUT CONTRACT]
 */
export function buildAgentPrompt(params: {
  userInstruction: string;
  flows: Flow[];
  feedbackPayload?: AgentFeedbackPayload;
  rolePrompt?: string;
  modPrompts?: string[];
  designSystemPrompt?: string;
  contextDigest?: string;
  attachedDirectives?: {
    system?: string;
    prefix?: string;
    suffix?: string;
  };
  stupidityMode?: boolean;
}): string {
  const {
    userInstruction, flows, feedbackPayload,
    rolePrompt, modPrompts, designSystemPrompt,
    contextDigest, attachedDirectives,
    stupidityMode = true,
  } = params;

  return new AiComposer(userInstruction)
    .withStupidityMode(stupidityMode)
    .withAttachedDirectives(attachedDirectives)
    .withPersona(rolePrompt ?? '')
    .withStrictConstraints(modPrompts ?? [])
    .withDesignSystem(designSystemPrompt)
    .withContextDigest(contextDigest)
    .withFlows(flows)
    .withFeedback(feedbackPayload)
    .withOutputSchema()
    .compose();
}
