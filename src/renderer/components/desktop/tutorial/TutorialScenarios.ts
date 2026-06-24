/**
 * TutorialScenarios.ts — Content registry for all tutorial scenarios.
 *
 * Each scenario defines the steps, labels, colors, tags, and icon that the
 * TutorialEngine renders inside the brutalist card overlay.
 */
import type { TutorialScenario } from '@/types/tutorial';

// ─── Comic palette (from the provided brutalist concept) ────────
const YELLOW = '#FFEA00';
const PINK = '#FF007F';
const CYAN = '#00FFFF';

// ─── Workspace (original Quick Tour) ────────────────────────────

const workspace: TutorialScenario = {
  id: 'workspace',
  label: 'Workspace',
  category: 'workspace',
  accentColor: CYAN,
  subtitle: 'Your infinite desktop IDE canvas, apps, and dock.',
  iconName: 'Columns2',
  tags: ['Dock', 'Canvas', 'Settings'],
  steps: [
    {
      target: '[data-testid="dock"]',
      title: 'Application Dock',
      description: 'Your command center. Launch apps, access the marketplace, and manage attachables from the dock.',
      position: 'top',
    },
    {
      target: '[data-testid="dock-new-chat"]',
      title: 'New Chat',
      description: 'Start a new agentic AI chat session scoped to your project. Each session gets its own window.',
      position: 'top',
    },
    {
      target: '[data-testid="dock-file-explorer"]',
      title: 'File Explorer',
      description: 'Browse your project files with syntax highlighting, tabbed editing, and drag-out support.',
      position: 'top',
    },
    {
      target: '[data-testid="dock-backlog"]',
      title: 'Backlog Board',
      description: 'A built-in Kanban board. Manage tasks across Backlog, In Progress, Done, and Failed columns.',
      position: 'top',
    },
    {
      target: '[data-testid="dock-marketplace"]',
      title: 'Marketplace',
      description: 'Browse and deploy Roles, Mods, and Flows to customize your AI agent sessions.',
      position: 'top',
    },
    {
      target: '[data-testid="desktop-canvas-bg"]',
      title: 'Desktop Canvas',
      description: 'Your infinite workspace. Pan with middle-click, zoom with Ctrl+scroll. Click anywhere to see the wave animation!',
      position: 'top',
      highlightViewport: true,
    },
    {
      target: '[data-testid="dock-settings"]',
      title: 'Settings',
      description: 'Configure your IDE preferences — CLI adapter, canvas animations, and more.',
      position: 'top',
    },
    {
      target: '[data-testid="attachables-dock"]',
      title: 'Attachables Dock',
      description: 'Deployed marketplace items appear here. Drag them onto the canvas, or click to spawn. Scroll infinitely with the arrows.',
      position: 'top',
    },
  ],
};

// ─── Roles ──────────────────────────────────────────────────────

const roles: TutorialScenario = {
  id: 'roles',
  label: 'Roles',
  category: 'market',
  accentColor: '#E87040',
  subtitle: 'System-level personas that define how your AI agent thinks and behaves.',
  iconName: 'ShieldCheck',
  tags: ['System Prompt', 'Persona', 'Agent'],
  steps: [
    {
      target: '[data-testid="dock-marketplace"]',
      title: 'Find Roles',
      description: 'Open the Marketplace to browse available Roles. Each Role injects a system prompt that shapes agent behavior.',
      position: 'top',
    },
    {
      target: '[data-testid="attachables-dock"]',
      title: 'Deployed Roles',
      description: 'After deploying a Role from the Marketplace, it appears in the attachable dock. Drag it onto the canvas.',
      position: 'top',
    },
    {
      target: '[data-testid="desktop-canvas-bg"]',
      title: 'Attach to Windows',
      description: 'Drag a Role card near a chat window to bind it. The agent will adopt that persona for the entire session.',
      position: 'top',
      highlightViewport: true,
    },
  ],
};

