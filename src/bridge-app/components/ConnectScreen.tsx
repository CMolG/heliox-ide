/**
 * ConnectScreen — PIN entry and authentication
 *
 * QR-based pairing is handled by the parent (App.tsx) directly from the URL
 * fragment and never touches this screen's input; this component only
 * covers the manual-PIN fallback. `pairing` reflects that in-flight QR
 * exchange so the manual form can show a status and avoid a racy double-submit.
 */
import React, { useState, useRef, useEffect } from 'react';

interface Props {
  pairing: boolean;
  error: string | null;
  onConnect: (pin: string) => void;
}

export function ConnectScreen({ pairing, error, onConnect }: Props) {
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (value?: string) => {
    const p = value ?? pin;
    if (p.length !== 6) return;
    setLoading(true);
    await onConnect(p);
    setLoading(false);
  };

  return (
    <div className="connect-screen">
      <div className="connect-card">
        <div className="connect-logo">⚡ Fluxor Remote</div>
        <p className="connect-subtitle">Enter the PIN shown in your IDE settings</p>
        <input
          ref={inputRef}
          className="pin-input"
          type="text"
          inputMode="numeric"
          maxLength={6}
          placeholder="······"
          autoComplete="off"
          value={pin}
          disabled={pairing}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
        />
        <button
          className="btn-primary"
          onClick={() => handleSubmit()}
          disabled={pin.length !== 6 || loading || pairing}
        >
          {pairing ? 'Pairing via QR...' : loading ? 'Connecting...' : 'Connect'}
        </button>
        {error && <div className="connect-error">{error}</div>}
        <div className="connect-status">
          {pairing ? 'Completing QR pairing...' : 'Scan QR code or enter PIN manually'}
        </div>
      </div>
    </div>
  );
}
