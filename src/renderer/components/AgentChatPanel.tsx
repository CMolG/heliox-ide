/**
 * AgentChatPanel.tsx — Renderer Composite Component
 *
 * Responsibility:
 * - Renders the AgentChatPanel surface in the renderer layer.
 * - Encapsulates Feature-level composition used by the renderer shell and panels.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/AgentChatPanel.tsx — Orchestrator: owns state, handles send, manages streaming
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useHelioxStore } from '../store';
import { sysMsg, errMsg } from '@/types';
import { ChatMessageItem, renderMessageContent } from './chat/MessageRenderer';
import { SLASH_COMMANDS, handleSlashCommand as executeSlashCommand } from './chat/SlashCommandHandler';
import { INFINITY_LOOP_PROMPT } from '../logic/flow-prompts';
import { FileContextPanel } from './chat/FileContextBuilder';
import { RoleIcon } from './ui/RoleIcon';
import { HelioxDropdown } from './ui/HelioxDropdown';
import { theme } from '../logic/theme';

const MESSAGE_PAGE_SIZE = 100;

{/* TODO duplicate, solve it */}
const MODEL_COSTS: Record<string, string> = Object.fromEntries([
  ...['gpt-4.1', 'gpt-4o', 'gpt-5-mini'].map(m => [m, 'x0']),
  ...['gpt-5.4-mini', 'gpt-5.1-codex-mini', 'claude-haiku-4.5', 'gemini-3-flash-preview'].map(m => [m, 'x0.33']),
  ...['claude-sonnet-4', 'claude-sonnet-4.5', 'claude-sonnet-4.6', 'gpt-5.1', 'gpt-5.2', 'gpt-5.4',
    'gpt-5.1-codex', 'gpt-5.1-codex-max', 'gpt-5.2-codex', 'gpt-5.3-codex', 'gemini-3-pro-preview', 'gemini-3.1-pro-preview'].map(m => [m, 'x1']),
  ...['claude-opus-4.5', 'claude-opus-4.6'].map(m => [m, 'x3']),
  ['claude-opus-4.6-fast', 'x30'],
]);

type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh';
const LMH: readonly EffortLevel[] = ['low', 'medium', 'high'];
const MODEL_EFFORT_SUPPORT: Record<string, readonly EffortLevel[]> = Object.fromEntries(
  ['gpt-4.1', 'gpt-5-mini', 'gpt-5.4-mini', 'gpt-5.1-codex-mini', 'claude-haiku-4.5'].map(m => [m, LMH])
);

const DEFAULT_EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh'];

/** Copilot CLI has no --effort flag; effort is only configurable via config.json. */
const ADAPTERS_WITHOUT_EFFORT: readonly string[] = ['copilot'];

function getEffortLevels(model: string, adapter?: string): readonly EffortLevel[] {
  if (adapter && ADAPTERS_WITHOUT_EFFORT.includes(adapter)) return [];
  return MODEL_EFFORT_SUPPORT[model] ?? DEFAULT_EFFORT_LEVELS;
}

