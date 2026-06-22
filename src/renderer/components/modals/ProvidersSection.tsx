/**
 * ProvidersSection.tsx — Renderer Modal Subcomponent
 *
 * Responsibility:
 * - Beautiful provider picker rendered inside SettingsModal.
 * - Lists every OpenCode provider, surfaces credential status, lets the user
 *   paste an API key, and lets them pick the active model.
 *
 * Boundaries:
 * - Owns: provider/model UI and the API-key input flow.
 * - Does NOT own: token persistence (delegated to main via opencodeAPI).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useHelioxStore } from '../../store';
import type { OpencodeProvider } from '@/types';
import { getCliTheme } from '@/types/desktop';
import { theme } from '../../logic/theme';

interface ProvidersSectionProps {
  selectedProvider: string;
  selectedModel: string;
  onSelect: (providerId: string, model: string) => void;
}

const SUGGESTED_MODELS_BY_PROVIDER: Record<string, string[]> = {
  opencode: ['opencode/claude-sonnet-4-6', 'opencode/claude-opus-4-7', 'opencode/gpt-5.4', 'opencode/gemini-3.1-pro'],
  'xiaomi-token-plan-ams': ['xiaomi-token-plan-ams/mimo-v2-pro', 'xiaomi-token-plan-ams/mimo-v2-omni'],
  'xiaomi-token-plan-cn': ['xiaomi-token-plan-cn/mimo-v2-pro'],
  openrouter: ['openrouter/anthropic/claude-sonnet-4.6', 'openrouter/openai/gpt-5.4', 'openrouter/x-ai/grok-4'],
};

export function ProvidersSection({ selectedProvider, selectedModel, onSelect }: ProvidersSectionProps) {
  const addToast = useHelioxStore(s => s.addToast);

  const [providers, setProviders] = useState<OpencodeProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(selectedProvider);
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [modelsLoading, setModelsLoading] = useState<Record<string, boolean>>({});

  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!window.helioxAPI?.opencodeListProviders) return;
    setLoading(true);
    try {
      const next = await window.helioxAPI.opencodeListProviders();
      setProviders(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const loadModels = useCallback(async (id: string) => {
    if (models[id] || modelsLoading[id]) return;
    if (!window.helioxAPI?.opencodeListProviderModels) return;
    setModelsLoading(s => ({ ...s, [id]: true }));
    try {
      const list = await window.helioxAPI.opencodeListProviderModels(id);
      setModels(s => ({ ...s, [id]: list }));
    } finally {
      setModelsLoading(s => ({ ...s, [id]: false }));
    }
  }, [models, modelsLoading]);

  const handleExpand = useCallback((id: string) => {
    setExpandedId(prev => {
      const next = prev === id ? null : id;
      if (next) loadModels(next);
      return next;
    });
  }, [loadModels]);

  const handleSaveKey = useCallback(async (id: string) => {
    const key = (keyDraft[id] ?? '').trim();
    if (!key) return;
    if (!window.helioxAPI?.opencodeSaveCredential) return;
    setSavingId(id);
    try {
      const res = await window.helioxAPI.opencodeSaveCredential(id, key);
      if (res.success) {
        addToast('Credential saved — provider authorized', 'success');
        setKeyDraft(s => ({ ...s, [id]: '' }));
        await refresh();
        // Bust the model cache for this provider on the main side.
        setModels(s => { const next = { ...s }; delete next[id]; return next; });
        loadModels(id);
      } else {
        addToast(`Failed to save key: ${res.error ?? 'unknown error'}`, 'error');
      }
    } finally {
      setSavingId(null);
    }
  }, [keyDraft, refresh, loadModels, addToast]);

  const handleRemoveKey = useCallback(async (id: string) => {
    if (!window.helioxAPI?.opencodeRemoveCredential) return;
    setSavingId(id);
    try {
      const res = await window.helioxAPI.opencodeRemoveCredential(id);
      if (res.success) {
        addToast('Credential removed', 'info');
        await refresh();
        setModels(s => { const next = { ...s }; delete next[id]; return next; });
      } else {
        addToast(`Failed to remove key: ${res.error ?? 'unknown error'}`, 'error');
      }
    } finally {
      setSavingId(null);
    }
  }, [refresh, addToast]);

  const selectedTheme = useMemo(() => getCliTheme(selectedProvider), [selectedProvider]);

  return (
    <div className="settings-section" data-testid="providers-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
        <span className="settings-section-label">Provider</span>
        <span
          className="settings-toggle-desc"
          style={{ fontFamily: theme.fontMono, fontSize: 11, color: selectedTheme.accent, padding: '2px 8px', borderRadius: 999, border: `1px solid ${selectedTheme.accent}40`, background: `${selectedTheme.accent}12` }}
          title={selectedModel}
        >
          {selectedModel || 'no model selected'}
        </span>
      </div>

      {loading && (
        <div style={{ padding: 12, color: theme.textDim, fontSize: 12 }}>Loading providers…</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {providers.map(p => {
          const isSelected = p.id === selectedProvider;
          const isExpanded = expandedId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => handleExpand(p.id)}
              data-testid={`provider-card-${p.id}`}
              style={{
                position: 'relative',
                textAlign: 'left',
                padding: 14,
                borderRadius: 14,
                border: `1px solid ${isSelected ? `${p.accent}80` : 'rgba(63,63,70,0.25)'}`,
                background: isSelected ? `linear-gradient(135deg, ${p.accent}1A, ${p.accent}05)` : 'rgba(20,20,24,0.45)',
                cursor: 'pointer',
                transition: 'all 160ms ease',
                color: theme.textPrimary,
                outline: 'none',
                fontFamily: theme.fontGrotesk,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: p.accent, boxShadow: `0 0 12px ${p.accent}80` }} />
                <span
                  style={{
                    fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700,
                    padding: '2px 6px', borderRadius: 999,
                    color: p.authorized ? '#A0F695' : theme.textDim,
                    background: p.authorized ? 'rgba(160,246,149,0.12)' : 'rgba(120,120,130,0.1)',
                    border: `1px solid ${p.authorized ? 'rgba(160,246,149,0.3)' : 'rgba(120,120,130,0.25)'}`,
                  }}
                >
                  {p.authorized ? 'authed' : 'no key'}
                </span>
              </div>
              <div style={{ marginTop: 8, fontSize: 14, fontWeight: 600 }}>{p.label}</div>
              <div style={{ marginTop: 4, fontSize: 11, lineHeight: 1.4, color: theme.textDim, minHeight: 30 }}>
                {p.description}
              </div>
              {isExpanded && (
                <div onClick={e => e.stopPropagation()} style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(63,63,70,0.2)' }}>
                  {!p.authorized && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {p.authHint && <span style={{ fontSize: 10, color: theme.textDim }}>{p.authHint}</span>}
                      <input
                        type="password"
                        value={keyDraft[p.id] ?? ''}
                        onChange={e => setKeyDraft(s => ({ ...s, [p.id]: e.target.value }))}
                        placeholder={p.keyPrefix ? `${p.keyPrefix}…` : 'API key'}
                        className="settings-input"
                        data-testid={`provider-key-${p.id}`}
                        style={{ fontFamily: theme.fontMono, fontSize: 12, padding: '6px 10px' }}
                      />
                      <button
                        type="button"
                        className="settings-outline-btn"
                        disabled={savingId === p.id || !(keyDraft[p.id] ?? '').trim()}
                        onClick={() => handleSaveKey(p.id)}
                        data-testid={`provider-save-${p.id}`}
                        style={{ borderColor: p.accent, color: p.accent }}
                      >
                        {savingId === p.id ? 'Saving…' : 'Save key'}
                      </button>
                    </div>
                  )}

                  {p.authorized && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <span style={{ fontSize: 10, color: theme.textDim, textTransform: 'uppercase', letterSpacing: 1 }}>Models</span>
                        <button
                          type="button"
                          className="settings-outline-btn"
                          onClick={() => handleRemoveKey(p.id)}
                          disabled={savingId === p.id}
                          style={{ fontSize: 9, padding: '2px 6px', borderColor: '#666', color: '#888' }}
                        >
                          Remove key
                        </button>
                      </div>

                      <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 4 }}>
                        {(models[p.id] ?? SUGGESTED_MODELS_BY_PROVIDER[p.id] ?? []).map(m => {
                          const isModelSelected = m === selectedModel;
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() => onSelect(p.id, m)}
                              data-testid={`model-${m}`}
                              style={{
                                textAlign: 'left',
                                fontFamily: theme.fontMono,
                                fontSize: 11,
                                padding: '5px 8px',
                                borderRadius: 6,
                                border: `1px solid ${isModelSelected ? `${p.accent}80` : 'transparent'}`,
                                background: isModelSelected ? `${p.accent}1A` : 'transparent',
                                color: isModelSelected ? p.accent : theme.textSecondary,
                                cursor: 'pointer',
                              }}
                            >
                              {m.replace(`${p.id}/`, '')}
                            </button>
                          );
                        })}
                        {modelsLoading[p.id] && (
                          <span style={{ fontSize: 10, color: theme.textDim, padding: '4px 6px' }}>Fetching models…</span>
                        )}
                        {!modelsLoading[p.id] && (models[p.id]?.length ?? 0) === 0 && (
                          <span style={{ fontSize: 10, color: theme.textDim, padding: '4px 6px' }}>
                            No models reported by opencode — verify the key is valid.
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
