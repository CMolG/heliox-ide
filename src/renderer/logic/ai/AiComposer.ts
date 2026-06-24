/**
 * AiComposer — RISEN Chain of Persona Mega-Prompt Engine
 *
 * Responsibility:
 * - Compose an irrefutable, single-shot Mega-Prompt sent to the AI agent.
 * - Enforce a strict cognitive sequencing:
 *   Persona -> Mandate -> Algorithm (CoT) -> Constraints -> Format.
 * - Fluent builder pattern: each wrapping step is a chainable method.
 *
 * Boundaries:
 * - Owns: prompt assembly order, section formatting, stupidity prelude,
 *   constraints aggregation, output schema injection.
 * - Does NOT own: adapter execution (see ai-adapter/),
 *   agent orchestration (see main/agent-manager), or UI state.
 *
 * Usage:
 *   const prompt = new AiComposer(instruction)
 *     .withStupidityMode(true)
 *     .withPersona("You are a Senior Cloud Architect...")
 *     .withCognitiveSteps(["Analyze feasibility", "Draft architecture"])
 *     .withStrictConstraints(["No AWS services allowed", "Keep under 500 words"])
 *     .withFlows(flows)
 *     .withFeedback(feedbackPayload)
 *     .withMemory(excitementProfile)
 *     .withOutputSchema()
 *     .compose();
 */
import type { Flow, AgentFeedbackPayload } from '@/types';
import type { NeuralExcitementProfile } from './memory/types';
import { MemoryComposerPlugin } from './memory/MemoryComposerPlugin';
import { getPrelude, getPreludeVersion } from './prompts/StupidityPrelude';
import { promptRegistry } from './prompts/PromptVersionRegistry';

// ─── Output Schema ─────────────────────────────────────────────────────────────

const OUTPUT_SCHEMA_VERSION = '2.0.0';

/**
 * The unified output contract.
 * It enforces that the AI does not just spit out JSON, but explicitly
 * writes out its reasoning process first (Chain-of-Thought) before formatting.
 */
const OUTPUT_SCHEMA = `[5. THE OUTPUT CONTRACT - STRICT FORMAT]
Your response MUST contain exactly two blocks, in this specific order:

1. A <step_by_step_reasoning> XML block where you document the execution of the Cognitive Algorithm.
2. A final JSON block inside a \`\`\`json fenced code block using this exact schema:

\`\`\`json
{
  "summary": "One-sentence description of what was accomplished",
  "filesChanged": [
    { "path": "relative/path.ext", "action": "modified | created | deleted", "description": "What changed and why" }
  ],
  "testsAffected": ["Names or paths of test files/suites affected by the changes"],
  "breakingChanges": false,
  "notes": "Optional additional context, caveats, or follow-up recommendations"
}
\`\`\``;

// ─── AiComposer ────────────────────────────────────────────────────────────────

export class AiComposer {
  // Base task
  private instruction: string;
  private stupidityMode = true;

  // 1. Persona (RISEN: Role)
  private personaProfile: string | null = null;

  // 3. Cognitive Algorithm (RISEN: Steps + Chain-of-Thought)
  private cognitiveSteps: string[] = [];

  // 4. Narrowing Constraints (RISEN: Narrowing)
  private strictConstraints: string[] = [];
  private contextDigest: string | null = null;
  private memorySection: string | null = null;
  private flows: Flow[] = [];

  // Dynamic Mandate modifiers (RISEN: Instructions / End Goal adjustments)
  private feedback: AgentFeedbackPayload | null = null;
  private attachedDirectives: { system?: string; prefix?: string; suffix?: string } = {};
  private includeOutputSchema = false;

  constructor(instruction: string) {
    this.instruction = instruction;
  }

  // ── Prelude Toggle ─────────────────────────────────────────────

  withStupidityMode(enabled: boolean): this {
    this.stupidityMode = enabled;
    return this;
  }

  // ── 1. The Mask (Persona Deep-Dive) ────────────────────────────

  /**
   * Replaces standard `withRole`.
   * Injects a deep psychological and professional profile.
   * Example: "You are an elite Staff Engineer known for extreme edge-case handling..."
   */
  withPersona(profile: string): this {
    this.personaProfile = profile;
    return this;
  }