// ─── Mods ───────────────────────────────────────────────────────

const mods: TutorialScenario = {
  id: 'mods',
  label: 'Mods',
  category: 'market',
  accentColor: '#4285F4',
  subtitle: 'Behavioral modifiers that stack on top of Roles to fine-tune agent output.',
  iconName: 'Blocks',
  tags: ['Modifier', 'Stackable', 'Prompt'],
  steps: [
    {
      target: '[data-testid="dock-marketplace"]',
      title: 'Browse Mods',
      description: 'Open the Marketplace and switch to the Modifiers tab. Mods add prompt prefixes/suffixes that alter behavior.',
      position: 'top',
    },
    {
      target: '[data-testid="attachables-dock"]',
      title: 'Deployed Mods',
      description: 'Deployed Mods appear in the attachable dock alongside Roles and Flows. Multiple Mods can stack.',
      position: 'top',
    },
    {
      target: '[data-testid="desktop-canvas-bg"]',
      title: 'Stack on Windows',
      description: 'Drag Mods near a chat window to attach them. They stack — combine brevity, humor, and domain expertise.',
      position: 'top',
      highlightViewport: true,
    },
  ],
};

// ─── Flows ──────────────────────────────────────────────────────

const flows: TutorialScenario = {
  id: 'flows',
  label: 'Flows',
  category: 'market',
  accentColor: '#A78BFA',
  subtitle: 'Multi-step automated workflows that chain agent actions into pipelines.',
  iconName: 'GitBranch',
  tags: ['Pipeline', 'Automation', 'Steps'],
  steps: [
    {
      target: '[data-testid="dock-marketplace"]',
      title: 'Discover Flows',
      description: 'Flows are agentic pipelines — multi-step automated sequences your AI agent follows.',
      position: 'top',
    },
    {
      target: '[data-testid="attachables-dock"]',
      title: 'Deployed Flows',
      description: 'Deployed Flows appear in the attachable dock. Each Flow defines an ordered sequence of steps.',
      position: 'top',
    },
    {
      target: '[data-testid="desktop-canvas-bg"]',
      title: 'Attach to Sessions',
      description: 'Drag a Flow near a chat window to activate it. The agent will execute each step in sequence.',
      position: 'top',
      highlightViewport: true,
    },
  ],
};

// ─── Chat App ───────────────────────────────────────────────────

const chat: TutorialScenario = {
  id: 'chat',
  label: 'Chat',
  category: 'apps',
  accentColor: CYAN,
  subtitle: 'Agentic AI chat sessions with full project context and tool use.',
  iconName: 'MessageSquare',
  tags: ['Agent', 'Session', 'Terminal'],
  steps: [
    {
      target: '[data-testid="dock-new-chat"]',
      title: 'Launch a Chat',
      description: 'Click to create a new agentic chat window. Each chat is an isolated AI session with its own context.',
      position: 'top',
    },
    {
      target: '[data-testid="desktop-canvas-bg"]',
      title: 'Chat Windows',
      description: 'Chat windows live on the canvas. Resize, move, and arrange them freely. Each has its own agent session.',
      position: 'top',
      highlightViewport: true,
    },
  ],
};

// ─── File Explorer ──────────────────────────────────────────────

const fileExplorer: TutorialScenario = {
  id: 'file-explorer',
  label: 'File Explorer',
  category: 'apps',
  accentColor: YELLOW,
  subtitle: 'Browse, view, and edit your project files with syntax highlighting.',
  iconName: 'FolderOpen',
  tags: ['Files', 'Tabs', 'Tree'],
  steps: [
    {
      target: '[data-testid="dock-file-explorer"]',
      title: 'Open File Explorer',
      description: 'Click to open a File Explorer window. Browse your project tree with syntax-highlighted previews.',
      position: 'top',
    },
    {
      target: '[data-testid="desktop-canvas-bg"]',
      title: 'File Windows',
      description: 'Navigate the file tree, open tabs, and drag files onto the canvas. Supports all common file types.',
      position: 'top',
      highlightViewport: true,
    },
  ],
};

