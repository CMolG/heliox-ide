/**
 * FlowsEditor.tsx — Renderer Composite Component
 *
 * Responsibility:
 * - Renders the FlowsEditor surface in the renderer layer.
 * - Encapsulates Feature-level composition used by the renderer shell and panels.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/FlowsEditor.tsx — E2E Flow management panel
import React, { useState, useCallback, useRef } from 'react';
import { useFluxorStore } from '../store';
import type { FlowStep } from '@/types';
import { FiCompass, FiAlertTriangle } from 'react-icons/fi';
import { theme } from '../logic/theme';
import { FluxorDropdown } from './ui/FluxorDropdown';
import { useAutoSave } from '@/renderer/logic/hooks/useAutoSave';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const STEP_ACTIONS: FlowStep['action'][] = ['navigate', 'click', 'type', 'screenshot', 'wait', 'scroll'];
const ACTIONS_REQUIRING_TARGET = new Set<FlowStep['action']>(['navigate', 'click', 'type']);

function isStepValid(step: FlowStep): boolean {
  return !(ACTIONS_REQUIRING_TARGET.has(step.action) && !step.target?.trim());
}

const ACTION_COLORS: Record<FlowStep['action'], string> = {
  navigate: '#60a5fa',
  click: '#f59e0b',
  type: '#a78bfa',
  screenshot: '#22d3ee',
  wait: theme.textDim,
  scroll: '#4ade80',
};

function SortableStepItem({ step, index, onRemove }: { step: FlowStep; index: number; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    background: 'rgba(0,0,0,0.3)',
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className="flex items-center gap-3 px-3 py-2 rounded-lg group cursor-grab active:cursor-grabbing transition-all"
    >
      <span className="text-[10px] font-mono w-4 text-right" style={{ color: theme.textFaint }}>{index + 1}</span>
      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
        style={{ background: `${ACTION_COLORS[step.action]}15`, color: ACTION_COLORS[step.action] }}
      >{step.action}</span>
      <span className="text-xs flex-1 truncate" style={{ fontFamily: theme.fontManrope, color: theme.textMuted }}>{step.name}</span>
      {step.target && (
        <span className="text-[10px] font-mono truncate max-w-40" style={{ color: theme.textFaint }}>{step.target}</span>
      )}
      {!isStepValid(step) && <FiAlertTriangle size={10} color="#ff9800" />}
      <button onClick={onRemove} aria-label={`Remove step: ${step.name}`}
        className="opacity-0 group-hover:opacity-100 text-neutral-600 hover:text-red-400 transition"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}

export function FlowsEditor() {
  const {
    flows, selectedFlowId, setSelectedFlowId,
    addFlow, removeFlow, renameFlow, duplicateFlow,
    addStep, removeStep, reorderSteps, updateFlowBaseUrl,
    saveFlowsToProject, projectPath, addToast, addLogEntry,
    appSettings,
  } = useFluxorStore();

  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('http://localhost:3000');
  const [isAddingStep, setIsAddingStep] = useState(false);
  const [stepAction, setStepAction] = useState<FlowStep['action']>('navigate');
  const [stepName, setStepName] = useState('');
  const [stepTarget, setStepTarget] = useState('');
  const [stepValue, setStepValue] = useState('');
  const [editingFlowName, setEditingFlowName] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState('');
  const [isAutoDiscovering, setIsAutoDiscovering] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showFlowCostConfirm, setShowFlowCostConfirm] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // @dnd-kit sensors for step reordering
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleStepDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !selectedFlowId) return;
    const selectedFlow = flows.find(f => f.id === selectedFlowId);
    if (!selectedFlow) return;
    const oldIndex = selectedFlow.steps.findIndex(s => s.id === active.id);
    const newIndex = selectedFlow.steps.findIndex(s => s.id === over.id);
    if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
      reorderSteps(selectedFlowId, oldIndex, newIndex);
    }
  }, [selectedFlowId, flows, reorderSteps]);

  const handleDeleteFlow = useCallback((flowId: string) => {
    if (confirmDeleteId === flowId) {
      removeFlow(flowId);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(flowId);
      setTimeout(() => setConfirmDeleteId((cur) => cur === flowId ? null : cur), 3000);
    }
  }, [confirmDeleteId, removeFlow]);

  const handleAutoDiscover = useCallback(async () => {
    if (!projectPath || !window.fluxorAPI || isAutoDiscovering) return;
    setIsAutoDiscovering(true);
    addToast('Analyzing project structure for E2E flows…', 'info');
    addLogEntry({ timestamp: Date.now(), level: 'info', message: 'Auto-discovering E2E flows…' });

    const agentId = `flow-discover-${Date.now()}`;
    let accumulated = '';

    // Listen for streaming messages from this specific agent
    const unsubscribe = window.fluxorAPI.onAgentEvent((event) => {
      if (event.agentId !== agentId) return;

      if (event.type === 'message-delta' && event.content) {
        accumulated += event.content;
      } else if (event.type === 'message' && event.content) {
        accumulated = event.content;
      } else if (event.type === 'result' || event.type === 'diffs-ready') {
        // Agent finished — parse accumulated content for JSON flows
        unsubscribe();
        try {
          // Extract JSON array from the response (may be wrapped in markdown)
          const jsonMatch = accumulated.match(/\[[\s\S]*\]/);
          if (!jsonMatch) throw new Error('No JSON array found in response');
          const parsed = JSON.parse(jsonMatch[0]) as Array<{
            name: string;
            baseUrl: string;
            steps: Array<{ action: string; name: string; target?: string; value?: string }>;
          }>;
          if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Empty or invalid array');

          let added = 0;
          for (const raw of parsed) {
            if (!raw.name || !raw.baseUrl) continue;
            const flowId = `flow-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
            const steps: FlowStep[] = (raw.steps ?? []).map((step, i) => {
              const action = (['navigate', 'click', 'type', 'screenshot', 'wait', 'scroll'] as const)
                .find(a => a === step.action) ?? 'navigate';
              return {
                id: `step-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
                name: step.name || `${action} step`,
                action,
                target: step.target,
                value: step.value,
              };
            });
            addFlow({ id: flowId, name: raw.name, baseUrl: raw.baseUrl, steps, diffHistory: [] });
            added++;
          }
          addToast(`Discovered ${added} flow${added !== 1 ? 's' : ''}`, 'success');
          addLogEntry({ timestamp: Date.now(), level: 'info', message: `Auto-discovered ${added} E2E flows` });
        } catch (parseErr) {
          const msg = parseErr instanceof Error ? parseErr.message : 'Parse error';
          addToast(`Could not parse flows: ${msg}`, 'error');
          addLogEntry({ timestamp: Date.now(), level: 'error', message: `Flow parse error: ${msg}` });
        }
        setIsAutoDiscovering(false);
      }
    });

    // TODO: Future enhancement — use @vercel-labs/agent-browser to navigate the running app
    // and discover flows by observing real user interactions, rather than reading code.
    // This will be integrated via the Electron skill for browser automation within the IDE.

    try {
      const prompt = `You are analyzing a project to discover its main user/API flows for E2E testing.

First, determine the project type:
1. FRONTEND (has React, Vue, Angular, Svelte, Next.js, etc.) — focus on user-visible flows: page navigation, form submissions, authentication, key interactions
2. BACKEND API (has Express, Fastify, NestJS, Django, Flask, Spring, etc. but no frontend) — enumerate ALL API endpoints with their HTTP methods and describe what they do
3. OTHER (CLI tool, library, etc.) — understand the project's main objective and create logical validation flows

Analyze the project structure, read key files (package.json, main entry points, route definitions, page components), and generate flows.

Return ONLY a JSON array with this exact structure:
[{"name":"Flow Name","baseUrl":"http://localhost:3000","steps":[{"action":"navigate","name":"Step Name","target":"/path"}]}]

Valid step actions: navigate, click, type, screenshot, wait, scroll.
Each step needs: action, name, target (CSS selector or URL path). Type steps also need a "value" field.
Generate 3-8 flows covering the main functionality. Return ONLY the JSON array.`;

      const result = await window.fluxorAPI.runAgent({
        agentId: agentId,
        instruction: prompt,
        flows: [],
        cwd: projectPath,
        contextProjectPath: projectPath,
        model: 'claude-sonnet-4.6',
        effort: 'high',
        aiAdapter: appSettings.aiAdapter,
      });

      if (!result.success) {
        unsubscribe();
        addToast('Could not auto-discover flows: ' + (result.error ?? 'Unknown error'), 'error');
        setIsAutoDiscovering(false);
      }
    } catch (err) {
      unsubscribe();
      addToast('Flow discovery failed', 'error');
      setIsAutoDiscovering(false);
    }
  }, [projectPath, isAutoDiscovering, addToast, addLogEntry, addFlow]);

  // Auto-save flows to project config when flows change
  useAutoSave([flows, saveFlowsToProject], saveFlowsToProject);

  const selectedFlow = flows.find(f => f.id === selectedFlowId);
  const totalSteps = flows.reduce((acc, f) => acc + f.steps.length, 0);
  const invalidSteps = flows.reduce((acc, f) => acc + f.steps.filter(s => !isStepValid(s)).length, 0);

  const handleCreateFlow = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    const flow = {
      id: `flow-${Date.now()}`,
      name,
      baseUrl: newUrl.trim() || 'http://localhost:3000',
      steps: [],
    };
    addFlow(flow);
    setSelectedFlowId(flow.id);
    setIsCreating(false);
    setNewName('');
    setNewUrl('http://localhost:3000');
  }, [newName, newUrl, addFlow, setSelectedFlowId]);

  const handleAddStep = useCallback(() => {
    if (!selectedFlow || !stepName.trim()) return;
    addStep(selectedFlow.id, {
      id: `step-${Date.now()}`,
      name: stepName.trim(),
      action: stepAction,
      target: stepTarget.trim() || undefined,
      value: stepValue.trim() || undefined,
    });
    setStepName('');
    setStepTarget('');
    setStepValue('');
    setIsAddingStep(false);
  }, [selectedFlow, stepName, stepAction, stepTarget, stepValue, addStep]);

  const handleExport = useCallback(() => {
    const data = JSON.stringify(flows, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fluxor-flows.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [flows]);

  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const imported = JSON.parse(text);
        if (!Array.isArray(imported)) {
          addToast('Invalid flow file: expected an array', 'error');
          return;
        }
        let count = 0;
        for (const flow of imported) {
          if (flow.id && flow.name && Array.isArray(flow.steps)) {
            addFlow({ ...flow, id: `flow-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
            count++;
          }
        }
        addToast(`Imported ${count} flow(s)`, 'success');
      } catch {
        addToast('Invalid JSON in flow file', 'error');
      }
    };
    input.click();
  }, [addFlow, addToast]);

  return (
    <div className="flex flex-col overflow-hidden h-full" style={{ background: theme.bgApp }}>
      {/* Header */}
      <div
        className="h-16 px-8 flex items-center justify-between shrink-0"
        style={{ borderBottom: `1px solid ${theme.border}` }}
      >
        <span
          className="text-sm font-medium leading-5"
          style={{ fontFamily: theme.fontGrotesk, color: theme.textSecondary }}
        >
          E2E FLOWS
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleImport}
            className="px-3 py-1.5 rounded-full text-[10px] font-semibold uppercase tracking-wider transition hover:bg-white/5"
            style={{ fontFamily: theme.fontInter, color: theme.textDim }}
          >
            Import
          </button>
          {flows.length > 0 && (
            <button
              onClick={handleExport}
              className="px-3 py-1.5 rounded-full text-[10px] font-semibold uppercase tracking-wider transition hover:bg-white/5"
              style={{ fontFamily: theme.fontInter, color: theme.textDim }}
            >
              Export
            </button>
          )}
          <button
            onClick={() => { setIsCreating(true); setTimeout(() => nameRef.current?.focus(), 50); }}
            className="px-4 py-1.5 rounded-full text-[10px] font-semibold uppercase tracking-wider transition"
            style={{
              fontFamily: theme.fontInter,
              background: 'linear-gradient(180deg, rgba(229,231,235,0.2) 0%, rgba(161,161,170,0.2) 100%)',
              color: theme.textSecondary,
              boxShadow: 'inset 0px 1px 4px 0px rgba(255,255,255,0.25)',
            }}
          >
            + New Flow
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Create form */}
        {isCreating && (
          <div
            className="p-5 rounded-3xl mb-6 flex flex-col gap-3"
            style={{ background: theme.surfaceMid, outline: `1px solid ${theme.borderLight}`, outlineOffset: '-1px' }}
          >
            <span className="text-xs font-medium" style={{ fontFamily: theme.fontGrotesk, color: theme.textPrimary }}>
              New E2E Flow
            </span>
            <input
              ref={nameRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFlow(); if (e.key === 'Escape') setIsCreating(false); }}
              placeholder="Flow name (e.g. Login Flow)"
              className="w-full bg-black text-sm rounded-lg px-4 py-2.5 outline-none"
              style={{ fontFamily: theme.fontManrope, color: theme.textPrimary, border: `1px solid ${theme.borderMedium}` }}
            />
            <input
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFlow(); if (e.key === 'Escape') setIsCreating(false); }}
              placeholder="Base URL"
              className="w-full bg-black text-xs rounded-lg px-4 py-2.5 outline-none"
              style={{ fontFamily: theme.fontMono, color: theme.textMuted, border: `1px solid ${theme.borderMedium}` }}
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreateFlow}
                disabled={!newName.trim()}
                className="flex-1 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition disabled:opacity-30"
                style={{
                  fontFamily: theme.fontGrotesk,
                  background: 'linear-gradient(180deg, rgba(229,231,235,0.2) 0%, rgba(161,161,170,0.2) 100%)',
                  color: theme.textMid,
                  boxShadow: 'inset 0px 1px 4px 0px rgba(255,255,255,0.25)',
                }}
              >
                Create
              </button>
              <button
                onClick={() => setIsCreating(false)}
                className="px-4 py-2 rounded-full text-xs text-neutral-500 hover:text-neutral-300 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {flows.length === 0 && !isCreating && (
          <div className="flex-1 flex items-center justify-center py-20">
            <div className="text-center">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="mx-auto mb-4">
                <circle cx="12" cy="12" r="4" stroke="#3f3f46" strokeWidth="2"/>
                <circle cx="36" cy="24" r="4" stroke="#3f3f46" strokeWidth="2"/>
                <circle cx="12" cy="36" r="4" stroke="#3f3f46" strokeWidth="2"/>
                <path d="M16 13l16 9M16 35l16-9" stroke="#3f3f46" strokeWidth="2"/>
              </svg>
              <span className="text-lg font-light" style={{ fontFamily: theme.fontGrotesk, color: theme.textGhost }}>
                No E2E flows defined
              </span>
              <p className="text-sm mt-2 mb-4" style={{ fontFamily: theme.fontManrope, color: theme.textFaint }}>
                Create a flow manually or auto-discover from your project
              </p>
              {showFlowCostConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
                  <div className="rounded-2xl p-6 max-w-sm w-full flex flex-col gap-4" style={{ background: theme.surfaceCard, border: `1px solid ${theme.borderMedium}` }}>
                    <span className="text-sm font-medium" style={{ fontFamily: theme.fontGrotesk, color: theme.textPrimary }}>
                      Initialize Flow Analysis
                    </span>
                    <span className="text-xs" style={{ fontFamily: theme.fontManrope, color: theme.textMuted }}>
                      Flow analysis uses AI to understand your project structure and generate E2E test flows. This costs <strong style={{ color: theme.textSecondary }}>1x premium request</strong> using claude-sonnet-4.6 (high effort).
                    </span>
                    <div className="flex items-center gap-2 justify-end pt-2">
                      <button
                        onClick={() => setShowFlowCostConfirm(false)}
                        className="px-4 py-1.5 rounded-lg text-xs font-medium transition hover:bg-white/5"
                        style={{ fontFamily: theme.fontInter, color: theme.textDim, border: `1px solid ${theme.borderMedium}` }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => { setShowFlowCostConfirm(false); handleAutoDiscover(); }}
                        className="px-4 py-1.5 rounded-lg text-xs font-medium transition hover:brightness-110"
                        style={{ fontFamily: theme.fontInter, color: theme.bgApp, background: 'linear-gradient(180deg, #ffffff 0%, #e0e0e0 100%)' }}
                      >
                        Confirm (1x request)
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <button
                onClick={() => setShowFlowCostConfirm(true)}
                disabled={isAutoDiscovering || !projectPath}
                className="px-4 py-2 rounded-full text-xs font-medium uppercase tracking-wider transition disabled:opacity-40"
                style={{
                  fontFamily: theme.fontGrotesk,
                  background: 'rgba(214,211,209,0.08)',
                  color: theme.textMid,
                  border: '1px solid rgba(214,211,209,0.15)',
                }}
              >
                {isAutoDiscovering ? 'Analyzing project…' : <><FiCompass size={12} className="inline mr-1" /> Auto-discover flows</>}
              </button>
            </div>
          </div>
        )}

        {flows.length > 0 && (
          <div className="flex flex-col gap-6">
            {/* Flow cards */}
            <div className="grid grid-cols-2 gap-3">
              {flows.map(flow => {
                const isSelected = selectedFlowId === flow.id;
                const warnings = flow.steps.filter(s => !isStepValid(s)).length;
                return (
                  <button
                    key={flow.id}
                    onClick={() => setSelectedFlowId(flow.id)}
                    aria-label={`Flow: ${flow.name}`}
                    className="text-left p-4 rounded-[20px] transition-all group"
                    style={{
                      background: isSelected ? theme.surfaceHover : theme.surfaceMid,
                      outline: isSelected ? '1px solid rgba(214,211,209,0.15)' : '1px solid rgba(63,63,70,0.08)',
                      outlineOffset: '-1px',
                    }}
                  >
                    <div className="flex items-start justify-between mb-2">
                      {editingFlowName === flow.id ? (
                        <input
                          value={editNameValue}
                          onChange={(e) => setEditNameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && editNameValue.trim()) { renameFlow(flow.id, editNameValue.trim()); setEditingFlowName(null); }
                            if (e.key === 'Escape') setEditingFlowName(null);
                          }}
                          onBlur={() => { if (editNameValue.trim()) renameFlow(flow.id, editNameValue.trim()); setEditingFlowName(null); }}
                          className="bg-black text-sm rounded px-2 py-0.5 outline-none w-full"
                          style={{ fontFamily: theme.fontGrotesk, color: theme.textPrimary, border: '1px solid rgba(214,211,209,0.2)' }}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="text-sm font-medium leading-5" style={{ fontFamily: theme.fontGrotesk, color: theme.textPrimary }}>
                          {flow.name}
                        </span>
                      )}
                      {warnings > 0 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(255,152,0,0.15)', color: '#ff9800' }}>
                          {warnings}<FiAlertTriangle size={10} className="inline ml-0.5" />
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-normal uppercase leading-4 tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textDim }}>
                        {flow.steps.length} step{flow.steps.length !== 1 ? 's' : ''}
                      </span>
                      <span className="text-[10px] font-mono" style={{ color: theme.textFaint }}>
                        {flow.baseUrl.replace(/^https?:\/\//, '')}
                      </span>
                    </div>
                    <div className="flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingFlowName(flow.id); setEditNameValue(flow.name); }}
                        className="px-2 py-0.5 rounded text-[9px] uppercase tracking-wider hover:bg-white/5 transition"
                        style={{ fontFamily: theme.fontInter, color: theme.textDim }}
                      >
                        Rename
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); duplicateFlow(flow.id); }}
                        className="px-2 py-0.5 rounded text-[9px] uppercase tracking-wider hover:bg-white/5 transition"
                        style={{ fontFamily: theme.fontInter, color: theme.textDim }}
                      >
                        Duplicate
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteFlow(flow.id); }}
                        aria-label={`Delete flow: ${flow.name}`}
                        className="px-2 py-0.5 rounded text-[9px] uppercase tracking-wider transition"
                        style={{
                          fontFamily: theme.fontInter,
                          color: confirmDeleteId === flow.id ? '#ffffff' : '#f87171',
                          background: confirmDeleteId === flow.id ? 'rgba(248,113,113,0.3)' : 'transparent',
                        }}
                      >
                        {confirmDeleteId === flow.id ? 'Confirm?' : 'Delete'}
                      </button>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Selected flow detail */}
            {selectedFlow && (
              <div
                className="p-5 rounded-3xl flex flex-col gap-4"
                style={{ background: theme.surfaceMid, outline: `1px solid ${theme.border}`, outlineOffset: '-1px' }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium" style={{ fontFamily: theme.fontGrotesk, color: theme.textPrimary }}>
                    {selectedFlow.name}
                  </span>
                  <span className="text-[10px] font-normal uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textDim }}>
                    {selectedFlow.steps.length} step{selectedFlow.steps.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Base URL */}
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-normal uppercase tracking-wide shrink-0" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>
                    Base URL
                  </span>
                  <input
                    value={selectedFlow.baseUrl}
                    onChange={(e) => updateFlowBaseUrl(selectedFlow.id, e.target.value)}
                    className="flex-1 bg-black text-xs rounded-lg px-3 py-1.5 outline-none"
                    style={{ fontFamily: theme.fontMono, color: theme.textMuted, border: `1px solid ${theme.borderLight}` }}
                  />
                </div>

                {/* Steps list */}
                <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleStepDragEnd}>
                  <SortableContext items={selectedFlow.steps.map(s => s.id)} strategy={verticalListSortingStrategy}>
                    <div className="flex flex-col gap-1">
                      {selectedFlow.steps.map((step, i) => (
                        <SortableStepItem
                          key={step.id}
                          step={step}
                          index={i}
                          onRemove={() => removeStep(selectedFlow.id, step.id)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>

                {/* Add step */}
                {isAddingStep ? (
                  <div className="p-3 rounded-lg flex flex-col gap-2" style={{ background: 'rgba(0,0,0,0.4)', border: `1px solid ${theme.borderLight}` }}>
                    <input
                      value={stepName}
                      onChange={(e) => setStepName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddStep(); if (e.key === 'Escape') setIsAddingStep(false); }}
                      placeholder="Step name"
                      className="w-full bg-black text-xs rounded px-3 py-2 outline-none"
                      style={{ fontFamily: theme.fontManrope, color: theme.textPrimary, border: `1px solid ${theme.borderLight}` }}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <FluxorDropdown
                        value={stepAction}
                        options={STEP_ACTIONS.map(a => ({ value: a, label: a.toUpperCase() }))}
                        onChange={(v) => setStepAction(v as FlowStep['action'])}
                        fontSize={10}
                        ariaLabel="Step action"
                        triggerStyle={{
                          background: '#000000',
                          border: `1px solid ${theme.borderLight}`,
                          borderRadius: 6,
                          padding: '4px 8px',
                          textTransform: 'uppercase',
                        }}
                      />
                      <input
                        value={stepTarget}
                        onChange={(e) => setStepTarget(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddStep(); }}
                        placeholder={stepAction === 'navigate' ? '/path' : 'CSS selector'}
                        className="flex-1 bg-black text-xs rounded px-3 py-1.5 outline-none"
                        style={{ fontFamily: theme.fontMono, color: theme.textMuted, border: `1px solid ${theme.borderLight}` }}
                      />
                    </div>
                    {stepAction === 'type' && (
                      <input
                        value={stepValue}
                        onChange={(e) => setStepValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddStep(); }}
                        placeholder="Value to type"
                        className="w-full bg-black text-xs rounded px-3 py-1.5 outline-none"
                        style={{ fontFamily: theme.fontManrope, color: theme.textMuted, border: `1px solid ${theme.borderLight}` }}
                      />
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={handleAddStep}
                        disabled={!stepName.trim()}
                        className="flex-1 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition disabled:opacity-30"
                        style={{
                          fontFamily: theme.fontInter,
                          background: 'linear-gradient(180deg, rgba(229,231,235,0.15) 0%, rgba(161,161,170,0.15) 100%)',
                          color: theme.textMid,
                        }}
                      >
                        Add Step
                      </button>
                      <button
                        onClick={() => setIsAddingStep(false)}
                        className="px-3 py-1.5 text-[10px] text-neutral-500 hover:text-neutral-300 transition"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { setIsAddingStep(true); setStepName(''); setStepTarget(''); setStepValue(''); setStepAction('navigate'); }}
                    aria-label="Add step"
                    className="w-full py-2 rounded-lg text-[10px] font-semibold uppercase tracking-wider transition hover:bg-white/3"
                    style={{ fontFamily: theme.fontInter, color: theme.textFaint, border: '1px dashed rgba(63,63,70,0.2)' }}
                  >
                    + Add Step
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom stats */}
      <div
        className="h-16 px-8 flex items-center gap-8 shrink-0"
        style={{ background: 'rgba(23,23,23,0.5)', borderTop: `1px solid ${theme.border}` }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-normal uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>Flows</span>
          <span className="text-sm font-bold" style={{ fontFamily: theme.fontGrotesk, color: theme.textPrimary }}>{flows.length}</span>
        </div>
        <div className="w-px h-5" style={{ background: 'rgba(63,63,70,0.2)' }} />
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-normal uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>Total Steps</span>
          <span className="text-sm font-bold" style={{ fontFamily: theme.fontGrotesk, color: theme.textPrimary }}>{totalSteps}</span>
        </div>
        {invalidSteps > 0 && (
          <>
            <div className="w-px h-5" style={{ background: 'rgba(63,63,70,0.2)' }} />
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-normal uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>Warnings</span>
              <span className="text-sm font-bold" style={{ fontFamily: theme.fontGrotesk, color: '#ff9800' }}>{invalidSteps}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
