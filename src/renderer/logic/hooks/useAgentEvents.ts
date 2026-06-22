/**
 * useAgentEvents.ts — Renderer UI
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
// src/renderer/hooks/useAgentEvents.ts — Agent event listener hook extracted from App.tsx
import { useEffect } from 'react';
import { useHelioxStore } from '../../store';
import { sysMsg } from '@/types';
import type { AgentEvent, ChatMessage } from '@/types';
import { playAgentCompleteSound, playAgentErrorSound } from '../sounds';

// Patterns that indicate the chosen model is unavailable — triggers cache invalidation
const MODEL_ERROR_PATTERNS = [
  /unknown model/i, /invalid model/i, /model not found/i,
  /model .* not available/i, /unsupported model/i, /no such model/i,
];

// Per-agent buffer of recent raw-output lines — cleared on agent start
const rawOutputBuffer = new Map<string, string[]>();
const MAX_BUFFER_LINES = 50;

function bufferRawLine(agentId: string, line: string) {
  const buf = rawOutputBuffer.get(agentId) ?? [];
  buf.push(line);
  if (buf.length > MAX_BUFFER_LINES) buf.shift();
  rawOutputBuffer.set(agentId, buf);
}

function hasModelError(agentId: string): boolean {
  const buf = rawOutputBuffer.get(agentId) ?? [];
  return buf.some(line => MODEL_ERROR_PATTERNS.some(re => re.test(line)));
}

const getUniqueTools = (msgs: ChatMessage[]) =>
  [...new Set(msgs.filter(m => m.role === 'system' && m.content.startsWith('Using tool:')).map(m => m.content.replace('Using tool: ', '')))];

function getEventMessage(event: AgentEvent): string {
  switch (event.type) {
    case 'started': return 'Agent started';
    case 'file-changed': return `File changed: ${event.path ?? 'unknown'}`;
    case 'running-e2e': return 'Running E2E snapshots…';
    case 'autocorrecting': return `Auto-correcting (attempt ${event.attempt ?? '?'})`;
    case 'message-delta': return '';
    case 'message': return `Agent: ${(event.content ?? '').slice(0, 80)}`;
    case 'tool-use': return `Tool: ${event.tool ?? 'unknown'}`;
    case 'tool-result': return `Tool result: ${event.tool ?? 'unknown'}`;
    case 'result': return `Agent finished (exit ${event.exitCode ?? '?'})`;
    case 'diffs-ready': return `${event.diffs?.length ?? 0} visual diff(s) ready`;
    default: return `Event: ${event.type}`;
  }
}

function handleDiffsReady(event: AgentEvent) {
  const store = useHelioxStore.getState();
  const projectPath = store.projectPath;
  if (event.error) {
    store.addSessionMessage(event.agentId, sysMsg('error', `Agent error: ${event.error}`));
    store.updateSessionStatus(event.agentId, 'error', Date.now());
    store.addToast(`Agent failed: ${event.error}`, 'error');
    playAgentErrorSound();
  } else {
    store.setPendingDiffs(event.diffs ?? []);
    store.addSessionMessage(event.agentId, sysMsg('diffs', `Agent completed — ${event.diffs?.length ?? 0} visual diff(s) ready for review.`));
    store.updateSessionStatus(event.agentId, 'completed', Date.now());
    store.addToast(`Agent completed — ${event.diffs?.length ?? 0} diff(s) ready`, 'success');
    playAgentCompleteSound();
  }
  store.updateAgentStatus(event.agentId, 'done');
  store.setIsRunningAgent(false);

  if (window.helioxAPI && projectPath) {
    const session = store.sessions.find(s => s.id === event.agentId);
    if (session) {
      window.helioxAPI.contextMapUpsertSessionNode(projectPath, {
        sessionId: session.id,
        label: session.description?.trim().length
          ? `Session #${session.number}: ${session.description}`
          : `Session #${session.number}`,
        status: event.error ? 'stopped' : 'completed',
        roleId: session.roleId,
      }).catch(() => {});
    }
  }
}

function buildSessionSummary(event: AgentEvent): string {
  const store = useHelioxStore.getState();
  const session = store.sessions.find(s => s.id === event.agentId);
  if (!session) return '';

  const changedFiles = store.sessionChangedFiles[event.agentId] ?? [];
  const duration = session.startedAt
    ? Math.round(((event.exitCode !== undefined ? Date.now() : session.completedAt ?? Date.now()) - session.startedAt) / 1000)
    : 0;

  const uniqueTools = getUniqueTools(session.messages);

  // File stats
  const totalAdded = changedFiles.reduce((s, f) => s + f.linesAdded, 0);
  const totalRemoved = changedFiles.reduce((s, f) => s + f.linesRemoved, 0);

  const lines: string[] = ['─── Session Summary ───'];

  if (event.exitCode === 0) {
    lines.push('✓ Completed successfully');
  } else {
    lines.push(`✗ Exited with code ${event.exitCode}`);
  }

  if (duration > 0) {
    const min = Math.floor(duration / 60);
    const sec = duration % 60;
    lines.push(`⏱ Duration: ${min > 0 ? `${min}m ` : ''}${sec}s`);
  }

  if (session.tokenUsage?.premiumRequests) {
    lines.push(`⚡ Premium requests: ${session.tokenUsage.premiumRequests}`);
  }

  if (changedFiles.length > 0) {
    lines.push(`📁 Files changed: ${changedFiles.length} (+${totalAdded} −${totalRemoved})`);
    changedFiles.slice(0, 10).forEach(f => {
      const name = f.path.split('/').pop() ?? f.path;
      const stats = f.linesAdded || f.linesRemoved ? ` (+${f.linesAdded} −${f.linesRemoved})` : '';
      lines.push(`   • ${name}${stats}`);
    });
    if (changedFiles.length > 10) {
      lines.push(`   … and ${changedFiles.length - 10} more`);
    }
  }

  if (uniqueTools.length > 0) {
    lines.push(`🔧 Tools used: ${uniqueTools.join(', ')}`);
  }

  lines.push('───────────────────────');
  return lines.join('\n');
}

function handleResult(event: AgentEvent) {
  const store = useHelioxStore.getState();
  if (event.exitCode !== undefined) {
    // Build and add summary before setting final status
    const summary = buildSessionSummary(event);
    if (summary) {
      store.addSessionMessage(event.agentId, sysMsg('summary', summary));
    }

    store.addSessionMessage(event.agentId, sysMsg('result', `Agent finished with exit code ${event.exitCode}`));
    const resultStatus = event.exitCode === 0 ? 'completed' : 'error';
    store.updateSessionStatus(event.agentId, resultStatus, Date.now());
    store.setIsRunningAgent(false);

    // Melodic notification sound
    if (event.exitCode === 0) playAgentCompleteSound();
    else playAgentErrorSound();

    if (!document.hasFocus() && window.helioxAPI) {
      const session = store.sessions.find(s => s.id === event.agentId);
      const label = session ? `Session #${session.number}` : event.agentId;
      window.helioxAPI.showNotification({
        title: event.exitCode === 0 ? 'Agent Complete' : 'Agent Failed',
        body: `${label} finished${event.exitCode !== 0 ? ` with exit code ${event.exitCode}` : ''}`,
      });
    }

    // If failure was caused by an invalid model, bust the cache and reload the list
    if (event.exitCode !== 0 && hasModelError(event.agentId) && window.helioxAPI) {
      console.warn('[Heliox] Model error detected — invalidating models cache');
      window.helioxAPI.invalidateModelsCache().then(() =>
        window.helioxAPI!.listModels()
      ).then((models) => {
        if (models?.length) store.setAvailableModels(models);
        store.addToast('Model list refreshed after error', 'info');
      }).catch(() => {});
    }

    // Cleanup raw-output buffer for this agent
    rawOutputBuffer.delete(event.agentId);

    // Save session summary to Heliox config dir
    saveSessionSummaryToFile(event);

    if (window.helioxAPI && store.projectPath) {
      const session = store.sessions.find(s => s.id === event.agentId);
      if (session) {
        window.helioxAPI.contextMapUpsertSessionNode(store.projectPath, {
          sessionId: session.id,
          label: session.description?.trim().length
            ? `Session #${session.number}: ${session.description}`
            : `Session #${session.number}`,
          status: event.exitCode === 0 ? 'completed' : 'stopped',
          roleId: session.roleId,
        }).catch(() => {});
      }
    }
  }
  if (event.sessionId) {
    store.setOpencodeSessionId(event.agentId, event.sessionId);
  }
  if (event.premiumRequests !== undefined || event.totalApiDurationMs !== undefined) {
    store.setSessionTokenUsage(event.agentId, {
      premiumRequests: event.premiumRequests,
      totalApiDurationMs: event.totalApiDurationMs,
    });
  }
}

function handleMessageDelta(event: AgentEvent) {
  if (!event.content || !event.messageId) return;
  const store = useHelioxStore.getState();
  const session = store.sessions.find(s => s.id === event.agentId);
  const lastMsg = session?.messages[session.messages.length - 1];
  if (lastMsg && lastMsg.role === 'assistant' && lastMsg.id === `stream-${event.messageId}`) {
    const updated = { ...lastMsg, content: lastMsg.content + event.content };
    const newMessages = [...(session?.messages ?? [])];
    newMessages[newMessages.length - 1] = updated;
    store.updateSessionMessages(event.agentId, newMessages);
  } else {
    store.addSessionMessage(event.agentId, {
      id: `stream-${event.messageId}`,
      role: 'assistant',
      content: event.content,
      timestamp: Date.now(),
    });
  }
}

function handleMessage(event: AgentEvent) {
  if (!event.content || !event.messageId) return;
  const store = useHelioxStore.getState();
  const session = store.sessions.find(s => s.id === event.agentId);
  const streamId = `stream-${event.messageId}`;
  const streamIdx = session?.messages.findIndex(m => m.id === streamId) ?? -1;
  if (streamIdx >= 0 && session) {
    const newMessages = [...session.messages];
    newMessages[streamIdx] = { ...newMessages[streamIdx], content: event.content, id: `msg-${event.messageId}` };
    store.updateSessionMessages(event.agentId, newMessages);
  } else if (event.content.trim()) {
    store.addSessionMessage(event.agentId, {
      id: `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      role: 'assistant',
      content: event.content.trim(),
      timestamp: Date.now(),
    });
  }
}

async function saveSessionSummaryToFile(event: AgentEvent) {
  const store = useHelioxStore.getState();
  const session = store.sessions.find(s => s.id === event.agentId);
  if (!session || !store.projectPath || !window.helioxAPI) return;

  try {
    const configDir = await window.helioxAPI.getConfigDir(store.projectPath);
    const changedFiles = store.sessionChangedFiles[event.agentId] ?? [];
    const uniqueTools = getUniqueTools(session.messages);
    const duration = session.startedAt
      ? Math.round((Date.now() - session.startedAt) / 1000)
      : 0;

    const summaryJson = {
      sessionId: session.id,
      sessionNumber: session.number,
      model: session.model,
      status: event.exitCode === 0 ? 'completed' : 'error',
      exitCode: event.exitCode,
      durationSeconds: duration,
      tokenUsage: session.tokenUsage ?? null,
      filesChanged: changedFiles.map(f => ({
        path: f.path,
        linesAdded: f.linesAdded,
        linesRemoved: f.linesRemoved,
      })),
      toolsUsed: uniqueTools,
      timestamp: new Date().toISOString(),
      description: session.description || session.messages.find(m => m.role === 'user')?.content?.slice(0, 200) || '',
    };

    const filename = `session-${session.number}-summary.json`;
    await window.helioxAPI.writeProjectConfig(store.projectPath, filename, JSON.stringify(summaryJson, null, 2));
  } catch {
    // Non-critical — silently ignore summary save failures
  }
}

export function useAgentEvents() {
  const {
    setPendingDiffs, updateAgentStatus, setIsRunningAgent,
    addToast, addLogEntry, addSessionMessage, updateSessionStatus,
    setOpencodeSessionId, setSessionTokenUsage, addRawOutputLine,
    addSessionChangedFile, clearSessionChangedFiles,
  } = useHelioxStore();

  useEffect(() => {
    if (!window.helioxAPI) return;

    const unsubscribe = window.helioxAPI.onAgentEvent((event: AgentEvent) => {
      // Only log meaningful events — skip raw-output, message-delta, thinking-delta
      if (event.type !== 'message-delta' && event.type !== 'thinking-delta' && event.type !== 'raw-output') {
        addLogEntry({
          timestamp: Date.now(),
          level: event.type === 'diffs-ready' ? 'system' : 'info',
          sessionId: event.agentId,
          message: getEventMessage(event),
        });
      }

      switch (event.type) {
        case 'diffs-ready':
          handleDiffsReady(event);
          break;
        case 'autocorrecting':
          updateAgentStatus(event.agentId, 'autocorrecting');
          addSessionMessage(event.agentId, sysMsg('autocorrect', `Auto-correcting regressions (attempt ${event.attempt ?? '?'})…`));
          addToast('Agent autocorrecting regressions…', 'info');
          break;
        case 'started':
          rawOutputBuffer.delete(event.agentId); // clear any leftover buffer from prior run
          updateAgentStatus(event.agentId, 'running');
          updateSessionStatus(event.agentId, 'running');
          setIsRunningAgent(true);
          clearSessionChangedFiles(event.agentId);
          addToast('Agent started', 'info');
          break;
        case 'file-changed':
          if (event.path) {
            addSessionChangedFile(event.agentId, {
              path: event.path,
              linesAdded: event.linesAdded ?? 0,
              linesRemoved: event.linesRemoved ?? 0,
            });
            const detail = event.linesAdded || event.linesRemoved
              ? ` (+${event.linesAdded ?? 0} −${event.linesRemoved ?? 0})`
              : '';
            addSessionMessage(event.agentId, sysMsg('file', `File changed: ${event.path}${detail}`));
          }
          break;
        case 'message-delta':
          handleMessageDelta(event);
          break;
        case 'message':
          handleMessage(event);
          break;
        case 'tool-use':
          if (event.tool) {
            addSessionMessage(event.agentId, sysMsg('tool', `Using tool: ${event.tool}`));
          }
          break;
        case 'tool-result':
          break;
        case 'result':
          handleResult(event);
          break;
        case 'raw-output':
          if (event.rawLine) {
            bufferRawLine(event.agentId, event.rawLine);
            addRawOutputLine(event.rawLine);
          }
          break;
      }
    });

    return unsubscribe;
  }, [setPendingDiffs, updateAgentStatus, setIsRunningAgent, addToast, addLogEntry, addSessionMessage, updateSessionStatus, setOpencodeSessionId, setSessionTokenUsage, addRawOutputLine, addSessionChangedFile, clearSessionChangedFiles]);
}
