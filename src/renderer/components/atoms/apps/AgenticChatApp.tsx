/**
 * AgenticChatApp.tsx — Renderer Embedded App Component
 *
 * Responsibility:
 * - Renders the AgenticChatApp surface in the renderer layer.
 * - Encapsulates Embedded mini-app surface mounted inside desktop windows.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/desktop/ChatWindow.tsx — Chat content adapted for desktop windows
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useHelioxStore } from '../../../store';
import { useDesktopStore } from '../../../store/desktop-store';
import { ChatMessage, sysMsg } from '@/types';
import { ChatMessageItem, renderMessageContent } from '../../chat/MessageRenderer';
import { FileContextPanel } from '../../chat/FileContextBuilder';
import { handleSlashCommand } from '../../chat/SlashCommandHandler';
import { INFINITY_LOOP_PROMPT } from '../../../logic/flow-prompts';
import { theme } from '../../../logic/theme';
import { LucideIcon } from '../../desktop/LucideIcon';
import { HelioxDropdown } from '../../ui/HelioxDropdown';
import { FlowQuickRail } from './FlowQuickRail';
import { MentalAttachmentChips } from './MentalAttachmentChips';
import {
  mentalAttachmentsToDigest,
  pickMentalSubgraph,
} from '../../../logic/ai/mental-digest';


/**
 * Detect if instruction references paths outside CWD (e.g. ../sibling-project)
 * and resolve CWD to the nearest common ancestor so the agent can access both.
 */
