/**
 * StepInfoModal.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders the editable "Step Config" panel for a pipeline step: an
 *   accessible dialog (`role="dialog"`, testid `step-info-modal`) that lets
 *   the user edit the step's instructions, attach/remove roles + mods, and
 *   trigger execution ("Run this step" / "Run from here").
 * - Owns the step-state mutations this surface exposes: `updateStepData`,
 *   `addRoleToStep`/`removeRoleFromStep`, `addModToStep`/`removeModFromStep`.
 *
 * Boundaries:
 * - Owns: panel presentation, focus trap/keyboard handling, and the store
 *   calls needed to edit *this* step's data.
 * - Does NOT own: edge/connection data (computed by the caller), dnd-kit
 *   drop-target wiring (StepNode owns that), or execution internals
 *   (harness-store owns `runStep`/`runFromStep`; this panel only invokes them).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LucideIcon } from './LucideIcon';
import { domainMismatchHint, kebabToTitle } from './attachable-helpers';
import { stepTypeMeta } from './mental/step-type-meta';
import { useDesktopStore } from '../../store/desktop-store';
import { useHarnessStore } from '../../store/harness-store';
import type { StepNodeData } from '@/types/desktop';
import type { AgenticExecutionStatus } from '@/types/harness';
import type { MarketRole, MarketMod } from '@/types/market';

// ─── Focus trap ─────────────────────────────────────────────────────

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

// ─── Status badge ─────────────────────────────────────────────────

function StatusBadge({ status }: { status?: AgenticExecutionStatus }) {
  const s = status ?? 'idle';
  return (
    <span
      className={`step-config-status step-config-status--${s}`}
      role="status"
      data-testid="step-info-status"
      aria-label={`Execution status: ${s}`}
    >
      {s}
    </span>
  );
}

// ─── Role / Mod rows (assigned atoms, with remove) ────────────────

function RoleRow({ role, onRemove }: { role: MarketRole; onRemove: () => void }) {
  const accent = role.color?.startsWith('#') ? role.color : role.color ? `#${role.color}` : '#E87040';
  const label = kebabToTitle(role.name);
  return (
    <div className="step-config-atom-row" style={{ ['--atom-accent' as string]: accent }}>
      <div className="step-config-atom-icon" aria-hidden="true">
        <LucideIcon name="User" size={12} />
      </div>
      <div className="step-config-atom-body">
        <div className="step-config-atom-name">{label}</div>
        {role.description && <p className="step-config-atom-desc">{role.description}</p>}
        {role.tags && role.tags.length > 0 && (
          <div className="step-config-atom-tags">
            {role.tags.map((tag) => (
              <span key={tag} className="step-config-atom-tag">{tag}</span>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="step-config-remove-btn"
        aria-label={`Remove role ${label}`}
        data-testid={`step-info-role-remove-${role.name}`}
        onClick={onRemove}
      >
        <LucideIcon name="X" size={14} />
      </button>
    </div>
  );
}

function ModRow({ mod, onRemove }: { mod: MarketMod; onRemove: () => void }) {
  const label = kebabToTitle(mod.name);
  return (
    <div className="step-config-atom-row" style={{ ['--atom-accent' as string]: '#4285F4' }}>
      <div className="step-config-atom-icon" aria-hidden="true">
        <LucideIcon name="Wrench" size={12} />
      </div>
      <div className="step-config-atom-body">
        <div className="step-config-atom-name">{label}</div>
        {mod.description && <p className="step-config-atom-desc">{mod.description}</p>}
        {mod.tags && mod.tags.length > 0 && (
          <div className="step-config-atom-tags">
            {mod.tags.map((tag) => (
              <span key={tag} className="step-config-atom-tag">{tag}</span>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="step-config-remove-btn"
        aria-label={`Remove mod ${label}`}
        data-testid={`step-info-mod-remove-${mod.name}`}
        onClick={onRemove}
      >
        <LucideIcon name="X" size={14} />
      </button>
    </div>
  );
}

// ─── Atom picker (native <select> + explicit Attach button) ───────
//
// A native select is used (rather than a custom listbox) per spec: it gives
// full keyboard/typeahead/screen-reader support for free. Attaching requires
// an explicit button activation (no on-change side effects) so selecting an
// option never causes a surprise state change for keyboard/AT users.

interface AtomPickerOption {
  value: string;
  label: string;
}

function AtomPicker({
  selectId,
  label,
  hint,
  options,
  onAttach,
  error,
  selectTestId,
  attachTestId,
}: {
  selectId: string;
  label: string;
  hint: string;
  options: AtomPickerOption[];
  onAttach: (value: string) => void;
  error?: string | null;
  selectTestId?: string;
  attachTestId?: string;
}) {
  const [draft, setDraft] = useState('');
  const hintId = `${selectId}-hint`;
  const errorId = `${selectId}-error`;

  const handleAttach = useCallback(() => {
    if (!draft) return;
    onAttach(draft);
    setDraft('');
  }, [draft, onAttach]);

  return (
    <div className="step-config-picker">
      <label htmlFor={selectId} className="step-config-label">{label}</label>
      <div className="step-config-picker-row">
        <select
          id={selectId}
          className="step-config-select"
          data-testid={selectTestId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          disabled={options.length === 0}
        >
          <option value="">{options.length === 0 ? 'None available' : 'Choose…'}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          type="button"
          className="step-config-attach-btn"
          data-testid={attachTestId}
          onClick={handleAttach}
          disabled={!draft}
        >
          <LucideIcon name="Plus" size={13} />
          Attach
        </button>
      </div>
      <p id={hintId} className="step-config-hint">{hint}</p>
      {error && (
        <p id={errorId} className="step-config-error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────

export interface StepInfoModalProps {
  stepId: string;
  stepData: StepNodeData;
  connections: {
    incoming: string[];
    outgoing: string[];
  };
  status?: AgenticExecutionStatus;
  onClose: () => void;
}

// ─── Panel ────────────────────────────────────────────────────────

export function StepInfoModal({ stepId, stepData, connections, status, onClose }: StepInfoModalProps) {
  const meta = stepTypeMeta(stepData.stepType as string | undefined);
  const accent = meta.accent;

  const marketInventory = useDesktopStore((s) => s.marketInventory);
  const updateStepData = useDesktopStore((s) => s.updateStepData);
  const addRoleToStep = useDesktopStore((s) => s.addRoleToStep);
  const removeRoleFromStep = useDesktopStore((s) => s.removeRoleFromStep);
  const addModToStep = useDesktopStore((s) => s.addModToStep);
  const removeModFromStep = useDesktopStore((s) => s.removeModFromStep);
  const runStep = useHarnessStore((s) => s.runStep);
  const runFromStep = useHarnessStore((s) => s.runFromStep);

  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const roles = stepData.roles ?? [];
  const mods = stepData.mods ?? [];
  // Roles are mutually exclusive (one per step), so the sole assigned role —
  // if any — is the one the domain-mismatch hint below compares mods against.
  const attachedRole = roles[0] ?? null;
  const promptValue = stepData.prompt ?? stepData.description ?? '';

  const [roleError, setRoleError] = useState<string | null>(null);
  const [modError, setModError] = useState<string | null>(null);
  const [modDomainHint, setModDomainHint] = useState<string | null>(null);

  const isBusy = status === 'running' || status === 'compiling';

  // Focus the close button on mount for keyboard accessibility.
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Escape closes the panel; Tab / Shift+Tab is trapped inside it.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      // Every interactive element in this panel is either fully rendered or
      // fully unmounted (no CSS-hidden-but-present controls), so the
      // FOCUSABLE_SELECTOR query alone is a reliable focus-trap boundary —
      // deliberately not filtering by layout metrics (e.g. offsetParent),
      // which are meaningless in non-layout test environments (jsdom).
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (!active || !panel.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handlePromptChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateStepData(stepId, { prompt: e.target.value });
  }, [stepId, updateStepData]);

  // Roles are mutually exclusive — hide the already-assigned role from its
  // own picker (re-selecting it would be a no-op). Mods are stackable, so
  // every mod not already attached AND not flagged incompatible with an
  // attached one is offered.
  const availableRoles = (marketInventory?.roles ?? []).filter(
    (role) => !roles.some((assigned) => assigned.name === role.name),
  );
  const availableMods = (marketInventory?.mods ?? []).filter((mod) => {
    if (mods.some((assigned) => assigned.name === mod.name)) return false;
    return !mods.some((assigned) =>
      assigned.incompatibleWith?.includes(mod.name) || mod.incompatibleWith?.includes(assigned.name),
    );
  });

  const handleAttachRole = useCallback((roleName: string) => {
    const role = marketInventory?.roles.find((r) => r.name === roleName);
    if (!role) return;
    const ok = addRoleToStep(stepId, role);
    setRoleError(ok ? null : `"${kebabToTitle(roleName)}" could not be attached.`);
  }, [marketInventory, addRoleToStep, stepId]);

  const handleAttachMod = useCallback((modName: string) => {
    const mod = marketInventory?.mods.find((m) => m.name === modName);
    if (!mod) return;
    const ok = addModToStep(stepId, mod);
    if (!ok) {
      setModError(`"${kebabToTitle(modName)}" was rejected — it may already be on this step or incompatible with one that is.`);
      setModDomainHint(null);
      return;
    }
    // Hard rejection (above) and this hint are mutually exclusive: the attach
    // already succeeded here, so this is purely informational — never a
    // reason to have blocked it (see MarketDomain doc comment, types/market.ts).
    setModError(null);
    setModDomainHint(domainMismatchHint(mod, attachedRole));
  }, [marketInventory, addModToStep, stepId, attachedRole]);

  const promptHeadingId = `step-config-prompt-heading-${stepId}`;
  const promptHintId = `step-config-prompt-hint-${stepId}`;
  const rolesHeadingId = `step-config-roles-heading-${stepId}`;
  const modsHeadingId = `step-config-mods-heading-${stepId}`;
  const busyHintId = `step-config-busy-hint-${stepId}`;

  return (
    <div
      className="step-config-overlay"
      data-testid="step-info-modal"
      role="dialog"
      aria-label={`Step details: ${stepData.title}`}
      aria-modal="true"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className="step-config-panel"
        style={{ ['--step-accent' as string]: accent }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="step-config-header">
          <div className="step-config-icon" aria-hidden="true">
            <LucideIcon name={meta.icon} size={18} />
          </div>
          <div className="step-config-title-wrap">
            <h2 className="step-config-title">{stepData.title}</h2>
            <span className="step-config-kicker">{meta.label}</span>
          </div>
          <StatusBadge status={status} />
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close step config panel"
            data-testid="step-info-modal-close"
            className="step-config-close"
          >
            <LucideIcon name="X" size={16} />
          </button>
        </div>

        <div className="step-config-body">
          {/* ── Instructions ── */}
          <h3 className="step-config-section-label" id={promptHeadingId}>Instructions</h3>
          <textarea
            id={`step-config-prompt-${stepId}`}
            className="step-config-textarea"
            data-testid="step-info-prompt"
            value={promptValue}
            onChange={handlePromptChange}
            placeholder="Describe what this step should do…"
            aria-labelledby={promptHeadingId}
            aria-describedby={promptHintId}
            rows={6}
          />
          <p id={promptHintId} className="step-config-hint">
            This text is what the agent executes for this step.
          </p>

          {/* ── Roles ── */}
          <h3 className="step-config-section-label" id={rolesHeadingId}>Role</h3>
          {roles.length > 0 ? (
            <div className="step-config-atom-list" role="group" aria-labelledby={rolesHeadingId}>
              {roles.map((role) => (
                <RoleRow key={role.name} role={role} onRemove={() => removeRoleFromStep(stepId, role.name)} />
              ))}
            </div>
          ) : (
            <p className="step-config-empty">No role assigned yet.</p>
          )}
          <AtomPicker
            selectId={`step-config-role-select-${stepId}`}
            label={roles.length > 0 ? 'Replace role' : 'Attach role'}
            hint="One role per step — attaching a new role replaces the current one."
            options={availableRoles.map((r) => ({ value: r.name, label: kebabToTitle(r.name) }))}
            onAttach={handleAttachRole}
            error={roleError}
            selectTestId="step-info-role-select"
            attachTestId="step-info-role-attach"
          />

          {/* ── Mods ── */}
          <h3 className="step-config-section-label" id={modsHeadingId}>Mods</h3>
          {mods.length > 0 ? (
            <div className="step-config-atom-list" role="group" aria-labelledby={modsHeadingId}>
              {mods.map((mod) => (
                <ModRow key={mod.name} mod={mod} onRemove={() => removeModFromStep(stepId, mod.name)} />
              ))}
            </div>
          ) : (
            <p className="step-config-empty">No mods assigned yet.</p>
          )}
          <AtomPicker
            selectId={`step-config-mod-select-${stepId}`}
            label="Attach mod"
            hint="Mods stack — incompatible combinations are rejected."
            options={availableMods.map((m) => ({ value: m.name, label: kebabToTitle(m.name) }))}
            onAttach={handleAttachMod}
            error={modError}
            selectTestId="step-info-mod-select"
            attachTestId="step-info-mod-attach"
          />
          {modDomainHint && (
            <p
              className="step-config-domain-hint"
              role="status"
              aria-live="polite"
              data-testid="step-info-mod-domain-hint"
            >
              <LucideIcon name="TriangleAlert" size={12} className="step-config-domain-hint-icon" />
              <span>{modDomainHint}</span>
            </p>
          )}

          {/* ── Execution ── */}
          <h3 className="step-config-section-label">Execution</h3>
          <div className="step-config-actions">
            <button
              type="button"
              className="step-config-run-btn"
              data-testid="step-info-run"
              onClick={() => runStep(stepId)}
              disabled={isBusy}
              aria-disabled={isBusy}
              aria-describedby={isBusy ? busyHintId : undefined}
            >
              <LucideIcon name="Play" size={13} />
              Run this step
            </button>
            <button
              type="button"
              className="step-config-run-from-btn"
              data-testid="step-info-run-from"
              onClick={() => runFromStep(stepId)}
              disabled={isBusy}
              aria-disabled={isBusy}
              aria-describedby={isBusy ? busyHintId : undefined}
            >
              <LucideIcon name="Workflow" size={13} />
              Run from here
            </button>
          </div>
          {isBusy && (
            <p id={busyHintId} className="step-config-hint" role="status">
              This step is currently {status}. Run controls are disabled until it finishes.
            </p>
          )}

          {/* ── Connections ── */}
          <h3 className="step-config-section-label">Connections</h3>
          <div className="step-config-connections">
            <div className="step-config-connection-card">
              <div className="step-config-connection-label">Incoming</div>
              {connections.incoming.length === 0 ? (
                <span className="step-config-connection-value--empty">None (root)</span>
              ) : (
                <span className="step-config-connection-value">
                  {connections.incoming.length} step{connections.incoming.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="step-config-connection-card">
              <div className="step-config-connection-label">Outgoing</div>
              {connections.outgoing.length === 0 ? (
                <span className="step-config-connection-value--empty">None (terminal)</span>
              ) : (
                <span className="step-config-connection-value">
                  {connections.outgoing.length} step{connections.outgoing.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
