import React, {useState} from 'react';
import {Text} from 'react-native';
import TextField from '../../components/TextField';
import {parseEbpPayloadInput, type ExternalIdentity} from '../../ebpCore';
import {verifyMessage} from '../../services/signVerify';
import {ToolForm, ToolHint, ToolToggle} from './ToolForm';
import {ToolImportField} from './ToolInputs';
import {ToolResult, toolResultStyles} from './ToolResult';
import {useToolAction} from './useToolAction';

function parsePublicIdentityJson(raw: string): ExternalIdentity {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    throw new Error(
      'Public identity JSON is invalid. Check the export and try again.',
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Public identity JSON must contain an object.');
  }
  if (
    typeof parsed.signingKey !== 'string' ||
    !parsed.signingKey ||
    typeof parsed.signingKeyType !== 'string' ||
    !parsed.signingKeyType
  ) {
    throw new Error(
      'Provide a public identity export that includes its signing key.',
    );
  }
  return parsed as unknown as ExternalIdentity;
}

export default function VerifyMessageScreen(): JSX.Element {
  const [payloadText, setPayloadText] = useState('');
  const [message, setMessage] = useState('');
  const [usePublicKeys, setUsePublicKeys] = useState(false);
  const [publicKeys, setPublicKeys] = useState('');
  const action = useToolAction<{verified: boolean; message: string}>();
  const busy = action.pending !== null;

  const onVerify = () =>
    action.run(async () => {
      const payload = parseEbpPayloadInput(payloadText);
      if (payload.type === 'ebp-signature' && !message) {
        throw new Error(
          'Enter the exact original message to verify this detached signature.',
        );
      }
      try {
        const result = await verifyMessage({
          payload,
          message: message || undefined,
          publicIdentity: usePublicKeys
            ? parsePublicIdentityJson(publicKeys)
            : undefined,
        });
        return {
          ...result,
          message:
            payload.type === 'ebp-signed-message'
              ? String(payload.message ?? '')
              : message,
        };
      } catch (error) {
        if (error instanceof Error && error.message === 'Contact not found') {
          throw new Error(
            'Signing key not found. Provide the signer’s public identity export and try again.',
          );
        }
        if (
          error instanceof Error &&
          error.message === 'Message hash mismatch'
        ) {
          return {verified: false, message: ''};
        }
        throw error;
      }
    });

  const result = action.result;
  return (
    <ToolForm
      description="Check a signed message or a detached signature from Even Better Privacy."
      action={action}
      title="Verify message"
      busyTitle="Verifying…"
      testID="verify-submit"
      disabled={!payloadText.trim() || (usePublicKeys && !publicKeys.trim())}
      onSubmit={onVerify}
      result={
        result && (
          <ToolResult
            title={result.verified ? 'Valid signature' : 'Invalid signature'}
            tone={result.verified ? 'success' : 'error'}
            testID="verify-result">
            {result.verified ? (
              <>
                <ToolHint>
                  Confirm the signer’s public identity before relying on the
                  signature.
                </ToolHint>
                <Text style={toolResultStyles.text} selectable>
                  {result.message}
                </Text>
              </>
            ) : null}
          </ToolResult>
        )
      }>
      <ToolImportField
        action={action}
        label="Signed payload"
        placeholder="Paste JSON or an EBP block"
        value={payloadText}
        onChange={action.edit(setPayloadText)}
        pasteMessage="Pasted payload"
        testID="verify-payload-input"
        pasteTestID="verify-paste-clipboard"
      />
      <TextField
        label="Detached message"
        value={message}
        onChangeText={action.edit(setMessage)}
        placeholder="Original text, only for a detached signature"
        editable={!busy}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        multiline
      />
      <ToolToggle
        label="Use a public identity export"
        hint="Use a public key you received separately to check the signature."
        value={usePublicKeys}
        onChange={action.edit(setUsePublicKeys)}
        disabled={busy}
        testID="verify-use-public-keys"
      />
      {usePublicKeys ? (
        <ToolImportField
          action={action}
          label="Public identity JSON"
          placeholder="Paste a public identity export with a signing key"
          value={publicKeys}
          onChange={action.edit(setPublicKeys)}
          pasteMessage="Pasted public keys"
          testID="verify-public-keys"
          pasteTestID="verify-public-keys-paste"
        />
      ) : null}
    </ToolForm>
  );
}
