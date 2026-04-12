/**
 * ConnectScreen — PIN entry and authentication
 */
import React, { useState, useRef, useEffect } from 'react';

interface Props {
  defaultPin: string;
  error: string | null;
  onConnect: (pin: string) => void;
}

export function ConnectScreen({ defaultPin, error, onConnect }: Props) {
  const [pin, setPin] = useState(defaultPin);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    // Auto-connect if PIN was provided via QR URL
    if (defaultPin.length === 6) {
      handleSubmit(defaultPin);
    }
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
        <div className="connect-logo">⚡ Heliox Remote</div>
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
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
        />
        <button
          className="btn-primary"
          onClick={() => handleSubmit()}
          disabled={pin.length !== 6 || loading}
        >
          {loading ? 'Connecting...' : 'Connect'}
        </button>
        {error && <div className="connect-error">{error}</div>}
        <div className="connect-status">
          {defaultPin ? 'PIN detected from QR code' : 'Scan QR code or enter PIN manually'}
        </div>
      </div>
    </div>
  );
}