  // ── Backward-Compatible Bridge Methods ─────────────────────────

  /** @deprecated Use `withPersona()` instead. Bridge for migration compatibility. */
  withRole(prompt: string | undefined | null): this {
    if (prompt) this.personaProfile = prompt;
    return this;
  }

  /** @deprecated Use `withStrictConstraints()` instead. Bridge for migration compatibility. */
  withMods(prompts: string[] | undefined | null): this {
    if (prompts && prompts.length > 0) this.strictConstraints = prompts;
    return this;
  }

  // ── 3. The Cognitive Algorithm (Steps + CoT) ───────────────────

  /**
   * Forces the AI to follow a strict logical sequence.
   * By combining RISEN's "Steps" with Chain-of-Thought, this prevents the
   * model from taking logic shortcuts.
   */
  withCognitiveSteps(steps: string[]): this {
    this.cognitiveSteps = steps;
    return this;
  }

  // ── 4. The Logical Prison (Narrowing Constraints) ──────────────

  /**
   * Replaces `withMods`. These are no longer mere suggestions;
   * they are absolute boundaries the AI cannot cross (RISEN's "Narrowing").
   */
  withStrictConstraints(constraints: string[]): this {
    if (constraints.length > 0) this.strictConstraints = constraints;
    return this;
  }

  withContextDigest(digest: string | undefined | null): this {
    if (digest && digest.trim()) this.contextDigest = digest.trim();
    return this;
  }

  withMemory(profileOrText: NeuralExcitementProfile | string | undefined | null): this {
    if (!profileOrText) return this;
    this.memorySection = typeof profileOrText === 'string'
      ? profileOrText
      : MemoryComposerPlugin.compose(profileOrText);
    return this;
  }

  withFlows(flows: Flow[] | undefined | null): this {
    if (flows && flows.length > 0) {
      this.flows = flows.filter(f => f.steps.length > 0 && f.baseUrl);
    }
    return this;
  }

  // ── Dynamic Modifiers (Feedback / Attachments) ─────────────────

  /**
   * If the agent failed a previous attempt, this modifies the "Mandate"
   * by explicitly forcing it to address metric regressions.
   */
  withFeedback(payload: AgentFeedbackPayload | undefined | null): this {
    if (payload) this.feedback = payload;
    return this;
  }

  withAttachedDirectives(directives: { system?: string; prefix?: string; suffix?: string } | undefined | null): this {
    if (directives) this.attachedDirectives = directives;
    return this;
  }

  withOutputSchema(): this {
    this.includeOutputSchema = true;
    return this;
  }

  // ── Compose ────────────────────────────────────────────────────

  /**
   * Assemble all sections into the final Mega-Prompt string.
   * Semantic layout for optimal LLM attention:
   * [PRELUDE]
   * 1. [THE MASK] (Persona)
   * 2. [THE MANDATE] (Task & Feedback)
   * 3. [THE COGNITIVE ALGORITHM] (CoT Steps)
   * 4. [THE LOGICAL PRISON] (Constraints & Context)
   * 5. [THE OUTPUT CONTRACT] (Format Schema)
   */
  compose(): string {
    this.registerVersions();

    const sections: string[] = [];

    // [PRELUDE]
    sections.push(`[PRELUDE]\n${getPrelude(this.stupidityMode)}`);
    if (this.attachedDirectives.system) sections.push(`[ACTIVE DIRECTIVES · SYSTEM]\n${this.attachedDirectives.system}`);
    if (this.attachedDirectives.prefix) sections.push(`[ACTIVE DIRECTIVES · PREFIX]\n${this.attachedDirectives.prefix}`);

    // 1. THE MASK
    if (this.personaProfile) {
      sections.push(`[1. THE MASK - PERSONA PROFILE]\n${this.personaProfile}`);
    }

    // 2. THE MANDATE
    sections.push(this.buildMandateSection());

    // 3. THE COGNITIVE ALGORITHM
    if (this.cognitiveSteps.length > 0) {
      sections.push(this.buildAlgorithmSection());
    }

    // 4. THE LOGICAL PRISON
    const narrowing = this.buildNarrowingSection();
    if (narrowing) {
      sections.push(`[4. THE LOGICAL PRISON - SYSTEM CONSTRAINTS]\n${narrowing}`);
    }

    // 5. THE OUTPUT CONTRACT
    if (this.includeOutputSchema) {
      sections.push(OUTPUT_SCHEMA);
    }

    if (this.attachedDirectives.suffix) {
      sections.push(`[ACTIVE DIRECTIVES · SUFFIX]\n${this.attachedDirectives.suffix}`);
    }

    // Using a heavy visual separator. LLMs allocate attention better
    // when distinct logical blocks are separated by distinct visual boundaries.
    return sections.join('\n\n=========================================\n\n');
  }

