/**
 * index.ts — Renderer UI
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
// src/renderer/store/index.ts — Zustand store for Heliox IDE state
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  Flow, FlowStep, SnapshotDiff, AgentConfig, DiffDecision, DiffRecord,
  ChatMessage, Session, SessionStatus, NavTab, DiffViewMode, Role, LogEntry, HelioxAPI, AppSettings, BottomPanel,
  GitStatusInfo,
} from '@/types';

const MAX_PERSISTED_MESSAGES = 100;
const MAX_LOG_ENTRIES = 500;
const MAX_DIFF_HISTORY = 50;

const DEFAULT_ROLES: Role[] = [
  {
    id: 'role-ui',
    name: 'UI Engineer',
    description: 'Frontend components, layouts, styles, animations',
    systemPrompt: 'You are an expert UI engineer specializing in React, TypeScript, CSS, and component architecture. Focus on visual quality, accessibility, and rendering performance. When modifying components, preserve existing design system tokens and patterns.',
    model: 'copilot',
    temperature: 0.3,
    maxTokens: 4096,
    icon: 'palette',
    createdAt: 0,
  },
  {
    id: 'role-backend',
    name: 'Backend Engineer',
    description: 'APIs, databases, server logic, infrastructure',
    systemPrompt: 'You are an expert backend engineer. Focus on API design, data modeling, security, and scalability. Follow REST conventions, validate inputs, handle errors gracefully, and write efficient database queries.',
    model: 'copilot',
    temperature: 0.2,
    maxTokens: 4096,
    icon: 'gear',
    createdAt: 0,
  },
  {
    id: 'role-reviewer',
    name: 'Code Reviewer',
    description: 'Review changes for bugs, security, and best practices',
    systemPrompt: 'You are a thorough code reviewer. Focus on bugs, security vulnerabilities, performance issues, and adherence to best practices. Be specific and actionable in your feedback. Flag potential regressions.',
    model: 'copilot',
    temperature: 0.1,
    maxTokens: 4096,
    icon: 'search',
    createdAt: 0,
  },
  {
    id: 'role-test',
    name: 'Test Engineer',
    description: 'Unit tests, integration tests, E2E flow validation',
    systemPrompt: 'You are an expert test engineer. Write comprehensive tests with good coverage of edge cases. Prefer testing behavior over implementation details. Use descriptive test names and follow arrange-act-assert patterns.',
    model: 'copilot',
    temperature: 0.2,
    maxTokens: 4096,
    icon: 'beaker',
    createdAt: 0,
  },
];

interface HelioxState {
  // Project
  projectPath: string | null;
  recentProjects: string[];
  openProjects: string[];
  setProjectPath: (path: string | null) => void;
  addRecentProject: (path: string) => void;
  addOpenProject: (path: string) => void;
  removeOpenProject: (path: string) => void;

  // Sessions
  sessions: Session[];
  selectedSessionId: string | null;
  nextSessionNumber: number;
  _updateSession: (sessionId: string, patch: Partial<Session>) => void;
  addSession: () => string;
  removeSession: (sessionId: string) => void;
  updateSessionStatus: (sessionId: string, status: SessionStatus, endedAt?: number) => void;
  updateSessionDescription: (sessionId: string, description: string) => void;
  setSelectedSessionId: (id: string | null) => void;
  addSessionMessage: (sessionId: string, msg: ChatMessage) => void;
  updateSessionMessages: (sessionId: string, messages: ChatMessage[]) => void;
  setCopilotSessionId: (sessionId: string, copilotId: string) => void;
  setSessionTokenUsage: (sessionId: string, usage: { premiumRequests?: number; totalTokens?: number; totalApiDurationMs?: number }) => void;
  setSessionModel: (sessionId: string, model: string) => void;
  updateSessionRole: (sessionId: string, roleId: string | undefined) => void;
  clearConversation: (sessionId: string) => void;

  // Accumulated usage across all sessions
  totalPremiumRequests: number;
  totalApiDuration: number;

  // Roles
  roles: Role[];
  addRole: (role: Role) => void;
  updateRole: (roleId: string, updates: Partial<Role>) => void;
  removeRole: (roleId: string) => void;

  // Logs
  logEntries: LogEntry[];
  addLogEntry: (entry: Omit<LogEntry, 'id'>) => void;
  clearLogs: () => void;

  // Bottom panel
  bottomPanel: BottomPanel;
  setBottomPanel: (panel: BottomPanel) => void;
  toggleBottomPanel: (panel: 'terminal' | 'logs') => void;

  // Raw CLI output (terminal panel)
  rawOutputLines: string[];
  addRawOutputLine: (line: string) => void;
  clearRawOutput: () => void;

  // UI state
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  diffViewMode: DiffViewMode;
  setDiffViewMode: (mode: DiffViewMode) => void;
  sessionFilter: string;
  setSessionFilter: (filter: string) => void;

  // Flows
  flows: Flow[];
  addFlow: (flow: Flow) => void;
  removeFlow: (flowId: string) => void;
  renameFlow: (flowId: string, newName: string) => void;
  duplicateFlow: (flowId: string) => void;
  updateFlowBaseUrl: (flowId: string, baseUrl: string) => void;
  addStep: (flowId: string, step: FlowStep) => void;
  removeStep: (flowId: string, stepId: string) => void;
  updateStep: (flowId: string, stepId: string, updates: Partial<FlowStep>) => void;
  reorderSteps: (flowId: string, fromIndex: number, toIndex: number) => void;

  // Agents
  agents: AgentConfig[];
  updateAgentStatus: (agentId: string, status: AgentConfig['status']) => void;

  // Diffs for review
  pendingDiffs: SnapshotDiff[];
  setPendingDiffs: (diffs: SnapshotDiff[]) => void;
  approveDiff: (stepId: string) => void;
  rejectDiff: (stepId: string, reason?: string) => void;
  diffHistory: DiffRecord[];

  selectedFlowId: string | null;
  setSelectedFlowId: (id: string | null) => void;

  isRunningAgent: boolean;
  setIsRunningAgent: (v: boolean) => void;

  // Open file viewer
  openFilePath: string | null;
  setOpenFilePath: (path: string | null) => void;

  toasts: { id: string; message: string; type: 'success' | 'error' | 'info' }[];
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  removeToast: (id: string) => void;

  // Project config sync
  loadProjectConfig: () => Promise<void>;
  saveFlowsToProject: () => Promise<void>;
  saveRolesToProject: () => Promise<void>;

  // App Settings
  appSettings: AppSettings;
  updateAppSettings: (updates: Partial<AppSettings>) => void;
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;
  showHelp: boolean;
  setShowHelp: (v: boolean) => void;

  // Panel visibility
  showSidebar: boolean;
  toggleSidebar: () => void;

  // Project files (for @-mention autocomplete)
  projectFiles: string[];
  setProjectFiles: (files: string[]) => void;

  // Models
  availableModels: string[];
  setAvailableModels: (models: string[]) => void;

  // Git status
  gitStatusInfo: GitStatusInfo | null;
  setGitStatusInfo: (info: GitStatusInfo | null) => void;

  // Session file changes (tracks files modified by agent during a session)
  sessionChangedFiles: Record<string, Array<{ path: string; linesAdded: number; linesRemoved: number }>>;
  addSessionChangedFile: (sessionId: string, file: { path: string; linesAdded: number; linesRemoved: number }) => void;
  clearSessionChangedFiles: (sessionId: string) => void;

  // Bridge (Remote Control)
  bridgeRunning: boolean;
  bridgePin: string | null;
  bridgeUrl: string | null;
  bridgeQrDataUrl: string | null;
  bridgeLocalIp: string | null;
  bridgePort: number | null;
  setBridgeState: (state: {
    running: boolean;
    pin?: string | null;
    url?: string | null;
    qrDataUrl?: string | null;
    localIp?: string | null;
    port?: number | null;
  }) => void;
  clearBridgeState: () => void;
}

export const useHelioxStore = create<HelioxState>()(
  persist(
    (set, get) => ({
      // ─── Project ────────────────────────────────────────
      projectPath: null,
      recentProjects: [],
      openProjects: [],
      setProjectPath: (path) => set((state) => ({
        projectPath: path,
        openProjects: path && !state.openProjects.includes(path)
          ? [...state.openProjects, path]
          : path ? state.openProjects : state.openProjects,
      })),
      addRecentProject: (path) => set((s) => ({
        recentProjects: [path, ...s.recentProjects.filter(p => p !== path)].slice(0, 10),
      })),
      addOpenProject: (path) => set((state) => ({
        openProjects: state.openProjects.includes(path)
          ? state.openProjects
          : [...state.openProjects, path],
        projectPath: path,
      })),
      removeOpenProject: (path) => set((state) => {
        const remaining = state.openProjects.filter(p => p !== path);
        return {
          openProjects: remaining,
          projectPath: state.projectPath === path
            ? (remaining[0] ?? null)
            : state.projectPath,
        };
      }),

      // ─── Sessions ──────────────────────────────────────
      sessions: [],
      selectedSessionId: null,
      nextSessionNumber: 1,

      _updateSession: (sessionId: string, patch: Partial<Session>) => set((s) => ({
        sessions: s.sessions.map(ses =>
          ses.id === sessionId ? { ...ses, ...patch } : ses
        ),
      })),

      addSession: () => {
        const { sessions, projectPath } = get();
        // Compute per-project session number so numbering restarts at 1 for each project/worktree
        const projectSessions = sessions.filter(s =>
          s.projectId === (projectPath ?? undefined) || (!s.projectId && !projectPath)
        );
        const num = projectSessions.reduce((max, s) => Math.max(max, s.number), 0) + 1;
        const id = `session-${Date.now()}-${num}`;
        const session: Session = {
          id,
          number: num,
          status: 'waiting',
          description: '',
          model: 'copilot',
          projectId: projectPath ?? undefined,
          createdAt: Date.now(),
          messages: [],
        };
        set({
          sessions: [session, ...sessions],
          selectedSessionId: id,
          nextSessionNumber: num + 1,
        });
        return id;
      },
      removeSession: (sessionId) => set((s) => ({
        sessions: s.sessions.filter(ses => ses.id !== sessionId),
        selectedSessionId: s.selectedSessionId === sessionId ? null : s.selectedSessionId,
      })),
      updateSessionStatus: (sessionId, status, endedAt) => set((s) => ({
        sessions: s.sessions.map(ses => {
          if (ses.id !== sessionId) return ses;
          const updates: Partial<Session> = { status };
          if (status === 'running' && !ses.startedAt) {
            updates.startedAt = Date.now();
          }
          if ((status === 'completed' || status === 'error' || status === 'stopped') && !ses.completedAt) {
            updates.completedAt = endedAt ?? Date.now();
          }
          if (endedAt !== undefined) {
            updates.endedAt = endedAt;
          }
          return { ...ses, ...updates };
        }),
      })),
      setSelectedSessionId: (id) => set({ selectedSessionId: id }),
      updateSessionDescription: (sessionId, description) => get()._updateSession(sessionId, { description }),
      addSessionMessage: (sessionId, msg) => set((s) => ({
        sessions: s.sessions.map(ses =>
          ses.id === sessionId
            ? { ...ses, messages: [...ses.messages, msg].slice(-MAX_PERSISTED_MESSAGES) }
            : ses
        ),
      })),
      updateSessionMessages: (sessionId, messages) => get()._updateSession(sessionId, { messages }),
      setCopilotSessionId: (sessionId, copilotId) => get()._updateSession(sessionId, { copilotSessionId: copilotId }),
      setSessionTokenUsage: (sessionId, usage) => set((s) => {
        const session = s.sessions.find(ses => ses.id === sessionId);
        const prevPremium = session?.tokenUsage?.premiumRequests ?? 0;
        const prevDuration = session?.tokenUsage?.totalApiDurationMs ?? 0;
        const newPremium = usage.premiumRequests ?? prevPremium;
        const newDuration = usage.totalApiDurationMs ?? prevDuration;
        return {
          sessions: s.sessions.map(ses =>
            ses.id === sessionId ? { ...ses, tokenUsage: { ...ses.tokenUsage, ...usage } } : ses
          ),
          totalPremiumRequests: s.totalPremiumRequests + (newPremium - prevPremium),
          totalApiDuration: s.totalApiDuration + (newDuration - prevDuration),
        };
      }),
      setSessionModel: (sessionId, model) => get()._updateSession(sessionId, { model }),
      updateSessionRole: (sessionId, roleId) => get()._updateSession(sessionId, { roleId }),
      clearConversation: (sessionId) => get()._updateSession(sessionId, {
        messages: [],
        status: 'waiting',
        startedAt: undefined,
        completedAt: undefined,
        endedAt: undefined,
        copilotSessionId: undefined,
        tokenUsage: undefined,
      }),

      // ─── Roles ──────────────────────────────────────────
      roles: DEFAULT_ROLES,
      addRole: (role) => set((s) => ({ roles: [...s.roles, role] })),
      updateRole: (roleId, updates) => set((s) => ({
        roles: s.roles.map(r => r.id === roleId ? { ...r, ...updates } : r),
      })),
      removeRole: (roleId) => set((s) => ({
        roles: s.roles.filter(r => r.id !== roleId),
      })),

      // ─── Logs ───────────────────────────────────────────
      logEntries: [],
      addLogEntry: (entry) => set((s) => ({
        logEntries: [
          ...s.logEntries,
          { ...entry, id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` },
        ].slice(-MAX_LOG_ENTRIES),
      })),
      clearLogs: () => set({ logEntries: [] }),

      // ─── Bottom Panel ───────────────────────────────────
      bottomPanel: 'none',
      setBottomPanel: (panel) => set({ bottomPanel: panel }),
      toggleBottomPanel: (panel) => set((s) => ({
        bottomPanel: s.bottomPanel === panel ? 'none' : panel,
      })),

      // ─── Raw CLI Output ─────────────────────────────────
      rawOutputLines: [],
      addRawOutputLine: (line) => set((s) => ({
        rawOutputLines: [...s.rawOutputLines, line].slice(-1000),
      })),
      clearRawOutput: () => set({ rawOutputLines: [] }),

      // ─── UI State ──────────────────────────────────────
      activeTab: 'sessions',
      setActiveTab: (tab) => set({ activeTab: tab }),
      diffViewMode: 'visual',
      setDiffViewMode: (mode) => set({ diffViewMode: mode }),
      sessionFilter: '',
      setSessionFilter: (filter) => set({ sessionFilter: filter }),

      // ─── Flows ─────────────────────────────────────────
      flows: [],
      addFlow: (flow) => set((s) => ({ flows: [...s.flows, flow] })),
      removeFlow: (flowId) => set((s) => ({
        flows: s.flows.filter(f => f.id !== flowId),
        selectedFlowId: s.selectedFlowId === flowId ? null : s.selectedFlowId,
      })),
      renameFlow: (flowId, newName) => set((s) => ({
        flows: s.flows.map(f => f.id === flowId ? { ...f, name: newName } : f),
      })),
      duplicateFlow: (flowId) => set((s) => {
        const source = s.flows.find(f => f.id === flowId);
        if (!source) return s;
        const clone: Flow = {
          ...source,
          id: `flow-${Date.now()}`,
          name: `${source.name} (copy)`,
          steps: source.steps.map(step => ({ ...step, id: `${step.id}-copy-${Date.now()}` })),
          diffHistory: [],
        };
        return { flows: [...s.flows, clone] };
      }),
      updateFlowBaseUrl: (flowId, baseUrl) => set((s) => ({
        flows: s.flows.map(f => f.id === flowId ? { ...f, baseUrl } : f),
      })),
      addStep: (flowId, step) => set((s) => ({
        flows: s.flows.map(f => f.id === flowId ? { ...f, steps: [...f.steps, step] } : f),
      })),
      removeStep: (flowId, stepId) => set((s) => ({
        flows: s.flows.map(f => f.id === flowId
          ? { ...f, steps: f.steps.filter(st => st.id !== stepId) }
          : f
        ),
      })),
      updateStep: (flowId, stepId, updates) => set((s) => ({
        flows: s.flows.map(f => f.id === flowId
          ? { ...f, steps: f.steps.map(st => st.id === stepId ? { ...st, ...updates } : st) }
          : f
        ),
      })),
      reorderSteps: (flowId, fromIndex, toIndex) => set((s) => ({
        flows: s.flows.map(f => {
          if (f.id !== flowId) return f;
          const steps = [...f.steps];
          const [moved] = steps.splice(fromIndex, 1);
          steps.splice(toIndex, 0, moved);
          return { ...f, steps };
        }),
      })),

      // ─── Agents ────────────────────────────────────────
      agents: [],
      updateAgentStatus: (agentId, status) => set((s) => ({
        agents: s.agents.map(a => a.id === agentId ? { ...a, status } : a),
      })),

      // ─── Diffs ─────────────────────────────────────────
      pendingDiffs: [],
      diffHistory: [],
      setPendingDiffs: (diffs) => set({ pendingDiffs: diffs }),
      approveDiff: (stepId) => set((s) => {
        const diff = s.pendingDiffs.find(d => d.stepId === stepId);
        if (!diff) return { pendingDiffs: s.pendingDiffs };
        const decision: DiffDecision = {
          stepId, action: 'approved', timestamp: Date.now(),
          impactScore: diff.impactScore, severity: diff.severity,
        };
        const record: DiffRecord = {
          flowId: diff.after.flowId,
          stepId,
          before: diff.before.screenshotBase64,
          after: diff.after.screenshotBase64,
          approved: true,
          timestamp: Date.now(),
        };
        const flows = s.flows.map(flow => {
          if (flow.id !== diff.after.flowId) return flow;
          return {
            ...flow,
            steps: flow.steps.map(step =>
              step.id === stepId ? { ...step, snapshot: diff.after } : step
            ),
            diffHistory: [...(flow.diffHistory ?? []), decision],
          };
        });
        return {
          pendingDiffs: s.pendingDiffs.filter(d => d.stepId !== stepId),
          flows,
          diffHistory: [...s.diffHistory, record].slice(-MAX_DIFF_HISTORY),
        };
      }),
      rejectDiff: (stepId, reason) => set((s) => {
        const diff = s.pendingDiffs.find(d => d.stepId === stepId);
        if (!diff) return { pendingDiffs: s.pendingDiffs };
        const decision: DiffDecision = {
          stepId, action: 'rejected', timestamp: Date.now(),
          impactScore: diff.impactScore, severity: diff.severity,
          rejectionReason: reason ?? 'User rejected without reason',
        };
        const record: DiffRecord = {
          flowId: diff.after.flowId,
          stepId,
          before: diff.before.screenshotBase64,
          after: diff.after.screenshotBase64,
          approved: false,
          timestamp: Date.now(),
        };
        const flows = s.flows.map(flow => {
          if (flow.id !== diff.after.flowId) return flow;
          return { ...flow, diffHistory: [...(flow.diffHistory ?? []), decision] };
        });
        return {
          pendingDiffs: s.pendingDiffs.filter(d => d.stepId !== stepId),
          flows,
          diffHistory: [...s.diffHistory, record].slice(-MAX_DIFF_HISTORY),
        };
      }),

      selectedFlowId: null,
      setSelectedFlowId: (id) => set({ selectedFlowId: id }),

      isRunningAgent: false,
      setIsRunningAgent: (v) => set({ isRunningAgent: v }),

      openFilePath: null,
      setOpenFilePath: (path) => set({ openFilePath: path }),

      toasts: [],
      addToast: (message, type = 'info') => set((s) => ({
        toasts: [...s.toasts.slice(-4), { id: `toast-${Date.now()}`, message, type }],
      })),
      removeToast: (id) => set((s) => ({
        toasts: s.toasts.filter(t => t.id !== id),
      })),

      // ─── Project Config Sync ────────────────────────────
      loadProjectConfig: async () => {
        const { projectPath } = get();
        if (!projectPath || !window.helioxAPI) return;
        try {
          const flowsJson = await window.helioxAPI.readProjectConfig(projectPath, 'flows.json');
          if (flowsJson) {
            const flows = JSON.parse(flowsJson);
            if (Array.isArray(flows)) set({ flows });
          }
        } catch (err) {
          console.warn('[Heliox] Failed to load flows.json:', err);
        }
        try {
          const rolesJson = await window.helioxAPI.readProjectConfig(projectPath, 'roles.json');
          if (rolesJson) {
            const roles = JSON.parse(rolesJson);
            if (Array.isArray(roles)) set({ roles });
          }
        } catch (err) {
          console.warn('[Heliox] Failed to load roles.json:', err);
        }
      },
      saveFlowsToProject: async () => {
        const { projectPath, flows } = get();
        if (!projectPath || !window.helioxAPI) return;
        try {
          await window.helioxAPI.writeProjectConfig(projectPath, 'flows.json', JSON.stringify(flows, null, 2));
        } catch (err) {
          console.error('[Heliox] Failed to save flows.json:', err);
        }
      },
      saveRolesToProject: async () => {
        const { projectPath, roles } = get();
        if (!projectPath || !window.helioxAPI) return;
        try {
          await window.helioxAPI.writeProjectConfig(projectPath, 'roles.json', JSON.stringify(roles, null, 2));
        } catch (err) {
          console.error('[Heliox] Failed to save roles.json:', err);
        }
      },

      // ─── App Settings ───────────────────────────────────
      appSettings: {
        aiAdapter: 'copilot',
        customCliPath: '',
        autoCommit: false,
        runE2E: false,
        sendOnEnter: false,
        onboardingDone: false,
        effort: 'high',
        stupidityMode: true,
      },
      updateAppSettings: (updates) => set((s) => ({
        appSettings: { ...s.appSettings, ...updates },
      })),
      showSettings: false,
      setShowSettings: (v) => set({ showSettings: v }),
      showHelp: false,
      setShowHelp: (v) => set({ showHelp: v }),

      // ─── Panel Visibility ───────────────────────────────
      showSidebar: true,
      toggleSidebar: () => set((s) => ({ showSidebar: !s.showSidebar })),

      // ─── Project Files ──────────────────────────────────
      projectFiles: [],
      setProjectFiles: (files) => set({ projectFiles: files }),

      // ─── Accumulated Usage ──────────────────────────────
      totalPremiumRequests: 0,
      totalApiDuration: 0,

      // ─── Models ──────────────────────────────────────────
      availableModels: ['copilot'],
      setAvailableModels: (models) => set({ availableModels: models }),

      // ─── Git Status ─────────────────────────────────────
      gitStatusInfo: null,
      setGitStatusInfo: (info) => set({ gitStatusInfo: info }),

      // ─── Session File Changes ────────────────────────────
      sessionChangedFiles: {},
      addSessionChangedFile: (sessionId, file) => set((s) => {
        const existing = s.sessionChangedFiles[sessionId] ?? [];
        // Deduplicate by path (keep latest stats)
        const updated = [...existing.filter(f => f.path !== file.path), file];
        return { sessionChangedFiles: { ...s.sessionChangedFiles, [sessionId]: updated } };
      }),
      clearSessionChangedFiles: (sessionId) => set((s) => ({
        sessionChangedFiles: { ...s.sessionChangedFiles, [sessionId]: [] },
      })),

      // ─── Bridge (Remote Control) ─────────────────────────
      bridgeRunning: false,
      bridgePin: null,
      bridgeUrl: null,
      bridgeQrDataUrl: null,
      bridgeLocalIp: null,
      bridgePort: null,
      setBridgeState: (state) => set((s) => ({
        bridgeRunning: state.running,
        bridgePin: state.pin ?? s.bridgePin,
        bridgeUrl: state.url ?? s.bridgeUrl,
        bridgeQrDataUrl: state.qrDataUrl ?? s.bridgeQrDataUrl,
        bridgeLocalIp: state.localIp ?? s.bridgeLocalIp,
        bridgePort: state.port ?? s.bridgePort,
      })),
      clearBridgeState: () => set({
        bridgeRunning: false,
        bridgePin: null,
        bridgeUrl: null,
        bridgeQrDataUrl: null,
        bridgeLocalIp: null,
        bridgePort: null,
      }),
    }),
    {
      name: 'heliox-store-v3',
      partialize: (state) => ({
        projectPath: state.projectPath,
        recentProjects: state.recentProjects,
        openProjects: state.openProjects,
        sessions: state.sessions.map(s => ({
          ...s,
          messages: s.messages.slice(-50),
        })),
        selectedSessionId: state.selectedSessionId,
        nextSessionNumber: state.nextSessionNumber,
        roles: state.roles,
        flows: state.flows,
        appSettings: state.appSettings,
        activeTab: state.activeTab,
        diffHistory: state.diffHistory.slice(-MAX_DIFF_HISTORY).map(d => ({
          ...d,
          before: '',
          after: '',
        })),
        totalPremiumRequests: state.totalPremiumRequests,
        totalApiDuration: state.totalApiDuration,
      }),
    },
  )
)
