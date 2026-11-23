import React, {useState} from 'react';
import {Text} from 'react-native';
import {parseEbpPayloadInput} from '../../ebpCore';
import {useIdentityUnlock} from '../../hooks/useIdentityUnlock';
import {decryptMessage} from '../../services/encryptDecrypt';
import {
  isEncryptedMessageType,
  isEncryptedSignedMessageMultiType,
  isEncryptedSignedMessageType,
  requireCiphertext,
} from '../../services/encryptDecryptLogic';
import {ToolForm, ToolHint, ToolIdentity} from './ToolForm';
import {ToolContact, ToolImportField} from './ToolInputs';
import {
  ToolCopy,
  ToolResult,
  ToolSignatureStatus,
  toolResultStyles,
} from './ToolResult';
import {useToolAction} from './useToolAction';

export default function DecryptMessageScreen(): JSX.Element {
  const {ensureUnlocked, unlockPrompt} = useIdentityUnlock();
  const [payloadText, setPayloadText] = useState('');
  const [sender, setSender] = useState('');
  const action = useToolAction<Awaited<ReturnType<typeof decryptMessage>>>();

  const onDecrypt = () =>
    action.run(async () => {
      const payload = parseEbpPayloadInput(payloadText);
      if (
        !isEncryptedMessageType(payload.type) &&
        !isEncryptedSignedMessageType(payload.type) &&
        !isEncryptedSignedMessageMultiType(payload.type)
      ) {
        throw new Error('Provide an encrypted message payload.');
      }
      requireCiphertext(payload);
      const identityName = await ensureUnlocked();
      if (!identityName) return;
      return decryptMessage({
        identityName,
        payload,
        sender: sender.trim() || undefined,
      });
    });

  const result = action.result;
  return (
    <ToolForm
      description="Open a message encrypted for your current identity."
      action={action}
      title="Decrypt message"
      busyTitle="Decrypting…"
      disabled={!payloadText.trim()}
      onSubmit={onDecrypt}
      result={
        result && (
          <ToolResult title="Message decrypted">
            <ToolSignatureStatus
              status={result.verifyStatus}
              fingerprint={result.signerFingerprint}
              knownContact={result.isKnownContact}
            />
            {result.message ? (
              <>
                <Text style={toolResultStyles.text} selectable>
                  {result.message}
                </Text>
                <ToolCopy value={result.message} title="Copy message" />
              </>
            ) : (
              <ToolHint>The decrypted message is empty.</ToolHint>
            )}
          </ToolResult>
        )
      }>
      {unlockPrompt}
      <ToolIdentity verb="Decrypting" />
      <ToolImportField
        action={action}
        label="Encrypted message"
        placeholder="Paste JSON or an EBP block"
        value={payloadText}
        onChange={action.edit(setPayloadText)}
        pasteMessage="Pasted encrypted message"
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
