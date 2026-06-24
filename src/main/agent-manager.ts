/**
 * agent-manager.ts — Main process
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
/**
 * Agent Orchestration Core
 *
 * High-level loop:
 *  1) Build prompt (+ optional feedback from prior attempt)
 *  2) Stream agent output/events to renderer
 *  3) Optionally run E2E flows and compute snapshot/metric diffs
 *  4) If blocking regressions exist, feed structured feedback and retry
 *  5) Emit final `diffs-ready` payload
 *
 * This class centralizes orchestration state to keep IPC handlers thin.
 */
import { EventEmitter } from 'events';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createAdapter, buildAgentPrompt } from '../ai-adapter';
import type { AiAdapter } from '../ai-adapter';
import { SnapshotRunner } from '../snapshot-engine/runner';
import { computeDiff } from '../snapshot-engine/diff-engine';
import { FilePatcher } from './file-patcher';
import { DevSessionLogger } from './dev-session-logger';
import {
  Flow, AgentFeedbackPayload, SnapshotDiff, MetricViolation,
  SnapshotArtifact, PerformanceMetrics, RunAgentParams, errMsg,
} from '../types';
import { attachmentRegistry, exportContextDigest, getAttachmentInjectionBlocks } from './context-map';

const METRIC_THRESHOLDS: Partial<Record<keyof PerformanceMetrics, number>> = {
  lcp: 2500,
  inp: 200,
  cls: 0.10,
  tbt: 300,
  jsHeapMB: 150,
};

// Max wall-clock time for a single agent run (all attempts combined)
const AGENT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Orchestrates multiple AI agents, running E2E snapshot validation
 * after each change and feeding metric regressions back for auto-correction.
 */
export class AgentManager extends EventEmitter {
  private runner = new SnapshotRunner();
  private patcher = new FilePatcher();
  private isShuttingDown = false;
  private baselineSnapshots = new Map<string, Map<string, SnapshotArtifact>>();
  private activeParser: AiAdapter | null = null;
  private activeAgentId: string | null = null;

  constructor() {
    super();
    this.patcher.on('applied', ({ path, hunks }: { path: string; hunks: number }) => {
      this.emit('patch-applied', { path, hunks });
    });
    this.patcher.on('failed', ({ path, error }: { path: string; error: string }) => {
      this.emit('patch-failed', { path, error });
    });
  }

  async initialize(flows: Flow[]): Promise<void> {
    // Baselines are per-flow and per-step. We index by:
    // flow.id -> (step.id -> artifact) so comparison is stable across runs.
    await this.runner.init();
    for (const flow of flows) {
      const snapshots = await this.runner.runFlow(flow);
      const stepMap = new Map(snapshots.map(s => [s.stepId, s]));
      this.baselineSnapshots.set(flow.id, stepMap);
    }
    this.emit('baselines-ready');
  }

