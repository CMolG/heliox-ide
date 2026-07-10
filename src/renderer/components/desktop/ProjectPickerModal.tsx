/**
 * ProjectPickerModal.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders the ProjectPickerModal surface in the renderer layer.
 * - Encapsulates Desktop canvas/window composition within the renderer workspace.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/desktop/ProjectPickerModal.tsx — Modal for selecting child project before new chat
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useFluxorStore } from '../../store';
import { theme } from '../../logic/theme';
import { LucideIcon } from './LucideIcon';

interface ProjectPickerModalProps {
  onSelect: (projectPath: string) => void;
  onClose: () => void;
}

interface ChildProject {
  name: string;
  path: string;
}

export function ProjectPickerModal({ onSelect, onClose }: ProjectPickerModalProps) {
  const projectPath = useFluxorStore(s => s.projectPath);
  const [children, setChildren] = useState<ChildProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!projectPath || !window.fluxorAPI) return;
    let cancelled = false;

    (async () => {
      try {
        const entries = await window.fluxorAPI!.readDirectory(projectPath);
        if (cancelled) return;
        // Filter to directories that look like projects (have package.json, .git, Cargo.toml, etc.)
        const projects: ChildProject[] = [];
        for (const entry of entries) {
          if (!entry.isDirectory) continue;
          // Check if directory looks like a project
          try {
            const subEntries = await window.fluxorAPI!.readDirectory(entry.path);
            const names = new Set(subEntries.map(e => e.name));
            const isProject = names.has('package.json') || names.has('.git') || names.has('Cargo.toml')
              || names.has('pom.xml') || names.has('build.gradle') || names.has('go.mod')
              || names.has('pyproject.toml') || names.has('requirements.txt') || names.has('Makefile')
              || names.has('.gitignore') || names.has('tsconfig.json') || names.has('setup.py');
            if (isProject) {
              projects.push({ name: entry.name, path: entry.path });
            }
          } catch { /* skip inaccessible */ }
        }
        if (!cancelled) {
          setChildren(projects);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [projectPath]);

  const filtered = useMemo(() => {
    if (!search) return children;
    const q = search.toLowerCase();
    return children.filter(p => p.name.toLowerCase().includes(q));
  }, [children, search]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  return (
    <div
      className="animate-fade-in"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      data-testid="project-picker-modal"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-picker-title"
        onClick={e => e.stopPropagation()}
        style={{
          background: theme.surface, border: `1px solid ${theme.borderLight}`,
          borderRadius: 16, width: 420, maxHeight: '70vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px 12px', borderBottom: `1px solid ${theme.borderLight}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 id="project-picker-title" style={{ margin: 0, fontSize: 14, fontWeight: 600, color: theme.textPrimary }}>
              Select Project
            </h3>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.textDim }}
              aria-label="Close project picker"
            >
              <LucideIcon name="X" size={16} />
            </button>
          </div>
          <input
            type="text"
            placeholder="Search projects..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
            aria-label="Search projects"
            data-testid="project-picker-search"
            style={{
              width: '100%', background: theme.bg, border: `1px solid ${theme.borderLight}`,
              borderRadius: 8, padding: '8px 12px', color: theme.textPrimary,
              fontSize: 13, outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Project list */}
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
          {/* Root project option — always available */}
          <button
            onClick={() => onSelect(projectPath!)}
            aria-label="Use root project"
            data-testid="project-pick-root"
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              width: '100%', padding: '10px 12px', border: 'none',
              borderRadius: 8, cursor: 'pointer', textAlign: 'left',
              background: 'rgba(214,211,209,0.04)', color: theme.textPrimary,
              marginBottom: 4, transition: 'background 0.1s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(214,211,209,0.08)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(214,211,209,0.04)'; }}
          >
            <LucideIcon name="FolderRoot" size={16} style={{ color: 'var(--cli-accent)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Root project</div>
              <div style={{ fontSize: 10, color: theme.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {projectPath}
              </div>
            </div>
            <LucideIcon name="ChevronRight" size={14} style={{ color: theme.textGhost, flexShrink: 0 }} />
          </button>

          {loading ? (
            <div style={{ padding: 20, textAlign: 'center', color: theme.textDim, fontSize: 12 }}>
              Scanning child projects…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: theme.textDim, fontSize: 12 }}>
              {children.length === 0 ? 'No child projects found' : 'No matches'}
            </div>
          ) : (
            filtered.map(project => (
              <button
                key={project.path}
                onClick={() => onSelect(project.path)}
                aria-label={`Open ${project.name}`}
                data-testid={`project-pick-${project.name}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '10px 12px', border: 'none',
                  borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                  background: 'transparent', color: theme.textPrimary,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(214,211,209,0.06)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <LucideIcon name="Folder" size={16} style={{ color: 'var(--cli-accent)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {project.name}
                  </div>
                  <div style={{ fontSize: 10, color: theme.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {project.path}
                  </div>
                </div>
                <LucideIcon name="ChevronRight" size={14} style={{ color: theme.textGhost, flexShrink: 0 }} />
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
