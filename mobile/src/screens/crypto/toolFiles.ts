import {
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
  pick,
} from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import {normalizeFileUri} from '../../services/encryptDecryptLogic';

export type ToolFile = {uri: string; name: string; mime: string};

let nextFileId = 0;

function uniqueName(): string {
  return `ebp-tool-${Date.now()}-${nextFileId++}`;
}

export async function pickToolFile(): Promise<ToolFile | undefined> {
  try {
    const [file] = await pick({mode: 'open'});
    const [copy] = await keepLocalCopy({
      destination: 'cachesDirectory',
      files: [{uri: file.uri, fileName: uniqueName()}],
    });
    if (copy.status !== 'success') {
      throw new Error(
        'Could not open this file. Choose it again or try another file.',
      );
    }
    return {
      uri: copy.localUri,
      name: file.name || 'Untitled file',
      mime: file.type || 'application/octet-stream',
    };
  } catch (error) {
    if (
      isErrorWithCode(error) &&
      error.code === errorCodes.OPERATION_CANCELED
    ) {
      return;
    }
    throw error;
  }
}

export function removeToolFile(uri: string): void {
  RNFS.unlink(normalizeFileUri(uri)).catch(() => {});
}

export async function readToolTextFile() {
  const file = await pickToolFile();
  if (!file) {
    return;
  }
  try {
    const text = await RNFS.readFile(normalizeFileUri(file.uri), 'utf8');
    if (!text.trim()) {
      throw new Error(
        'This file is empty. Choose a file containing the exported text.',
      );
    }
    return {text, name: file.name};
  } finally {
    removeToolFile(file.uri);
  }
}

export async function shareToolFile(
  name: string,
  data: string,
  mime: string,
  encoding: 'base64' | 'utf8',
) {
  const directory = `${RNFS.CachesDirectoryPath}/${uniqueName()}`;
  const sanitized = name.replace(/[/\\]/g, '_');
  const safeName =
    sanitized && sanitized !== '.' && sanitized !== '..'
      ? sanitized
      : 'decrypted-file';
  const path = `${directory}/${safeName}`;
  await RNFS.mkdir(directory);
  try {
    await RNFS.writeFile(path, data, encoding);
    await Share.open({
      url: `file://${directory}/${encodeURIComponent(safeName)}`,
      type: mime || 'application/octet-stream',
      filename: safeName,
      failOnCancel: false,
    });
  } catch (error) {
    removeToolFile(directory);
    throw error;
  }
}

export function formatToolFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
