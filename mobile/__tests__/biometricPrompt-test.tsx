import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {
  AppState,
  Modal,
  Text,
  TextInput,
  type AppStateStatus,
} from 'react-native';
import AppButton from '../src/components/AppButton';
import {
  useSecretPrompt,
  type SecretPromptOptions,
} from '../src/hooks/useSecretPrompt';

jest.mock('../src/components/AppIcon', () => () => null);

let prompt: ReturnType<typeof useSecretPrompt>;
let tree: renderer.ReactTestRenderer;
const listeners = new Set<(state: AppStateStatus) => void>();

function Harness() {
  prompt = useSecretPrompt();
  return prompt.secretPrompt;
}

async function open(biometricUnlock?: SecretPromptOptions['biometricUnlock']) {
  let result!: Promise<string | null>;
  await act(async () => {
    result = prompt.promptSecret({title: 'Unlock identity', biometricUnlock});
  });
  return {result};
}

async function show() {
  await act(async () => tree.root.findByType(Modal).props.onShow());
}

async function changeAppState(state: AppStateStatus) {
  await act(async () => {
    AppState.currentState = state;
    listeners.forEach(listener => listener(state));
  });
}

function button(testID: string) {
  return tree.root
    .findAllByType(AppButton)
    .find(node => node.props.testID === testID)!;
}

function alerts() {
  return tree.root
    .findAllByType(Text)
    .filter(node => node.props.accessibilityRole === 'alert');
}

beforeEach(async () => {
  AppState.currentState = 'active';
  listeners.clear();
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      listeners.add(listener);
      return {
        remove: () => {
          listeners.delete(listener);
        },
      };
    });
  await act(async () => {
    tree = renderer.create(<Harness />);
  });
});

afterEach(async () => {
  await act(async () => tree.unmount());
  expect(listeners.size).toBe(0);
  jest.restoreAllMocks();
});

it('waits until the unlock dialog is shown, then resolves successful authentication', async () => {
  const unlock = jest.fn(async () => 'saved');
  expect(tree.root.findByType(Modal).props.visible).toBe(false);
  const {result} = await open(unlock);
  expect(unlock).not.toHaveBeenCalled();
  await show();
  expect(unlock).toHaveBeenCalledTimes(1);
  await expect(result).resolves.toBe('saved');
  expect(tree.root.findByType(Modal).props.visible).toBe(false);
});

it('keeps the password flow when biometric unlock is not enabled', async () => {
  await open();
  await show();
  expect(
    tree.root
      .findAllByType(AppButton)
      .some(node => node.props.testID === 'identity-biometric-unlock'),
  ).toBe(false);
  expect(tree.root.findByType(TextInput).props.editable).toBe(true);
});

it('waits for the foreground before starting authentication', async () => {
  await changeAppState('background');
  const unlock = jest.fn(async () => null);
  await open(unlock);
  await show();
  expect(unlock).not.toHaveBeenCalled();
  await changeAppState('active');
  expect(unlock).toHaveBeenCalledTimes(1);
});

it('returns quietly to password entry after dismissal', async () => {
  const {result} = await open(async () => null);
  await show();
  expect(alerts()).toHaveLength(0);
  expect(tree.root.findByType(Modal).props.visible).toBe(true);
  expect(button('identity-biometric-unlock').props.disabled).toBe(false);
  await act(async () =>
    tree.root.findByType(TextInput).props.onChangeText('manual'),
  );
  await act(async () => button('password-modal-submit').props.onPress());
  await expect(result).resolves.toBe('manual');
});

it('allows an explicit biometric retry after dismissal', async () => {
  const unlock = jest
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce('saved');
  const {result} = await open(unlock);
  await show();
  await act(async () => button('identity-biometric-unlock').props.onPress());
  expect(unlock).toHaveBeenCalledTimes(2);
  await expect(result).resolves.toBe('saved');
});

it('does not retry on rerender, repeated onShow, or returning from the native prompt', async () => {
  const unlock = jest.fn(async () => null);
  await open(unlock);
  await show();
  await act(async () => tree.update(<Harness />));
  await changeAppState('inactive');
  await changeAppState('active');
  await show();
  expect(unlock).toHaveBeenCalledTimes(1);
});

it('starts a fresh automatic attempt on each new request, including a visible replacement', async () => {
  const unlock = jest.fn(async () => null);
  const first = await open(unlock);
  await show();
  const second = await open(unlock);
  await expect(first.result).resolves.toBeNull();
  expect(unlock).toHaveBeenCalledTimes(2);
  await act(async () => button('password-modal-cancel').props.onPress());
  await expect(second.result).resolves.toBeNull();
  await open(unlock);
  expect(unlock).toHaveBeenCalledTimes(2);
  await show();
  expect(unlock).toHaveBeenCalledTimes(3);
});

it('blocks overlapping attempts, password submission, and cancellation while authenticating', async () => {
  let finish!: (value: string | null) => void;
  const unlock = jest.fn(
    () =>
      new Promise<string | null>(resolve => {
        finish = resolve;
      }),
  );
  await open(unlock);
  await show();
  expect(button('identity-biometric-unlock').props.disabled).toBe(true);
  expect(tree.root.findByType(TextInput).props.editable).toBe(false);
  await act(async () => {
    button('identity-biometric-unlock').props.onPress();
    button('password-modal-submit').props.onPress();
    button('password-modal-cancel').props.onPress();
    tree.root.findByType(Modal).props.onRequestClose();
  });
  expect(unlock).toHaveBeenCalledTimes(1);
  expect(tree.root.findByType(Modal).props.visible).toBe(true);
  await changeAppState('inactive');
  await changeAppState('active');
  await act(async () => finish(null));
  expect(unlock).toHaveBeenCalledTimes(1);
  expect(button('identity-biometric-unlock').props.disabled).toBe(false);
});

it('leaves password entry available after a real failure without retrying automatically', async () => {
  const unlock = jest.fn(async () => {
    throw new Error('Biometric lockout');
  });
  await open(unlock);
  await show();
  expect(alerts()).toHaveLength(1);
  expect(tree.root.findByType(TextInput).props.editable).toBe(true);
  await changeAppState('inactive');
  await changeAppState('active');
  expect(unlock).toHaveBeenCalledTimes(1);
  await act(async () => button('identity-biometric-unlock').props.onPress());
  expect(unlock).toHaveBeenCalledTimes(2);
});

it('waits for an older attempt and ignores its error when a new request replaces it', async () => {
  let fail!: (reason: Error) => void;
  const first = await open(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  await show();
  const unlock = jest.fn(async () => null);
  await open(unlock);
  await expect(first.result).resolves.toBeNull();
  expect(unlock).not.toHaveBeenCalled();
  await act(async () => fail(new Error('Old request failed')));
  expect(unlock).toHaveBeenCalledTimes(1);
  expect(alerts()).toHaveLength(0);
});

it('ignores a successful older attempt when a new request replaces it', async () => {
  let finish!: (value: string | null) => void;
  const first = await open(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await show();
  const unlock = jest.fn(async () => null);
  await open(unlock);
  await expect(first.result).resolves.toBeNull();
  await act(async () => finish('old secret'));
  expect(unlock).toHaveBeenCalledTimes(1);
  expect(tree.root.findByType(Modal).props.visible).toBe(true);
});

it('cancels a request on unmount while native authentication finishes', async () => {
  let finish!: (value: string | null) => void;
  const {result} = await open(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await show();
  await act(async () => tree.update(<></>));
  await expect(result).resolves.toBeNull();
  await act(async () => finish('saved'));
  expect(listeners.size).toBe(0);
});