  async runAgent(params: RunAgentParams): Promise<void> {
    const { agentId, instruction, flows, cwd } = params;
    const deadline = Date.now() + AGENT_TIMEOUT_MS;
    let attemptNumber = 1;
    let feedbackPayload: AgentFeedbackPayload | undefined;
    const devLog = DevSessionLogger.enabled ? new DevSessionLogger(agentId, cwd) : null;

    // Bounded retry loop: attempts are capped and also constrained by wall-clock.
    while (attemptNumber <= 3) {
      if (Date.now() > deadline) {
        devLog?.error('Agent run exceeded maximum time limit');
        this.emit('diffs-ready', {
          agentId,
          diffs: [],
          violations: [],
          attemptNumber,
          error: 'Agent run exceeded maximum time limit',
        });
        return;
      }

      try {
        const contextProjectPath = params.contextProjectPath ?? params.cwd;
        if (contextProjectPath) {
          await attachmentRegistry.refresh(contextProjectPath).catch(() => undefined);
        }
        const contextDigest = params.contextDigest ??
          await exportContextDigest(contextProjectPath, {
            roleId: params.roleId,
            sessionId: agentId,
            limit: 10,
          }).catch(() => '');
        const attachedDirectives = params.attachedDirectives ?? getAttachmentInjectionBlocks(agentId);

        const prompt = buildAgentPrompt({
          userInstruction: instruction,
          flows,
          feedbackPayload,
          rolePrompt: params.rolePrompt,
          modPrompts: params.modPrompts,
          contextDigest,
          attachedDirectives,
        });
        const parser = createAdapter(params.aiAdapter ?? 'opencode');
        this.activeParser = parser;
        this.activeAgentId = agentId;

        // Start dev session log
        if (attemptNumber === 1) {
          devLog?.start({
            model: params.model,
            effort: params.effort,
            aiAdapter: params.aiAdapter,
            resumeSessionId: params.resumeSessionId,
            prompt,
          });
        } else {
          devLog?.event('autocorrecting', { attemptNumber });
        }

        // Forward normalized streaming events for live UI updates.
        // Mapping stays explicit so renderer contracts remain predictable.
        const fwd: [string, string][] = [
          ['thinking_delta', 'agent-thinking-delta'],
          ['message_delta', 'agent-message-delta'],
          ['message', 'agent-message'],
          ['tool_request', 'agent-tool-use'],
          ['tool_result', 'agent-tool-result'],
          ['file_changed', 'agent-file-changed'],
        ];
        for (const [from, to] of fwd) parser.on(from, (data: any) => {
          this.emit(to, { agentId, ...data });
          // Log event with the external type name for readability
          const logType = to.replace('agent-', '');
          devLog?.event(logType, data);
        });

        parser.on('raw_line', (line: string) => {
          // Parse and transform raw JSONL into readable conversation entries
          // instead of dumping full JSON objects
          try {
            const parsed = JSON.parse(line);
            const type = parsed.type as string;
            const data = parsed.data ?? {};

            // Skip noisy ephemeral events that are handled by dedicated listeners
            if (type === 'assistant.message_delta' || type === 'assistant.message' ||
                type === 'assistant.turn_start' || type === 'assistant.turn_end' ||
                type === 'models' || parsed.ephemeral) {
              return;
            }

            // Reasoning/thinking deltas → emit just the readable text content
            if (type === 'assistant.reasoning_delta' || type === 'assistant.thinking_delta') {
              const delta = data.deltaContent as string;
              if (delta) {
                this.emit('agent-raw-output', { agentId, rawLine: delta, isThinking: true });
              }
              return;
            }

            // Tool results — show a concise summary
            if (type === 'tool.result') {
              const tool = data.tool as string ?? 'unknown';
              const result = data.result as string ?? '';
              const summary = result.length > 200 ? result.slice(0, 200) + '…' : result;
              this.emit('agent-raw-output', { agentId, rawLine: `[tool:${tool}] ${summary}` });
              return;
            }

            // Result event — show summary
            if (type === 'result') {
              const exitCode = parsed.exitCode ?? data.exitCode ?? '?';
              this.emit('agent-raw-output', { agentId, rawLine: `[result] exit code: ${exitCode}` });
              return;
            }

            // For any other unhandled event types, show a compact one-liner
            this.emit('agent-raw-output', { agentId, rawLine: `[${type}]` });
          } catch {
            // Non-JSON line — pass through as-is (stderr, plain text, etc.)
            if (line.trim()) {
              this.emit('agent-raw-output', { agentId, rawLine: line });
            }
          }
        });

        parser.on('result', ({ exitCode, usage, sessionId, premiumRequests, totalApiDurationMs }: { exitCode: number; usage: unknown; sessionId?: string; premiumRequests?: number; totalApiDurationMs?: number }) => {
          this.emit('agent-result', { agentId, exitCode, usage, sessionId, premiumRequests, totalApiDurationMs });
          devLog?.event('result', { exitCode, sessionId, premiumRequests, totalApiDurationMs });
        });

        this.emit('agent-started', { agentId, attempt: attemptNumber });
        devLog?.event('started', { attempt: attemptNumber });
        await parser.runPrompt({
          prompt,
          cwd,
          model: params.model,
          effort: params.effort,
          resumeSessionId: params.resumeSessionId,
        });
        this.activeParser = null;
        this.activeAgentId = null;

        // Fast path: when E2E is disabled (or no executable flows), return
        // directly after generation to avoid snapshot overhead.
        const activeFlows = flows.filter(f => f.steps.length > 0 && f.baseUrl);
        if (params.runE2E === false || activeFlows.length === 0) {
          // Auto-commit if enabled
          if (params.autoCommit) {
            await this.autoCommit(cwd, instruction);
          }
          this.emit('diffs-ready', { agentId, diffs: [], violations: [], attemptNumber });
          devLog?.finish();
          return;
        }

        // Validation phase: execute flows, compare against stored baselines,
        // then derive violations used by autocorrection.
        this.emit('agent-running-e2e', { agentId, attempt: attemptNumber });
        const diffs: SnapshotDiff[] = [];

        for (const flow of flows) {
          try {
            const newSnapshots = await this.runner.runFlow(flow);
            const baseline = this.baselineSnapshots.get(flow.id);
            if (!baseline) continue;

            for (const newSnap of newSnapshots) {
              const baseSnap = baseline.get(newSnap.stepId);
              if (!baseSnap) continue;
              const diff = await computeDiff(baseSnap, newSnap);
              diffs.push(diff);
            }
          } catch (flowErr) {
            const message = flowErr instanceof Error ? flowErr.message : String(flowErr);
            this.emit('agent-file-changed', {
              agentId,
              path: `e2e-error:${flow.id}`,
              patch: message,
            });
          }
        }

        const violations = this.extractViolations(diffs);
        const hasBlockingViolations = violations.some(v =>
          ['lcp', 'cls', 'tbt'].includes(v.metric) && Math.abs(v.deltaPct) > 50
        );

        if (!hasBlockingViolations || attemptNumber === 3) {
          if (params.autoCommit && !hasBlockingViolations) {
            await this.autoCommit(cwd, instruction);
          }
          this.emit('diffs-ready', { agentId, diffs, violations, attemptNumber });
          devLog?.finish(diffs.flatMap(d => (d as any).filesChanged ?? []));
          return;
        }

        // Retry payload carries concrete regression evidence so the next attempt
        // can target specific performance issues instead of re-running blindly.
        feedbackPayload = {
          snapshotDiff: diffs[0],
          violations,
          instruction: 'Fix the metric regressions listed above before proceeding.',
          attemptNumber,
        };

        this.emit('agent-autocorrecting', { agentId, violations, attemptNumber });
        attemptNumber++;
      } catch (err) {
        devLog?.error(`Agent failed on attempt ${attemptNumber}: ${errMsg(err)}`);
        this.emit('diffs-ready', {
          agentId,
          diffs: [],
          violations: [],
          attemptNumber,
          error: `Agent failed on attempt ${attemptNumber}: ${errMsg(err)}`,
        });
        return;
      }
    }
  }

