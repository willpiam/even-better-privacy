import React from 'react';
import renderer, {act} from 'react-test-renderer';
import ContactsScreen from '../src/screens/ContactsScreen';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]),
}));
jest.mock('../src/services/contacts', () => ({listContacts: async () => []}));
jest.mock('../src/ebpCore', () => ({shortFingerprint: (fp: string) => fp}));
jest.mock('../src/components/ImportContactModal', () => jest.fn(() => null));
jest.mock('../src/components/FetchContactModal', () => jest.fn(() => null));
jest.mock('../src/components/BrowseContactsModal', () => jest.fn(() => null));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));

import ImportContactModal from '../src/components/ImportContactModal';
import FetchContactModal from '../src/components/FetchContactModal';
import BrowseContactsModal from '../src/components/BrowseContactsModal';

let tree: renderer.ReactTestRenderer;
let options: {headerRight: () => React.ReactNode};
beforeEach(async () => {
  await act(async () => {
    tree = renderer.create(
      <ContactsScreen
        navigation={
          {
            navigate: jest.fn(),
            setOptions: (value: typeof options) => {
              options = value;
            },
          } as never
        }
        route={{key: 'contacts', name: 'ContactsList'}}
      />,
    );
  });
});
afterEach(async () => {
  await act(async () => tree.unmount());
});
async function openMenu() {
  let header!: renderer.ReactTestRenderer;
  await act(async () => {
    header = renderer.create(options.headerRight() as React.ReactElement);
  });
  const button = header.root.findAll(
    node =>
      node.props.testID === 'contacts-add' &&
      typeof node.props.onPress === 'function',
  )[0];
  expect(button.props.accessibilityLabel).toBe('Add contact');
  await act(async () => button.props.onPress());
  await act(async () => header.unmount());
}
it.each([
  ['contacts-import', ImportContactModal],
  ['contacts-fetch', FetchContactModal],
  ['contacts-browse', BrowseContactsModal],
] as const)('opens %s from the header menu', async (id, modal) => {
  expect(tree.root.findAllByProps({testID: id})).toHaveLength(0);
  await openMenu();
  await act(async () =>
    tree.root
      .findAll(node => typeof node.props.onPress === 'function')
      .find(n => n.props.testID === id)!
      .props.onPress(),
  );
  expect(tree.root.findByType(modal).props.visible).toBe(true);
  expect(
    tree.root.findAllByProps({testID: 'contacts-menu-dismiss'}),
  ).toHaveLength(0);
});
it('dismisses the menu without opening a form', async () => {
  await openMenu();
  await act(async () =>
    tree.root
      .findAll(node => typeof node.props.onPress === 'function')
      .find(n => n.props.testID === 'contacts-menu-dismiss')!
      .props.onPress(),
  );
  expect(tree.root.findByType(ImportContactModal).props.visible).toBe(false);
  expect(tree.root.findByType(FetchContactModal).props.visible).toBe(false);
  expect(tree.root.findByType(BrowseContactsModal).props.visible).toBe(false);
});