// ─── Backlog Board ──────────────────────────────────────────────

const backlog: TutorialScenario = {
  id: 'backlog',
  label: 'Backlog Board',
  category: 'apps',
  accentColor: PINK,
  subtitle: 'A Kanban board for managing agent tasks and project workflow.',
  iconName: 'KanbanSquare',
  tags: ['Kanban', 'Tasks', 'Drag & Drop'],
  steps: [
    {
      target: '[data-testid="dock-backlog"]',
      title: 'Open Backlog',
      description: 'Click to open the Backlog Board. Manage tasks across Backlog, In Progress, Done, and Failed columns.',
      position: 'top',
    },
    {
      target: '[data-testid="desktop-canvas-bg"]',
      title: 'Kanban Board',
      description: 'Drag cards between columns to track progress. AI agents can auto-create and move tasks.',
      position: 'top',
      highlightViewport: true,
    },
  ],
};

// ─── Marketplace ────────────────────────────────────────────────

const marketplace: TutorialScenario = {
  id: 'marketplace',
  label: 'Marketplace',
  category: 'apps',
  accentColor: YELLOW,
  subtitle: 'Browse and deploy Roles, Mods, and Flows.',
  iconName: 'Store',
  tags: ['Deploy', 'Browse', 'Customize'],
  steps: [
    {
      target: '[data-testid="dock-marketplace"]',
      title: 'Open Marketplace',
      description: 'Click to open the Marketplace overlay. Browse curated Roles, Mods, and Flows.',
      position: 'top',
    },
    {
      target: '[data-testid="desktop-canvas-bg"]',
      title: 'Deploy Items',
      description: 'Click any item to deploy it. Deployed items appear in the attachable dock for drag-and-drop use.',
      position: 'top',
      highlightViewport: true,
    },
  ],
};


// ─── Diff Viewer ────────────────────────────────────────────────

const diffViewer: TutorialScenario = {
  id: 'diff-viewer',
  label: 'Diff Viewer',
  category: 'apps',
  accentColor: PINK,
  subtitle: 'Side-by-side code diffs for reviewing agent changes.',
  iconName: 'GitCompareArrows',
  tags: ['Diff', 'Review', 'Changes'],
  steps: [
    {
      target: '[data-testid="desktop-canvas-bg"]',
      title: 'Diff Windows',
      description: 'Diff Viewer windows appear when agents propose code changes. Review additions and deletions side-by-side.',
      position: 'top',
      highlightViewport: true,
    },
  ],
};

// ─── File Viewer ────────────────────────────────────────────────

const fileViewer: TutorialScenario = {
  id: 'file-viewer',
  label: 'File Viewer',
  category: 'apps',
  accentColor: CYAN,
  subtitle: 'Read-only file preview with syntax highlighting.',
  iconName: 'Eye',
  tags: ['Preview', 'Read-only', 'Syntax'],
  steps: [
    {
      target: '[data-testid="desktop-canvas-bg"]',
      title: 'File Preview',
      description: 'File Viewer windows display read-only file contents with full syntax highlighting. Opened from File Explorer or agent actions.',
      position: 'top',
      highlightViewport: true,
    },
  ],
};

// ─── Registry ───────────────────────────────────────────────────

export const TUTORIAL_SCENARIOS: Record<string, TutorialScenario> = {
  workspace,
  roles,
  mods,
  flows,
  chat,
  'file-explorer': fileExplorer,
  backlog,
  marketplace,
  'diff-viewer': diffViewer,
  'file-viewer': fileViewer,
};

/** Get a scenario by ID, or undefined if not found */
export function getTutorialScenario(id: string): TutorialScenario | undefined {
  return TUTORIAL_SCENARIOS[id];
}
