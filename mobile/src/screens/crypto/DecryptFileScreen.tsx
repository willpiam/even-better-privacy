import React, {useState} from 'react';
import {StyleSheet, Text} from 'react-native';
import {parseEbpPayloadInput} from '../../ebpCore';
import {useIdentityUnlock} from '../../hooks/useIdentityUnlock';
import {decryptFile} from '../../services/encryptDecrypt';
import {
  isEncryptedFileType,
  isEncryptedSignedFileType,
  requireCiphertext,
} from '../../services/encryptDecryptLogic';
import {colors, typography} from '../../theme/tokens';
import {ToolForm, ToolHint, ToolIdentity} from './ToolForm';
import {ToolContact, ToolImportField} from './ToolInputs';
import {ToolResult, ToolShare, ToolSignatureStatus} from './ToolResult';
import {formatToolFileSize, shareToolFile} from './toolFiles';
import {useToolAction} from './useToolAction';

export default function DecryptFileScreen(): JSX.Element {
  const {ensureUnlocked, unlockPrompt} = useIdentityUnlock();
  const [payloadText, setPayloadText] = useState('');
  const [sender, setSender] = useState('');
  const action = useToolAction<Awaited<ReturnType<typeof decryptFile>>>();

  const onDecrypt = () =>
    action.run(async () => {
      const payload = parseEbpPayloadInput(payloadText);
      if (
        !isEncryptedFileType(payload.type) &&
        !isEncryptedSignedFileType(payload.type)
      ) {
        throw new Error('Provide an encrypted file payload.');
      }
      requireCiphertext(payload);
      const identityName = await ensureUnlocked();
      if (!identityName) return;
      return decryptFile({
        identityName,
        payload,
        sender: sender.trim() || undefined,
      });
    });

  const file = action.result;
  return (
    <ToolForm
      description="Import an encrypted file payload to recover the original file."
      action={action}
      title="Decrypt file"
      busyTitle="Decrypting…"
      disabled={!payloadText.trim()}
      onSubmit={onDecrypt}
      result={
        file && (
          <ToolResult title="File decrypted">
            <Text style={styles.fileName} selectable>
              {file.fileName}
            </Text>
            <ToolHint>
              {formatToolFileSize(file.fileSize)} · {file.mimeType}
            </ToolHint>
            <ToolSignatureStatus status={file.verifyStatus} />
            <ToolShare
              title="Share or save file"
              share={() =>
                shareToolFile(
                  file.fileName,
                  file.fileDataBase64,
                  file.mimeType,
                  'base64',
                )
              }
            />
          </ToolResult>
        )
      }>
      {unlockPrompt}
      <ToolIdentity verb="Decrypting" />
      <ToolImportField
        action={action}
        label="Encrypted file payload"
        placeholder="Paste JSON or import the encrypted file"
        value={payloadText}
        onChange={action.edit(setPayloadText)}
        pasteMessage="Pasted encrypted file payload"
      />
      <ToolContact
        sender
        value={sender}
        onChange={action.edit(setSender)}
        disabled={action.pending !== null}
      />
    </ToolForm>
  );
}

const styles = StyleSheet.create({
  fileName: {color: colors.text, fontSize: typography.row, fontWeight: '600'},
});
