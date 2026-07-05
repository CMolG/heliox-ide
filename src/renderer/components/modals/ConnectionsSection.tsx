/**
 * ConnectionsSection.tsx — Renderer Modal Subcomponent
 *
 * Responsibility:
 * - DBeaver-style connection-profile manager rendered inside SettingsModal,
 *   replacing the old opencode-backed provider-picker section.
 * - Bento grid of saved connections (name, protocol chip, host, status dot,
 *   model count) + an inline new/edit form (Test → Save) + a per-connection
 *   expandable model list (enable checkboxes + pick-the-active-model).
 *
 * Boundaries:
 * - Owns: connection UI + the draft-form flow. Persistence, token encryption,
 *   and the actual `/models` probe all live main-side
 *   (provider-connections.ts / provider-connection-tester.ts) — this
 *   component only calls `window.helioxAPI.providerConnections*`.
 *
 * Model-id convention: selecting an enabled model calls
 * `onSelect(connectionId, 'conn:<connectionId>/<modelId>')` — see
 * `harness-engine/llm-runner.ts#resolveHarnessModel` for the consumer.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useHelioxStore } from '../../store';
import { LucideIcon } from '../desktop/LucideIcon';
import { theme } from '../../logic/theme';
import type {
  ConnectionModel, ConnectionProtocol, ProviderConnection, ProviderConnectionUpdate,
} from '@/types/ipc-events';
import { PROTOCOL_DEFAULTS } from '@/types/ipc-events';

interface ConnectionsSectionProps {
  /** Currently selected connection id (prop name/contract preserved from the previous provider-picker section's `selectedProvider`). */
  selectedProvider: string;
  /** Currently selected fully-qualified model, e.g. `conn:<id>/<modelId>` once a model has been picked. */
  selectedModel: string;
  onSelect: (connectionId: string, model: string) => void;
}

/** Presentation-only accent per protocol — reuses the same brand colors opencode-providers.ts assigns these two providers, for visual continuity. */
const PROTOCOL_ACCENT: Record<ConnectionProtocol, string> = {
  openai: '#10A37F',
  anthropic: '#E87040',
};

const PROTOCOL_LABEL: Record<ConnectionProtocol, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

interface ConnectionFormDraft {
  name: string;
  protocol: ConnectionProtocol;
  baseUrl: string;
  token: string;
}

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; models: string[] }
  | { status: 'error'; error: string };

function emptyDraft(): ConnectionFormDraft {
  return { name: '', protocol: 'openai', baseUrl: PROTOCOL_DEFAULTS.openai, token: '' };
}

