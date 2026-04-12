/**
 * InputBar — Mobile-optimized prompt entry with safe area padding
 */
import React, { useState, useRef, useCallback } from 'react';

interface Props {
  onSend: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function InputBar({ onSend, disabled = false, placeholder = 'Type a message...' }: Props) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    // Auto-resize
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  return (
    <div className="input-bar">
      <textarea
        ref={textareaRef}
        className="input-field"
        rows={1}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
      />
      <button
        className="send-btn"
        onClick={handleSend}
        disabled={!value.trim() || disabled}
        aria-label="Send message"
      >
        ↑
      </button>
    </div>
  );
}
