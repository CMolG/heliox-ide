/**
 * PromptDevZoneApp.tsx — Renderer Embedded App Component
 *
 * Responsibility:
 * - Renders the PromptDevZoneApp surface in the renderer layer.
 * - Encapsulates Embedded mini-app surface mounted inside desktop windows.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/atoms/apps/PromptDevZoneApp.tsx — Dev-only prompt testing sandbox for AiComposer
//
// Purpose:
// Allows developers to compose and preview the full enriched prompt that would
// be sent to an AI agent — without actually launching an agent session.
// This is invaluable for debugging prompt structure, testing constraint combinations,
// and validating the output of the AiComposer builder pipeline.
//
// Access: Only available when import.meta.env.DEV is true (Vite dev mode).

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { AiComposer, resolveMarketPrompt, resolveMarketPrompts } from '../../../logic/ai';
import { useHelioxStore } from '../../../store';
import { useDesktopStore } from '../../../store/desktop-store';
import { theme } from '../../../logic/theme';
import { HelioxDropdown } from '../../ui/HelioxDropdown';
import { LucideIcon } from '../../desktop/LucideIcon';
import { CodeEditor } from '../../ui/CodeEditor';

interface PromptDevZoneAppProps {
  windowId: string;
}

export function PromptDevZoneApp({ windowId }: PromptDevZoneAppProps) {
  const roles = useHelioxStore(s => s.roles);
  const flows = useHelioxStore(s => s.flows);
  const projectPath = useHelioxStore(s => s.projectPath);
  const marketInventory = useDesktopStore(s => s.marketInventory);

  // ── Local state for composing prompts ──────────────────────────
  const [instruction, setInstruction] = useState('');
  const [stupidityMode, setStupidityMode] = useState(true);
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
  const [selectedModNames, setSelectedModNames] = useState<Set<string>>(new Set());
  const [selectedDesignSystem, setSelectedDesignSystem] = useState<string>('');
  const [includeFlows, setIncludeFlows] = useState(false);
  const [includeOutputSchema, setIncludeOutputSchema] = useState(true);
  const [copied, setCopied] = useState(false);

  // ── Resolved markdown content (loaded from .md files) ──────────
  const [resolvedRolePrompt, setResolvedRolePrompt] = useState<string | null>(null);
  const [resolvedModPrompts, setResolvedModPrompts] = useState<string[]>([]);
  const [resolvedDSPrompt, setResolvedDSPrompt] = useState<string | null>(null);

  const mods = marketInventory?.mods ?? [];
  const designSystems = marketInventory?.designSystems ?? [];
  const marketRoles = marketInventory?.roles ?? [];

  // ── Load role markdown when selection changes ──────────────────
  useEffect(() => {
    if (!selectedRoleId || !projectPath) {
      setResolvedRolePrompt(null);
      return;
    }
    const isMarketRole = marketRoles.some(r => r.name === selectedRoleId);
    if (isMarketRole) {
      resolveMarketPrompt(projectPath, 'roles', selectedRoleId).then(setResolvedRolePrompt);
    } else {
      const localRole = roles.find(r => r.id === selectedRoleId);
      setResolvedRolePrompt(localRole?.systemPrompt ?? null);
    }
  }, [selectedRoleId, projectPath, marketRoles, roles]);

  // ── Load mod markdowns when selection changes ──────────────────
  useEffect(() => {
    if (selectedModNames.size === 0 || !projectPath) {
      setResolvedModPrompts([]);
      return;
    }
    const names = Array.from(selectedModNames);
    resolveMarketPrompts(projectPath, 'mods', names).then(setResolvedModPrompts);
  }, [selectedModNames, projectPath]);

  // ── Load design system markdown when selection changes ─────────
  useEffect(() => {
    if (!selectedDesignSystem || !projectPath) {
      setResolvedDSPrompt(null);
      return;
    }
    resolveMarketPrompt(projectPath, 'design-systems', selectedDesignSystem).then(setResolvedDSPrompt);
  }, [selectedDesignSystem, projectPath]);

  // ── Compose prompt live ────────────────────────────────────────
  const composedPrompt = useMemo(() => {
    if (!instruction.trim()) return '// Enter an instruction above to preview the composed prompt';

    let composer = new AiComposer(instruction)
      .withStupidityMode(stupidityMode)
      .withPersona(resolvedRolePrompt ?? '')
      .withStrictConstraints(resolvedModPrompts)
      .withDesignSystem(resolvedDSPrompt);

    if (includeFlows && flows.length > 0) {
      composer = composer.withFlows(flows);
    }

    if (includeOutputSchema) {
      composer = composer.withOutputSchema();
    }

    return composer.compose();
  }, [instruction, stupidityMode, resolvedRolePrompt, resolvedModPrompts, resolvedDSPrompt, includeFlows, flows, includeOutputSchema]);

  // ── Metrics ────────────────────────────────────────────────────
  const charCount = composedPrompt.length;
  const lineCount = composedPrompt.split('\n').length;
  const estimatedTokens = Math.round(charCount / 4);

  // ── Handlers ───────────────────────────────────────────────────

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(composedPrompt).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [composedPrompt]);

  const toggleMod = useCallback((modName: string) => {
    setSelectedModNames(prev => {
      const next = new Set(prev);
      if (next.has(modName)) next.delete(modName);
      else next.add(modName);
      return next;
    });
  }, []);

  // ── Style constants ────────────────────────────────────────────
  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: '0.05em', color: theme.textFaint, fontFamily: theme.fontInter,
  };
  const sectionStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 6,
  };
  const chipBase: React.CSSProperties = {
    fontSize: 10, padding: '3px 8px', borderRadius: 6,
    border: '1px solid', cursor: 'pointer', fontFamily: theme.fontInter,
    transition: 'all 0.12s',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: theme.bg }}>
      {/* ── Header ───────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
        borderBottom: `1px solid ${theme.borderLight}`, background: theme.surface, flexShrink: 0,
      }}>
        <LucideIcon name="FlaskConical" size={13} style={{ color: theme.warning }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: theme.warning, fontFamily: theme.fontInter }}>
          DEV ZONE
        </span>
        <span style={{ fontSize: 10, color: theme.textGhost, fontFamily: theme.fontInter }}>
          AiComposer Prompt Preview
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 9, color: theme.textGhost, fontFamily: theme.fontMono }}>
          {estimatedTokens.toLocaleString()} est. tokens · {lineCount} lines · {charCount.toLocaleString()} chars
        </span>
      </div>

      {/* ── Body: Controls + Preview ─────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Left: Controls Panel ─────────────────────────────── */}
        <div style={{
          width: 260, minWidth: 220, flexShrink: 0,
          borderRight: `1px solid ${theme.borderLight}`,
          padding: 12, overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 14,
        }}>
          {/* Instruction */}
          <div style={sectionStyle}>
            <span style={labelStyle}>Instruction (Task)</span>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Enter the instruction the agent would receive…"
              rows={5}
              style={{
                background: '#000', color: theme.textPrimary, fontSize: 11,
                fontFamily: theme.fontMono, borderRadius: 8, padding: '8px 10px',
                border: `1px solid ${theme.borderLight}`, outline: 'none', resize: 'vertical',
              }}
            />
          </div>

          {/* Stupidity Mode */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setStupidityMode(!stupidityMode)}
              style={{
                width: 32, height: 18, borderRadius: 9, padding: 2,
                background: stupidityMode ? theme.accentBlue : theme.surfaceHover,
                border: 'none', cursor: 'pointer', transition: 'background 0.15s',
                display: 'flex', alignItems: 'center',
              }}
            >
              <div style={{
                width: 14, height: 14, borderRadius: 7, background: '#fff',
                transform: stupidityMode ? 'translateX(14px)' : 'translateX(0)',
                transition: 'transform 0.15s',
              }} />
            </button>
            <span style={{ fontSize: 10, color: theme.textMuted, fontFamily: theme.fontInter }}>
              Stupidity Mode (+3σ)
            </span>
          </div>

          {/* Output Schema */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setIncludeOutputSchema(!includeOutputSchema)}
              style={{
                width: 32, height: 18, borderRadius: 9, padding: 2,
                background: includeOutputSchema ? theme.accentBlue : theme.surfaceHover,
                border: 'none', cursor: 'pointer', transition: 'background 0.15s',
                display: 'flex', alignItems: 'center',
              }}
            >
              <div style={{
                width: 14, height: 14, borderRadius: 7, background: '#fff',
                transform: includeOutputSchema ? 'translateX(14px)' : 'translateX(0)',
                transition: 'transform 0.15s',
              }} />
            </button>
            <span style={{ fontSize: 10, color: theme.textMuted, fontFamily: theme.fontInter }}>
              Output Schema
            </span>
          </div>

          {/* Role */}
          <div style={sectionStyle}>
            <span style={labelStyle}>Role</span>
            <HelioxDropdown
              value={selectedRoleId}
              options={[
                { value: '', label: 'None' },
                ...marketRoles.map(r => ({ value: r.name, label: `🏪 ${r.name}` })),
                ...roles.map(r => ({ value: r.id, label: `${r.icon} ${r.name}` })),
              ]}
              onChange={setSelectedRoleId}
              variant="field"
              fontSize={11}
              ariaLabel="Select role"
            />
          </div>

          {/* Design System */}
          {designSystems.length > 0 && (
            <div style={sectionStyle}>
              <span style={labelStyle}>Design System</span>
              <HelioxDropdown
                value={selectedDesignSystem}
                options={[
                  { value: '', label: 'None' },
                  ...designSystems.map(ds => ({ value: ds.name, label: ds.name })),
                ]}
                onChange={setSelectedDesignSystem}
                variant="field"
                fontSize={11}
                ariaLabel="Select design system"
              />
            </div>
          )}

          {/* Mods */}
          {mods.length > 0 && (
            <div style={sectionStyle}>
              <span style={labelStyle}>Modifiers ({selectedModNames.size}/{mods.length})</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {mods.map(m => {
                  const active = selectedModNames.has(m.name);
                  return (
                    <button
                      key={m.name}
                      onClick={() => toggleMod(m.name)}
                      style={{
                        ...chipBase,
                        background: active ? theme.accentBlueBg : 'transparent',
                        borderColor: active ? theme.accentBlueBorder : theme.borderLight,
                        color: active ? theme.accentBlue : theme.textDim,
                      }}
                    >
                      {m.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Flows */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setIncludeFlows(!includeFlows)}
              style={{
                width: 32, height: 18, borderRadius: 9, padding: 2,
                background: includeFlows ? theme.accentBlue : theme.surfaceHover,
                border: 'none', cursor: 'pointer', transition: 'background 0.15s',
                display: 'flex', alignItems: 'center',
              }}
            >
              <div style={{
                width: 14, height: 14, borderRadius: 7, background: '#fff',
                transform: includeFlows ? 'translateX(14px)' : 'translateX(0)',
                transition: 'transform 0.15s',
              }} />
            </button>
            <span style={{ fontSize: 10, color: theme.textMuted, fontFamily: theme.fontInter }}>
              Include E2E Flows ({flows.length})
            </span>
          </div>

          {/* Copy button */}
          <button
            onClick={handleCopy}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '8px 12px', borderRadius: 8,
              background: copied ? theme.successBg : theme.surfaceHover,
              border: `1px solid ${copied ? theme.successBorder : theme.borderLight}`,
              color: copied ? theme.success : theme.textMuted,
              fontSize: 11, fontWeight: 600, fontFamily: theme.fontInter,
              cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            <LucideIcon name={copied ? 'Check' : 'Copy'} size={12} />
            {copied ? 'Copied!' : 'Copy Prompt'}
          </button>
        </div>

        {/* ── Right: Prompt Preview (Monaco, read-only) ────────── */}
        <div style={{ flex: 1, overflow: 'hidden', background: '#2B2B2B' }}>
          <CodeEditor
            language="markdown"
            value={composedPrompt}
            readOnly
            fontSize={11}
            lineHighlight="none"
            wordWrap="on"
            scrollbarSize={4}
            enableLinting={false}
          />
        </div>
      </div>
    </div>
  );
}
