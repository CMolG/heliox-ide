/**
 * ProjectExplorer.tsx — Renderer Composite Component
 *
 * Responsibility:
 * - Renders the ProjectExplorer surface in the renderer layer.
 * - Encapsulates Feature-level composition used by the renderer shell and panels.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/ProjectExplorer.tsx — Shown when no project is open
import React, { useState, useCallback, useEffect } from 'react';
import { useHelioxStore } from '../store';
import { errMsg } from '@/types';
import { theme } from '../logic/theme';
import { HelioxLogo } from './brand/HelioxLogo';

export function ProjectExplorer() {
  const { recentProjects, setProjectPath, addRecentProject } = useHelioxStore();
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpening, setIsOpening] = useState(false);

  const handleOpenFolder = useCallback(async () => {
    if (isOpening) return;
    setError(null);
    setIsOpening(true);

    try {
      if (!window.helioxAPI) {
        setError('IPC bridge not available — restart the app');
        return;
      }
      const path = await window.helioxAPI.openFolderDialog();
      if (path) {
        setProjectPath(path);
        addRecentProject(path);
      }
    } catch (err) {
      setError(`Failed to open folder: ${errMsg(err)}`);
    } finally {
      setIsOpening(false);
    }
  }, [isOpening, setProjectPath, addRecentProject]);

  const handleOpenRecent = useCallback((path: string) => {
    setProjectPath(path);
    addRecentProject(path);
  }, [setProjectPath, addRecentProject]);

  useEffect(() => {
    const handler = () => handleOpenFolder();
    window.addEventListener('heliox:open-project', handler);
    return () => window.removeEventListener('heliox:open-project', handler);
  }, [handleOpenFolder]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    const folder = files.find(f => !f.type);
    if (folder) {
      const path = (folder as any).path;
      if (path) {
        setProjectPath(path);
        addRecentProject(path);
      }
    }
  }, [setProjectPath, addRecentProject]);

  const projectName = (path: string) => path.split('/').filter(Boolean).pop() ?? path;

  return (
    <main
      className="flex flex-col items-center justify-center h-full overflow-hidden relative"
      style={{
        gridColumn: '2 / -1',
        gridRow: '2',
        background: theme.bgApp,
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex flex-col items-center gap-12 max-w-md w-full px-8">
        {/* Heliox brand mark */}
        <div className="flex flex-col items-center gap-4">
          <HelioxLogo size={76} />
          <div className="text-center">
            <h1
              className="text-2xl font-bold leading-8"
              style={{ fontFamily: theme.fontDisplay, color: theme.textSecondary, letterSpacing: '0.02em' }}
            >
              Open a project
            </h1>
            <p
              className="text-sm font-normal mt-2 leading-5"
              style={{ fontFamily: theme.fontManrope, color: theme.textFaint }}
            >
              Select a folder to start working with the Heliox agent
            </p>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div
            className="w-full px-4 py-3 rounded-xl text-sm"
            style={{
              fontFamily: theme.fontManrope,
              color: '#fca5a5',
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.2)',
            }}
          >
            {error}
          </div>
        )}

        {/* Open button */}
        <button
          onClick={handleOpenFolder}
          disabled={isOpening}
          aria-label="Open project folder"
          className="w-full py-4 rounded-full flex items-center justify-center gap-3 transition hover:brightness-125 disabled:opacity-50"
          style={{
            background: 'linear-gradient(180deg, rgba(229,231,235,0.12) 0%, rgba(161,161,170,0.12) 100%)',
            outline: '1px solid rgba(214,211,209,0.1)',
            outlineOffset: '-1px',
            boxShadow: 'inset 0px 1px 4px 0px rgba(255,255,255,0.1)',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 13V3h4.5l1.5 2H14v8H2z" stroke="#a3a3a3" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          <span
            className="text-sm font-bold uppercase tracking-wider"
              style={{ fontFamily: theme.fontGrotesk, color: theme.textMid }}
          >
            {isOpening ? 'Opening…' : 'Open Folder'}
          </span>
        </button>

        {/* Keyboard shortcut hint */}
        <div className="flex items-center gap-2">
          <kbd
            className="px-1.5 py-0.5 rounded text-[10px]"
            style={{
              fontFamily: theme.fontInter,
              color: theme.textFaint,
              background: 'rgba(63,63,70,0.2)',
              border: '1px solid rgba(63,63,70,0.2)',
            }}
          >
            ⌘O
          </kbd>
          <span
            className="text-[10px] uppercase tracking-wide"
            style={{ fontFamily: theme.fontInter, color: theme.textGhost }}
          >
            or drag a folder here
          </span>
        </div>

        {/* Recent projects */}
        {recentProjects.length > 0 && (
          <div className="w-full flex flex-col gap-3">
            <span
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ fontFamily: theme.fontInter, color: theme.textGhost }}
            >
              Recent Projects
            </span>
            <div className="flex flex-col gap-1">
              {recentProjects.map((path) => (
                <button
                  key={path}
                  onClick={() => handleOpenRecent(path)}
                  aria-label={`Open recent project: ${projectName(path)}`}
                  className="w-full text-left px-4 py-3 rounded-2xl flex items-center gap-3 transition hover:bg-white/[0.03]"
                  style={{ outline: '1px solid rgba(63,63,70,0.08)', outlineOffset: '-1px' }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M1.5 11.5V2.5h3.5l1 1.5H12.5v7.5h-11z" stroke="#525252" strokeWidth="1" strokeLinejoin="round" />
                  </svg>
                  <div className="flex flex-col overflow-hidden">
                    <span
                      className="text-sm font-medium leading-5 truncate"
                      style={{ fontFamily: theme.fontGrotesk, color: theme.textMuted }}
                    >
                      {projectName(path)}
                    </span>
                    <span
                      className="text-[10px] font-normal leading-3 truncate"
                      style={{ fontFamily: theme.fontManrope, color: theme.textGhost }}
                    >
                      {path}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Drag overlay */}
      {isDragOver && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            background: 'rgba(12,10,9,0.9)',
            border: '2px dashed rgba(214,211,209,0.2)',
            zIndex: 100,
          }}
        >
          <div className="flex flex-col items-center gap-3">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <path d="M8 40V8h14l4 6H40v26H8z" stroke="#d6d3d1" strokeWidth="2" strokeLinejoin="round" />
            </svg>
            <span
              className="text-lg font-bold"
              style={{ fontFamily: theme.fontGrotesk, color: theme.textSecondary }}
            >
              Drop folder to open
            </span>
          </div>
        </div>
      )}
    </main>
  );
}
