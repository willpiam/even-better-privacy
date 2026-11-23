import React, {useState} from 'react';
import TextField from '../../components/TextField';
import {useIdentityUnlock} from '../../hooks/useIdentityUnlock';
import {signFile} from '../../services/signVerify';
import {ToolForm, ToolIdentity, ToolToggle} from './ToolForm';
import {ToolFileInput, ToolFileOptions} from './ToolInputs';
import {ToolPayloadResult} from './ToolResult';
import type {ToolFile} from './toolFiles';
import {useToolAction} from './useToolAction';

export default function SignFileScreen(): JSX.Element {
  const {ensureUnlocked, unlockPrompt} = useIdentityUnlock();
  const [file, setFile] = useState<ToolFile | null>(null);
  const [uri, setUri] = useState('');
  const [context, setContext] = useState('');
  const [includeSalt, setIncludeSalt] = useState(true);
  const action = useToolAction<string>();
  const busy = action.pending !== null;
  const fileUri = uri.trim() || file?.uri || '';

  const onSign = () =>
    action.run(async () => {
      const identityName = await ensureUnlocked();
      if (!identityName) {
        return;
      }
      const result = await signFile({
        identityName,
        fileUri,
        fileName: uri.trim() ? undefined : file?.name,
        contextMessage: context || undefined,
        includeSalt,
      });
      return JSON.stringify(result.payload, null, 2);
    });

  return (
    <ToolForm
      description="Create a separate signature for a file. Keep the original file to verify it later."
      action={action}
      title="Sign file"
      busyTitle="Signing…"
      disabled={!fileUri}
      onSubmit={onSign}
      result={
        action.result && (
          <ToolPayloadResult
            title="File signed"
            description="Send the signature JSON alongside the original file."
            value={action.result}
            documentName="file-signature.ebp.json"
          />
        )
      }>
      {unlockPrompt}
      <ToolIdentity verb="Signing" />
      <ToolFileInput
        action={action}
        label="Original file"
        file={file}
        nameTestID="sign-file-name"
        overridden={!!uri.trim()}
        onPick={action.edit(selected => {
          setFile(selected);
          setUri('');
        })}
      />
      <TextField
        label="Context (optional)"
        value={context}
        onChangeText={action.edit(setContext)}
        placeholder="Add a note to include in the signature"
        editable={!busy}
        multiline
      />
      <ToolFileOptions uri={uri} onChange={action.edit(setUri)} disabled={busy}>
        <ToolToggle
          label="Include random salt"
          hint="Use a new random value each time you sign."
          value={includeSalt}
          onChange={action.edit(setIncludeSalt)}
          disabled={busy}
          testID="sign-file-include-salt"
        />
      </ToolFileOptions>
    </ToolForm>
  );
}
