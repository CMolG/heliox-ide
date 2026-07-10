/**
 * RolesEditor.tsx — Renderer Composite Component
 *
 * Responsibility:
 * - Renders the RolesEditor surface in the renderer layer.
 * - Encapsulates Feature-level composition used by the renderer shell and panels.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/RolesEditor.tsx — Agent Role management panel
import React, { useState, useCallback, useRef } from 'react';
import { useFluxorStore } from '../store';
import type { Role } from '@/types';
import { RoleIcon, ROLE_ICON_NAMES } from './ui/RoleIcon';
import { theme } from '../logic/theme';
import { FluxorDropdown } from './ui/FluxorDropdown';
import { useAutoSave } from '@/renderer/logic/hooks/useAutoSave';
const FALLBACK_MODELS = ['opencode/claude-sonnet-4-6'];

const PRESET_ROLES: { name: string; icon: string; description: string; systemPrompt: string }[] = [
  {
    name: 'Code Reviewer',
    icon: 'search',
    description: 'Senior code reviewer focused on quality',
    systemPrompt: 'You are a senior code reviewer. Focus on bugs, security, and performance. Be concise and direct.',
  },
  {
    name: 'Architect',
    icon: 'structure',
    description: 'System design and scalability expert',
    systemPrompt: 'You are a software architect. Think about system design, scalability, and maintainability. Propose patterns and trade-offs.',
  },
  {
    name: 'Debugger',
    icon: 'bug',
    description: 'Systematic root cause analysis',
    systemPrompt: 'You are a debugging expert. Systematically identify root causes. Check logs, trace execution flow, and suggest fixes.',
  },
  {
    name: 'Doc Writer',
    icon: 'edit',
    description: 'Clear, developer-friendly documentation',
    systemPrompt: 'You are a technical writer. Write clear, concise documentation. Use examples and keep it developer-friendly.',
  },
];

export function RolesEditor() {
  const { roles, addRole, updateRole, removeRole, sessions, saveRolesToProject, availableModels, addSession, updateSessionRole, setSelectedSessionId, setActiveTab, addToast } = useFluxorStore();
  const models = availableModels.length > 0 ? availableModels : FALLBACK_MODELS;
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formSystemPrompt, setFormSystemPrompt] = useState('');
  const [formModel, setFormModel] = useState('opencode/claude-sonnet-4-6');
  const [formTemperature, setFormTemperature] = useState(0.3);
  const [formMaxTokens, setFormMaxTokens] = useState(4096);
  const [formIcon, setFormIcon] = useState('cpu');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Auto-save roles to project config
  useAutoSave([roles, saveRolesToProject], saveRolesToProject);
  const nameRef = useRef<HTMLInputElement>(null);

  const selectedRole = roles.find(r => r.id === selectedRoleId);
  const activeSessions = sessions.filter(s => s.status === 'running' || s.status === 'waiting');
  const rolesInUse = new Set(activeSessions.map(s => s.roleId).filter(Boolean));

  const resetForm = () => {
    setFormName('');
    setFormDescription('');
    setFormSystemPrompt('');
    setFormModel('opencode/claude-sonnet-4-6');
    setFormTemperature(0.3);
    setFormMaxTokens(4096);
    setFormIcon('cpu');
  };

  const populateForm = (r: Role) => {
    setFormName(r.name);
    setFormDescription(r.description);
    setFormSystemPrompt(r.systemPrompt);
    setFormModel(r.model);
    setFormTemperature(r.temperature);
    setFormMaxTokens(r.maxTokens);
    setFormIcon(r.icon);
  };

  const handleCreate = useCallback(() => {
    if (!formName.trim()) return;
    const role: Role = {
      id: `role-${Date.now()}`,
      name: formName.trim(),
      description: formDescription.trim(),
      systemPrompt: formSystemPrompt.trim(),
      model: formModel,
      temperature: formTemperature,
      maxTokens: formMaxTokens,
      icon: formIcon,
      createdAt: Date.now(),
    };
    addRole(role);
    setIsCreating(false);
    setSelectedRoleId(role.id);
    resetForm();
  }, [formName, formDescription, formSystemPrompt, formModel, formTemperature, formMaxTokens, formIcon, addRole]);

  const handleSelectRole = useCallback((roleId: string) => {
    const role = roles.find(r => r.id === roleId);
    if (!role) return;
    setSelectedRoleId(roleId);
    populateForm(role);
    setIsCreating(false);
  }, [roles]);

  const handleSaveChanges = useCallback(() => {
    if (!selectedRoleId || !formName.trim()) return;
    updateRole(selectedRoleId, {
      name: formName.trim(),
      description: formDescription.trim(),
      systemPrompt: formSystemPrompt.trim(),
      model: formModel,
      temperature: formTemperature,
      maxTokens: formMaxTokens,
      icon: formIcon,
    });
  }, [selectedRoleId, formName, formDescription, formSystemPrompt, formModel, formTemperature, formMaxTokens, formIcon, updateRole]);

  const handleDelete = useCallback((roleId: string) => {
    if (confirmDelete === roleId) {
      removeRole(roleId);
      if (selectedRoleId === roleId) {
        setSelectedRoleId(null);
        resetForm();
      }
      setConfirmDelete(null);
    } else {
      setConfirmDelete(roleId);
      setTimeout(() => setConfirmDelete(null), 3000);
    }
  }, [confirmDelete, selectedRoleId, removeRole]);

  const handleCreateFromPreset = useCallback((preset: typeof PRESET_ROLES[number]) => {
    const role: Role = {
      id: `role-${Date.now()}`,
      name: preset.name,
      description: preset.description,
      systemPrompt: preset.systemPrompt,
      model: 'opencode/claude-sonnet-4-6',
      temperature: 0.3,
      maxTokens: 4096,
      icon: preset.icon,
      createdAt: Date.now(),
    };
    addRole(role);
    setSelectedRoleId(role.id);
    populateForm(role);
    setIsCreating(false);
    addToast(`Created role "${preset.name}"`, 'success');
  }, [addRole, addToast]);

  const handleTestRole = useCallback((roleId: string) => {
    const sessionId = addSession();
    updateSessionRole(sessionId, roleId);
    setSelectedSessionId(sessionId);
    setActiveTab('sessions');
    window.dispatchEvent(new CustomEvent('fluxor:focus-chat'));
    addToast('New session created with role — start chatting!', 'info');
  }, [addSession, updateSessionRole, setSelectedSessionId, setActiveTab, addToast]);

  return (
    <div className="flex flex-col overflow-hidden h-full" style={{ background: theme.bgApp }}>
      {/* Header */}
      <div
        className="h-16 px-8 flex items-center justify-between shrink-0"
        style={{ borderBottom: '1px solid rgba(63,63,70,0.1)' }}
      >
        <span className="text-sm font-medium leading-5" style={{ fontFamily: theme.fontGrotesk, color: theme.textSecondary }}>
          AGENT ROLES
        </span>
        <button
          onClick={() => { setIsCreating(true); setSelectedRoleId(null); resetForm(); setTimeout(() => nameRef.current?.focus(), 50); }}
          className="px-4 py-1.5 rounded-full text-[10px] font-semibold uppercase tracking-wider transition"
          aria-label="Add new role"
          style={{
            fontFamily: theme.fontInter,
            background: 'linear-gradient(180deg, rgba(229,231,235,0.2) 0%, rgba(161,161,170,0.2) 100%)',
            color: theme.textSecondary,
            boxShadow: 'inset 0px 1px 4px 0px rgba(255,255,255,0.25)',
          }}
        >
          + New Role
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
        {/* Preset role templates — only visible when creating a new role */}
        {isCreating && (
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>
              Quick Start Templates
            </span>
            <div className="grid grid-cols-4 gap-2">
              {PRESET_ROLES.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => handleCreateFromPreset(preset)}
                  className="text-left p-3 rounded-xl transition-all hover:brightness-125"
                  style={{ background: theme.surfaceMid, outline: '1px solid rgba(63,63,70,0.08)', outlineOffset: '-1px' }}
                >
                  <span className="text-base block mb-1"><RoleIcon icon={preset.icon} size={16} color="#a1a1aa" /></span>
                  <span className="text-[11px] font-medium block leading-4" style={{ fontFamily: theme.fontGrotesk, color: theme.textPrimary }}>
                    {preset.name}
                  </span>
                  <span className="text-[10px] font-normal leading-3 block mt-1 line-clamp-2" style={{ fontFamily: theme.fontManrope, color: theme.textDim }}>
                    {preset.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Role cards */}
        <div className="grid grid-cols-2 gap-3">
          {roles.map(role => {
            const isSelected = selectedRoleId === role.id;
            const inUse = rolesInUse.has(role.id);
            return (
              <button
                key={role.id}
                onClick={() => handleSelectRole(role.id)}
                aria-label={`Role: ${role.name}`}
                className="text-left p-4 rounded-[20px] transition-all"
                style={{
                  background: isSelected ? theme.surfaceHover : theme.surfaceMid,
                  outline: isSelected ? '1px solid rgba(214,211,209,0.15)' : '1px solid rgba(63,63,70,0.08)',
                  outlineOffset: '-1px',
                }}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-lg"><RoleIcon icon={role.icon} size={18} color="#a1a1aa" /></span>
                  <span className="text-sm font-medium leading-5 flex-1" style={{ fontFamily: theme.fontGrotesk, color: theme.textPrimary }}>
                    {role.name}
                  </span>
                  {inUse && (
                    <span className="w-1.5 h-1.5 rounded-full dot-pulse" style={{ background: theme.success }} />
                  )}
                </div>
                <span className="text-xs font-normal leading-4 line-clamp-2 block" style={{ fontFamily: theme.fontManrope, color: theme.textMuted }}>
                  {role.description}
                </span>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] font-normal uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textDim }}>
                    {role.model}
                  </span>
                  <span className="text-[10px] font-normal uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>
                    temp {role.temperature}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Edit / Create form */}
        {(selectedRole || isCreating) && (
          <div
            className="p-5 rounded-[24px] flex flex-col gap-4"
            style={{ background: theme.surfaceMid, outline: `1px solid ${theme.border}`, outlineOffset: '-1px' }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium" style={{ fontFamily: theme.fontGrotesk, color: theme.textPrimary }}>
                {isCreating ? 'Create Role' : 'Edit Role'}
              </span>
              {selectedRole && !isCreating && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleTestRole(selectedRole.id)}
                    aria-label={`Test ${selectedRole.name}`}
                    className="px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider transition"
                    style={{
                      fontFamily: theme.fontInter,
                      color: theme.success,
                      background: 'rgba(74,222,128,0.1)',
                    }}
                  >
                    Test Role
                  </button>
                  <button
                    onClick={() => handleDelete(selectedRole.id)}
                    aria-label={`Delete ${selectedRole.name}`}
                    className="px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider transition"
                    style={{
                      fontFamily: theme.fontInter,
                      color: confirmDelete === selectedRole.id ? '#ffffff' : theme.danger,
                      background: confirmDelete === selectedRole.id ? 'rgba(248,113,113,0.3)' : 'rgba(248,113,113,0.1)',
                    }}
                  >
                    {confirmDelete === selectedRole.id ? 'Confirm Delete' : 'Delete'}
                  </button>
                </div>
              )}
            </div>

            {/* Icon picker */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-normal uppercase tracking-wide shrink-0" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>
                Icon
              </span>
              <div className="flex gap-1 flex-wrap">
                {ROLE_ICON_NAMES.map(iconName => (
                  <button
                    key={iconName}
                    onClick={() => setFormIcon(iconName)}
                    aria-label={`Select ${iconName} icon`}
                    aria-pressed={formIcon === iconName}
                    className="w-7 h-7 rounded-lg flex items-center justify-center transition"
                    style={{
                      background: formIcon === iconName ? 'rgba(214,211,209,0.15)' : 'transparent',
                      outline: formIcon === iconName ? '1px solid rgba(214,211,209,0.2)' : 'none',
                    }}
                  >
                    <RoleIcon icon={iconName} size={14} color={formIcon === iconName ? theme.textSecondary : theme.textDim} />
                  </button>
                ))}
              </div>
            </div>

            <input
              ref={nameRef}
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Role name"
              aria-label="Role name"
              className="w-full bg-black text-sm rounded-lg px-4 py-2.5 outline-none"
              style={{ fontFamily: theme.fontGrotesk, color: theme.textPrimary, border: '1px solid rgba(63,63,70,0.2)' }}
            />

            <input
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="Brief description"
              aria-label="Role description"
              className="w-full bg-black text-xs rounded-lg px-4 py-2.5 outline-none"
              style={{ fontFamily: theme.fontManrope, color: theme.textMuted, border: '1px solid rgba(63,63,70,0.2)' }}
            />

            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-normal uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>
                System Prompt
              </span>
              <textarea
                value={formSystemPrompt}
                onChange={(e) => setFormSystemPrompt(e.target.value)}
                placeholder="Instructions that define how the agent behaves in this role..."
                rows={4}
                className="w-full bg-black text-xs rounded-lg px-4 py-3 outline-none resize-none"
                style={{ fontFamily: theme.fontManrope, color: theme.textMuted, border: '1px solid rgba(63,63,70,0.2)', lineHeight: '1.6' }}
              />
              {formSystemPrompt.trim() && (
                <div className="p-3 rounded-lg" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(63,63,70,0.15)' }}>
                  <span className="text-[10px] font-bold uppercase tracking-wide block mb-1.5" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>
                    Prompt Injection Preview
                  </span>
                  <div className="text-[11px] font-mono leading-5" style={{ color: theme.textDim }}>
                    <span style={{ color: theme.success }}>[Role: {formName || 'Unnamed'}]</span>
                    {'\n'}
                    <span>{formSystemPrompt.trim().slice(0, 120)}{formSystemPrompt.trim().length > 120 ? '…' : ''}</span>
                    {'\n\n'}
                    <span style={{ color: theme.textMuted }}>{'<user message>'}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-4">
              <div className="flex-1 flex flex-col gap-1">
                <span className="text-[10px] font-normal uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>
                  Model
                </span>
                <FluxorDropdown
                  value={formModel}
                  options={models.map(m => ({ value: m, label: m.toUpperCase() }))}
                  onChange={(v) => setFormModel(v)}
                  variant="field"
                  fontSize={12}
                  triggerStyle={{ textTransform: 'uppercase' }}
                />
              </div>
              <div className="w-24 flex flex-col gap-1">
                <span className="text-[10px] font-normal uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>
                  Temperature
                </span>
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={formTemperature}
                  onChange={(e) => setFormTemperature(parseFloat(e.target.value) || 0)}
                  className="w-full bg-black text-xs rounded-lg px-3 py-2 outline-none"
                  style={{ fontFamily: theme.fontInter, color: theme.textMuted, border: '1px solid rgba(63,63,70,0.2)' }}
                />
              </div>
              <div className="w-24 flex flex-col gap-1">
                <span className="text-[10px] font-normal uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>
                  Max Tokens
                </span>
                <input
                  type="number"
                  min="256"
                  max="32768"
                  step="256"
                  value={formMaxTokens}
                  onChange={(e) => setFormMaxTokens(parseInt(e.target.value) || 4096)}
                  className="w-full bg-black text-xs rounded-lg px-3 py-2 outline-none"
                  style={{ fontFamily: theme.fontInter, color: theme.textMuted, border: '1px solid rgba(63,63,70,0.2)' }}
                />
              </div>
            </div>

            <button
              onClick={isCreating ? handleCreate : handleSaveChanges}
              disabled={!formName.trim()}
              className="w-full py-2.5 rounded-full text-xs font-bold uppercase tracking-wider transition disabled:opacity-30"
              style={{
                fontFamily: theme.fontGrotesk,
                background: 'linear-gradient(180deg, rgba(229,231,235,0.2) 0%, rgba(161,161,170,0.2) 100%)',
                color: theme.textMid,
                boxShadow: 'inset 0px 1px 4px 0px rgba(255,255,255,0.25)',
              }}
            >
              {isCreating ? 'Create Role' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>

      {/* Bottom stats */}
      <div
        className="h-16 px-8 flex items-center gap-8 shrink-0"
        style={{ background: 'rgba(23,23,23,0.5)', borderTop: '1px solid rgba(63,63,70,0.1)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-normal uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>Roles</span>
          <span className="text-sm font-bold" style={{ fontFamily: theme.fontGrotesk, color: theme.textPrimary }}>{roles.length}</span>
        </div>
        <div className="w-px h-5" style={{ background: 'rgba(63,63,70,0.2)' }} />
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-normal uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>Active</span>
          <span className="text-sm font-bold" style={{ fontFamily: theme.fontGrotesk, color: rolesInUse.size > 0 ? '#4ade80' : theme.textPrimary }}>{rolesInUse.size}</span>
        </div>
      </div>
    </div>
  );
}