  // ── Private Section Builders ───────────────────────────────────

  /**
   * Formats the core task and injects urgent auto-correction feedback
   * if the agent is currently in a retry loop.
   */
  private buildMandateSection(): string {
    let mandate = `[2. THE MANDATE - MASTER OBJECTIVE]\n${this.instruction}`;

    if (this.feedback) {
      mandate += `\n\n!!! AUTO-CORRECTION ALERT (Attempt ${this.feedback.attemptNumber}/3) !!!\n`;
      mandate += `Your previous iteration caused metrics regressions. You MUST fix them based on the following:\n`;
      mandate += this.feedback.violations.map(v =>
        `- ${v.metric}: ${v.before} -> ${v.after} (${v.deltaPct > 0 ? '+' : ''}${v.deltaPct.toFixed(0)}%). Likely cause: ${v.likelyCause}`
      ).join('\n');
      mandate += `\nCorrection instruction: ${this.feedback.instruction}`;
    }

    return mandate;
  }

  /**
   * Prepares the Chain-of-Thought injection.
   * Instructs the AI on *how* to think before generating the final JSON.
   */
  private buildAlgorithmSection(): string {
    const stepsList = this.cognitiveSteps.map((step, idx) => `${idx + 1}. ${step}`).join('\n');
    return `[3. THE COGNITIVE ALGORITHM - SEQUENTIAL REASONING]
To ensure absolute precision, before generating the final output, you MUST open a <step_by_step_reasoning> tag and document your logical process strictly following this order:

${stepsList}

Do not take shortcuts. Show your work and evaluate trade-offs at each step.`;
  }

  /**
   * Aggregates all constraints and external context into a single unified
   * "ruleset" block.
   */
  private buildNarrowingSection(): string {
    const parts: string[] = [];

    if (this.strictConstraints.length > 0) {
      parts.push(`[ABSOLUTE RULES]\n- ${this.strictConstraints.join('\n- ')}`);
    }
    if (this.memorySection) {
      parts.push(`[LEARNED PREFERENCES (MEMORY)]\n${this.memorySection}`);
    }
    if (this.contextDigest) {
      parts.push(`[PROJECT CONTEXT DIGEST]\n${this.contextDigest}`);
    }
    if (this.flows.length > 0) {
      const flowText = this.flows.map(f => {
        const metrics = f.steps
          .filter(s => s.snapshot)
          .map(s => `    ${s.name}: LCP=${s.snapshot!.metrics.lcp}ms, CLS=${s.snapshot!.metrics.cls}, INP=${s.snapshot!.metrics.inp}ms`)
          .join('\n');
        return `  Flow: "${f.name}" (${f.baseUrl})\n${metrics}`;
      }).join('\n---\n');

      parts.push(`[E2E FLOWS BASELINE]\n${flowText}`);
    }

    return parts.join('\n\n');
  }

  /** Register all active prompt versions for telemetry and auditing. */
  private registerVersions(): void {
    const preludeKey = this.stupidityMode ? 'stupidity-prelude' : 'standard-prelude';
    promptRegistry.registerSync(preludeKey, getPreludeVersion(this.stupidityMode), getPrelude(this.stupidityMode));

    if (this.includeOutputSchema) {
      promptRegistry.registerSync('output-schema', OUTPUT_SCHEMA_VERSION, OUTPUT_SCHEMA);
    }
  }
}
