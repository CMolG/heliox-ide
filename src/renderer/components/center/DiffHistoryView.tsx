/**
 * DiffHistoryView.tsx — Renderer Center Panel Component
 *
 * Responsibility:
 * - Renders the DiffHistoryView surface in the renderer layer.
 * - Encapsulates Center-pane visualization for sessions, diffs, and code context.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/center/DiffHistoryView.tsx — Diff history timeline view
import React, { useState } from 'react';
import { useHelioxStore } from '@/renderer/store';
import { theme } from '@/renderer/logic/theme';

export function DiffHistoryView() {
  const diffHistory = useHelioxStore((s) => s.diffHistory);
  const flows = useHelioxStore((s) => s.flows);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);

  const sorted = [...diffHistory].sort((a, b) => b.timestamp - a.timestamp);

  const getFlowName = (flowId: string) =>
    flows.find(f => f.id === flowId)?.name ?? flowId;

  const getStepName = (flowId: string, stepId: string) => {
    const flow = flows.find(f => f.id === flowId);
    return flow?.steps.find(s => s.id === stepId)?.name ?? stepId;
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  if (sorted.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-sm" style={{ fontFamily: theme.fontManrope, color: theme.textFaint }}>
          No diff history yet
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-3xl mx-auto flex flex-col gap-3">
          {sorted.map((record, i) => (
            <div
              key={`${record.stepId}-${record.timestamp}-${i}`}
              className="rounded-xl p-4 flex items-center gap-4"
              style={{ background: theme.surfaceLight, border: '1px solid rgba(63,63,70,0.12)' }}
            >
              {/* Thumbnails */}
              <button
                onClick={() => setExpandedImage(`data:image/png;base64,${record.before}`)}
                className="shrink-0 rounded-lg overflow-hidden transition hover:ring-1 hover:ring-zinc-600"
                style={{ width: 64, height: 48, background: theme.bg, border: `1px solid ${theme.borderLight}` }}
                title="Before — click to expand"
                aria-label="Expand before screenshot"
              >
                {record.before ? (
                  <img src={`data:image/png;base64,${record.before}`} alt="before" className="w-full h-full object-cover" />
                ) : (
                  <span className="flex items-center justify-center h-full text-[8px]" style={{ color: theme.textFaint }}>—</span>
                )}
              </button>
              <span className="text-zinc-600 text-xs select-none">→</span>
              <button
                onClick={() => setExpandedImage(`data:image/png;base64,${record.after}`)}
                className="shrink-0 rounded-lg overflow-hidden transition hover:ring-1 hover:ring-zinc-600"
                style={{ width: 64, height: 48, background: theme.bg, border: `1px solid ${theme.borderLight}` }}
                title="After — click to expand"
                aria-label="Expand after screenshot"
              >
                {record.after ? (
                  <img src={`data:image/png;base64,${record.after}`} alt="after" className="w-full h-full object-cover" />
                ) : (
                  <span className="flex items-center justify-center h-full text-[8px]" style={{ color: theme.textFaint }}>—</span>
                )}
              </button>

              {/* Info */}
              <div className="flex-1 min-w-0 flex flex-col gap-1 ml-2">
                <span className="text-xs font-medium truncate" style={{ fontFamily: theme.fontGrotesk, color: theme.textPrimary }}>
                  {getFlowName(record.flowId)}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wide truncate" style={{ fontFamily: theme.fontInter, color: theme.textDim }}>
                  {getStepName(record.flowId, record.stepId)}
                </span>
              </div>

              {/* Badge */}
              <span
                className="shrink-0 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
                style={{
                  fontFamily: theme.fontInter,
                  background: record.approved ? 'rgba(160,246,149,0.12)' : theme.dangerBg,
                  color: record.approved ? theme.success : theme.danger,
                  border: `1px solid ${record.approved ? theme.successBorder : theme.dangerBorder}`,
                }}
              >
                {record.approved ? 'Approved' : 'Rejected'}
              </span>

              {/* Timestamp */}
              <span className="shrink-0 text-[10px] tabular-nums" style={{ fontFamily: theme.fontManrope, color: theme.textFaint }}>
                {formatTime(record.timestamp)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Overlay for expanded thumbnail */}
      {expandedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
          onClick={() => setExpandedImage(null)}
        >
          <img
            src={expandedImage}
            alt="Expanded screenshot"
            className="max-w-[90vw] max-h-[90vh] rounded-2xl shadow-2xl"
            style={{ border: '1px solid rgba(63,63,70,0.2)' }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
