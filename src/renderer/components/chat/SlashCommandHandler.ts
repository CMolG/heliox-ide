/**
 * SlashCommandHandler.ts — Renderer Chat Command Module
 *
 * Responsibility:
 * - Defines supported slash-command metadata for chat command discovery/help.
 * - Interprets local slash commands and maps them to store actions and system messages.
 *
 * Boundaries:
 * - Owns: client-side command parsing and local command routing behavior
 * - Does NOT own: OpenCode CLI execution, transport orchestration, or backend command semantics
 *
 * Architectural role:
 * - Renderer chat integration boundary translating text commands into UI/store mutations.
 */
// src/renderer/components/chat/SlashCommandHandler.ts — Slash command definitions and handler
import type { ChatMessage, AppSettings, LogEntry } from '../../../types';

export const SLASH_COMMANDS: { cmd: string; desc: string; local?: boolean }[] = [
  // Heliox local commands
  { cmd: '/model', desc: 'Switch or view models', local: true },
  { cmd: '/effort', desc: 'Set reasoning effort (L/M/H/X)', local: true },
  { cmd: '/clear', desc: 'Clear chat messages', local: true },
  { cmd: '/usage', desc: 'Show session usage stats', local: true },
  { cmd: '/role', desc: 'Switch or view roles', local: true },
  { cmd: '/help', desc: 'Show command reference', local: true },
  // OpenCode passthrough commands
  { cmd: '/compact', desc: 'Compact conversation history' },
  { cmd: '/context', desc: 'Show/manage context' },
  { cmd: '/diff', desc: 'Show current changes' },
  { cmd: '/delegate', desc: 'Delegate to sub-agent' },
  { cmd: '/fleet', desc: 'Multi-agent fleet' },
  { cmd: '/tasks', desc: 'Show running tasks' },
  { cmd: '/init', desc: 'Initialize project' },
  { cmd: '/agent', desc: 'Switch agent' },
  { cmd: '/skills', desc: 'List available skills' },
  { cmd: '/mcp', desc: 'MCP server management' },
  { cmd: '/plugin', desc: 'Plugin management' },
  { cmd: '/plan', desc: 'Create execution plan' },
  { cmd: '/research', desc: 'Research mode' },
  { cmd: '/rewind', desc: 'Rewind to previous state' },
];

export interface SlashCommandActions {
  addSessionMessage: (sessionId: string, msg: ChatMessage) => void;
  setSessionModel: (sessionId: string, model: string) => void;
  updateAppSettings: (settings: Partial<AppSettings>) => void;
  updateSessionMessages: (sessionId: string, msgs: ChatMessage[]) => void;
  addLogEntry: (entry: Omit<LogEntry, 'id'>) => void;
  getState: () => {
    sessions: { id: string; model: string; opencodeSessionId?: string; number: number; tokenUsage?: { premiumRequests?: number; totalApiDurationMs?: number }; roleId?: string }[];
    roles: { id: string; name: string; icon: string }[];
    totalPremiumRequests: number;
    totalApiDuration: number;
    updateSessionRole: (sessionId: string, roleId: string) => void;
  };
  availableModels: string[];
  currentEffort: AppSettings['effort'];
}

