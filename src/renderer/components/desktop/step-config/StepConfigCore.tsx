/**
 * StepConfigCore.tsx — Editable Step Config surface (instructions, roles, mods, execution)
 *
 * Responsibility:
 * - Renders the editable portion of a Step's config: the Instructions
 *   textarea, the Role/Mod attach-and-remove pickers, and the Execution
 *   controls (model override input + Run this step / Run from here).
 * - Owns the step-state mutations this surface exposes: `updateStepData`,
 *   `addRoleToStep`/`removeRoleFromStep`, `addModToStep`/`removeModFromStep`,
 *   and invokes `runStep`/`runFromStep` on harness-store.
 *
 * Boundaries:
 * - Owns: this surface's own local UI state (picker drafts, attach-rejection
 *   errors, the domain-mismatch hint) and the store calls needed to edit
 *   *this* step's data.
 * - Does NOT own: the panel chrome (overlay/header/focus-trap/Escape — see
 *   `StepInfoModal.tsx`) or execution *evidence* (the "Why this model" card
 *   and the Connections/Loop cards — see `StepRunEvidence.tsx`).
 *
 * Extracted verbatim from StepInfoModal.tsx (Phase 6 refactor) so a future
 * right-side inspector can host this surface without the modal chrome.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LucideIcon } from '../LucideIcon';
import {
  domainMismatchHint,
  filterAvailableMods,
  filterAvailableRoles,
  kebabToTitle,
  modAttachRejectedMessage,
  roleAttachRejectedMessage,
} from '../attachable-helpers';
import { useDesktopStore } from '../../../store/desktop-store';
import { useHarnessStore } from '../../../store/harness-store';
// Recycled verbatim from the retired chat surface (F0: chats→steps). The step's
// Instructions box is now the "chat-like" composer, so it reuses the exact
// @file autocomplete + attached-file chips the chat input had. Imported in
// place — NOT moved — so Ola C's dead-code sweep keeps this file (H2 consumer).
import { FileContextPanel } from '../../chat/FileContextBuilder';
import { useFluxorStore } from '../../../store';
import type { StepNodeData } from '@/types/desktop';
import type { AgenticExecutionStatus } from '@/types/harness';
import type { MarketRole, MarketMod } from '@/types/market';

// ─── Role / Mod rows (assigned atoms, with remove) ────────────────

// The role "helm" row (Single Persona). The role's descriptive content is a
// single-select-listbox `option` (see the roles list's `role="listbox"` below)
// marked `aria-selected` — the assigned persona is the current selection, and
// there is at most one. The remove control is a SIBLING of the option, never a
// child of it (ARIA APG: an option must not contain focusable descendants).
function RoleRow({ role, onRemove }: { role: MarketRole; onRemove: () => void }) {
  const accent = role.color?.startsWith('#') ? role.color : role.color ? `#${role.color}` : '#E87040';
  const label = kebabToTitle(role.name);
  return (
    <div className="step-config-atom-row" style={{ ['--atom-accent' as string]: accent }}>
      <div
        role="option"
        aria-selected="true"
        tabIndex={0}
        data-testid={`step-info-role-helm-${role.name}`}
        style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flex: 1, minWidth: 0 }}
      >
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

export interface StepConfigCoreProps {
  stepId: string;
  stepData: StepNodeData;
  status?: AgenticExecutionStatus;
}

// ─── Core editable surface ─────────────────────────────────────────

export function StepConfigCore({ stepId, stepData, status }: StepConfigCoreProps) {
  const marketInventory = useDesktopStore((s) => s.marketInventory);
  const updateStepData = useDesktopStore((s) => s.updateStepData);
  const addRoleToStep = useDesktopStore((s) => s.addRoleToStep);
  const removeRoleFromStep = useDesktopStore((s) => s.removeRoleFromStep);
  const addModToStep = useDesktopStore((s) => s.addModToStep);
  const removeModFromStep = useDesktopStore((s) => s.removeModFromStep);
  // Mono-step gesture hookup (W2 → H2): the double-click-empty-canvas gesture
  // (and the "New Step" context-menu action) create a step, open the Inspector,
  // and set `pendingStepFocusId` to that step. This surface owns the step's
  // text input, so it is the consumer of that signal — see the focus effect
  // below. (desktop-store.ts:513 documents the full contract.)
  const pendingStepFocusId = useDesktopStore((s) => s.pendingStepFocusId);
  const setPendingStepFocusId = useDesktopStore((s) => s.setPendingStepFocusId);
  // Workspace file list backing the @file autocomplete (recycled from the chat
  // composer). Empty until a project is opened — the autocomplete simply shows
  // nothing then, never errors.
  const projectFiles = useFluxorStore((s) => s.projectFiles);
  const runStep = useHarnessStore((s) => s.runStep);
  const runFromStep = useHarnessStore((s) => s.runFromStep);

  const roles = stepData.roles ?? [];
  const mods = stepData.mods ?? [];
  // Roles are mutually exclusive (one per step), so the sole assigned role —
  // if any — is the one the domain-mismatch hint below compares mods against.
  const attachedRole = roles[0] ?? null;
  const promptValue = stepData.prompt ?? stepData.description ?? '';
  const modelOverrideValue = typeof stepData.model === 'string' ? stepData.model : '';

  const [roleError, setRoleError] = useState<string | null>(null);
  const [modError, setModError] = useState<string | null>(null);
  const [modDomainHint, setModDomainHint] = useState<string | null>(null);

  // @file autocomplete state (recycled from the chat composer's own local
  // state; the presentational dropdown/chips live in FileContextPanel).
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const [showAtAutocomplete, setShowAtAutocomplete] = useState(false);
  const [atQuery, setAtQuery] = useState('');
  const [atSelectedIndex, setAtSelectedIndex] = useState(0);
  const [atCursorIndex, setAtCursorIndex] = useState(0);

  const isBusy = status === 'running' || status === 'compiling';

  // Mono-step gesture hookup (contract in desktop-store.ts:513): when the
  // gesture names THIS step, grab DOM focus into the prompt textarea and clear
  // the one-shot signal so it fires exactly once. StepInspector remounts this
  // subtree via `key={stepId}` on selection change, so this runs on mount for a
  // freshly-gestured step — no stale-focus race across steps.
  useEffect(() => {
    if (pendingStepFocusId === stepId) {
      promptRef.current?.focus();
      setPendingStepFocusId(null);
    }
  }, [pendingStepFocusId, stepId, setPendingStepFocusId]);

  // `setInput` for FileContextPanel: it inserts/removes `@file` tokens in the
  // prompt text (both the value and the updater forms). The prompt is the one
  // step field the harness compiler actually executes (normalizePrompt), so
  // @file mentions ride to execution inside it — the same mechanism the chat
  // used to deliver file context. FileContextPanel is a controlled view over
  // `promptValue`, so the updater's `prev` is that same value — no stale-closure
  // risk (each select/chip-remove is its own settled render).
  const setPromptInput = useCallback((value: string | ((prev: string) => string)) => {
    const next = typeof value === 'function' ? value(promptValue) : value;
    updateStepData(stepId, { prompt: next });
  }, [stepId, updateStepData, promptValue]);

  // Extends the plain prompt write with the chat composer's @-mention
  // detection: when the caret sits right after an `@token`, open the file
  // autocomplete anchored at that token.
  const handlePromptChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    updateStepData(stepId, { prompt: val });
    const cursor = e.target.selectionStart ?? val.length;
    const atMatch = val.slice(0, cursor).match(/@([\w./\-[\]()]*)$/);
    if (atMatch) {
      setShowAtAutocomplete(true);
      setAtQuery(atMatch[1]);
      setAtCursorIndex(cursor - atMatch[0].length);
      setAtSelectedIndex(0);
    } else {
      setShowAtAutocomplete(false);
    }
  }, [stepId, updateStepData]);

  // Arrow/Escape navigation for the open autocomplete (mirrors the chat
  // composer). The suggestions are also plain <button>s, so they stay
  // Tab/Enter reachable without this handler (keyboard access never depends on
  // it) — this only adds the faster in-textarea arrow navigation.
  const handlePromptKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showAtAutocomplete) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setAtSelectedIndex((i) => i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAtSelectedIndex((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Escape') { e.preventDefault(); setShowAtAutocomplete(false); }
  }, [showAtAutocomplete]);

  // Model override: an explicit "provider/model" string beats this flow's
  // Model policy AND the router's pick, for this step only (AgenticStep.model,
  // src/types/harness.ts:95 — "beats the flow model + router"). Committed on
  // both change and blur so the store never lags a keystroke behind; empty/
  // whitespace clears the override back to `undefined`, resuming routing.
  const commitModelOverride = useCallback((value: string) => {
    updateStepData(stepId, { model: value.trim() || undefined });
  }, [stepId, updateStepData]);
  const handleModelOverrideChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    commitModelOverride(e.target.value);
  }, [commitModelOverride]);
  const handleModelOverrideBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    commitModelOverride(e.target.value);
  }, [commitModelOverride]);

  // Roles are mutually exclusive — hide the already-assigned role from its
  // own picker (re-selecting it would be a no-op). Mods are stackable, so
  // every mod not already attached AND not flagged incompatible with an
  // attached one is offered. Shared with StepQuickAddPopover's identical
  // pickers via attachable-helpers.ts.
  const availableRoles = filterAvailableRoles(marketInventory?.roles ?? [], attachedRole);
  const availableMods = filterAvailableMods(marketInventory?.mods ?? [], mods);

  const handleAttachRole = useCallback((roleName: string) => {
    const role = marketInventory?.roles.find((r) => r.name === roleName);
    if (!role) return;
    const ok = addRoleToStep(stepId, role);
    setRoleError(ok ? null : roleAttachRejectedMessage(kebabToTitle(roleName)));
  }, [marketInventory, addRoleToStep, stepId]);

  const handleAttachMod = useCallback((modName: string) => {
    const mod = marketInventory?.mods.find((m) => m.name === modName);
    if (!mod) return;
    const ok = addModToStep(stepId, mod);
    if (!ok) {
      setModError(modAttachRejectedMessage(kebabToTitle(modName)));
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
    <>
      {/* ── Instructions (chat-like composer: text → prompt, @file → context) ── */}
      <h3 className="step-config-section-label" id={promptHeadingId}>Instructions</h3>
      {/* Recycled chat composer: the @file autocomplete dropdown + attached-file
          chips. Chips are a live view of the `@token`s in the prompt, so
          removing a chip edits the prompt itself. */}
      <FileContextPanel
        input={promptValue}
        setInput={setPromptInput}
        projectFiles={projectFiles}
        inputRef={promptRef}
        showAtAutocomplete={showAtAutocomplete}
        setShowAtAutocomplete={setShowAtAutocomplete}
        atQuery={atQuery}
        atSelectedIndex={atSelectedIndex}
        setAtSelectedIndex={setAtSelectedIndex}
        atCursorIndex={atCursorIndex}
      />
      <textarea
        ref={promptRef}
        id={`step-config-prompt-${stepId}`}
        className="step-config-textarea"
        data-testid="step-info-prompt"
        value={promptValue}
        onChange={handlePromptChange}
        onKeyDown={handlePromptKeyDown}
        placeholder="Describe what this step should do… Type @ to attach a file."
        aria-labelledby={promptHeadingId}
        aria-describedby={promptHintId}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showAtAutocomplete}
        aria-controls={showAtAutocomplete ? 'file-autocomplete-listbox' : undefined}
        aria-activedescendant={showAtAutocomplete ? `file-option-${atSelectedIndex}` : undefined}
        rows={6}
      />
      <p id={promptHintId} className="step-config-hint">
        This text is what the agent executes for this step. Type <kbd>@</kbd> to attach a workspace file as context.
      </p>

      {/* ── Role (Single Persona helm) ── */}
      <h3 className="step-config-section-label" id={rolesHeadingId}>Role</h3>
      {roles.length > 0 ? (
        // Single-select listbox: the assigned persona is the sole aria-selected
        // option (see RoleRow). A different persona is picked below; attaching
        // one replaces the current (addRoleToStep's client-side affordance).
        <div className="step-config-atom-list" role="listbox" aria-labelledby={rolesHeadingId}>
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

      {/* Execution-authority doctrine (F0 spec): the pickers above run fast
          client-side affordances (one role per step; incompatible mods
          rejected), but the FINAL authority is `validateStepAtoms` at run time
          (main process). Surfacing that here is the contract — the UI reuses
          the affordances AND makes the run-time veto visible, rather than
          silently implying the client checks are the whole story. The veto
          itself appears in Run evidence (StepRunEvidence, owned elsewhere). */}
      <p
        className="step-config-hint"
        role="note"
        data-testid="step-config-execution-authority"
        style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}
      >
        <LucideIcon name="ShieldCheck" size={12} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          One persona per step, and mod compatibility, are finally verified when the step runs —
          any conflict is vetoed at run time and shown in Run evidence.
        </span>
      </p>

      {/* ── Execution ── */}
      <h3 className="step-config-section-label">Execution</h3>

      <label htmlFor={`step-config-model-${stepId}`} className="step-config-label">
        Model override (optional)
      </label>
      <input
        id={`step-config-model-${stepId}`}
        type="text"
        className="step-config-select"
        style={{ width: '100%' }}
        data-testid="step-info-model-override"
        placeholder="provider/model — overrides routing"
        value={modelOverrideValue}
        onChange={handleModelOverrideChange}
        onBlur={handleModelOverrideBlur}
      />
      <p className="step-config-hint">
        Beats this flow's Model policy and the router's pick — for this step only.
      </p>

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
    </>
  );
}
