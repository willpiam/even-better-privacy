import {NativeModules} from 'react-native';

/** Native implementations write a sibling temporary file, then replace by rename. */
export async function writeFileAtomic(
  path: string,
  content: string,
): Promise<void> {
  const writer = NativeModules.EbpAtomicFile;
  if (!writer?.write) {
    throw new Error('Atomic identity storage is unavailable; rebuild the app');
  }
  await writer.write(path, content);
}
