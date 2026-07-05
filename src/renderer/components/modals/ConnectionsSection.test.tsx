/**
 * ConnectionsSection.test.tsx — Component tests for the DBeaver-style connection manager
 *
 * Strategy:
 * - Mount <ConnectionsSection /> with a mocked `window.helioxAPI.providerConnections*`
 *   surface (same `Object.defineProperty(window, 'helioxAPI', ...)` pattern as
 *   TimeTravelPanel.test.tsx).
 * - Assertions target `data-testid` attributes rather than CSS classes.
 *
 * Scenarios covered (per the implementation plan's Task 16 Step 1):
 *   1. Renders saved connections as cards with model counts.
 *   2. New-connection flow: fill form → Test (3 models) → Save → create IPC
 *      called with protocol/baseUrl/token; the new card appears.
 *   3. Toggling a model checkbox calls set-model-enabled.
 *   4. Selecting an enabled model calls onSelect(connectionId, 'conn:<id>/<modelId>').
 *   5. A failed test renders the error and keeps Save gated behind a
 *      separate "save anyway" confirm affordance.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionsSection } from './ConnectionsSection';
import type {
  ProviderConnection, ProviderConnectionInput, ProviderConnectionUpdate,
  ConnectionTestRequest, ConnectionTestResponse,
} from '@/types/ipc-events';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CONN_A: ProviderConnection = {
  id: 'conn-a',
  name: 'My OpenAI',
  protocol: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  hasToken: true,
  models: [
    { id: 'gpt-4o', enabled: true },
    { id: 'gpt-4o-mini', enabled: false },
  ],
  lastTestedAt: 1_700_000_000_000,
  lastTestOk: true,
};

// ── Mock `window.helioxAPI` ───────────────────────────────────────────────────

function setupMockAPI(overrides?: {
  list?: ProviderConnection[];
  create?: (input: ProviderConnectionInput) => Promise<{ success: boolean; data?: ProviderConnection; error?: string }>;
  update?: (id: string, patch: ProviderConnectionUpdate) => Promise<{ success: boolean; data?: ProviderConnection; error?: string }>;
  setModelEnabled?: (id: string, modelId: string, enabled: boolean) => Promise<{ success: boolean; data?: ProviderConnection; error?: string }>;
  test?: (request: ConnectionTestRequest) => Promise<ConnectionTestResponse>;
}) {
  const providerConnectionsList = vi.fn(async () => ({ success: true, data: overrides?.list ?? [] }));
  const providerConnectionsCreate = vi.fn(overrides?.create ?? (async (input: ProviderConnectionInput) => ({
    success: true,
    data: {
      id: 'conn-new', name: input.name, protocol: input.protocol, baseUrl: input.baseUrl,
      hasToken: Boolean(input.token), models: [],
    } as ProviderConnection,
  })));
  const providerConnectionsUpdate = vi.fn(overrides?.update ?? (async (id: string, patch: ProviderConnectionUpdate) => ({
    success: true,
    data: { ...CONN_A, id, ...patch } as ProviderConnection,
  })));
  const providerConnectionsDelete = vi.fn(async () => ({ success: true }));
  const providerConnectionsSetModelEnabled = vi.fn(overrides?.setModelEnabled ?? (async (id: string, modelId: string, enabled: boolean) => ({
    success: true,
    data: {
      ...CONN_A,
      models: CONN_A.models.map((m) => (m.id === modelId ? { ...m, enabled } : m)),
    } as ProviderConnection,
  })));
  const providerConnectionsTest = vi.fn(overrides?.test ?? (async () => ({
    success: true,
    data: { result: { ok: true, models: ['m1', 'm2', 'm3'] } },
  } as ConnectionTestResponse)));

  Object.defineProperty(window, 'helioxAPI', {
    value: {
      providerConnectionsList,
      providerConnectionsCreate,
      providerConnectionsUpdate,
      providerConnectionsDelete,
      providerConnectionsSetModelEnabled,
      providerConnectionsTest,
    },
    writable: true,
    configurable: true,
  });

  return {
    providerConnectionsList, providerConnectionsCreate, providerConnectionsUpdate,
    providerConnectionsDelete, providerConnectionsSetModelEnabled, providerConnectionsTest,
  };
}

function renderSection(onSelect = vi.fn()) {
  render(
    <ConnectionsSection selectedProvider="" selectedModel="" onSelect={onSelect} />,
  );
  return { onSelect };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ConnectionsSection — listing', () => {
  it('renders saved connections as cards with model counts', async () => {
    setupMockAPI({ list: [CONN_A] });
    renderSection();

    await waitFor(() => {
      expect(screen.getByTestId('connection-card-conn-a')).toBeInTheDocument();
    });

    expect(screen.getByText('My OpenAI')).toBeInTheDocument();
    expect(screen.getByTestId('connection-card-models-conn-a').textContent).toMatch(/2 models.*1 enabled/i);
  });
});

describe('ConnectionsSection — new connection flow', () => {
  it('fills the form, tests it (3 models), saves it, and the create IPC + new card reflect it', async () => {
    const api = setupMockAPI({ list: [] });
    renderSection();

    await waitFor(() => expect(api.providerConnectionsList).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('connections-new-btn'));

    fireEvent.change(screen.getByTestId('connection-form-name'), { target: { value: 'New Conn' } });
    fireEvent.change(screen.getByTestId('connection-form-token'), { target: { value: 'sk-xyz' } });

    fireEvent.click(screen.getByTestId('connection-form-test'));

    await waitFor(() => {
      expect(screen.getByTestId('connection-form-test-result').textContent).toMatch(/3 models/i);
    });

    const saveBtn = screen.getByTestId('connection-form-save') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(api.providerConnectionsCreate).toHaveBeenCalledWith(expect.objectContaining({
        name: 'New Conn',
        protocol: 'openai',
        token: 'sk-xyz',
      }));
    });

    // The freshly-tested model list is seeded onto the newly-created profile
    // via one follow-up update call, so the card doesn't show "0 models"
    // immediately after a connection that was just successfully tested.
    await waitFor(() => {
      expect(api.providerConnectionsUpdate).toHaveBeenCalledWith('conn-new', expect.objectContaining({
        models: [
          { id: 'm1', enabled: true },
          { id: 'm2', enabled: true },
          { id: 'm3', enabled: true },
        ],
      }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('connection-card-conn-new')).toBeInTheDocument();
    });
  });
});

describe('ConnectionsSection — model list interactions', () => {
  it('toggling a model checkbox calls set-model-enabled', async () => {
    const api = setupMockAPI({ list: [CONN_A] });
    renderSection();

    await waitFor(() => expect(screen.getByTestId('connection-card-conn-a')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('connection-card-conn-a'));

    await waitFor(() => {
      expect(screen.getByTestId('connection-model-checkbox-conn-a-gpt-4o-mini')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('connection-model-checkbox-conn-a-gpt-4o-mini'));

    await waitFor(() => {
      expect(api.providerConnectionsSetModelEnabled).toHaveBeenCalledWith('conn-a', 'gpt-4o-mini', true);
    });
  });

  it('selecting an enabled model calls onSelect with the conn:<id>/<modelId> convention', async () => {
    setupMockAPI({ list: [CONN_A] });
    const { onSelect } = renderSection();

    await waitFor(() => expect(screen.getByTestId('connection-card-conn-a')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('connection-card-conn-a'));

    await waitFor(() => {
      expect(screen.getByTestId('connection-model-select-conn-a-gpt-4o')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('connection-model-select-conn-a-gpt-4o'));

    expect(onSelect).toHaveBeenCalledWith('conn-a', 'conn:conn-a/gpt-4o');
  });

  it('does not offer a select affordance for a disabled model', async () => {
    setupMockAPI({ list: [CONN_A] });
    renderSection();

    await waitFor(() => expect(screen.getByTestId('connection-card-conn-a')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('connection-card-conn-a'));

    await waitFor(() => {
      expect(screen.getByTestId('connection-model-checkbox-conn-a-gpt-4o-mini')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('connection-model-select-conn-a-gpt-4o-mini')).not.toBeInTheDocument();
  });
});

describe('ConnectionsSection — failed test', () => {
  it('renders the error and keeps Save disabled behind a separate save-anyway confirm', async () => {
    setupMockAPI({
      list: [],
      test: async () => ({ success: true, data: { result: { ok: false, error: 'HTTP 401 — invalid key' } } }),
    });
    renderSection();

    fireEvent.click(screen.getByTestId('connections-new-btn'));
    fireEvent.change(screen.getByTestId('connection-form-name'), { target: { value: 'Bad key' } });
    fireEvent.change(screen.getByTestId('connection-form-token'), { target: { value: 'sk-bad' } });
    fireEvent.click(screen.getByTestId('connection-form-test'));

    await waitFor(() => {
      expect(screen.getByTestId('connection-form-test-result').textContent).toMatch(/HTTP 401/);
    });

    expect((screen.getByTestId('connection-form-save') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('connection-form-save-anyway')).toBeInTheDocument();
  });
});
