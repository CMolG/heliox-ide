import type { NodeProps } from '@xyflow/react';
import type { FrameNodeData } from '@/types/desktop';

export function FrameNode({ id, data }: NodeProps) {
  const frameData = data as unknown as FrameNodeData;

  return (
    <section
      className="pipeline-frame-node"
      data-testid={`pipeline-frame-${id}`}
      aria-label={`Pipeline frame ${frameData.title}`}
    >
      <div className="pipeline-frame-title">
        <span>Frame</span>
        <strong>{frameData.title}</strong>
      </div>
      {frameData.missingCapabilitiesRequested && frameData.missingCapabilitiesRequested.length > 0 && (
        <div className="pipeline-frame-missing" aria-label="Missing capabilities requested">
          {frameData.missingCapabilitiesRequested.length}
        </div>
      )}
    </section>
  );
}