function resolveCwdForCrossProjectRefs(instruction: string, baseCwd: string): string {
  const crossRefs = instruction.match(/\.\.\//g);
  if (!crossRefs || crossRefs.length === 0) return baseCwd;
  // Instruction references parent dirs — use the parent of baseCwd as the agent CWD
  const parts = baseCwd.replace(/\/$/, '').split('/');
  if (parts.length > 2) {
    return parts.slice(0, -1).join('/');
  }
  return baseCwd;
}

/* TODO duplicate, solve it */
// ─── Premium request cost multipliers per model ──────────────────
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

/** OpenCode maps effort → `--variant` (minimal/medium/high/max), so all adapters support it. */
const ADAPTERS_WITHOUT_EFFORT: readonly string[] = [];

function getEffortLevels(model: string, adapter?: string): readonly EffortLevel[] {
  if (adapter && ADAPTERS_WITHOUT_EFFORT.includes(adapter)) return [];
  return MODEL_EFFORT_SUPPORT[model] ?? DEFAULT_EFFORT_LEVELS;
}

interface ChatWindowProps {
  windowId: string;
  sessionId: string;
}

export function AgenticChatApp({ windowId, sessionId }: ChatWindowProps) {
  const session = useHelioxStore(s => s.sessions.find(ss => ss.id === sessionId));
  const addSessionMessage = useHelioxStore(s => s.addSessionMessage);
  const updateSessionStatus = useHelioxStore(s => s.updateSessionStatus);
  const updateSessionDescription = useHelioxStore(s => s.updateSessionDescription);
  const setOpencodeSessionId = useHelioxStore(s => s.setOpencodeSessionId);
  const setSessionModel = useHelioxStore(s => s.setSessionModel);
  const setSessionTokenUsage = useHelioxStore(s => s.setSessionTokenUsage);
  const addLogEntry = useHelioxStore(s => s.addLogEntry);
  const addToast = useHelioxStore(s => s.addToast);
  const projectPath = useHelioxStore(s => s.projectPath);
  const flows = useHelioxStore(s => s.flows);
  const roles = useHelioxStore(s => s.roles);
  const appSettings = useHelioxStore(s => s.appSettings);
  const projectFiles = useHelioxStore(s => s.projectFiles);
  const addRawOutputLine = useHelioxStore(s => s.addRawOutputLine);
  const availableModels = useHelioxStore(s => s.availableModels);
  const sessionChangedFiles = useHelioxStore(s => s.sessionChangedFiles);

  const win = useDesktopStore(s => s.windows.find(w => w.id === windowId));
  const updateWindowTitle = useDesktopStore(s => s.updateWindowTitle);
  const addWindow = useDesktopStore(s => s.addWindow);
  const installedPlugins = useDesktopStore(s => s.installedPlugins);
  const marketInventory = useDesktopStore(s => s.marketInventory);

  const totalPremiumRequests = useHelioxStore(s => s.totalPremiumRequests);

  // Effective cwd: child project path (if selected) or parent project path
  const effectiveCwd = win?.childProjectPath || projectPath;

  const [input, setInput] = useState('');
  const [showFlows, setShowFlows] = useState(true);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const lastStreamMsgIdRef = useRef<string | null>(null);
  const lastCompleteMessageRef = useRef<string>('');
  const [showAtAutocomplete, setShowAtAutocomplete] = useState(false);
  const [atQuery, setAtQuery] = useState('');
  const [atSelectedIndex, setAtSelectedIndex] = useState(0);
  const [atCursorIndex, setAtCursorIndex] = useState(0);
  const [infiniteLoop, setInfiniteLoop] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);

  // Branch selector state
  const [currentBranch, setCurrentBranch] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const flashBranchError = useCallback((msg: string) => {
    setBranchError(msg);
    setTimeout(() => setBranchError(null), 3000);
  }, []);

  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef(input);
  inputRef.current = input;

  const messages = session?.messages ?? [];
  const isRunning = session?.status === 'running';
  const isStopped = session?.status === 'stopped' || session?.status === 'error';

  // Filter out system messages — route them to notification center
  const addNotification = useDesktopStore(s => s.addNotification);
  const notifiedRef = useRef(new Set<string>());
  const visibleMessages = useMemo(() => {
    const result: ChatMessage[] = [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        if (!notifiedRef.current.has(msg.id)) {
          notifiedRef.current.add(msg.id);
          addNotification(msg.content, sessionId);
        }
      } else {
        result.push(msg);
      }
    }
    return result;
  }, [messages, sessionId, addNotification]);

  // Build role + modifier prompt context
  const rolePlugin = win?.roleId ? installedPlugins.find(p => p.id === win.roleId) : null;
  const modifierPlugins = (win?.modifierIds ?? []).map(id => installedPlugins.find(p => p.id === id)).filter(Boolean);

  // Auto-scroll only the chat messages scroller (never the desktop canvas)
  useEffect(() => {
    const scroller = messagesScrollRef.current;
    if (!scroller) return;
    scroller.scrollTo({
      top: scroller.scrollHeight,
      behavior: (streamingContent || streamingThinking) ? 'auto' : 'smooth',
    });
  }, [messages.length, streamingContent, streamingThinking]);

  // Focus chat input on heliox:focus-chat if this is the active window
  useEffect(() => {
    const handler = () => {
      const activeId = useDesktopStore.getState().activeWindowId;
      if (activeId === windowId) {
        textareaRef.current?.focus();
      }
    };
    window.addEventListener('heliox:focus-chat', handler);
    return () => window.removeEventListener('heliox:focus-chat', handler);
  }, [windowId]);

  // Load branches on mount and when project changes
  useEffect(() => {
    if (!window.helioxAPI || !effectiveCwd) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await window.helioxAPI!.gitBranches(effectiveCwd);
        if (!cancelled) {
          setCurrentBranch(result.current);
          setBranches(result.branches);
        }
      } catch {
        // No git repo or branches unavailable
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveCwd]);

  // Streaming event listener — routes thinking to log bar, content to chat bubble
  const resetStreaming = useCallback(() => {
    lastStreamMsgIdRef.current = null;
    setStreamingContent('');
    setStreamingThinking('');
    setStreamingMessageId(null);
  }, []);

  useEffect(() => {
    if (!window.helioxAPI) return;
    const unsubscribe = window.helioxAPI.onAgentEvent((event: any) => {
      if (event.agentId !== sessionId) return;
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
          // Persist the final assistant message as the chat bubble
          const finalContent = lastCompleteMessageRef.current;
          if (finalContent) {
            addSessionMessage(sessionId, {
              id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              role: 'assistant',
              content: finalContent,
              timestamp: Date.now(),
            });
            lastCompleteMessageRef.current = '';
          }
          resetStreaming();
          if (event.exitCode === 0 || event.exitCode === undefined) {
            updateSessionStatus(sessionId, 'completed', Date.now());
          }
          if (event.sessionId) {
            setOpencodeSessionId(sessionId, event.sessionId);
          }
          if (event.premiumRequests !== undefined || event.totalApiDurationMs !== undefined) {
            setSessionTokenUsage(sessionId, {
              premiumRequests: event.premiumRequests,
              totalApiDurationMs: event.totalApiDurationMs,
            });
          }
          break;
        }
        case 'error':
          lastCompleteMessageRef.current = '';
          resetStreaming();
          updateSessionStatus(sessionId, 'error', Date.now());
          addSessionMessage(sessionId, sysMsg('error', `Agent error: ${event.content ?? 'Process terminated unexpectedly'}`));
          break;
      }
    });
    return () => {
      unsubscribe();
      resetStreaming();
    };
  }, [sessionId, addSessionMessage, updateSessionStatus, setOpencodeSessionId, setSessionTokenUsage, resetStreaming]);

  // Reset effort when model/adapter doesn't support current level
  const currentAdapter = appSettings.aiAdapter;
  useEffect(() => {
    if (session) {
      const supported = getEffortLevels(session.model, currentAdapter);
      if (supported.length === 0 || !supported.includes(appSettings.effort)) {
        if (supported.length > 0) {
          useHelioxStore.getState().updateAppSettings({effort: supported[supported.length - 1]});
        }
      }
    }
  }, [session?.model, currentAdapter]);

  {/* TODO duplicate, solve it */}
  // Close model dropdown on outside click or Escape
  useEffect(() => {
    if (!showModelDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowModelDropdown(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [showModelDropdown]);

  // Check if any OTHER window is running on same project+different branch
  const allWindows = useDesktopStore(s => s.windows);
  const sessions = useHelioxStore(s => s.sessions);
  const isAnyOtherRunning = useMemo(() => {
    return allWindows.some(w => {
      if (w.id === windowId || w.type !== 'chat' || !w.sessionId) return false;
      const s = sessions.find(ss => ss.id === w.sessionId);
      return s?.status === 'running';
    });
  }, [allWindows, sessions, windowId]);

  const handleBranchChange = useCallback(async (newBranch: string) => {
    if (!window.helioxAPI || !effectiveCwd || newBranch === currentBranch) return;

    // Block branch switch if any agent is running on this project (no worktree)
    if (isAnyOtherRunning) {
      flashBranchError('Cannot switch: agent running');
      return;
    }

    setBranchLoading(true);
    setBranchError(null);
    try {
      const result = await window.helioxAPI.gitCheckout(effectiveCwd, newBranch);
      if (result.success) {
        setCurrentBranch(newBranch);
      } else {
        flashBranchError(result.error ?? 'Checkout failed');
      }
    } catch (err) {
      flashBranchError('Checkout error');
    }
    setBranchLoading(false);
  }, [effectiveCwd, currentBranch, isAnyOtherRunning]);

  const handleSend = useCallback(async () => {
    const text = inputRef.current.trim();
    if (!text || isRunning || !window.helioxAPI || !effectiveCwd) return;

    // Slash command
    if (text.startsWith('/')) {
      const store = useHelioxStore.getState();
      const handled = handleSlashCommand(text, sessionId, {
        setSessionModel: store.setSessionModel,
        addSessionMessage: store.addSessionMessage,
        addLogEntry: store.addLogEntry,
        updateAppSettings: store.updateAppSettings,
        updateSessionMessages: store.updateSessionMessages,
        availableModels: store.availableModels,
        currentEffort: store.appSettings.effort,
        getState: () => ({
          sessions: store.sessions.map(s => ({ id: s.id, model: s.model, opencodeSessionId: s.opencodeSessionId, number: s.number, tokenUsage: s.tokenUsage, roleId: s.roleId })),
          roles: store.roles.map(r => ({ id: r.id, name: r.name, icon: r.icon })),
          totalPremiumRequests: store.totalPremiumRequests,
          totalApiDuration: store.totalApiDuration,
          updateSessionRole: store.updateSessionRole,
        }),
      });
      if (handled) {
        setInput('');
        return;
      }
    }

    // Update session description from first message
    if (messages.length === 0 && session) {
      const desc = text.slice(0, 60) + (text.length > 60 ? '…' : '');
      updateSessionDescription(sessionId, desc);
      updateWindowTitle(windowId, desc);
    }

    // Add user message
    const userMsg: ChatMessage = { id: `msg-${Date.now()}`, role: 'user', content: text, timestamp: Date.now() };
    addSessionMessage(sessionId, userMsg);
    setInput('');
    updateSessionStatus(sessionId, 'running');

    if (window.helioxAPI && projectPath && session) {
      window.helioxAPI.contextMapUpsertSessionNode(projectPath, {
        sessionId,
        label: `Session #${session.number}: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`,
        status: 'running',
        roleId: win?.roleId,
      }).catch(() => {});
    }

    // Extract @file references
    const fileRefs = [...text.matchAll(/@([\w./\-[\]()]+)/g)].map(m => m[1]);
    let instruction = text;

    if (fileRefs.length > 0) {
      const contents = await Promise.all(fileRefs.map(async (f) => {
        const content = await window.helioxAPI!.readFile(`${effectiveCwd}/${f}`);
        return content ? `--- ${f} ---\n${content}\n--- end ${f} ---` : null;
      }));
      const fileBlock = contents.filter(Boolean).join('\n\n');
      if (fileBlock) instruction = `${fileBlock}\n\n${text}`;
    }

    // Prepend flow prompt from market .md (if connected)
    if (win?.flowId && projectPath) {
      try {
        const flowPrompt = await window.helioxAPI.readMarketPrompt(projectPath, 'flows', win.flowId);
        if (flowPrompt) instruction = `[Flow: ${win.flowId}]\n${flowPrompt}\n\n${instruction}`;
      } catch { /* flow prompt not found, continue */ }
    }

    // Collect role prompt separately (passed to buildAgentPrompt, not inlined)
    let rolePrompt: string | undefined;
    if (win?.roleId && projectPath) {
      const marketRole = marketInventory?.roles.find(r => r.name === win.roleId);
      if (marketRole) {
        try {
          rolePrompt = await window.helioxAPI.readMarketPrompt(projectPath, 'roles', win.roleId) ?? undefined;
        } catch { /* fallback to plugin */ }
      }
    }
    if (!rolePrompt && rolePlugin?.roleConfig?.systemPrompt) {
      rolePrompt = rolePlugin.roleConfig.systemPrompt;
    }

    // Collect modifier prompts separately (passed to buildAgentPrompt, not inlined)
    const modPrompts: string[] = [];
    const marketModNames = new Set(marketInventory?.mods.map(m => m.name) ?? []);
    for (const modId of (win?.modifierIds ?? [])) {
      if (marketModNames.has(modId) && projectPath) {
        try {
          const modPrompt = await window.helioxAPI.readMarketPrompt(projectPath, 'mods', modId);
          if (modPrompt) { modPrompts.push(modPrompt); continue; }
        } catch { /* fallback to plugin */ }
      }
      const mod = installedPlugins.find(p => p.id === modId);
      if (mod?.modifierConfig) {
        const parts: string[] = [];
        if (mod.modifierConfig.promptPrefix) parts.push(mod.modifierConfig.promptPrefix);
        if (mod.modifierConfig.promptSuffix) parts.push(mod.modifierConfig.promptSuffix);
        if (parts.length > 0) modPrompts.push(parts.join('\n\n'));
      }
    }

    // Infinity loop
    if (infiniteLoop) {
      instruction = `${INFINITY_LOOP_PROMPT}\n\n${instruction}`;
    }

    const model = rolePlugin?.roleConfig?.model ?? session?.model ?? 'opencode/claude-sonnet-4-6';

    // Resolve CWD: if instruction references ../sibling-project, use parent dir
    const agentCwd = resolveCwdForCrossProjectRefs(instruction, effectiveCwd);

    // Build the live mental-map digest for every attached subgraph (Phase 6).
    // The serialization happens here, on each send, so edits to the graph
    // between messages are reflected without re-attaching.
    let mentalDigest = '';
    if (win?.mentalAttachments?.length) {
      const storeState = useDesktopStore.getState();
      const subgraphs = win.mentalAttachments.map(att =>
        pickMentalSubgraph(storeState.mentalNodes, storeState.mentalEdges, att.nodeIds)
      );
      mentalDigest = mentalAttachmentsToDigest(subgraphs);
    }

    // If we're injecting a mental digest, we must precompute the project
    // context-map digest here too (otherwise our explicit `contextDigest`
    // would suppress agent-manager's auto-computed one). Skip the call when
    // there's no mental block — let the main process handle it as before.
    let combinedDigest: string | undefined = undefined;
    if (mentalDigest) {
      let projectDigest = '';
      if (projectPath) {
        try {
          projectDigest = await window.helioxAPI.contextMapExportText(projectPath, {
            roleId: win?.roleId,
            sessionId,
            limit: 10,
          });
        } catch { /* non-critical */ }
      }
      combinedDigest = [projectDigest, mentalDigest].filter(s => s && s.trim()).join('\n\n');
    }

    try {
      await window.helioxAPI.runAgent({
        agentId: sessionId,
        instruction,
        flows,
        cwd: agentCwd,
        contextProjectPath: projectPath ?? undefined,
        model,
        effort: appSettings.effort,
        resumeSessionId: session?.opencodeSessionId,
        aiAdapter: 'opencode',
        autoCommit: appSettings.autoCommit,
        runE2E: appSettings.runE2E,
        rolePrompt,
        modPrompts: modPrompts.length > 0 ? modPrompts : undefined,
        roleId: win?.roleId,
        contextDigest: combinedDigest,
      });
    } catch (err) {
      updateSessionStatus(sessionId, 'error');
      addLogEntry({ timestamp: Date.now(), level: 'error', sessionId, message: `Agent error: ${err}` });
    }
  }, [sessionId, session, isRunning, effectiveCwd, projectPath, flows, appSettings, messages.length, rolePlugin, modifierPlugins, infiniteLoop, windowId, win, marketInventory, installedPlugins, addSessionMessage, updateSessionStatus, updateSessionDescription, updateWindowTitle, addToast, addLogEntry]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (showAtAutocomplete) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAtSelectedIndex(i => i + 1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAtSelectedIndex(i => Math.max(0, i - 1)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return; }
      if (e.key === 'Escape') { setShowAtAutocomplete(false); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && appSettings.sendOnEnter) {
      e.preventDefault();
      handleSend();
    }
  }, [showAtAutocomplete, appSettings.sendOnEnter, handleSend]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    // @-mention detection
    const cursor = e.target.selectionStart ?? val.length;
    const before = val.slice(0, cursor);
    const atMatch = before.match(/@([\w./\-[\]()]*)$/);
    if (atMatch) {
      setShowAtAutocomplete(true);
      setAtQuery(atMatch[1]);
      setAtCursorIndex(cursor - atMatch[0].length);
      setAtSelectedIndex(0);
    } else {
      setShowAtAutocomplete(false);
    }
    // Auto-resize
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }, []);

  const handleStop = useCallback(() => {
    if (window.helioxAPI && session) {
      window.helioxAPI.stopAgent(sessionId);
      updateSessionStatus(sessionId, 'stopped');
      resetStreaming();
    }
  }, [sessionId, session, updateSessionStatus, resetStreaming]);

  // Resolve the accent color: role color from CSS variable, or electric blue default
  const roleAccent = useMemo(() => {
    if (!win?.roleId || !marketInventory) return null;
    const role = marketInventory.roles.find((r: any) => r.name === win.roleId);
    if (!role) return null;
    const c = (role as any).color;
    if (!c) return null;
    return typeof c === 'string' && c.startsWith('#') ? c : `#${c}`;
  }, [win?.roleId, marketInventory]);

  const accent = roleAccent ?? theme.accentBlue;
  const accentBg = roleAccent ? `${roleAccent}22` : theme.accentBlueBg;
  const accentBorder = roleAccent ? `${roleAccent}55` : theme.accentBlueBorder;

  return (
    <div style={{ display: 'flex', flexDirection: 'row', height: '100%', background: theme.bg, position: 'relative' }}>
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, height: '100%' }}>
      {/* Chat header bar — always visible, hosts the flows toggle at top-right */}
      <div
        data-testid="chat-header-bar"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          padding: '3px 8px', borderBottom: `1px solid ${theme.border}`,
          background: theme.surface, flexShrink: 0, minHeight: 28,
        }}
      >
        <button
          type="button"
          data-testid="chat-flows-toggle"
          aria-label="Toggle flows"
          aria-pressed={showFlows}
          onClick={() => setShowFlows(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 24, height: 24, borderRadius: 6,
            border: `1px solid ${showFlows ? accentBorder : 'transparent'}`,
            background: showFlows ? accentBg : 'transparent',
            color: showFlows ? accent : theme.textDim,
            cursor: 'pointer', padding: 0,
            transition: 'all 140ms ease',
          }}
        >
          <LucideIcon name="Route" size={13} />
        </button>
      </div>
      {/* Mental attachment chips — visible whenever this chat has subgraphs attached */}
      {(win?.mentalAttachments?.length ?? 0) > 0 && (
        <div
          data-testid="mental-attachments-row"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 10px', borderBottom: `1px solid ${theme.border}`,
            background: theme.surface, flexShrink: 0,
          }}
        >
          <MentalAttachmentChips windowId={windowId} accent={roleAccent ?? undefined} />
        </div>
      )}

      {/* Session status frame */}
      {(isRunning || session?.status === 'completed' || session?.status === 'error' || (session && session.messages.length > 0)) && (
        <div
          data-testid="session-frame"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 10px', borderBottom: `1px solid ${theme.border}`,
            background: theme.surface, fontSize: 10, fontFamily: theme.fontInter,
            color: theme.textGhost, flexShrink: 0,
          }}
        >
          {isRunning && (
            <>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', background: accent,
                animation: 'pulse 1.5s ease-in-out infinite', flexShrink: 0,
              }} />
              <span style={{ fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: accent }}>
                Running in {session?.model ?? 'OpenCode'}
              </span>
            </>
          )}
          {session?.status === 'completed' && (
            <>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: theme.success, flexShrink: 0 }} />
              <span style={{ fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: theme.textDim }}>
                Completed
              </span>
            </>
          )}
          {session?.status === 'error' && (
            <>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: theme.danger, flexShrink: 0 }} />
              <span style={{ fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: theme.danger }}>
                Error
              </span>
            </>
          )}
          {!isRunning && session?.status !== 'completed' && session?.status !== 'error' && session?.messages && session.messages.length > 0 && (
            <span style={{ fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: theme.textGhost }}>
              {session.messages.length} messages · {session.model ?? 'OpenCode'}
            </span>
          )}
          {session?.tokenUsage?.premiumRequests !== undefined && (
            <span style={{ color: theme.textFaint }}>
              · {session.tokenUsage.premiumRequests} req
            </span>
          )}
          {/* OpenCode session resumable badge */}
          {session?.opencodeSessionId && !isRunning && (
            <span style={{
              padding: '1px 6px', borderRadius: 10, fontSize: 9, fontWeight: 700,
              textTransform: 'uppercase' as const, letterSpacing: '0.06em',
              background: `${accent}18`, color: accent,
            }}>Resumable</span>
          )}
          {/* Diff Viewer button — opens side-by-side diff window for session changes */}
          {session && session.messages.length > 0 && !isRunning && (sessionChangedFiles[sessionId]?.length ?? 0) > 0 && (
            <button
              onClick={() => {
                addWindow('diff-viewer', {
                  sessionId,
                  title: `Diff · Session ${session.number}`,
                  size: { width: 720, height: 540 },
                });
              }}
              data-testid="chat-diff"
              title="Open diff viewer for session changes"
              aria-label="Open diff viewer"
              style={{
                marginLeft: 'auto', padding: '2px 8px', borderRadius: 6,
                border: `1px solid ${accentBorder}`,
                background: 'transparent', color: accent,
                fontSize: 9, fontWeight: 600, fontFamily: theme.fontInter,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3,
                textTransform: 'uppercase' as const, letterSpacing: '0.04em',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = accentBg; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 3h5v5" />
                <path d="M8 3H3v5" />
                <path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3" />
                <path d="m15 9 6-6" />
              </svg>
              Diff
            </button>
          )}
          {/* Clear button — right side */}
          {session && session.messages.length > 0 && !isRunning && (
            <button
              onClick={() => {
                useHelioxStore.getState().clearConversation(sessionId);
                setInput('');
                setStreamingContent('');
                setStreamingThinking('');
                setStreamingMessageId(null);
                lastCompleteMessageRef.current = '';
              }}
              data-testid="chat-clear"
              title="Clear conversation (keeps model & attachments)"
              aria-label="Clear conversation"
              style={{
                marginLeft: (sessionChangedFiles[sessionId]?.length ?? 0) > 0 ? undefined : 'auto',
                padding: '2px 8px', borderRadius: 6,
                border: `1px solid ${accentBorder}`,
                background: 'transparent', color: accent,
                fontSize: 9, fontWeight: 600, fontFamily: theme.fontInter,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3,
                textTransform: 'uppercase' as const, letterSpacing: '0.04em',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = accentBg; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
                <line x1="18" y1="9" x2="12" y2="15" />
                <line x1="12" y1="9" x2="18" y2="15" />
              </svg>
              Clear
            </button>
          )}
        </div>
      )}
      {/* Messages */}
      <div ref={messagesScrollRef} style={{ flex: 1, overflow: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visibleMessages.length === 0 && !streamingContent && !streamingThinking && (
          <div role="status" aria-live="polite" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.textGhost, fontSize: 13, pointerEvents: 'none' }}>
            Start a conversation…
          </div>
        )}
        {visibleMessages.map(msg => (
          <ChatMessageItem key={msg.id} msg={msg} />
        ))}

        {/* Thinking log bar — NOT a chat bubble, shows as compact progress console */}
        {streamingThinking && !streamingContent && (
          <div style={{
            padding: '6px 10px', borderRadius: 6,
            background: `${accent}08`, borderLeft: `2px solid ${accent}`,
            maxHeight: 80, overflow: 'hidden',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', background: accent,
                animation: 'pulse 1.5s ease-in-out infinite',
              }} />
              <span style={{ fontFamily: theme.fontInter, fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: theme.textGhost }}>
                Reasoning…
              </span>
            </div>
            <p style={{
              fontFamily: theme.fontMono, fontSize: 10, lineHeight: 1.4,
              color: theme.textGhost, whiteSpace: 'pre-wrap', overflow: 'hidden',
              display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as const,
            }}>
              {streamingThinking.slice(-300)}
            </p>
          </div>
        )}

        {/* Streaming response — this IS the chat bubble */}
        {streamingContent && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontFamily: theme.fontInter, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: theme.textGhost }}>Heliox</span>
            <div style={{
              padding: 14, borderRadius: '0 18px 18px 18px',
              background: theme.surfaceHover, outline: `1px solid ${theme.border}`, outlineOffset: '-1px',
            }}>
              {renderMessageContent(streamingContent)}
              <span style={{ color: theme.textDim, fontSize: 14, animation: 'blink 1s step-end infinite' }}>▊</span>
            </div>
          </div>
        )}

        {/* Loading dots — agent running but no streaming yet */}
        {isRunning && !streamingContent && !streamingThinking && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 8, background: `${accent}08` }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: accent, opacity: 0.6, animation: 'bounce 1s infinite' }} />
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: accent, opacity: 0.6, animation: 'bounce 1s infinite 0.15s' }} />
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: accent, opacity: 0.6, animation: 'bounce 1s infinite 0.3s' }} />
            <span style={{ fontFamily: theme.fontInter, fontSize: 10, color: theme.textGhost, textTransform: 'uppercase' as const }}>
              Thinking in {session?.model ?? 'OpenCode'}
            </span>
          </div>
        )}
      </div>

      {/* Input area */}
      <div style={{ padding: '8px 12px 10px', borderTop: `1px solid ${accentBorder}`, background: theme.surface }}>
        <FileContextPanel
          input={input}
          setInput={setInput}
          projectFiles={projectFiles}
          inputRef={textareaRef}
          showAtAutocomplete={showAtAutocomplete}
          atQuery={atQuery}
          atSelectedIndex={atSelectedIndex}
          atCursorIndex={atCursorIndex}
          setShowAtAutocomplete={setShowAtAutocomplete}
          setAtSelectedIndex={setAtSelectedIndex}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Direct the agent..."
            disabled={isStopped}
            rows={1}
            data-testid="chat-input"
            aria-label="Message input"
            aria-expanded={showAtAutocomplete}
            aria-controls={showAtAutocomplete ? 'file-autocomplete-listbox' : undefined}
            aria-activedescendant={showAtAutocomplete ? `file-option-${atSelectedIndex}` : undefined}
            aria-autocomplete="list"
            style={{
              flex: 1, resize: 'none', background: theme.bg, border: `1px solid ${theme.borderLight}`,
              borderRadius: 8, padding: '8px 10px', color: theme.textPrimary, fontSize: 13,
              fontFamily: theme.fontManrope, outline: 'none', maxHeight: 120, lineHeight: 1.5,
            }}
          />
          {isRunning ? (
            <button onClick={handleStop} data-testid="chat-stop" aria-label="Stop agent" style={{
              padding: '6px 14px', borderRadius: 8, border: `1px solid ${theme.dangerBorder}`,
              background: theme.danger, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              fontFamily: theme.fontInter,
            }}>Stop</button>
          ) : (
            <button onClick={handleSend} data-testid="chat-send" disabled={!input.trim() || isStopped} aria-label="Send message" aria-disabled={!input.trim() || isStopped} style={{
              padding: '6px 14px', borderRadius: 8, border: `1px solid ${accentBorder}`,
              background: accent, color: '#fff',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: (!input.trim() || isStopped) ? 0.4 : 1,
              fontFamily: theme.fontInter,
            }}>Send</button>
          )}
        </div>
        {/* Model + branch + effort + premium row */}
        <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center', fontSize: 11, color: theme.textDim, flexWrap: 'wrap' }}>
          {/* Model dropdown with cost multipliers */}
          <div ref={modelDropdownRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setShowModelDropdown(!showModelDropdown)}
              data-testid="chat-model-select"
              aria-expanded={showModelDropdown}
              aria-label="Select model"
              aria-haspopup="listbox"
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: showModelDropdown ? theme.surfaceHover : theme.bg,
                border: `1px solid ${theme.borderLight}`, borderRadius: 6,
                color: theme.textMuted, padding: '2px 8px', fontSize: 11, cursor: 'pointer', outline: 'none',
              }}
            >
              <span style={{ fontFamily: theme.fontMono, fontSize: 10 }}>
                {session?.model ?? 'opencode/claude-sonnet-4-6'}
              </span>
              {MODEL_COSTS[session?.model ?? ''] && (
                <span style={{ fontSize: 9, opacity: 0.5 }}>({MODEL_COSTS[session?.model ?? '']})</span>
              )}
              <svg width="8" height="5" viewBox="0 0 8 5" fill="none" aria-hidden="true" style={{ transform: showModelDropdown ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                <path d="M1 1l3 3 3-3" stroke={theme.textFaint} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {showModelDropdown && (
              <div style={{
                position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
                padding: '4px 0', borderRadius: 10, overflow: 'auto', zIndex: 50,
                background: theme.surfaceCard, border: `1px solid ${theme.borderMedium}`,
                minWidth: 200, maxHeight: 300, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              }} role="listbox" aria-label="Available models">
                {availableModels.map(m => (
                  <button
                    key={m}
                    onClick={() => { setSessionModel(sessionId, m); setShowModelDropdown(false); }}
                    role="option"
                    aria-selected={(session?.model ?? 'opencode/claude-sonnet-4-6') === m}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '5px 12px', border: 'none', cursor: 'pointer',
                      background: (session?.model ?? 'opencode/claude-sonnet-4-6') === m ? `${accent}18` : 'transparent',
                      fontFamily: theme.fontMono, fontSize: 11,
                      color: (session?.model ?? 'opencode/claude-sonnet-4-6') === m ? accent : theme.textDim,
                    }}
                    onMouseEnter={e => { (e.target as HTMLElement).style.background = `${accent}12`; }}
                    onMouseLeave={e => { (e.target as HTMLElement).style.background = (session?.model ?? 'opencode/claude-sonnet-4-6') === m ? `${accent}18` : 'transparent'; }}
                  >
                    {m}
                    {MODEL_COSTS[m] && (
                      <span style={{ marginLeft: 8, fontSize: 9, opacity: 0.5 }}>({MODEL_COSTS[m]})</span>
                    )}
                    {(session?.model ?? 'opencode/claude-sonnet-4-6') === m && <span style={{ marginLeft: 6, fontSize: 9, color: accent }}>●</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Branch selector */}
          {branches.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <LucideIcon name="GitBranch" size={11} style={{ color: '#a0a0a8' }} />
              <HelioxDropdown
                value={currentBranch}
                options={branches.map(b => ({ value: b, label: b }))}
                onChange={handleBranchChange}
                disabled={branchLoading || isRunning}
                testId="chat-branch-select"
                ariaLabel="Git branch"
                maxWidth={120}
                triggerStyle={{
                  background: theme.bg,
                  border: `1px solid ${branchError ? '#f44336' : theme.borderLight}`,
                }}
              />
              {branchError && (
                <span style={{ color: '#f44336', fontSize: 10 }}>{branchError}</span>
              )}
            </div>
          )}

          {/* Effort selector (model/adapter-aware) — electric blue active state */}
          {getEffortLevels(session?.model ?? 'opencode/claude-sonnet-4-6', currentAdapter).length > 0 && (
          <>
          <span>Effort:</span>
          {getEffortLevels(session?.model ?? 'opencode/claude-sonnet-4-6', currentAdapter).map(e => (
            <button
              key={e}
              onClick={() => useHelioxStore.getState().updateAppSettings({ effort: e })}
              aria-pressed={appSettings.effort === e}
              aria-label={`Effort: ${e}`}
              style={{
                padding: '1px 6px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
                border: appSettings.effort === e ? `1px solid ${accentBorder}` : '1px solid transparent',
                background: appSettings.effort === e ? accentBg : 'transparent',
                color: appSettings.effort === e ? accent : theme.textGhost,
                fontWeight: appSettings.effort === e ? 700 : 400,
              }}
            >{e[0].toUpperCase()}</button>
          ))}
          </>
          )}

          {/* Premium requests display */}
          {(session?.tokenUsage?.premiumRequests !== undefined || totalPremiumRequests > 0) && (
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {session?.tokenUsage?.premiumRequests !== undefined && (
                <span>{session.tokenUsage.premiumRequests} premium req</span>
              )}
              {session?.tokenUsage?.totalApiDurationMs !== undefined && (
                <span>{(session.tokenUsage.totalApiDurationMs / 1000).toFixed(1)}s</span>
              )}
              {totalPremiumRequests > 0 && (
                <span style={{ opacity: 0.6 }}>· {totalPremiumRequests} total</span>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
      {showFlows && <FlowQuickRail windowId={windowId} accent={roleAccent ?? undefined} />}
    </div>
  );
}
