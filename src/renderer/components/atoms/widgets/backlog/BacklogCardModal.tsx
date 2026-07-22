/**
 * BacklogCardModal.tsx — canvas-level backlog card detail modal (F2 Task 9,
 * full build-out — replaces the Task 1 cutover shell).
 *
 * Ported verbatim from the frozen reference's `renderModal()`
 * (docs/superpowers/specs/2026-07-08-backlog-bento-reference.tsx:304-563):
 * header (id badge, StatusShape, status badge, editable title, edit/close
 * buttons), body left column (description with edit textarea, attachments,
 * related tasks, comments + input), body right column (BacklogModalSidebar).
 *
 * Canvas-level surface — mounted directly in SeamlessCanvas.tsx (not inside
 * the resizable widget wrapper), same as the deleted
 * desktop/BacklogCardModal.tsx. Its `fixed inset-0` / `max-h-[90vh]` /
 * `sticky top-0` positioning is a legitimate full-app-window overlay by
 * design (same as every other modal in this app), NOT the widget-wrapper
 * case Gate 1's "min-h-screen/sticky -> wrapper-relative" deviation targets
 * (that one only applies to BacklogBentoWidget's own root).
 *
 * Data seam: `canvasModalCard`/`openCanvasModal`/`closeCanvasModal`
 * (desktop-store.ts) — already the exact seam the task doc calls out, so a
 * related-task click "opening" another card just replaces
 * `canvasModalCard` in place (no modal stacking needed).
 *
 * Edit-save and comment-submit both call the new
 * `fluxor:update-backlog-card-content` IPC path (added in this task)
 * through `activeBacklogDir` (a small new transient desktop-store field —
 * also added in this task — since this canvas-level modal has no other
 * route to "which directory does this card's file live in").
 *
 * Status/priority badge LABELS are EN (statusConfig.ts/priorityConfig.ts —
 * task doc resolved decision #2); the sidebar's assignees empty state is EN
 * ("Unassigned", Task 8). All other copy here (section headers,
 * placeholders, empty states, the new-comment author "Tú") ports the
 * reference's Spanish verbatim per Gate 1 — see this task's final report
 * for the exact scoping of that decision.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDesktopStore } from '@/renderer/store/desktop-store';
import { LucideIcon } from '@/renderer/components/desktop/LucideIcon';
import { theme } from '@/renderer/logic/theme';
import { STATUS_CONFIG } from './statusConfig';
import { PRIORITY_CONFIG } from './priorityConfig';
import { StatusShape } from './StatusShape';
import { BacklogModalSidebar } from './BacklogModalSidebar';
import { formatCardDate } from './BacklogCardItem';
import { LaunchMenu } from './LaunchMenu';
import { launchAutoflow, launchEpicFlow, launchExistingFlow } from './launchActions';
import type { BacklogCard, BacklogComment } from '@/types/market';
import type { CanvasGraphNode, FrameGraphNode } from '@/types/desktop';

function isFrameGraphNode(node: CanvasGraphNode): node is FrameGraphNode {
  return node.type === 'frame';
}

interface EditForm {
  title: string;
  description: string;
}

export function BacklogCardModal() {
  const modalCard = useDesktopStore((s) => s.canvasModalCard);
  const closeModal = useDesktopStore((s) => s.closeCanvasModal);
  const openCanvasModal = useDesktopStore((s) => s.openCanvasModal);
  const backlogCards = useDesktopStore((s) => s.backlogCards);
  const setBacklogCards = useDesktopStore((s) => s.setBacklogCards);
  const activeBacklogDir = useDesktopStore((s) => s.activeBacklogDir);
  // F3 launchers — see launchActions.ts for the actual orchestration (zero
  // new materializer: runFrameWithContext / assemblePipeline+
  // insertPipelineAssembly+runFromStep, both already-existing seams).
  const mentalNodes = useDesktopStore((s) => s.mentalNodes);
  const frames = useMemo(
    () => mentalNodes.filter(isFrameGraphNode).map((f) => ({ id: f.id, title: f.data.title })),
    [mentalNodes],
  );

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>({ title: '', description: '' });
  const [newComment, setNewComment] = useState('');

  // Reset local edit state whenever a DIFFERENT card is shown (initial open,
  // or a related-task navigation swapping canvasModalCard in place) — keyed
  // on filename only, so an in-place content patch of the SAME card (our own
  // optimistic write-back after save) never clobbers in-progress edits.
  useEffect(() => {
    if (!modalCard) return;
    setIsEditing(false);
    setEditForm({ title: modalCard.title, description: modalCard.description });
    setNewComment('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalCard?.filename]);

  useEffect(() => {
    if (!modalCard) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeModal(); }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [modalCard, closeModal]);

  const patchCard = useCallback((patch: Partial<BacklogCard>) => {
    if (!modalCard) return;
    setBacklogCards(backlogCards.map((c) => (c.filename === modalCard.filename ? { ...c, ...patch } : c)));
    openCanvasModal({ ...modalCard, ...patch });
  }, [modalCard, backlogCards, setBacklogCards, openCanvasModal]);

  const handleSaveEdit = useCallback(async () => {
    if (!modalCard) return;
    const nextTitle = editForm.title.trim() || modalCard.title;
    const nextDescription = editForm.description;
    if (activeBacklogDir) {
      await window.fluxorAPI?.updateBacklogCardContent(activeBacklogDir, modalCard.filename, {
        title: nextTitle,
        description: nextDescription,
      });
    }
    patchCard({ title: nextTitle, description: nextDescription });
    setIsEditing(false);
  }, [modalCard, editForm, activeBacklogDir, patchCard]);

  const handleAddComment = useCallback(async () => {
    if (!modalCard || !newComment.trim()) return;
    const author = 'Tú';
    const text = newComment.trim();
    if (activeBacklogDir) {
      await window.fluxorAPI?.updateBacklogCardContent(activeBacklogDir, modalCard.filename, {
        newComment: { author, text },
      });
    }
    const comment: BacklogComment = { author, date: new Date().toISOString(), text };
    patchCard({ comments: [...modalCard.comments, comment] });
    setNewComment('');
  }, [modalCard, newComment, activeBacklogDir, patchCard]);

  if (!modalCard) return null;

  const statusObj = STATUS_CONFIG[modalCard.status];
  const priorityInfo = PRIORITY_CONFIG[modalCard.priority] ?? PRIORITY_CONFIG.medium;
  const relatedCards = modalCard.related
    .map((taskId) => backlogCards.find((c) => c.taskId === taskId))
    .filter((c): c is BacklogCard => !!c);
  // Bound once — see LaunchMenu.tsx's own comment on why a locally-bound
  // const (not a re-evaluated `modalCard.epic` read) is what survives
  // narrowing into a closure.
  const epic = modalCard.epic;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/40 backdrop-blur-md font-bold"
      onClick={closeModal}
      style={{ fontFamily: theme.fontDisplay }}
      data-testid="backlog-card-modal"
    >
      <div
        className="bg-white rounded-3xl w-full max-w-5xl max-h-[90vh] overflow-y-auto border border-black shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-6 border-b border-black bg-neutral-50 gap-4 sticky top-0 z-10">
          <div className="flex-1 w-full">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-xs font-black bg-black text-white px-3 py-1 rounded-full uppercase tracking-widest">{modalCard.taskId}</span>
              <StatusShape sides={statusObj.sides} className="w-6 h-6" fillClass={statusObj.fillClass} strokeClass={statusObj.strokeClass} />
              <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-extrabold uppercase ${statusObj.colorClass}`}>
                <LucideIcon name={statusObj.icon} size={16} strokeWidth={2.5} />
                {statusObj.label}
              </div>
            </div>

            {isEditing ? (
              <input
                type="text"
                value={editForm.title}
                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                className="text-2xl sm:text-3xl font-black text-black border-b-2 border-black outline-none bg-white p-2 rounded-t-lg w-full mt-2"
              />
            ) : (
              <h2 className="text-2xl sm:text-3xl font-black text-black leading-tight mt-2">{modalCard.title}</h2>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <LaunchMenu
              variant="full"
              card={modalCard}
              frames={frames}
              onLaunchExisting={(frameId) => { void launchExistingFlow(modalCard, frameId, activeBacklogDir); }}
              onLaunchAutoflow={() => { void launchAutoflow(modalCard, activeBacklogDir); }}
              onLaunchEpic={epic ? () => { void launchEpicFlow(epic, activeBacklogDir); } : undefined}
            />
            {isEditing ? (
              <button onClick={handleSaveEdit} aria-label="Save edit" className="p-3 hover:bg-emerald-100 text-emerald-700 rounded-full transition-colors border border-emerald-300">
                <LucideIcon name="Check" size={24} />
              </button>
            ) : (
              <button onClick={() => setIsEditing(true)} aria-label="Edit card" className="p-3 hover:bg-black/10 rounded-full transition-colors">
                <LucideIcon name="Edit3" size={24} />
              </button>
            )}
            <button onClick={closeModal} aria-label="Close modal" className="p-3 hover:bg-black/10 rounded-full transition-colors">
              <LucideIcon name="X" size={24} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-col md:flex-row p-6 gap-8 relative">
          {/* Main Content (Left) */}
          <div className="flex-1 flex flex-col gap-8">
            {/* Descripción */}
            <div>
              <h3 className="text-sm font-extrabold uppercase tracking-wider mb-3 border-b border-black/10 pb-2 flex items-center gap-2">
                <LucideIcon name="AlignLeft" size={18} /> Descripción Completa
              </h3>
              {isEditing ? (
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  className="w-full min-h-[150px] p-4 font-bold text-black border border-black rounded-xl bg-neutral-50 outline-none focus:ring-2 focus:ring-black"
                />
              ) : (
                <p className="text-base text-black/80 font-bold whitespace-pre-wrap leading-relaxed">
                  {modalCard.description || 'Sin descripción detallada.'}
                </p>
              )}
            </div>

            {/* Adjuntos */}
            <div>
              <h3 className="text-sm font-extrabold uppercase tracking-wider mb-3 border-b border-black/10 pb-2 flex items-center gap-2">
                <LucideIcon name="Paperclip" size={18} /> Archivos Adjuntos
              </h3>
              {modalCard.attachments.length > 0 ? (
                <div className="flex flex-wrap gap-3">
                  {modalCard.attachments.map((file, idx) => (
                    <div key={idx} className="flex items-center gap-3 p-3 bg-neutral-100 border border-neutral-300 rounded-xl hover:border-black cursor-pointer transition-colors group">
                      <div className="bg-black text-white p-2 rounded-lg group-hover:scale-105 transition-transform">
                        <LucideIcon name="Paperclip" size={16} />
                      </div>
                      <div>
                        <p className="text-sm font-extrabold text-black">{file.name}</p>
                        <p className="text-xs text-neutral-500 font-bold">{file.size ?? '—'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-neutral-500 italic font-bold">No hay archivos adjuntos.</p>
              )}
            </div>

            {/* Tareas Relacionadas */}
            {relatedCards.length > 0 && (
              <div>
                <h3 className="text-sm font-extrabold uppercase tracking-wider mb-3 border-b border-black/10 pb-2 flex items-center gap-2">
                  <LucideIcon name="Link2" size={18} /> Tareas Relacionadas
                </h3>
                <div className="flex flex-col gap-2">
                  {relatedCards.map((relCard) => {
                    const relStatus = STATUS_CONFIG[relCard.status];
                    return (
                      <div
                        key={relCard.filename}
                        onClick={() => openCanvasModal(relCard)}
                        className="flex items-center justify-between p-3 bg-white border border-black/20 rounded-xl hover:border-black cursor-pointer transition-colors group"
                      >
                        <div className="flex items-center gap-3 overflow-hidden">
                          <span className="text-xs font-black bg-neutral-200 px-2 py-1 rounded">{relCard.taskId}</span>
                          <span className="text-sm font-bold truncate group-hover:underline">{relCard.title}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <StatusShape sides={relStatus.sides} className="w-5 h-5" fillClass={relStatus.fillClass} strokeClass={relStatus.strokeClass} />
                          <div className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-extrabold uppercase ${relStatus.colorClass}`}>
                            <LucideIcon name={relStatus.icon} size={12} strokeWidth={2.5} />
                            {relStatus.label}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Comentarios */}
            <div className="mt-4 pt-4 border-t border-black/10">
              <h3 className="text-sm font-extrabold uppercase tracking-wider mb-4 flex items-center gap-2">
                <LucideIcon name="MessageSquare" size={18} /> Conversación
              </h3>

              <div className="flex flex-col gap-4 mb-4">
                {modalCard.comments.length > 0 ? (
                  modalCard.comments.map((comment, idx) => (
                    <div key={idx} className="flex gap-3">
                      <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center shrink-0 font-black text-xs">
                        {comment.author.charAt(0)}
                      </div>
                      <div className="bg-neutral-100 p-3 rounded-2xl rounded-tl-none border border-black/5 w-full">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-black">{comment.author}</span>
                          <span className="text-[10px] font-bold text-neutral-500">{formatCardDate(comment.date)}</span>
                        </div>
                        <p className="text-sm font-bold text-black/80">{comment.text}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-neutral-500 italic font-bold text-center py-4 bg-neutral-50 rounded-xl border border-dashed border-neutral-300">
                    Aún no hay comentarios. Sé el primero.
                  </p>
                )}
              </div>

              {/* Input de Comentario */}
              <div className="flex items-end gap-2 mt-4">
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Escribe un comentario..."
                  className="flex-1 min-h-[60px] p-3 font-bold text-sm bg-neutral-50 border border-black rounded-xl outline-none focus:ring-2 focus:ring-black resize-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleAddComment();
                    }
                  }}
                />
                <button
                  onClick={handleAddComment}
                  disabled={!newComment.trim()}
                  aria-label="Send comment"
                  className="p-3 bg-black text-white rounded-xl hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
                >
                  <LucideIcon name="Send" size={20} />
                </button>
              </div>
            </div>
          </div>

          {/* Sidebar Metadata (Right) */}
          <BacklogModalSidebar card={modalCard} />
        </div>
      </div>
    </div>
  );
}