export function AgentChatPanel() {
  const {
    sessions, selectedSessionId, addSessionMessage, updateSessionMessages,
    updateSessionStatus, updateSessionDescription,
    roles, flows, addLogEntry, addToast,
    addSession, projectPath, appSettings, updateAppSettings,
    availableModels, setSessionModel,
    projectFiles, setProjectFiles,
    totalPremiumRequests,
    updateSessionRole,
  } = useHelioxStore();
  const [input, setInput] = useState('');
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [infiniteLoopEnabled, setInfiniteLoopEnabled] = useState(false);
  const infiniteLoopRef = useRef(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [showAllMessages, setShowAllMessages] = useState(false);
  const lastStreamMsgIdRef = useRef<string | null>(null);
  const lastCompleteMessageRef = useRef<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const resetStreaming = () => {
    lastStreamMsgIdRef.current = null;
    setStreamingContent('');
    setStreamingMessageId(null);
    setStreamingThinking('');
  };
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  const log = (level: 'info' | 'warn' | 'error' | 'system', sid: string, message: string) =>
    addLogEntry({ timestamp: Date.now(), level, sessionId: sid, message });

  // @-mention autocomplete state
  const [showAtAutocomplete, setShowAtAutocomplete] = useState(false);
  const [atQuery, setAtQuery] = useState('');
  const [atCursorIndex, setAtCursorIndex] = useState(0);
  const [atSelectedIndex, setAtSelectedIndex] = useState(0);

  const selectedSession = sessions.find((s) => s.id === selectedSessionId);
  const messages = selectedSession?.messages ?? [];

  // Message list optimization: only render last MESSAGE_PAGE_SIZE unless user requested all
  const { visibleMessages, hasHiddenMessages } = useMemo(() => {
    const filtered = streamingMessageId
      ? messages.filter(m => m.id !== `stream-${streamingMessageId}`)
      : messages;
    if (showAllMessages || filtered.length <= MESSAGE_PAGE_SIZE) {
      return { visibleMessages: filtered, hasHiddenMessages: false };
    }
    return {
      visibleMessages: filtered.slice(-MESSAGE_PAGE_SIZE),
      hasHiddenMessages: true,
    };
  }, [messages, streamingMessageId, showAllMessages]);

  // Auto-scroll on new messages, streaming content, and thinking
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      if (streamingContent || streamingThinking) {
        el.scrollTop = el.scrollHeight;
      } else {
        requestAnimationFrame(() => {
          el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        });
      }
    }
  }, [messages.length, streamingContent, streamingThinking]);

  // Focus input on session change; reset pagination
  useEffect(() => {
    inputRef.current?.focus();
    setShowAllMessages(false);
  }, [selectedSessionId]);

  useEffect(() => {
    const handler = () => inputRef.current?.focus();
    window.addEventListener('heliox:focus-chat', handler);
    return () => window.removeEventListener('heliox:focus-chat', handler);
  }, []);

  // Reset effort when model/adapter doesn't support current level
  const currentAdapter = appSettings.aiAdapter ?? appSettings.cliAdapter;
  useEffect(() => {
    if (selectedSession) {
      const supported = getEffortLevels(selectedSession.model, currentAdapter);
      if (supported.length === 0 || !supported.includes(appSettings.effort)) {
        if (supported.length > 0) {
          updateAppSettings({ effort: supported[supported.length - 1] });
        }
      }
    }
  }, [selectedSession?.model, currentAdapter]);

  /* TODO duplicate, solve it. */
  // Close model dropdown on outside click or Escape
  useEffect(() => {
    if (!showModelDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowModelDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [showModelDropdown]);

  // Load project files for @-mention autocomplete
  useEffect(() => {
    if (!projectPath || !window.helioxAPI) return;
    window.helioxAPI.listProjectFiles(projectPath).then((files) => {
      setProjectFiles(files);
    }).catch(() => { /* ignore */ });
  }, [projectPath, setProjectFiles]);

  // Filtered autocomplete suggestions (for keyboard nav in handleKeyDown)
  const atSuggestions = useMemo(() => {
    if (!showAtAutocomplete || !atQuery) return projectFiles.slice(0, 15);
    const q = atQuery.toLowerCase();
    return projectFiles.filter(f => f.toLowerCase().includes(q)).slice(0, 15);
  }, [showAtAutocomplete, atQuery, projectFiles]);

  // Recover stuck sessions on mount — if a session is 'running' but no agent process exists, reset it
  useEffect(() => {
    const sessions = useHelioxStore.getState().sessions;
    for (const session of sessions) {
      if (session.status === 'running') {
        updateSessionStatus(session.id, 'error', Date.now());
        addSessionMessage(session.id, sysMsg('recovery', 'Session recovered from stuck state (agent process no longer running)'));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Streaming event listener for real-time delta display
  useEffect(() => {
    if (!window.helioxAPI) return;
    const unsubscribe = window.helioxAPI.onAgentEvent((event) => {
      if (event.agentId !== selectedSessionId) return;
      switch (event.type) {
        case 'thinking-delta':
          if (event.content) {
            setStreamingThinking(prev => prev + event.content);
          }
          break;
        case 'message-delta':
          if (event.content) {
            const delta = event.content;
            const msgId = event.messageId ?? null;
            if (lastStreamMsgIdRef.current !== msgId) {
              lastStreamMsgIdRef.current = msgId;
              setStreamingMessageId(msgId);
              setStreamingContent(delta);
              setStreamingThinking('');
            } else {
              setStreamingContent(prev => prev + delta);
            }
          }
          break;
        case 'message':
          // Buffer the complete message — only the LAST one becomes a chat bubble on 'result'
          if (event.content) {
            lastCompleteMessageRef.current = event.content;
          }
          resetStreaming();
          break;
        case 'result': {
          // Persist the final assistant message
          const finalContent = lastCompleteMessageRef.current;
          if (finalContent) {
            addSessionMessage(selectedSessionId, {
              id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              role: 'assistant',
              content: finalContent,
              timestamp: Date.now(),
            });
            lastCompleteMessageRef.current = '';
          }
          resetStreaming();
          if ((event as any).exitCode === 0 || (event as any).exitCode === undefined) {
            updateSessionStatus(selectedSessionId, 'completed', Date.now());
          }
          if ((event as any).sessionId) {
            useHelioxStore.getState().setCopilotSessionId(selectedSessionId, (event as any).sessionId);
          }
          if ((event as any).premiumRequests !== undefined || (event as any).totalApiDurationMs !== undefined) {
            useHelioxStore.getState().setSessionTokenUsage(selectedSessionId, {
              premiumRequests: (event as any).premiumRequests,
              totalApiDurationMs: (event as any).totalApiDurationMs,
            });
          }
          break;
        }
        case 'error':
          lastCompleteMessageRef.current = '';
          resetStreaming();
          updateSessionStatus(selectedSessionId, 'error', Date.now());
          addSessionMessage(selectedSessionId, sysMsg('error', `Agent error: ${event.content ?? 'Process terminated unexpectedly'}`));
          log('error', selectedSessionId, `Agent error event: ${event.content ?? 'unknown'}`);
          break;
      }
    });
    return () => {
      unsubscribe();
      resetStreaming();
    };
  }, [selectedSessionId, updateSessionStatus, addSessionMessage, addLogEntry]);

  const handleSlashCommand = useCallback((command: string, sessionId: string) => {
    return executeSlashCommand(command, sessionId, {
      addSessionMessage,
      setSessionModel,
      updateAppSettings,
      updateSessionMessages,
      addLogEntry,
      availableModels,
      currentEffort: appSettings.effort,
      getState: () => {
        const s = useHelioxStore.getState();
        return {
          sessions: s.sessions,
          roles: s.roles,
          totalPremiumRequests: s.totalPremiumRequests,
          totalApiDuration: s.totalApiDuration,
          updateSessionRole: s.updateSessionRole,
        };
      },
    });
  }, [availableModels, appSettings.effort, addSessionMessage, setSessionModel, updateAppSettings, updateSessionMessages, addLogEntry]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text) return;

    if (text.startsWith('/')) {
      let targetSessionId = selectedSessionId;
      if (!targetSessionId) {
        targetSessionId = addSession();
      }
      const handled = handleSlashCommand(text, targetSessionId);
      if (handled) {
        setInput('');
        return;
      }
    }

    let currentSessionId = selectedSessionId;
    if (!currentSessionId) {
      currentSessionId = addSession();
    }

    const currentSession = useHelioxStore.getState().sessions.find(s => s.id === currentSessionId);
    if (!currentSession) return;

    if (!currentSession.description) {
      const desc = text.length > 60 ? text.slice(0, 60) + '\u2026' : text;
      updateSessionDescription(currentSessionId, desc);
    }

    addSessionMessage(currentSessionId, {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    });
    setInput('');

    if (currentSession.status === 'waiting' || currentSession.status === 'completed') {
      updateSessionStatus(currentSessionId, 'running');
    }

    if (window.helioxAPI && projectPath) {
      window.helioxAPI.contextMapUpsertSessionNode(projectPath, {
        sessionId: currentSessionId,
        label: `Session #${currentSession.number}: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`,
        status: 'running',
        roleId: currentSession.roleId,
      }).catch(() => {});
    }

    // Parse @file references and read file contents
    const fileRefs = text.match(/@([\w./\-[\]()]+)/g)?.map(m => m.slice(1)) ?? [];
    let fileContext = '';
    let cleanedText = text;
    if (fileRefs.length > 0 && window.helioxAPI && projectPath) {
      const fileContents: string[] = [];
      for (const ref of fileRefs) {
        const fullPath = ref.startsWith('/') ? ref : `${projectPath}/${ref}`;
        try {
          const content = await window.helioxAPI.readFile(fullPath);
          if (content) {
            fileContents.push(`--- ${ref} ---\n${content}\n--- end ---`);
          }
        } catch { /* skip unreadable files */ }
      }
      if (fileContents.length > 0) {
        fileContext = `Context files:\n${fileContents.join('\n\n')}\n\n`;
        cleanedText = text.replace(/@[\w./\-[\]()]+/g, '').replace(/\s+/g, ' ').trim();
      }
    }

    const sessionRole = currentSession.roleId ? roles.find(r => r.id === currentSession.roleId) : null;
    const rolePrompt = sessionRole?.systemPrompt;

    const baseInstruction = fileContext
      ? `${fileContext}User request: ${cleanedText}`
      : cleanedText;
    let instruction = infiniteLoopRef.current
      ? `${INFINITY_LOOP_PROMPT}\n\n---\n\nUser: ${baseInstruction}`
      : baseInstruction;

    const effectiveModel = sessionRole && sessionRole.model !== 'copilot'
      ? sessionRole.model
      : currentSession.model;

    log('info', currentSessionId, `User instruction: ${text.slice(0, 100)}${text.length > 100 ? '\u2026' : ''}`);

    if (!window.helioxAPI) {
      addSessionMessage(currentSessionId, sysMsg('ipc', 'IPC bridge not available. Running outside Electron — connect via the desktop app to execute agent commands against GitHub Copilot CLI.'));
      log('warn', currentSessionId, 'IPC bridge unavailable (development mode)');
      return;
    }

    // Resolve CWD: if instruction references ../sibling-project, use parent dir
    const baseCwd = projectPath ?? '.';
    const crossRefs = instruction.match(/\.\.\//g);
    const agentCwd = (crossRefs && crossRefs.length > 0 && baseCwd !== '.')
      ? baseCwd.replace(/\/$/, '').split('/').slice(0, -1).join('/') || baseCwd
      : baseCwd;

    try {
      const result = await window.helioxAPI.runAgent({
        agentId: currentSessionId,
        instruction,
        flows,
        cwd: agentCwd,
        contextProjectPath: projectPath ?? undefined,
        model: effectiveModel !== 'copilot' ? effectiveModel : undefined,
        effort: appSettings.effort,
        resumeSessionId: currentSession.copilotSessionId,
        aiAdapter: appSettings.aiAdapter ?? appSettings.cliAdapter,
        customCliPath: appSettings.customCliPath,
        autoCommit: appSettings.autoCommit,
        runE2E: appSettings.runE2E,
        rolePrompt,
        roleId: currentSession.roleId,
      });

      if (!result.success) {
        addSessionMessage(currentSessionId, sysMsg('error', `Agent error: ${result.error ?? 'Unknown error'}`));
        updateSessionStatus(currentSessionId, 'error', Date.now());
        resetStreaming();
        log('error', currentSessionId, `Agent failed: ${result.error ?? 'Unknown error'}`);
        addToast(`Agent failed: ${result.error ?? 'Unknown error'}`, 'error');
      } else {
        // Agent run completed (may still have internal validation errors, but the process is done)
        updateSessionStatus(currentSessionId, 'completed', Date.now());
        resetStreaming();
      }
    } catch (err) {
      const errorStr = errMsg(err);
      addSessionMessage(currentSessionId, sysMsg('error', `Failed to run agent: ${errorStr}`));
      updateSessionStatus(currentSessionId, 'error', Date.now());
      resetStreaming();
      log('error', currentSessionId, `Agent exception: ${errorStr}`);
      addToast(`Agent error: ${errorStr}`, 'error');
    }
  }, [input, selectedSessionId, addSession, updateSessionDescription, addSessionMessage, updateSessionStatus, roles, flows, projectPath, addLogEntry, addToast, appSettings.effort, appSettings.aiAdapter, appSettings.customCliPath, appSettings.autoCommit, appSettings.runE2E, handleSlashCommand, infiniteLoopEnabled]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (showAtAutocomplete && atSuggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAtSelectedIndex(i => (i + 1) % atSuggestions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAtSelectedIndex(i => (i - 1 + atSuggestions.length) % atSuggestions.length); return; }
      if (e.key === 'Escape') { e.preventDefault(); setShowAtAutocomplete(false); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && appSettings.sendOnEnter) {
      e.preventDefault();
      handleSend();
    }
  }, [showAtAutocomplete, atSuggestions, appSettings.sendOnEnter, handleSend]);

  const adjustTextareaHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = 20;
    const minH = lineHeight * 3;
    const maxH = lineHeight * 6;
    const scrollH = el.scrollHeight;
    el.style.height = `${Math.min(Math.max(scrollH, minH), maxH)}px`;
    el.style.overflowY = scrollH > maxH ? 'auto' : 'hidden';
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    adjustTextareaHeight();
    const cursor = e.target.selectionStart;
    const textBeforeCursor = val.slice(0, cursor);
    const atMatch = textBeforeCursor.match(/@([\w./\-[\]()]*)$/);
    if (atMatch && projectFiles.length > 0) {
      setShowAtAutocomplete(true);
      setAtQuery(atMatch[1]);
      setAtCursorIndex(cursor - atMatch[0].length + 1);
      setAtSelectedIndex(0);
    } else {
      setShowAtAutocomplete(false);
    }
  }, [projectFiles, adjustTextareaHeight]);

  const handleAttachFile = useCallback(async () => {
    if (!window.helioxAPI || !projectPath) {
      addToast('Open a project first to browse files', 'info');
      return;
    }
    const filePath = await window.helioxAPI.openFileDialog(projectPath);
    if (filePath) {
      const relativePath = filePath.startsWith(projectPath) ? filePath.slice(projectPath.length + 1) : filePath;
      setInput((prev) => prev ? `${prev} @${relativePath}` : `@${relativePath}`);
      inputRef.current?.focus();
    }
  }, [projectPath, addToast]);

  const handleInsertCodeSnippet = useCallback(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = input.slice(0, start);
    const after = input.slice(end);
    const snippet = '```\n\n```';
    setInput(`${before}${snippet}${after}`);
    requestAnimationFrame(() => {
      textarea.focus();
      const cursorPos = start + 4;
      textarea.setSelectionRange(cursorPos, cursorPos);
    });
  }, [input]);


  const handleStopAgent = useCallback(async () => {
    if (!selectedSessionId || !window.helioxAPI) return;
    try {
      const stopped = await window.helioxAPI.stopAgent(selectedSessionId);
      const msg = stopped ? 'Agent stopped by user' : 'Agent force-stopped (process already exited)';
      updateSessionStatus(selectedSessionId, 'stopped', Date.now());
      addSessionMessage(selectedSessionId, sysMsg('stopped', msg));
      resetStreaming();
      addToast(msg, 'info');
      log('warn', selectedSessionId, msg);
    } catch (err) {
      // Force recovery even if stopAgent throws
      updateSessionStatus(selectedSessionId, 'stopped', Date.now());
      resetStreaming();
      addToast('Agent force-stopped', 'info');
    }
  }, [selectedSessionId, updateSessionStatus, addSessionMessage, addToast, addLogEntry]);

  const handleLoadEarlierMessages = useCallback(() => {
    setShowAllMessages(true);
  }, []);

  const isDisabled = selectedSession && (selectedSession.status === 'stopped' || selectedSession.status === 'error');
  const isRunning = selectedSession?.status === 'running';

  return (
    <div
      className="heliox-chat flex flex-col overflow-hidden h-full"
      style={{ background: theme.surfaceMid, borderLeft: `1px solid ${theme.borderMedium}` }}
    >
      {/* Header */}
      <div className="p-6 flex items-center gap-3 shrink-0" style={{ borderBottom: `1px solid ${theme.border}` }}>
        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, rgba(214,211,209,0.2) 0%, rgba(63,63,70,0.2) 100%)' }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="4" fill="#a3a3a3" />
            <circle cx="10" cy="10" r="8" stroke="#a3a3a3" strokeWidth="1" opacity="0.3" />
          </svg>
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold leading-5" style={{ fontFamily: theme.fontGrotesk, color: theme.textPrimary }}>
              Heliox Agent
            </span>
            {(() => {
              const activeRole = selectedSession?.roleId ? roles.find(r => r.id === selectedSession.roleId) : null;
              return activeRole ? (
                <span className="text-[10px] font-bold uppercase tracking-wide text-stone-300 px-2 py-0.5 rounded flex items-center gap-1" style={{ background: theme.border }}>
                  <RoleIcon icon={activeRole.icon} size={10} /> {activeRole.name}
                </span>
              ) : null;
            })()}
          </div>
          <div className="flex items-center gap-1.5">
            {selectedSession?.status === 'running' && <span className="w-1.5 h-1.5 rounded-full dot-pulse" style={{ background: theme.accentBlue }} />}
            <span className="text-neutral-500 text-[10px] font-normal uppercase leading-4" style={{ fontFamily: theme.fontInter }}>
              {selectedSession
                ? ({ running: `Thinking in ${selectedSession.model ?? 'Copilot'}`, waiting: 'Awaiting input', completed: 'Session complete', error: 'Session failed' } as Record<string, string>)[selectedSession.status] ?? 'Session stopped'
                : 'Ready'}
            </span>
            {selectedSession?.copilotSessionId && selectedSession.status !== 'running' && (
              <span className="text-[10px] font-bold uppercase leading-4 ml-1.5 px-1.5 py-0.5 rounded-full" style={{ background: theme.accentBlueBg, color: theme.accentBlue }}>Resumable</span>
            )}
          </div>
          {selectedSession && (
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-neutral-500 text-[10px] font-normal uppercase tracking-wide" style={{ fontFamily: theme.fontInter }}>
                {selectedSession.tokenUsage?.premiumRequests ?? 0} requests · {selectedSession.tokenUsage?.totalApiDurationMs ? (selectedSession.tokenUsage.totalApiDurationMs / 1000).toFixed(1) : '0.0'}s API time
              </span>
              {totalPremiumRequests > 0 && (
                <span className="text-neutral-500 text-[10px] font-normal uppercase tracking-wide" style={{ fontFamily: theme.fontInter }}>
                  · {totalPremiumRequests} total requests
                </span>
              )}
            </div>
          )}
        </div>
        {/* Clear conversation */}
        {selectedSession && selectedSession.messages.length > 0 && (
          <button
            onClick={() => {
              useHelioxStore.getState().clearConversation(selectedSession.id);
              setInput('');
              setStreamingContent('');
              setStreamingThinking('');
              setStreamingMessageId(null);
            }}
            disabled={selectedSession.status === 'running'}
            title="Clear conversation (keeps model & role)"
            aria-label="Clear conversation"
            className="ml-auto self-start shrink-0 p-1.5 rounded-md transition"
            style={{
              color: theme.textGhost,
              cursor: selectedSession.status === 'running' ? 'not-allowed' : 'pointer',
              opacity: selectedSession.status === 'running' ? 0.3 : 0.6,
            }}
            onMouseEnter={e => { if (selectedSession.status !== 'running') (e.currentTarget.style.opacity = '1', e.currentTarget.style.background = theme.surfaceHover); }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '0.6'; e.currentTarget.style.background = 'transparent'; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
              <line x1="18" y1="9" x2="12" y2="15" />
              <line x1="12" y1="9" x2="18" y2="15" />
            </svg>
          </button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 p-6 overflow-y-auto flex flex-col gap-6">
        {hasHiddenMessages && (
          <button
            onClick={handleLoadEarlierMessages}
            className="self-center px-4 py-1.5 rounded-lg text-xs font-medium transition hover:bg-white/5"
            style={{ background: 'rgba(214,211,209,0.06)', color: theme.textMuted, fontFamily: theme.fontInter }}
          >
            Load earlier messages ({messages.length - MESSAGE_PAGE_SIZE} hidden)
          </button>
        )}

        {visibleMessages.length === 0 && !streamingContent && (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-sm" style={{ fontFamily: theme.fontManrope, color: theme.textFaint }}>
              Start typing to begin a new session
            </span>
          </div>
        )}

        {visibleMessages.map((msg) => (
          <ChatMessageItem key={msg.id} msg={msg} />
        ))}

        {/* Thinking log bar — compact progress indicator, NOT a chat bubble */}
        {streamingThinking && !streamingContent && (
          <div
            className="px-3 py-2 rounded-md overflow-hidden"
            style={{
              background: `${theme.accentBlue}08`,
              borderLeft: `2px solid ${theme.accentBlue}`,
              maxHeight: 80,
            }}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <span className="w-1.5 h-1.5 rounded-full shrink-0 dot-pulse" style={{ background: theme.accentBlue }} />
              <span className="text-[9px] font-bold uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textGhost }}>
                Reasoning…
              </span>
            </div>
            <p
              className="text-[10px] leading-4 whitespace-pre-wrap overflow-hidden"
              style={{
                fontFamily: theme.fontMono, color: theme.textGhost,
                display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as any,
              }}
            >
              {streamingThinking.slice(-300)}
            </p>
          </div>
        )}

        {streamingContent && (
          <div className="flex flex-col gap-2" aria-live="polite">
            <div className="flex items-center gap-2">
              <span className="text-neutral-500 text-[10px] font-bold uppercase leading-4 tracking-wide" style={{ fontFamily: theme.fontInter }}>Heliox</span>
            </div>
            <div className="p-4 rounded-tr-4xl rounded-bl-4xl rounded-br-4xl" style={{ background: theme.surfaceHover, outline: `1px solid ${theme.border}`, outlineOffset: '-1px' }}>
              {renderMessageContent(streamingContent)}
              <span className="cursor-blink text-zinc-400 text-sm inline-block">▊</span>
            </div>
          </div>
        )}

        {selectedSession?.status === 'running' && !streamingContent && !streamingThinking && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl" style={{ background: `${theme.accentBlue}08` }}>
            <div className="flex gap-1 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: theme.accentBlue, animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: theme.accentBlue, animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: theme.accentBlue, animationDelay: '300ms' }} />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-neutral-500 text-[10px] font-normal uppercase leading-4" style={{ fontFamily: theme.fontInter }}>
                Thinking in {selectedSession.model ?? 'Copilot'}
              </span>
              <span className="text-[9px] font-normal" style={{ fontFamily: theme.fontManrope, color: theme.textGhost }}>
                {appSettings.effort === 'xhigh' ? 'Extended reasoning' : appSettings.effort === 'high' ? 'Deep analysis' : appSettings.effort === 'medium' ? 'Standard reasoning' : 'Quick response'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="px-6 pb-4 pt-2 shrink-0">
        <div className="px-5 pt-3 pb-2 rounded-2xl flex flex-col gap-1 focus-within:outline-none" style={{ background: theme.bg, outline: 'none' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={adjustTextareaHeight}
            placeholder="Direct the agent..."
            disabled={!!isDisabled}
            className="w-full bg-transparent outline-none focus-visible:outline-none resize-none text-sm font-normal leading-5 disabled:opacity-30 scrollbar-thin"
            style={{ fontFamily: theme.fontManrope, color: theme.textPrimary, height: '60px', overflowY: 'hidden' }}
            aria-label="Chat message input"
          />

          {input.startsWith('/') && (() => {
            const typedCmd = input.toLowerCase().split(' ')[0];
            const filtered = SLASH_COMMANDS.filter(c => c.cmd.startsWith(typedCmd));
            return filtered.length > 0 ? (
              <div className="flex flex-col gap-0.5 px-1 pb-1 max-h-48 overflow-y-auto">
                {filtered.map(({ cmd, desc, local }) => (
                  <button
                    key={cmd}
                    onClick={() => { setInput(cmd + ' '); inputRef.current?.focus(); }}
                    className="flex items-center gap-2 px-2 py-1 rounded text-left transition hover:bg-white/5"
                  >
                    <span className="text-[10px] font-normal shrink-0" style={{ fontFamily: theme.fontMono, color: local ? theme.textMid : theme.textDim }}>{cmd}</span>
                    <span className="text-[9px] font-normal truncate" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>{desc}</span>
                  </button>
                ))}
              </div>
            ) : null;
          })()}

          <FileContextPanel
            input={input}
            setInput={setInput}
            projectFiles={projectFiles}
            inputRef={inputRef}
            showAtAutocomplete={showAtAutocomplete}
            setShowAtAutocomplete={setShowAtAutocomplete}
            atQuery={atQuery}
            atSelectedIndex={atSelectedIndex}
            setAtSelectedIndex={setAtSelectedIndex}
            atCursorIndex={atCursorIndex}
          />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isRunning && (
                <span className="text-[10px] font-normal uppercase tracking-wide px-2 py-1 rounded-full" style={{ fontFamily: theme.fontInter, color: theme.textSecondary, background: theme.border }}>
                  Agent processing…
                </span>
              )}
              <button onClick={handleAttachFile} className="p-1.5 rounded-full hover:bg-white/5 transition" aria-label="Attach file" title="Insert file reference (opens file picker)">
                <svg width="10" height="14" viewBox="0 0 10 14" fill="none">
                  <path d="M1 7V4a4 4 0 018 0v5a2.5 2.5 0 01-5 0V4a1 1 0 012 0v5" stroke={theme.textDim} strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
              <button
                onClick={() => {
                  const next = !infiniteLoopRef.current;
                  infiniteLoopRef.current = next;
                  setInfiniteLoopEnabled(next);
                }}
                className="p-1.5 rounded-full transition"
                style={infiniteLoopEnabled ? { background: 'rgba(214,211,209,0.15)' } : undefined}
                aria-label="Infinite Loop"
                aria-pressed={infiniteLoopEnabled}
                title="Infinite Loop"
              >
                <svg width="16" height="10" viewBox="0 0 16 10" fill="none">
                  <path d="M5.5 5C5.5 3.067 6.567 1.5 8 1.5C9.433 1.5 10.5 3.067 10.5 5C10.5 6.933 9.433 8.5 8 8.5C6.567 8.5 5.5 6.933 5.5 5Z" stroke={infiniteLoopEnabled ? '#d6d3d1' : '#737373'} strokeWidth="1.2" fill="none" />
                  <path d="M1.5 5C1.5 2.791 3.015 1 5.5 1C6.8 1 7.7 1.6 8 2C8.3 1.6 9.2 1 10.5 1C12.985 1 14.5 2.791 14.5 5C14.5 7.209 12.985 9 10.5 9C9.2 9 8.3 8.4 8 8C7.7 8.4 6.8 9 5.5 9C3.015 9 1.5 7.209 1.5 5Z" stroke={infiniteLoopEnabled ? '#d6d3d1' : '#737373'} strokeWidth="1.2" fill="none" />
                </svg>
              </button>
            </div>

            <div className="flex items-center gap-2">
              {isRunning && (
                <button
                  onClick={handleStopAgent}
                  className="rounded-lg px-4 py-1.5 text-xs font-semibold transition"
                  style={{ fontFamily: theme.fontInter, background: theme.danger, color: '#fff', border: `1px solid ${theme.dangerBorder}` }}
                  aria-label="Stop agent" title="Stop the running agent"
                >
                  Stop
                </button>
              )}
              <button
                onClick={handleSend}
                disabled={!input.trim() || !!isDisabled || !!isRunning}
                className="w-7 h-7 rounded-full flex items-center justify-center transition disabled:opacity-30"
                style={{ background: theme.accentBlueSolid }}
                aria-label="Send message"
              >
                <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
                  <path d="M1 5h10M8 1l3.5 4L8 9" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-1.5 py-1.5 px-1">
          {/* Role selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>Role</span>
            <HelioxDropdown
              value={selectedSession?.roleId ?? ''}
              options={[
                { value: '', label: 'None' },
                ...roles.map(r => ({ value: r.id, label: `${r.icon} ${r.name}` })),
              ]}
              onChange={(v) => {
                if (selectedSession) {
                  updateSessionRole(selectedSession.id, v || undefined);
                }
              }}
              disabled={!selectedSession}
              fontSize={10}
              maxWidth={120}
              ariaLabel="Select role for this session"
            />
          </div>

          {/* Send on Enter toggle */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <button
              type="button"
              role="checkbox"
              aria-checked={appSettings.sendOnEnter}
              onClick={() => updateAppSettings({ sendOnEnter: !appSettings.sendOnEnter })}
              className="w-3.5 h-3.5 rounded-[3px] border border-zinc-600 bg-transparent flex items-center justify-center transition-colors hover:border-zinc-500"
            >
              {appSettings.sendOnEnter && (
                <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                  <path d="M1 3l2 2 4-4" stroke="#a1a1aa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <span className="text-[10px] font-normal leading-3 text-neutral-500" style={{ fontFamily: theme.fontInter }}>
              Send on Enter
            </span>
          </label>
        </div>
      </div>

      {/* Model selector, effort selector & session metadata */}
      {selectedSession && (
        <div className="px-6 pb-3 shrink-0 flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative" ref={modelDropdownRef}>
              <button
                onClick={() => setShowModelDropdown(!showModelDropdown)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all"
                style={{ background: showModelDropdown ? theme.surfaceHover : 'rgba(38,38,38,0.5)', outline: `1px solid ${theme.borderLight}`, outlineOffset: '-1px' }}
                aria-label="Select model"
                aria-haspopup="listbox"
                aria-expanded={showModelDropdown}
              >
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>Model</span>
                <span className="text-[10px] font-normal" style={{ fontFamily: theme.fontMono, color: theme.textMuted }}>
                  {selectedSession.model}
                  {MODEL_COSTS[selectedSession.model] && (
                    <span className="ml-2 text-[9px] opacity-50">({MODEL_COSTS[selectedSession.model]})</span>
                  )}
                </span>
                <svg width="8" height="5" viewBox="0 0 8 5" fill="none" aria-hidden="true" style={{ transform: showModelDropdown ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                  <path d="M1 1l3 3 3-3" stroke={theme.textFaint} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {showModelDropdown && (
                <div role="listbox" aria-label="Available models" className="absolute bottom-full left-0 mb-1 py-1 rounded-xl overflow-y-auto z-50" style={{ background: theme.surfaceCard, border: `1px solid ${theme.borderMedium}`, minWidth: '180px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', maxHeight: '300px' }}>
                  {availableModels.map((m) => (
                    <button
                      key={m}
                      role="option"
                      aria-selected={selectedSession.model === m}
                      onClick={() => { setSessionModel(selectedSession.id, m); setShowModelDropdown(false); }}
                      className="w-full text-left px-4 py-2 transition-all"
                      style={{ background: selectedSession.model === m ? theme.border : 'transparent', fontFamily: theme.fontMono, fontSize: '11px', color: selectedSession.model === m ? theme.textSecondary : theme.textDim }}
                      onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'rgba(214,211,209,0.06)'; }}
                      onMouseLeave={(e) => { (e.target as HTMLElement).style.background = selectedSession.model === m ? 'rgba(214,211,209,0.08)' : 'transparent'; }}
                    >
                      {m}
                      {MODEL_COSTS[m] && (
                        <span className="ml-2 text-[9px] opacity-50">({MODEL_COSTS[m]})</span>
                      )}
                      {selectedSession.model === m && <span className="ml-2 text-[9px]" style={{ color: theme.textFaint }}>●</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {getEffortLevels(selectedSession.model, currentAdapter).length > 0 && (
            <div className="flex items-center gap-1.5" role="group" aria-label="Effort level">
              <span className="text-[10px] font-bold uppercase tracking-wider mr-1" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>Effort</span>
              {getEffortLevels(selectedSession.model, currentAdapter).map((level) => {
                const labels: Record<string, string> = { low: 'L', medium: 'M', high: 'H', xhigh: 'X' };
                const isActive = appSettings.effort === level;
                return (
                  <button
                    key={level}
                    onClick={() => updateAppSettings({ effort: level })}
                    className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide transition-all"
                    style={{
                      fontFamily: theme.fontInter,
                      background: isActive ? theme.accentBlueBg : 'transparent',
                      color: isActive ? theme.accentBlue : theme.textGhost,
                      border: isActive ? `1px solid ${theme.accentBlueBorder}` : '1px solid rgba(63,63,70,0.2)',
                      fontWeight: isActive ? 700 : 400,
                    }}
                    aria-pressed={isActive}
                    aria-label={`Effort: ${level}`}
                    title={level}
                  >
                    {labels[level]}
                  </button>
                );
              })}
            </div>
            )}
          </div>

          {(selectedSession.copilotSessionId || selectedSession.tokenUsage) && (
            <div className="flex items-center gap-3 flex-wrap">
              {selectedSession.copilotSessionId && (
                <span className="text-[9px] font-normal tracking-wide" style={{ fontFamily: theme.fontMono, color: theme.textGhost }} title={`Copilot Session: ${selectedSession.copilotSessionId}`}>
                  session:{selectedSession.copilotSessionId.slice(0, 8)}…
                </span>
              )}
              {selectedSession.tokenUsage?.premiumRequests !== undefined && (
                <span className="text-[9px] font-normal" style={{ fontFamily: theme.fontInter, color: theme.textGhost }}>
                  {selectedSession.tokenUsage.premiumRequests} premium req
                </span>
              )}
              {selectedSession.tokenUsage?.totalApiDurationMs !== undefined && (
                <span className="text-[9px] font-normal" style={{ fontFamily: theme.fontInter, color: theme.textGhost }}>
                  {(selectedSession.tokenUsage.totalApiDurationMs / 1000).toFixed(1)}s API time
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
