/**
 * retriever.test.ts — Unit tests for the `retrieve` function
 *
 * All tests use:
 * - InMemoryVectorStore — no SQLite, no I/O
 * - A deterministic axis-vector embed function — no model endpoint, offline
 *
 * Coverage:
 * 1. Empty store returns { chunks: [] } (no throw)
 * 2. Cosine ranking is correct: top chunk matches the query direction
 * 3. k limit is respected
 * 4. Embed error degrades gracefully to { chunks: [] }
 * 5. Retrieved chunks flow through buildStepContext into <retrieved_context>
 * 6. executor.ts executes a `retriever` step: injects chunks, emits checkpoint
 */
import { describe, expect, it, afterEach, vi } from 'vitest';
import { retrieve } from './retriever';
import { InMemoryVectorStore } from './knowledge/vector-store';
import { buildStepContext } from './context-builder';
import type { AgenticStep } from '../../types/harness';
import { executeAgenticFlow } from './executor';
import { harnessEventBus, HARNESS_EVENT_NAME } from './event-bus';
import type { HarnessEventPayload } from '../../types/ipc-events';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function axisVec(dim: number, axis: number): number[] {
  const v = new Array<number>(dim).fill(0);
  v[axis] = 1;
  return v;
}

/** Deterministic embed fn: maps query to axis vector based on its first char code % dim. */
function makeAxisEmbedFn(dim: number) {
  return (text: string): number[] => {
    const axis = text.length === 0 ? 0 : text.charCodeAt(0) % dim;
    return axisVec(dim, axis);
  };
}