  private extractViolations(diffs: SnapshotDiff[]): MetricViolation[] {
    const violations: MetricViolation[] = [];
    for (const diff of diffs) {
      for (const [metric, threshold] of Object.entries(METRIC_THRESHOLDS)) {
        const delta = diff.metricsDelta[metric as keyof typeof diff.metricsDelta];
        if (delta && delta.status === 'critical') {
          violations.push({
            metric: metric as keyof PerformanceMetrics,
            before: delta.before,
            after: delta.after,
            deltaPct: delta.deltaPct,
            threshold,
            likelyCause: inferCause(metric),
          });
        }
      }
    }
    return violations;
  }

  stopAgent(agentId: string): boolean {
    // Abort is best-effort and idempotent: returning false means the process
    // was already inactive by the time stop was requested.
    if (this.activeAgentId === agentId && this.activeParser?.isRunning) {
      this.activeParser.abort();
      this.activeParser = null;
      this.activeAgentId = null;
      this.emit('diffs-ready', { agentId, diffs: [], violations: [], error: 'Agent stopped by user' });
      return true;
    }
    // Agent already exited or crashed — clean up stale references
    if (this.activeAgentId === agentId) {
      this.activeParser = null;
      this.activeAgentId = null;
    }
    return false;
  }

  private async autoCommit(cwd: string, instruction: string): Promise<void> {
    const execFileAsync = promisify(execFile);
    try {
      const summary = instruction.length > 72
        ? instruction.slice(0, 69) + '...'
        : instruction;
      await execFileAsync('git', ['add', '-A'], { cwd, timeout: 10_000 });
      await execFileAsync('git', ['commit', '-m', `Heliox: ${summary}`], { cwd, timeout: 15_000 });
    } catch {
      // Commit may fail if there are no changes; ignore silently
    }
  }

  async shutdown(): Promise<void> {
    // Remove listeners first to prevent late emissions during teardown.
    this.isShuttingDown = true;
    this.removeAllListeners();
    await this.runner.close();
  }
}

function inferCause(metric: string): string {
  const causes: Record<string, string> = {
    lcp: 'New unoptimized image or render-blocking resource likely added',
    cls: 'Dynamic element without reserved dimensions detected in DOM diff',
    tbt: 'Long synchronous JS task introduced in main thread',
    inp: 'Heavy event handler or synchronous state update on interaction',
    jsHeapMB: 'Memory leak or uncleaned subscription in component lifecycle',
  };
  return causes[metric] ?? 'Unknown — review DOM diff for clues';
}
