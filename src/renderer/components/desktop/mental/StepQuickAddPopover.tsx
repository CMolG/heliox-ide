/**
 * StepQuickAddPopover.tsx — One-click Role/Mod quick-add affordance
 *
 * Responsibility:
 * - Renders a small, searchable popover — portaled to document.body, anchored
 *   under whichever button opened it — that lets the user attach a Role or
 *   Mod to a step directly from its node, without opening the full Step
 *   Config modal (StepInfoModal.tsx).
 * - Applies the same eligibility rules as StepConfigCore's atom pickers
 *   (step-config/StepConfigCore.tsx) via the shared `filterAvailableRoles`/
 *   `filterAvailableMods` helpers (attachable-helpers.ts): the step's
 *   already-assigned role is excluded from the Roles list, and mods already
 *   attached OR incompatible with an attached mod are excluded from the Mods
 *   list — plus a case-insensitive name-substring search filter layered on
 *   top of both.
 *
 * Boundaries:
 * - Owns: this popover's own local search/error/hint UI state, and the
 *   `addRoleToStep`/`addModToStep` calls it triggers.
 * - Does NOT own: step-state persistence (desktop-store owns that), the
 *   full Step Config surface (StepConfigCore.tsx owns that — this popover is
 *   a faster, narrower path to the same two actions), or the panel/backdrop
 *   shell's origin (cloned from StepNode.tsx's own context-menu portal).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDesktopStore } from '../../../store/desktop-store';
import { LucideIcon } from '../LucideIcon';
import {
  domainMismatchHint,
  filterAvailableMods,
  filterAvailableRoles,
  kebabToTitle,
  modAttachRejectedMessage,
  roleAttachRejectedMessage,
} from '../attachable-helpers';
import type { StepNodeData } from '@/types/desktop';
import type { MarketMod, MarketRole } from '@/types/market';

// Kept in sync with `.step-quick-add`'s `max-height` in index.css — used only
// to decide whether the panel should flip above the anchor instead of below.
const POPOVER_MAX_HEIGHT = 320;

export interface StepQuickAddPopoverProps {
  stepId: string;
  stepData: StepNodeData;
  /**
   * Trigger button's position, captured by StepNode's `openQuickAdd`. Two
   * points, not one, because the panel can anchor from either its top or its
   * bottom depending on available viewport space:
   * - `x`: the trigger's left edge (`rect.left`) — shared by both placements.
   * - `y`: the trigger's `rect.bottom + 6` — where the panel's TOP edge
   *   lands in the common case (enough room below the trigger).
   * - `topY`: the trigger's `rect.top - 6` — where the panel's BOTTOM edge
   *   lands when flipped above the trigger instead (not enough room below).
   */
  anchor: { x: number; y: number; topY: number };
  onClose: () => void;
}

