import React, {useState} from 'react';
import {MAX_ENCRYPTED_FILE_BYTES} from '../../../../common/FileLimits';
import TextField from '../../components/TextField';
import {useIdentityUnlock} from '../../hooks/useIdentityUnlock';
import {encryptFile} from '../../services/encryptDecrypt';
import {ToolForm, ToolHint, ToolIdentity, ToolToggle} from './ToolForm';
import {ToolContact, ToolFileInput, ToolFileOptions} from './ToolInputs';
import {ToolPayloadResult} from './ToolResult';
import {formatToolFileSize, type ToolFile} from './toolFiles';
import {useToolAction} from './useToolAction';

export default function EncryptFileScreen(): JSX.Element {
  const {ensureUnlocked, unlockPrompt} = useIdentityUnlock();
  const [file, setFile] = useState<ToolFile | null>(null);
  const [uri, setUri] = useState('');
  const [name, setName] = useState('');
  const [mime, setMime] = useState('');
  const [recipient, setRecipient] = useState('');
  const [sign, setSign] = useState(false);
  const action = useToolAction<string>();
  const busy = action.pending !== null;
  const manualUri = uri.trim();
  const fileUri = manualUri || file?.uri || '';
  const fileName =
    name.trim() ||
    (manualUri ? 'encrypted.bin' : file?.name) ||
    'encrypted.bin';

  const onEncrypt = () =>
    action.run(async () => {
      const identityName = sign ? await ensureUnlocked() : undefined;
      if (identityName === null) return;
      const payload = await encryptFile({
        identityName,
        fileUri,
        fileName,
        mimeType: mime.trim() || (manualUri ? undefined : file?.mime),
        recipient: recipient.trim(),
        sign,
      });
      return JSON.stringify(payload, null, 2);
    });

  return (
    <ToolForm
      description="Create an encrypted copy of a file for one of your saved contacts."
      action={action}
      title="Encrypt file"
      busyTitle="Encrypting…"
      disabled={!fileUri || !recipient.trim()}
      onSubmit={onEncrypt}
      result={
        action.result && (
          <ToolPayloadResult
            title="File encrypted"
            description="Share the JSON file so the recipient can import it in Decrypt file."
            value={action.result}
            documentName="encrypted-file.ebp.json"
          />
        )
      }>
      {unlockPrompt}
      <ToolFileInput
        action={action}
        label="File to encrypt"
        file={file}
        nameTestID="encrypt-file-name"
        overridden={!!manualUri}
        onPick={action.edit(selected => {
          setFile(selected);
          setUri('');
          setName('');
          setMime('');
        })}
      />
      <ToolHint>
        Maximum file size {formatToolFileSize(MAX_ENCRYPTED_FILE_BYTES)}.
      </ToolHint>
      <ToolFileOptions uri={uri} onChange={action.edit(setUri)} disabled={busy}>
        <TextField
          label="Output file name (optional)"
          value={name}
          onChangeText={action.edit(setName)}
          placeholder={
            manualUri ? 'encrypted.bin' : file?.name || 'encrypted.bin'
          }
          editable={!busy}
        />
        <TextField
          label="MIME type (optional)"
          value={mime}
          onChangeText={action.edit(setMime)}
          placeholder={
            manualUri
              ? 'application/octet-stream'
              : file?.mime || 'application/octet-stream'
          }
          editable={!busy}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
        />
      </ToolFileOptions>
      <ToolContact
        value={recipient}
        onChange={action.edit(setRecipient)}
        disabled={busy}
      />
      <ToolToggle
        label="Sign with my identity"
        hint="Let your recipient verify who signed the file."
        value={sign}
        onChange={action.edit(setSign)}
        disabled={busy}
      />
      {sign ? <ToolIdentity verb="Signing" /> : null}
    </ToolForm>
  );
}