function makeRetrieverStep(overrides: Partial<AgenticStep> = {}): AgenticStep {
  return {
    id: 'retriever-step',
    type: 'retriever',
    prompt: 'What is the capital of France?',
    tools: [],
    prevStepIds: [],
    nextStepIds: [],
    mods: [],
    roles: [],
    mentalContext: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// retrieve() — unit
// ---------------------------------------------------------------------------

describe('retrieve', () => {
  it('returns { chunks: [] } for an empty store (no throw)', async () => {
    const store = new InMemoryVectorStore();
    const result = await retrieve('any query', 5, store, makeAxisEmbedFn(4));
    expect(result).toEqual({ chunks: [] });
  });

  it('ranks chunks by cosine similarity correctly (top chunk matches query direction)', async () => {
    const DIM = 4;
    const store = new InMemoryVectorStore();

    // "Paris" → charCode('P') = 80; 80 % 4 = 0 → axis 0
    store.upsertChunk({ id: 'a', docId: 'doc-1', text: 'Paris is the capital of France.', embedding: axisVec(DIM, 0) });
    // "Berlin" → charCode('B') = 66; 66 % 4 = 2 → axis 2
    store.upsertChunk({ id: 'b', docId: 'doc-2', text: 'Berlin is the capital of Germany.', embedding: axisVec(DIM, 2) });
    // "Rome" → charCode('R') = 82; 82 % 4 = 2 → axis 2 (same bucket as b — still ranked by cosine)
    store.upsertChunk({ id: 'c', docId: 'doc-3', text: 'Rome is the capital of Italy.', embedding: axisVec(DIM, 1) });

    // Query "Paris..." → 'P'=80; 80%4=0 → axis-0 embed → cosine(chunk-a)=1.0, others=0
    const result = await retrieve('Paris is a city', 3, store, makeAxisEmbedFn(DIM));

    expect(result.chunks[0].text).toBe('Paris is the capital of France.');
    expect(result.chunks[0].score).toBeCloseTo(1.0, 6);
    expect(result.chunks[0].docId).toBe('doc-1');
  });

  it('respects the k limit', async () => {
    const DIM = 8;
    const store = new InMemoryVectorStore();
    for (let i = 0; i < 6; i++) {
      store.upsertChunk({ id: `chunk-${i}`, docId: 'doc', text: `text ${i}`, embedding: axisVec(DIM, i) });
    }

    const result = await retrieve('query', 3, store, makeAxisEmbedFn(DIM));
    expect(result.chunks).toHaveLength(3);
  });

  it('degrades gracefully to { chunks: [] } when the embed fn throws', async () => {
    const store = new InMemoryVectorStore();
    store.upsertChunk({ id: 'x', docId: 'doc', text: 'some text', embedding: axisVec(4, 0) });

    const throwingEmbed = () => { throw new Error('model not available'); };
    const result = await retrieve('query', 5, store, throwingEmbed);
    expect(result).toEqual({ chunks: [] });
  });

  it('returns all chunks when k >= store size', async () => {
    const DIM = 4;
    const store = new InMemoryVectorStore();
    store.upsertChunk({ id: 'a', docId: 'doc', text: 'alpha', embedding: axisVec(DIM, 0) });
    store.upsertChunk({ id: 'b', docId: 'doc', text: 'beta', embedding: axisVec(DIM, 1) });

    const result = await retrieve('query', 10, store, makeAxisEmbedFn(DIM));
    expect(result.chunks).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// buildStepContext — retrieved chunks flow into <retrieved_context>
// ---------------------------------------------------------------------------

describe('buildStepContext with injectedChunks', () => {
  it('injects retrieved chunks into the user prompt under <retrieved_context>', async () => {
    const step: AgenticStep = {
      id: 'step-1',
      type: 'retriever',
      prompt: 'Explain retrieval.',
      tools: [],
      prevStepIds: [],
      nextStepIds: [],
      mods: [],
      roles: [],
      mentalContext: [],
    };

    const chunks = [
      { text: 'Chunk A content', score: 0.95, docId: 'doc-1' },
      { text: 'Chunk B content', score: 0.72, docId: 'doc-2' },
    ];

    const context = await buildStepContext(step, { injectedChunks: chunks });

    expect(context.userPrompt).toContain('<retrieved_context>');
    expect(context.userPrompt).toContain('Chunk A content');
    expect(context.userPrompt).toContain('Chunk B content');
    expect(context.userPrompt).toContain('doc-1');
    expect(context.userPrompt).toContain('doc-2');
    expect(context.userPrompt).toContain('</retrieved_context>');
  });

  it('omits <retrieved_context> when no chunks are injected', async () => {
    const step: AgenticStep = {
      id: 'step-2',
      type: 'llm_call',
      prompt: 'Normal step.',
      tools: [],
      prevStepIds: [],
      nextStepIds: [],
      mods: [],
      roles: [],
      mentalContext: [],
    };

    const context = await buildStepContext(step);
    expect(context.userPrompt).not.toContain('<retrieved_context>');
  });

  it('omits <retrieved_context> when injectedChunks is an empty array', async () => {
    const step: AgenticStep = {
      id: 'step-3',
      type: 'retriever',
      prompt: 'Empty retrieval.',
      tools: [],
      prevStepIds: [],
      nextStepIds: [],
      mods: [],
      roles: [],
      mentalContext: [],
    };

    const context = await buildStepContext(step, { injectedChunks: [] });
    expect(context.userPrompt).not.toContain('<retrieved_context>');
  });
});

// ---------------------------------------------------------------------------
// executor.ts — retriever step integration
// ---------------------------------------------------------------------------

describe('executeAgenticFlow with retriever step', () => {
  afterEach(() => {
    harnessEventBus.removeAllListeners();
  });

  it('runs a retriever step: injects top-k chunks into context and emits checkpoint', async () => {
    const DIM = 4;
    const store = new InMemoryVectorStore();
    store.upsertChunk({ id: 'a', docId: 'doc-1', text: 'Paris is the capital of France.', embedding: axisVec(DIM, 0) });
    store.upsertChunk({ id: 'b', docId: 'doc-2', text: 'Berlin is the capital of Germany.', embedding: axisVec(DIM, 1) });
    store.upsertChunk({ id: 'c', docId: 'doc-3', text: 'Rome is the capital of Italy.', embedding: axisVec(DIM, 2) });

    // 'P' = 80; 80 % 4 = 0 → axis 0 → chunk-a has cosine 1.0
    const embedFn = makeAxisEmbedFn(DIM);

    const events: HarnessEventPayload[] = [];
    harnessEventBus.on(HARNESS_EVENT_NAME, (e) => events.push(e));

    await executeAgenticFlow(
      {
        id: 'flow-retriever',
        name: 'Retriever Flow',
        rootStepId: 'retriever-step',
        stepsRecord: {
          'retriever-step': makeRetrieverStep({ prompt: 'Paris query' }),
        },
      },
      { vectorStore: store, embedFn, retrieverK: 2 },
    );

    // Step status: running → completed
    const statusEvents = events.filter(
      (e): e is Extract<HarnessEventPayload, { type: 'StepStatusChanged' }> =>
        e.type === 'StepStatusChanged',
    );
    expect(statusEvents.some((e) => e.stepId === 'retriever-step' && e.status === 'running')).toBe(true);
    expect(statusEvents.some((e) => e.stepId === 'retriever-step' && e.status === 'completed')).toBe(true);

    // Completed log should contain the retrieved context XML tag
    const completed = statusEvents.find(
      (e) => e.stepId === 'retriever-step' && e.status === 'completed',
    );
    expect(completed?.logs).toContain('<retrieved_context>');

    // A checkpoint was emitted
    const checkpointEvent = events.find(
      (e): e is Extract<HarnessEventPayload, { type: 'CheckpointCreated' }> =>
        e.type === 'CheckpointCreated',
    );
    expect(checkpointEvent).toBeDefined();
    expect(checkpointEvent?.stepId).toBe('retriever-step');

    // Flow completed
    expect(events.at(-1)).toMatchObject({ type: 'FlowCompleted', flowId: 'flow-retriever' });
  });

  it('retriever step with empty store produces { chunks: [] } and still completes', async () => {
    const store = new InMemoryVectorStore(); // empty
    const embedFn = makeAxisEmbedFn(4);
    const events: HarnessEventPayload[] = [];
    harnessEventBus.on(HARNESS_EVENT_NAME, (e) => events.push(e));

    await executeAgenticFlow(
      {
        id: 'flow-empty-retriever',
        name: 'Empty Retriever Flow',
        rootStepId: 'retriever-step',
        stepsRecord: {
          'retriever-step': makeRetrieverStep(),
        },
      },
      { vectorStore: store, embedFn },
    );

    const statusEvents = events.filter(
      (e): e is Extract<HarnessEventPayload, { type: 'StepStatusChanged' }> =>
        e.type === 'StepStatusChanged',
    );
    expect(statusEvents.some((e) => e.stepId === 'retriever-step' && e.status === 'completed')).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'FlowCompleted' });
  });

  it('does NOT call runStep for retriever steps (no LLM inference)', async () => {
    const store = new InMemoryVectorStore();
    const embedFn = makeAxisEmbedFn(4);
    const runStep = vi.fn();

    await executeAgenticFlow(
      {
        id: 'flow-no-llm',
        name: 'No LLM Flow',
        rootStepId: 'retriever-step',
        stepsRecord: {
          'retriever-step': makeRetrieverStep(),
        },
      },
      { vectorStore: store, embedFn, runStep },
    );

    expect(runStep).not.toHaveBeenCalled();
  });

  it('retriever step does not break checkpoints from subsequent LLM steps', async () => {
    const DIM = 4;
    const store = new InMemoryVectorStore();
    store.upsertChunk({ id: 'a', docId: 'doc-1', text: 'Some content.', embedding: axisVec(DIM, 0) });

    const embedFn = makeAxisEmbedFn(DIM);
    const events: HarnessEventPayload[] = [];
    harnessEventBus.on(HARNESS_EVENT_NAME, (e) => events.push(e));

    const llmStep: AgenticStep = {
      id: 'llm-step',
      type: 'llm_call',
      prompt: 'Summarise the retrieved context.',
      tools: [],
      prevStepIds: ['retriever-step'],
      nextStepIds: [],
      mods: [],
      roles: [],
      mentalContext: [],
    };

    const runStep = vi.fn(async ({ step }) => ({
      text: `LLM output for ${step.id}`,
      usage: null,
      toolCalls: [],
      toolResults: [],
    }));

    await executeAgenticFlow(
      {
        id: 'flow-rag-pipeline',
        name: 'RAG Pipeline',
        rootStepId: 'retriever-step',
        stepsRecord: {
          'retriever-step': makeRetrieverStep({ nextStepIds: ['llm-step'] }),
          'llm-step': llmStep,
        },
      },
      { vectorStore: store, embedFn, runStep },
    );

    // Both steps must have checkpoints
    const checkpoints = events.filter(
      (e): e is Extract<HarnessEventPayload, { type: 'CheckpointCreated' }> =>
        e.type === 'CheckpointCreated',
    );
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0].stepId).toBe('retriever-step');
    expect(checkpoints[1].stepId).toBe('llm-step');

    // LLM step was called once
    expect(runStep).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({ type: 'FlowCompleted' });
  });
});