export function StepQuickAddPopover({ stepId, stepData, anchor, onClose }: StepQuickAddPopoverProps) {
  const marketInventory = useDesktopStore((s) => s.marketInventory);
  const addRoleToStep = useDesktopStore((s) => s.addRoleToStep);
  const addModToStep = useDesktopStore((s) => s.addModToStep);

  const [query, setQuery] = useState('');
  const [roleError, setRoleError] = useState<string | null>(null);
  const [modError, setModError] = useState<string | null>(null);
  const [modDomainHint, setModDomainHint] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Autofocus the search input on mount — this popover is keyboard-first:
  // typing immediately filters both lists, and the rows below are native
  // buttons reachable by Tab/Enter without ever touching the mouse.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const roles = stepData.roles ?? [];
  const mods = stepData.mods ?? [];
  // Roles are mutually exclusive (one per step) — the sole assigned role, if
  // any, is what the domain-mismatch hint below compares a newly-attached
  // mod against (mirrors StepConfigCore's `attachedRole`).
  const attachedRole = roles[0] ?? null;
  const normalizedQuery = query.trim().toLowerCase();

  // Eligibility (exclude-assigned / exclude-incompatible) is shared with
  // StepConfigCore's `availableRoles`/`availableMods` via filterAvailableRoles/
  // filterAvailableMods (attachable-helpers.ts); only the search-substring
  // filter is layered on top here, locally.
  const availableRoles = filterAvailableRoles(marketInventory?.roles ?? [], attachedRole)
    .filter((role) => !normalizedQuery || role.name.toLowerCase().includes(normalizedQuery));

  const availableMods = filterAvailableMods(marketInventory?.mods ?? [], mods)
    .filter((mod) => !normalizedQuery || mod.name.toLowerCase().includes(normalizedQuery));

  const handleAttachRole = useCallback((role: MarketRole) => {
    const ok = addRoleToStep(stepId, role);
    // Message wording shared with StepConfigCore.handleAttachRole (attachable-helpers.ts).
    setRoleError(ok ? null : roleAttachRejectedMessage(kebabToTitle(role.name)));
  }, [addRoleToStep, stepId]);

  const handleAttachMod = useCallback((mod: MarketMod) => {
    const ok = addModToStep(stepId, mod);
    if (!ok) {
      // Message wording shared with StepConfigCore.handleAttachMod (attachable-helpers.ts).
      setModError(modAttachRejectedMessage(kebabToTitle(mod.name)));
      setModDomainHint(null);
      return;
    }
    // Hard rejection (above) and this hint are mutually exclusive: the attach
    // already succeeded here, so this is purely informational (see the
    // `MarketDomain` doc comment in types/market.ts) — never a reason it
    // should have been blocked.
    setModError(null);
    setModDomainHint(domainMismatchHint(mod, attachedRole));
  }, [addModToStep, stepId, attachedRole]);

  // Escape closes — the only keyboard shortcut this popover intercepts;
  // everything else (Tab, Enter on a row, typing in the search box) is
  // native behavior. Mirrors StepNode.tsx's own context-menu backdrop.
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onClose();
  }, [onClose]);

  // Simple flip: if the panel would overflow the viewport bottom, anchor its
  // BOTTOM edge just above the button that opened it instead of its top just
  // below — mirrors how native context menus reposition near screen edges.
  // `anchor.topY` is already the trigger's `rect.top - 6` (see the `anchor`
  // prop doc comment above), i.e. exactly the Y-coordinate we want the
  // panel's bottom edge to land on. A CSS `bottom` is a distance measured
  // from the viewport's *bottom* edge, so converting that target
  // Y-coordinate to a `bottom` value is `window.innerHeight - anchor.topY`.
  const wouldOverflowBottom = anchor.y + POPOVER_MAX_HEIGHT > window.innerHeight;
  const panelStyle: React.CSSProperties = wouldOverflowBottom
    ? { left: anchor.x, bottom: window.innerHeight - anchor.topY }
    : { left: anchor.x, top: anchor.y };

  // Same aria-labelledby-to-a-real-heading convention StepConfigCore's atom
  // lists use (step-config/StepConfigCore.tsx), instead of a redundant
  // aria-label duplicating the visible section text.
  const rolesLabelId = `step-quick-add-roles-${stepId}`;
  const modsLabelId = `step-quick-add-mods-${stepId}`;

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 10002 }}
      onClick={onClose}
      onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      <div
        className="step-quick-add"
        data-testid="step-quick-add-popover"
        role="dialog"
        aria-label="Add roles and mods"
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          className="step-quick-add-search"
          data-testid="step-quick-add-search"
          placeholder="Search roles & mods…"
          aria-label="Search roles & mods"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="step-quick-add-section">
          <span className="step-quick-add-section-label" id={rolesLabelId}>Roles</span>
          {availableRoles.length > 0 ? (
            <div className="step-quick-add-list" role="group" aria-labelledby={rolesLabelId}>
              {availableRoles.map((role) => (
                <button
                  key={role.name}
                  type="button"
                  className="step-quick-add-row"
                  data-testid={`step-quick-add-role-${role.name}`}
                  onClick={() => handleAttachRole(role)}
                >
                  <span className="step-quick-add-row-icon" aria-hidden="true">
                    <LucideIcon name="User" size={12} />
                  </span>
                  <span className="step-quick-add-row-name">{kebabToTitle(role.name)}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="step-quick-add-empty">No roles found.</p>
          )}
          {roleError && (
            <p className="step-quick-add-error" role="status" data-testid="step-quick-add-role-error">
              {roleError}
            </p>
          )}
        </div>

        <div className="step-quick-add-section">
          <span className="step-quick-add-section-label" id={modsLabelId}>Mods</span>
          {availableMods.length > 0 ? (
            <div className="step-quick-add-list" role="group" aria-labelledby={modsLabelId}>
              {availableMods.map((mod) => (
                <button
                  key={mod.name}
                  type="button"
                  className="step-quick-add-row"
                  data-testid={`step-quick-add-mod-${mod.name}`}
                  onClick={() => handleAttachMod(mod)}
                >
                  <span className="step-quick-add-row-icon" aria-hidden="true">
                    <LucideIcon name="Wrench" size={12} />
                  </span>
                  <span className="step-quick-add-row-name">{kebabToTitle(mod.name)}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="step-quick-add-empty">No mods found.</p>
          )}
          {modError && (
            <p className="step-quick-add-error" role="status" data-testid="step-quick-add-mod-error">
              {modError}
            </p>
          )}
          {modDomainHint && (
            <p className="step-quick-add-hint" role="status" data-testid="step-quick-add-mod-domain-hint">
              <LucideIcon name="TriangleAlert" size={11} />
              <span>{modDomainHint}</span>
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
