import React, {useCallback, useMemo, useRef, useState} from 'react';
import PasswordModal from '../components/PasswordModal';

export type SecretPromptOptions = {
  title: string;
  placeholder?: string;
  submitLabel?: string;
};

type Pending = {
  options: SecretPromptOptions;
  resolve: (value: string | null) => void;
};

/**
 * Promise-based secret prompt backed by PasswordModal.
 * Returns null when the user cancels.
 */
export function useSecretPrompt(): {
  promptSecret: (options: SecretPromptOptions) => Promise<string | null>;
  secretPrompt: JSX.Element;
} {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const promptSecret = useCallback((options: SecretPromptOptions) => {
    return new Promise<string | null>(resolve => {
      if (pendingRef.current) {
        pendingRef.current.resolve(null);
      }
      const next: Pending = {options, resolve};
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  const close = useCallback((value: string | null) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(value);
  }, []);

  const secretPrompt = useMemo(
    () => (
      <PasswordModal
        visible={pending !== null}
        title={pending?.options.title ?? 'Enter password'}
        placeholder={pending?.options.placeholder}
        submitLabel={pending?.options.submitLabel}
        onCancel={() => close(null)}
        onSubmit={value => close(value)}
      />
    ),
    [pending, close],
  );

  return {promptSecret, secretPrompt};
}
