/**
 * HelpSectionContent.tsx — Renderer Modal Component
 *
 * Responsibility:
 * - Renders the HelpSectionContent surface in the renderer layer.
 * - Encapsulates Modal dialog composition and modal-scoped interactions.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/modals/HelpSectionContent.tsx — Help section content renderer
import React from 'react';
import { theme } from '../../logic/theme';

export type DocSection = 'overview' | 'sessions' | 'flows' | 'roles' | 'pipelines' | 'shortcuts' | 'settings';

const SHORTCUTS = [
  { keys: ['⌘', 'O'], description: 'Open project folder' },
  { keys: ['⌘', 'N'], description: 'Create new session' },
  { keys: ['⌘', 'K'], description: 'Focus chat input' },
  { keys: ['⌘', 'L'], description: 'Toggle logs panel' },
  { keys: ['⌘', 'T'], description: 'Toggle terminal panel' },
  { keys: ['⌘', 'B'], description: 'Toggle sidebar' },
  { keys: ['⌘', '\\'], description: 'Toggle chat panel' },
  { keys: ['⌘', '/'], description: 'Toggle help' },
  { keys: ['⌘', '1-5'], description: 'Switch to session by index' },
  { keys: ['A'], description: 'Approve diff (when reviewing)' },
  { keys: ['R'], description: 'Reject diff (when reviewing)' },
  { keys: ['Esc'], description: 'Close modal / unfocus' },
];

export function SectionContent({ section }: { section: DocSection }) {
  const labelStyle = { fontFamily: theme.fontInter, color: theme.textFaint } as const;
  const bodyStyle = { fontFamily: theme.fontManrope, color: theme.textMuted } as const;
  const headStyle = { fontFamily: theme.fontGrotesk, color: theme.textPrimary } as const;

  switch (section) {
    case 'overview':
      return (
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-bold" style={headStyle}>Welcome to Fluxor IDE</h2>
          <p className="text-sm leading-6" style={bodyStyle}>
            Fluxor is an AI agent workspace built on OpenCode. Pick a provider (Anthropic, OpenAI,
            OpenRouter, Xiaomi MiMo, OpenCode Zen, …), and Fluxor orchestrates agent sessions,
            validates changes against E2E flows, and auto-corrects regressions.
          </p>
          <div className="flex flex-col gap-2 p-4 rounded-xl" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <span className="text-[10px] font-bold uppercase tracking-wider" style={labelStyle}>Quick start</span>
            <ol className="text-sm leading-7 list-decimal list-inside" style={bodyStyle}>
              <li>Open a project folder with <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono" style={{ background: theme.bg, color: theme.textSecondary, border: '1px solid rgba(63,63,70,0.3)' }}>⌘O</kbd></li>
              <li>A session is created automatically</li>
              <li>Type your instruction in the chat panel</li>
              <li>The agent processes your request via the CLI</li>
              <li>Review results and visual diffs</li>
            </ol>
          </div>
          <p className="text-sm leading-6" style={bodyStyle}>
            Project configurations (flows, roles) are stored in the IDE's user data directory,
            separate from your project files. They load automatically when you switch projects.
          </p>
        </div>
      );
    case 'sessions':
      return (
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-bold" style={headStyle}>Agent Sessions</h2>
          <p className="text-sm leading-6" style={bodyStyle}>
            Sessions represent individual conversations with AI agents. Each session tracks messages,
            status, model info, and timing.
          </p>
          <div className="flex flex-col gap-2 p-4 rounded-xl" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <span className="text-[10px] font-bold uppercase tracking-wider" style={labelStyle}>Session states</span>
            <div className="flex flex-col gap-1.5 text-sm" style={bodyStyle}>
              <span><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: theme.success }} /> <strong className="text-stone-300">Running</strong> — Agent is processing your instruction</span>
              <span><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: '#facc15' }} /> <strong className="text-neutral-400">Waiting</strong> — Ready for input</span>
              <span><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: theme.textMuted }} /> <strong className="text-zinc-400">Finished</strong> — Task completed</span>
              <span><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: theme.danger }} /> <strong className="text-red-400">Stopped</strong> — Cancelled or errored</span>
            </div>
          </div>
          <p className="text-sm leading-6" style={bodyStyle}>
            Sessions auto-create when you open a project or type your first message. The description
            is auto-filled from the first chat message. Use the + button or ⌘N to create additional sessions.
          </p>
        </div>
      );
    case 'flows':
      return (
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-bold" style={headStyle}>E2E Flows</h2>
          <p className="text-sm leading-6" style={bodyStyle}>
            E2E Flows define user journeys to validate with Playwright snapshots. After an agent
            makes changes, Fluxor runs your flows and compares screenshots against baselines.
          </p>
          <div className="flex flex-col gap-2 p-4 rounded-xl" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <span className="text-[10px] font-bold uppercase tracking-wider" style={labelStyle}>Flow actions</span>
            <div className="flex flex-col gap-1.5 text-sm" style={bodyStyle}>
              <span><strong className="text-stone-300">navigate</strong> — Go to a URL</span>
              <span><strong className="text-stone-300">click</strong> — Click an element</span>
              <span><strong className="text-stone-300">fill</strong> — Type into an input</span>
              <span><strong className="text-stone-300">snapshot</strong> — Capture screenshot</span>
              <span><strong className="text-stone-300">wait</strong> — Wait for an element</span>
            </div>
          </div>
          <p className="text-sm leading-6" style={bodyStyle}>
            If no flows are defined for your project, use "Auto-discover flows" to generate them
            automatically by analyzing your project structure.
          </p>
        </div>
      );
    case 'roles':
      return (
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-bold" style={headStyle}>Agent Roles</h2>
          <p className="text-sm leading-6" style={bodyStyle}>
            Roles define how the agent behaves. Each role has a system prompt, temperature setting,
            and token limit. Assign roles to sessions for specialized behavior.
          </p>
          <div className="flex flex-col gap-2 p-4 rounded-xl" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <span className="text-[10px] font-bold uppercase tracking-wider" style={labelStyle}>Default roles</span>
            <div className="flex flex-col gap-1.5 text-sm" style={bodyStyle}>
              <span><strong className="text-stone-300">UI Engineer</strong> — Frontend, components, styles</span>
              <span><strong className="text-stone-300">Backend Engineer</strong> — APIs, databases, infra</span>
              <span><strong className="text-stone-300">Code Reviewer</strong> — Bugs, security, best practices</span>
              <span><strong className="text-stone-300">Test Engineer</strong> — Unit, integration, E2E tests</span>
            </div>
          </div>
          <p className="text-sm leading-6" style={bodyStyle}>
            Create custom roles for your workflow — documentation writer, DevOps engineer,
            accessibility auditor, or anything else.
          </p>
        </div>
      );
    case 'pipelines':
      return (
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-bold" style={headStyle}>Glosario de Pipelines</h2>
          <p className="text-sm leading-6" style={bodyStyle}>
            El editor de pipelines del canvas usa un vocabulario específico. Esta sección explica
            cada concepto para que puedas diseñar y depurar flujos de agente con confianza.
          </p>
          <div className="flex flex-col gap-2 p-4 rounded-xl" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <span className="text-[10px] font-bold uppercase tracking-wider" style={labelStyle}>Elementos del canvas</span>
            <div className="flex flex-col gap-2 text-sm" style={bodyStyle}>
              <span>
                <strong className="text-stone-300">Flow (Pipeline)</strong> — Grafo dirigido de Steps que el agente ejecuta de principio a fin.
                Visualmente es el frame que agrupa y delimita todos los pasos del proceso.
              </span>
              <span>
                <strong className="text-stone-300">Step</strong> — Unidad de trabajo dentro de un flow. Existen tres tipos:
                <span className="block mt-1 ml-3">
                  · <strong className="text-stone-400">LLM Call</strong> — Realiza una llamada al modelo de lenguaje.
                </span>
                <span className="block ml-3">
                  · <strong className="text-stone-400">Tool Call</strong> — Ejecuta herramientas o servidores MCP.
                </span>
                <span className="block ml-3">
                  · <strong className="text-stone-400">Router</strong> — Bifurca el flujo según una decisión condicional.
                </span>
              </span>
              <span>
                <strong className="text-stone-300">Role</strong> — Persona o system prompt que adopta el agente en ese step.
                Determina el tono, las restricciones y el foco del modelo.
              </span>
              <span>
                <strong className="text-stone-300">Mod</strong> — Modificador de comportamiento aplicado al step.
                Puede ser un pre/post-procesador, un override de sistema o un proveedor de tools adicionales.
              </span>
              <span>
                <strong className="text-stone-300">Tool</strong> — Capacidad concreta (función o endpoint MCP) que el step
                puede invocar durante su ejecución.
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-2 p-4 rounded-xl" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <span className="text-[10px] font-bold uppercase tracking-wider" style={labelStyle}>Conexiones y estados</span>
            <div className="flex flex-col gap-1.5 text-sm" style={bodyStyle}>
              <span>
                <strong className="text-stone-300">Conexiones (flechas)</strong> — Indican el orden de ejecución entre steps.
                Se animan con un flujo pulsante cuando el step de origen está en curso.
              </span>
              <span><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: theme.textFaint }} /> <strong className="text-zinc-400">Idle</strong> — El step no ha sido ejecutado aún.</span>
              <span><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: theme.success }} /> <strong className="text-stone-300">Running</strong> — Ejecutándose; el borde del nodo oscila.</span>
              <span><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: '#60a5fa' }} /> <strong className="text-blue-300">Completed</strong> — Finalizado con éxito.</span>
              <span><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: theme.danger }} /> <strong className="text-red-400">Error</strong> — El step falló; revisa los logs del nodo.</span>
            </div>
          </div>
        </div>
      );
    case 'shortcuts':
      return (
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-bold" style={headStyle}>Keyboard Shortcuts</h2>
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(63,63,70,0.3)' }}>
                <th className="text-left py-2 px-3" scope="col">
                  <span className="text-neutral-500 text-[10px] font-bold uppercase tracking-wide" style={{ fontFamily: theme.fontInter }}>Shortcut</span>
                </th>
                <th className="text-left py-2 px-3" scope="col">
                  <span className="text-neutral-500 text-[10px] font-bold uppercase tracking-wide" style={{ fontFamily: theme.fontInter }}>Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {SHORTCUTS.map((s, i) => (
                <tr key={i} style={{ borderBottom: '1px solid rgba(63,63,70,0.25)' }}>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-1">
                      {s.keys.map((key, j) => (
                        <React.Fragment key={j}>
                          {j > 0 && <span className="text-[10px]" style={{ color: theme.textGhost }}>+</span>}
                          <kbd className="bg-zinc-800 px-2 py-1 rounded text-xs font-mono text-stone-300 inline-block">
                            {key}
                          </kbd>
                        </React.Fragment>
                      ))}
                    </div>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="text-zinc-300 text-sm" style={{ fontFamily: theme.fontManrope }}>{s.description}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-col gap-2 p-4 rounded-xl mt-2" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <span className="text-[10px] font-bold uppercase tracking-wider" style={labelStyle}>Chat input</span>
            <div className="flex flex-col gap-1.5 text-sm" style={bodyStyle}>
              <span>Enter sends a message only when "Send on Enter" is checked (below the textarea).</span>
              <span>Otherwise, use the send button or Shift+Enter for new lines.</span>
            </div>
          </div>
        </div>
      );
    case 'settings':
      return (
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-bold" style={headStyle}>Settings</h2>
          <p className="text-sm leading-6" style={bodyStyle}>
            Configure the IDE via the settings modal (gear icon in the sidebar or top bar).
          </p>
          <div className="flex flex-col gap-3">
            {[
              { title: 'Providers', desc: 'Pick a provider (Anthropic, OpenAI, OpenRouter, Xiaomi MiMo, …) and paste its API key — Fluxor routes everything through OpenCode.' },
              { title: 'Auto-commit', desc: 'When enabled, automatically commits changes after a successful agent run.' },
              { title: 'E2E Validation', desc: 'When enabled, runs E2E flows after each agent execution to catch regressions.' },
              { title: 'Send on Enter', desc: 'Toggle whether pressing Enter sends the message or inserts a newline.' },
            ].map((item, i) => (
              <div key={i} className="p-3 rounded-xl" style={{ background: 'rgba(0,0,0,0.3)' }}>
                <span className="text-xs font-medium block mb-1" style={{ ...headStyle, fontSize: '13px' }}>{item.title}</span>
                <span className="text-[11px] leading-4" style={bodyStyle}>{item.desc}</span>
              </div>
            ))}
          </div>
        </div>
      );
  }
}