export function handleSlashCommand(
  command: string,
  sessionId: string,
  actions: SlashCommandActions,
): boolean {
  const [cmd, ...args] = command.split(' ');
  const arg = args.join(' ').trim();

  switch (cmd.toLowerCase()) {
    case '/model': {
      if (arg) {
        actions.setSessionModel(sessionId, arg);
        actions.addSessionMessage(sessionId, {
          id: `sys-cmd-${Date.now()}`,
          role: 'system',
          content: `Model switched to ${arg}`,
          timestamp: Date.now(),
        });
        actions.addLogEntry({ timestamp: Date.now(), level: 'info', sessionId, message: `Model changed to ${arg}` });
      } else {
        const state = actions.getState();
        const session = state.sessions.find(s => s.id === sessionId);
        actions.addSessionMessage(sessionId, {
          id: `sys-cmd-${Date.now()}`,
          role: 'system',
          content: `Available models: ${actions.availableModels.join(', ')}\n\nCurrent: ${session?.model ?? 'opencode/claude-sonnet-4-6'}\nUsage: /model <name>`,
          timestamp: Date.now(),
        });
      }
      return true;
    }
    case '/effort': {
      const levels = ['low', 'medium', 'high', 'xhigh'] as const;
      const level = levels.find(l => l === arg || l[0] === arg);
      if (level) {
        actions.updateAppSettings({ effort: level });
        actions.addSessionMessage(sessionId, {
          id: `sys-cmd-${Date.now()}`,
          role: 'system',
          content: `Reasoning effort set to ${level}`,
          timestamp: Date.now(),
        });
      } else {
        actions.addSessionMessage(sessionId, {
          id: `sys-cmd-${Date.now()}`,
          role: 'system',
          content: `Current effort: ${actions.currentEffort}\nUsage: /effort <low|medium|high|xhigh>`,
          timestamp: Date.now(),
        });
      }
      return true;
    }
    case '/clear': {
      actions.updateSessionMessages(sessionId, []);
      actions.addLogEntry({ timestamp: Date.now(), level: 'info', sessionId, message: 'Chat cleared' });
      return true;
    }
    case '/usage': {
      const state = actions.getState();
      const session = state.sessions.find(s => s.id === sessionId);
      const usage = session?.tokenUsage;

      const sessionRows = state.sessions
        .filter(s => s.tokenUsage?.premiumRequests)
        .map(s => {
          const u = s.tokenUsage!;
          const cost = ((u.premiumRequests ?? 0) * 0.01).toFixed(2);
          return `│ #${s.number} │ ${s.model.padEnd(12)} │ ${String(u.premiumRequests ?? 0).padStart(4)} req │ ${u.totalApiDurationMs ? (u.totalApiDurationMs / 1000).toFixed(1).padStart(6) + 's' : '   N/A '} │ ~$${cost} │`;
        });

      const totalCost = (state.totalPremiumRequests * 0.01).toFixed(2);

      const lines = [
        '── Current Session ──',
        usage
          ? `• Premium requests: ${usage.premiumRequests ?? 'N/A'}\n• API time: ${usage.totalApiDurationMs ? (usage.totalApiDurationMs / 1000).toFixed(1) + 's' : 'N/A'}\n• Model: ${session?.model ?? 'opencode/claude-sonnet-4-6'}\n• OpenCode session: ${session?.opencodeSessionId ?? 'N/A'}`
          : 'No usage data yet — send a message first.',
        '',
        '── All Sessions ──',
        `Total requests: ${state.totalPremiumRequests} · Total API time: ${(state.totalApiDuration / 1000).toFixed(1)}s · Est. cost: ~$${totalCost}`,
      ];
      if (sessionRows.length > 0) {
        lines.push('', '┌─────┬──────────────┬──────────┬─────────┬────────┐');
        lines.push(...sessionRows);
        lines.push('└─────┴──────────────┴──────────┴─────────┴────────┘');
      }

      actions.addSessionMessage(sessionId, {
        id: `sys-cmd-${Date.now()}`,
        role: 'system',
        content: lines.join('\n'),
        timestamp: Date.now(),
      });
      return true;
    }
    case '/help': {
      actions.addSessionMessage(sessionId, {
        id: `sys-cmd-${Date.now()}`,
        role: 'system',
        content: `Heliox commands:\n• /model [name] — Switch or view models\n• /effort [level] — Set reasoning effort (L/M/H/X)\n• /clear — Clear chat messages\n• /usage — Show session usage stats\n• /role [name] — Switch or view roles\n• /help — Show this help\n\nAll other commands (/compact, /context, /diff, etc.) are passed directly to OpenCode.`,
        timestamp: Date.now(),
      });
      return true;
    }
    case '/role': {
      const state = actions.getState();
      if (arg) {
        const role = state.roles.find(r => r.name.toLowerCase() === arg.toLowerCase());
        if (role) {
          state.updateSessionRole(sessionId, role.id);
          actions.addSessionMessage(sessionId, {
            id: `sys-cmd-${Date.now()}`,
            role: 'system',
            content: `Role switched to ${role.name} (${role.icon})`,
            timestamp: Date.now(),
          });
        } else {
          actions.addSessionMessage(sessionId, {
            id: `sys-cmd-${Date.now()}`,
            role: 'system',
            content: `Role "${arg}" not found. Available: ${state.roles.map(r => r.name).join(', ') || 'none'}`,
            timestamp: Date.now(),
          });
        }
      } else {
        const session = state.sessions.find(s => s.id === sessionId);
        const currentRole = session?.roleId ? state.roles.find(r => r.id === session.roleId) : null;
        actions.addSessionMessage(sessionId, {
          id: `sys-cmd-${Date.now()}`,
          role: 'system',
          content: `Current role: ${currentRole ? `${currentRole.name} (${currentRole.icon})` : 'None'}\nAvailable: ${state.roles.map(r => `${r.icon} ${r.name}`).join(', ') || 'none'}\nUsage: /role <name>`,
          timestamp: Date.now(),
        });
      }
      return true;
    }
    default: {
      const cmdName = cmd.slice(1);
      actions.addSessionMessage(sessionId, {
        id: `sys-passthrough-${Date.now()}`,
        role: 'system',
        content: `Passing /${cmdName} to OpenCode...`,
        timestamp: Date.now(),
      });
      return false;
    }
  }
}
