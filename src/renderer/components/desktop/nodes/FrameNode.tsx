import type { NodeProps } from '@xyflow/react';
import type { FrameNodeData } from '@/types/desktop';

export function FrameNode({ id, data }: NodeProps) {
  const frameData = data as unknown as FrameNodeData;
  const stepCount = frameData.childIds.length;
  const stepLabel = stepCount === 1 ? '1 step' : `${stepCount} steps`;

  return (
    <section
      className="pipeline-frame-node"
      data-testid={`pipeline-frame-${id}`}
      aria-label={`Pipeline frame ${frameData.title}`}
    >
      <div className="pipeline-frame-title">
        <span>Frame</span>
        <strong>{frameData.title}</strong>
        <span className="pipeline-frame-count">{stepLabel}</span>
      </div>
      {frameData.description && (
        <div className="pipeline-frame-meta">
          <p className="pipeline-frame-desc">{frameData.description}</p>
        </div>
      )}
      {frameData.missingCapabilitiesRequested && frameData.missingCapabilitiesRequested.length > 0 && (
        <div className="pipeline-frame-missing" aria-label="Missing capabilities requested">
          {frameData.missingCapabilitiesRequested.length}
        </div>
      )}
    </section>
  );
}
