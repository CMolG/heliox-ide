/**
 * output-parser.ts — Copilot adapter (DEPRECATED)
 *
 * Responsibility:
 * - Backward-compatibility shim pointing to the new ai-adapter package
 * - All logic has been moved to src/ai-adapter/
 *
 * @deprecated Import from '../ai-adapter' instead
 */
import { GitHubCopilotAdapter } from '../ai-adapter/adapters/github-copilot';
import type { AdapterRunOptions } from '../ai-adapter/types';

/** @deprecated Use createAdapter('copilot') from '../ai-adapter' instead */
export class CopilotOutputParser extends GitHubCopilotAdapter {}

/** @deprecated Use AdapterRunOptions from '../ai-adapter/types' instead */
export type CopilotRunOptions = AdapterRunOptions;