function hostOnly(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/**
 * Client-side mirror of `provider-connections.ts#mergeModelList` (main-only —
 * the renderer never imports `src/main/*`): new models arrive enabled, models
 * the connection already knew about keep their flag, vanished ones are
 * dropped. Kept in lockstep manually; it is a 3-line pure function.
 */
function mergeModels(existing: ConnectionModel[], fetched: string[]): ConnectionModel[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  return fetched.map((id) => ({ id, enabled: byId.get(id)?.enabled ?? true }));
}

export function ConnectionsSection({ selectedProvider, selectedModel, onSelect }: ConnectionsSectionProps) {
  const addToast = useHelioxStore((s) => s.addToast);

  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ConnectionFormDraft>(emptyDraft());
  const [baseUrlTouched, setBaseUrlTouched] = useState(false);
  const [testState, setTestState] = useState<TestState>({ status: 'idle' });
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!window.helioxAPI?.providerConnectionsList) return;
    setLoading(true);
    try {
      const res = await window.helioxAPI.providerConnectionsList();
      if (res.success && res.data) setConnections(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const closeForm = useCallback(() => {
    setFormOpen(false);
    setEditingId(null);
    setDraft(emptyDraft());
    setBaseUrlTouched(false);
    setTestState({ status: 'idle' });
  }, []);

  const openNewForm = useCallback(() => {
    setEditingId(null);
    setDraft(emptyDraft());
    setBaseUrlTouched(false);
    setTestState({ status: 'idle' });
    setFormOpen(true);
  }, []);

  const openEditForm = useCallback((conn: ProviderConnection) => {
    setEditingId(conn.id);
    setDraft({ name: conn.name, protocol: conn.protocol, baseUrl: conn.baseUrl, token: '' });
    setBaseUrlTouched(true); // an existing connection's baseUrl is intentional — never auto-overwrite it
    setTestState({ status: 'idle' });
    setFormOpen(true);
  }, []);

  const handleProtocolChange = useCallback((protocol: ConnectionProtocol) => {
    setDraft((d) => ({
      ...d,
      protocol,
      baseUrl: baseUrlTouched ? d.baseUrl : PROTOCOL_DEFAULTS[protocol],
    }));
    setTestState({ status: 'idle' });
  }, [baseUrlTouched]);

  const handleTest = useCallback(async () => {
    if (!window.helioxAPI?.providerConnectionsTest) return;
    setTestState({ status: 'testing' });
    const res = await window.helioxAPI.providerConnectionsTest({
      protocol: draft.protocol,
      baseUrl: draft.baseUrl,
      ...(draft.token.trim() ? { token: draft.token.trim() } : {}),
    });
    if (!res.success || !res.data) {
      setTestState({ status: 'error', error: res.error ?? 'Test failed' });
      return;
    }
    const { result } = res.data;
    if (result.ok) {
      setTestState({ status: 'ok', models: result.models ?? [] });
    } else {
      setTestState({ status: 'error', error: result.error ?? 'Test failed' });
    }
  }, [draft]);

  const persistDraft = useCallback(async () => {
    if (!window.helioxAPI?.providerConnectionsCreate || !window.helioxAPI?.providerConnectionsUpdate) return;
    setSaving(true);
    try {
      const testedModels = testState.status === 'ok' ? testState.models : undefined;

      if (editingId) {
        const patch: ProviderConnectionUpdate = {
          name: draft.name,
          baseUrl: draft.baseUrl,
          ...(draft.token.trim() ? { token: draft.token.trim() } : {}),
        };
        const res = await window.helioxAPI.providerConnectionsUpdate(editingId, patch);
        if (!res.success || !res.data) {
          addToast(`Failed to save connection: ${res.error ?? 'unknown error'}`, 'error');
          return;
        }
        let saved = res.data;
        if (testedModels) {
          const mergeRes = await window.helioxAPI.providerConnectionsUpdate(editingId, {
            models: mergeModels(saved.models, testedModels),
            lastTestedAt: Date.now(),
            lastTestOk: true,
          });
          if (mergeRes.success && mergeRes.data) saved = mergeRes.data;
        }
        setConnections((prev) => prev.map((c) => (c.id === saved.id ? saved : c)));
        addToast('Connection updated', 'success');
      } else {
        const created = await window.helioxAPI.providerConnectionsCreate({
          name: draft.name,
          protocol: draft.protocol,
          baseUrl: draft.baseUrl,
          ...(draft.token.trim() ? { token: draft.token.trim() } : {}),
        });
        if (!created.success || !created.data) {
          addToast(`Failed to create connection: ${created.error ?? 'unknown error'}`, 'error');
          return;
        }
        let saved = created.data;
        if (testedModels && testedModels.length > 0) {
          const mergeRes = await window.helioxAPI.providerConnectionsUpdate(saved.id, {
            models: mergeModels(saved.models, testedModels),
            lastTestedAt: Date.now(),
            lastTestOk: true,
          });
          if (mergeRes.success && mergeRes.data) saved = mergeRes.data;
        }
        setConnections((prev) => [...prev, saved]);
        addToast('Connection created', 'success');
      }
      closeForm();
    } finally {
      setSaving(false);
    }
  }, [draft, editingId, testState, addToast, closeForm]);

  const handleDeleteClick = useCallback(async (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    if (!window.helioxAPI?.providerConnectionsDelete) return;
    setBusyId(id);
    try {
      await window.helioxAPI.providerConnectionsDelete(id);
      setConnections((prev) => prev.filter((c) => c.id !== id));
      if (expandedId === id) setExpandedId(null);
      addToast('Connection deleted', 'info');
    } finally {
      setBusyId(null);
      setConfirmDeleteId(null);
    }
  }, [confirmDeleteId, expandedId, addToast]);

  const handleRetest = useCallback(async (id: string) => {
    if (!window.helioxAPI?.providerConnectionsTest) return;
    setBusyId(id);
    try {
      const res = await window.helioxAPI.providerConnectionsTest({ connectionId: id });
      if (res.success && res.data?.connection) {
        setConnections((prev) => prev.map((c) => (c.id === id ? res.data!.connection! : c)));
      } else if (!res.success) {
        addToast(`Re-test failed: ${res.error ?? 'unknown error'}`, 'error');
      } else if (!res.data?.result.ok) {
        addToast(`Re-test failed: ${res.data?.result.error ?? 'unknown error'}`, 'error');
      }
    } finally {
      setBusyId(null);
    }
  }, [addToast]);

  const handleToggleModel = useCallback(async (connId: string, modelId: string, enabled: boolean) => {
    if (!window.helioxAPI?.providerConnectionsSetModelEnabled) return;
    const res = await window.helioxAPI.providerConnectionsSetModelEnabled(connId, modelId, enabled);
    if (res.success && res.data) {
      setConnections((prev) => prev.map((c) => (c.id === connId ? res.data! : c)));
    }
  }, []);

  const handleSelectModel = useCallback((connId: string, modelId: string) => {
    onSelect(connId, `conn:${connId}/${modelId}`);
  }, [onSelect]);

  const canSave = draft.name.trim().length > 0 && draft.baseUrl.trim().length > 0;
  const testPassed = testState.status === 'ok';

  const selectedConnectionTheme = useMemo(
    () => connections.find((c) => c.id === selectedProvider),
    [connections, selectedProvider],
  );

  return (
    <div className="settings-section" data-testid="connections-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
        <span className="settings-section-label">Connections</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {selectedModel && (
            <span
              className="settings-toggle-desc"
              style={{
                fontFamily: theme.fontMono, fontSize: 11,
                color: selectedConnectionTheme ? PROTOCOL_ACCENT[selectedConnectionTheme.protocol] : theme.textDim,
                padding: '2px 8px', borderRadius: 999, border: '1px solid rgba(120,120,130,0.25)',
              }}
              title={selectedModel}
            >
              {selectedModel}
            </span>
          )}
          <button
            type="button"
            className="settings-outline-btn conn-new-btn"
            data-testid="connections-new-btn"
            onClick={openNewForm}
          >
            <LucideIcon name="Plus" size={12} /> New connection
          </button>
        </div>
      </div>

      {formOpen && (
        <div className="conn-form" data-testid="connection-form">
          <div className="conn-form-row">
            <label className="conn-form-label" htmlFor="conn-form-name">Name</label>
            <input
              id="conn-form-name"
              className="settings-input"
              data-testid="connection-form-name"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="e.g. Work OpenAI"
            />
          </div>
          <div className="conn-form-row conn-form-row--split">
            <div style={{ flex: 1 }}>
              <label className="conn-form-label" htmlFor="conn-form-protocol">Protocol</label>
              <select
                id="conn-form-protocol"
                className="settings-input"
                data-testid="connection-form-protocol"
                value={draft.protocol}
                onChange={(e) => handleProtocolChange(e.target.value as ConnectionProtocol)}
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
              </select>
            </div>
            <div style={{ flex: 2 }}>
              <label className="conn-form-label" htmlFor="conn-form-base-url">Base URL</label>
              <input
                id="conn-form-base-url"
                className="settings-input"
                data-testid="connection-form-base-url"
                value={draft.baseUrl}
                onChange={(e) => {
                  setBaseUrlTouched(true);
                  setDraft((d) => ({ ...d, baseUrl: e.target.value }));
                  setTestState({ status: 'idle' });
                }}
                style={{ fontFamily: theme.fontMono }}
              />
            </div>
          </div>
          <div className="conn-form-row">
            <label className="conn-form-label" htmlFor="conn-form-token">
              API token {editingId ? <span style={{ opacity: 0.6 }}>(leave blank to keep the current one)</span> : null}
            </label>
            <input
              id="conn-form-token"
              type="password"
              className="settings-input"
              data-testid="connection-form-token"
              value={draft.token}
              onChange={(e) => {
                setDraft((d) => ({ ...d, token: e.target.value }));
                setTestState({ status: 'idle' });
              }}
              placeholder={editingId ? '••••••••' : 'sk-…'}
              style={{ fontFamily: theme.fontMono }}
            />
          </div>

          {testState.status === 'ok' && (
            <div className="conn-test-result conn-test-result--ok" data-testid="connection-form-test-result">
              {testState.models.length} models
            </div>
          )}
          {testState.status === 'error' && (
            <div className="conn-test-result conn-test-result--error" data-testid="connection-form-test-result">
              {testState.error}
            </div>
          )}

          <div className="conn-form-actions">
            <button
              type="button"
              className="settings-outline-btn"
              data-testid="connection-form-test"
              disabled={testState.status === 'testing' || !draft.baseUrl.trim()}
              onClick={handleTest}
            >
              {testState.status === 'testing' ? 'Testing…' : 'Test connection'}
            </button>
            <button
              type="button"
              className="settings-outline-btn"
              data-testid="connection-form-save"
              disabled={!canSave || !testPassed || saving}
              style={testPassed ? { borderColor: '#34d399', color: '#1b8a5a' } : undefined}
              onClick={persistDraft}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {!testPassed && (
              <button
                type="button"
                className="settings-outline-btn"
                data-testid="connection-form-save-anyway"
                disabled={!canSave || saving}
                title="Save without a successful test"
                onClick={persistDraft}
              >
                Save without testing
              </button>
            )}
            <button type="button" className="settings-outline-btn" data-testid="connection-form-cancel" onClick={closeForm}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div style={{ padding: 12, color: theme.textDim, fontSize: 12 }}>Loading connections…</div>
      )}

      {!loading && connections.length === 0 && !formOpen && (
        <div style={{ padding: 12, color: theme.textDim, fontSize: 12 }}>
          No connections yet — add one to run steps against your own OpenAI- or Anthropic-compatible endpoint.
        </div>
      )}

      <div className="conn-grid">
        {connections.map((conn) => {
          const accent = PROTOCOL_ACCENT[conn.protocol];
          const isExpanded = expandedId === conn.id;
          const isConfirmingDelete = confirmDeleteId === conn.id;
          const isBusy = busyId === conn.id;
          const enabledCount = conn.models.filter((m) => m.enabled).length;

          return (
            <div key={conn.id} className="conn-card" data-connected={conn.hasToken ? 'true' : 'false'}>
              <button
                type="button"
                className="conn-card-header"
                data-testid={`connection-card-${conn.id}`}
                aria-expanded={isExpanded}
                onClick={() => setExpandedId((prev) => (prev === conn.id ? null : conn.id))}
              >
                <span
                  className="conn-status-dot"
                  data-testid={`connection-card-status-${conn.id}`}
                  data-status={conn.lastTestOk === undefined ? 'never' : conn.lastTestOk ? 'ok' : 'fail'}
                  title={conn.lastTestOk === undefined ? 'Never tested' : conn.lastTestOk ? 'Last test: OK' : 'Last test: failed'}
                />
                <div className="conn-card-title">
                  <span className="conn-card-name">{conn.name}</span>
                  <span className="conn-card-host" style={{ fontFamily: theme.fontMono }}>{hostOnly(conn.baseUrl)}</span>
                </div>
                <span
                  className="conn-protocol-chip"
                  data-testid={`connection-card-protocol-${conn.id}`}
                  style={{ color: accent, borderColor: `${accent}55`, background: `${accent}14` }}
                >
                  {PROTOCOL_LABEL[conn.protocol]}
                </span>
              </button>

              <div className="conn-card-meta" data-testid={`connection-card-models-${conn.id}`}>
                {conn.models.length} models · {enabledCount} enabled
              </div>

              <div className="conn-card-actions">
                <button
                  type="button"
                  className="settings-outline-btn"
                  data-testid={`connection-card-edit-${conn.id}`}
                  onClick={() => openEditForm(conn)}
                >
                  <LucideIcon name="Pencil" size={11} /> Edit
                </button>
                <button
                  type="button"
                  className="settings-outline-btn"
                  data-testid={`connection-card-retest-${conn.id}`}
                  disabled={isBusy}
                  onClick={() => handleRetest(conn.id)}
                >
                  <LucideIcon name="RefreshCw" size={11} /> Re-test
                </button>
                <button
                  type="button"
                  className="settings-outline-btn conn-delete-btn"
                  data-testid={`connection-card-delete-${conn.id}`}
                  disabled={isBusy}
                  style={{ borderColor: '#ef4444', color: '#ef4444' }}
                  onClick={() => handleDeleteClick(conn.id)}
                >
                  {isConfirmingDelete ? 'Confirm?' : <><LucideIcon name="Trash2" size={11} /> Delete</>}
                </button>
              </div>

              {isExpanded && (
                <div className="conn-model-list">
                  {conn.models.length === 0 && (
                    <span style={{ fontSize: 10, color: theme.textDim, padding: '4px 6px' }}>
                      No models yet — Re-test to fetch the list from this endpoint.
                    </span>
                  )}
                  {conn.models.map((m) => {
                    const isActive = selectedModel === `conn:${conn.id}/${m.id}`;
                    return (
                      <div key={m.id} className="conn-model-row">
                        <input
                          type="checkbox"
                          checked={m.enabled}
                          data-testid={`connection-model-checkbox-${conn.id}-${m.id}`}
                          aria-label={`Enable ${m.id}`}
                          onChange={(e) => handleToggleModel(conn.id, m.id, e.target.checked)}
                        />
                        {m.enabled ? (
                          <button
                            type="button"
                            className="conn-model-select"
                            data-testid={`connection-model-select-${conn.id}-${m.id}`}
                            aria-pressed={isActive}
                            data-active={isActive ? 'true' : 'false'}
                            style={{ fontFamily: theme.fontMono, color: isActive ? accent : theme.textSecondary }}
                            onClick={() => handleSelectModel(conn.id, m.id)}
                          >
                            {m.id}
                          </button>
                        ) : (
                          <span className="conn-model-select conn-model-select--disabled" style={{ fontFamily: theme.fontMono }}>
                            {m.id}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
