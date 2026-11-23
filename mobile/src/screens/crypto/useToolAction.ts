import {useRef, useState} from 'react';
import {Keyboard} from 'react-native';

export function useToolAction<T>() {
  const [result, setResult] = useState<T>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState<'submit' | 'input' | null>(null);
  const locked = useRef(false);
  const revision = useRef(0);

  const perform = async (
    kind: 'submit' | 'input',
    work: () => Promise<void>,
    onError: (message: string) => void,
  ) => {
    if (locked.current) {
      return;
    }
    locked.current = true;
    Keyboard.dismiss();
    setPending(kind);
    try {
      await work();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      locked.current = false;
      setPending(null);
    }
  };

  const edit =
    <V>(setter: (value: V) => void) =>
    (value: V) => {
      revision.current += 1;
      setter(value);
      setResult(undefined);
      setError('');
    };

  const run = (work: () => T | undefined | Promise<T | undefined>) =>
    perform(
      'submit',
      async () => {
        const submitted = revision.current;
        setResult(undefined);
        setError('');
        const nextResult = await work();
        if (submitted === revision.current) {
          setResult(nextResult);
        }
      },
      message => {
        setError(
          message === 'No current identity selected'
            ? 'Choose a current identity in Identities and try again.'
            : message,
        );
      },
    );

  return {result, error, pending, edit, run, perform};
}

export type ToolAction = Pick<
  ReturnType<typeof useToolAction>,
  'error' | 'pending' | 'perform'
>;
