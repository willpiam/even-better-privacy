import React, {useState} from 'react';
import {Text} from 'react-native';
import {parseEbpPayloadInput} from '../../ebpCore';
import {verifyFileSignature} from '../../services/signVerify';
import {ToolDisclosure, ToolForm, ToolHint} from './ToolForm';
import {ToolFileInput, ToolFileOptions, ToolImportField} from './ToolInputs';
import {ToolCopy, ToolResult, toolResultStyles} from './ToolResult';
import type {ToolFile} from './toolFiles';
import {useToolAction} from './useToolAction';

export default function VerifyFileScreen(): JSX.Element {
  const [file, setFile] = useState<ToolFile | null>(null);
  const [uri, setUri] = useState('');
  const [signature, setSignature] = useState('');
  const action =
    useToolAction<Awaited<ReturnType<typeof verifyFileSignature>>>();
  const fileUri = uri.trim() || file?.uri || '';

  const onVerify = () =>
    action.run(async () => {
      const payload = parseEbpPayloadInput(signature);
      if (payload.type !== 'ebp-signed-file') {
        throw new Error('Choose the signature that was created for this file.');
      }
      return verifyFileSignature({fileUri, payload});
    });

  const result = action.result;
  const verdict = result?.verified
    ? 'Valid file signature'
    : 'Invalid file signature';
  return (
    <ToolForm
      description="Choose the original file and provide its separate signature."
      action={action}
      title="Verify file"
      busyTitle="Verifying…"
      disabled={!fileUri || !signature.trim()}
      onSubmit={onVerify}
      result={
        result && (
          <ToolResult
            title={verdict}
            tone={result.verified ? 'success' : 'error'}>
            <Text style={toolResultStyles.text} selectable>
              {result.details}
            </Text>
            {result.verified ? (
              <ToolHint>
                Compare the signer fingerprint with one you trust.
              </ToolHint>
            ) : null}
            {result.signedMessage ? (
              <ToolDisclosure label="Signed text">
                <Text style={toolResultStyles.text} selectable>
                  {result.signedMessage}
                </Text>
              </ToolDisclosure>
            ) : null}
            <ToolCopy
              title="Copy verification details"
              value={[verdict, result.details, result.signedMessage]
                .filter(Boolean)
                .join('\n\n')}
            />
          </ToolResult>
        )
      }>
      <ToolFileInput
        action={action}
        label="Original file"
        file={file}
        nameTestID="verify-file-name"
        overridden={!!uri.trim()}
        onPick={action.edit(selected => {
          setFile(selected);
          setUri('');
        })}
      />
      <ToolFileOptions
        uri={uri}
        onChange={action.edit(setUri)}
        disabled={action.pending !== null}
      />
      <ToolImportField
        action={action}
        label="File signature"
        placeholder="Paste the separate signature"
        value={signature}
        onChange={action.edit(setSignature)}
        pasteMessage="Pasted file signature"
      />
    </ToolForm>
  );
}
