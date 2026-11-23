import React, {useState} from 'react';
import TextField from '../../components/TextField';
import {useIdentityUnlock} from '../../hooks/useIdentityUnlock';
import {encryptMessage} from '../../services/encryptDecrypt';
import {ToolForm, ToolIdentity, ToolToggle} from './ToolForm';
import {ToolContact} from './ToolInputs';
import {ToolPayloadResult} from './ToolResult';
import {useToolAction} from './useToolAction';

export default function EncryptMessageScreen(): JSX.Element {
  const {ensureUnlocked, unlockPrompt} = useIdentityUnlock();
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const [sign, setSign] = useState(false);
  const action = useToolAction<string>();
  const busy = action.pending !== null;

  const onEncrypt = () =>
    action.run(async () => {
      const identityName = sign ? await ensureUnlocked() : undefined;
      if (identityName === null) return;
      const payload = await encryptMessage({
        identityName,
        message,
        recipient: recipient.trim(),
        sign,
      });
      return JSON.stringify(payload, null, 2);
    });

  return (
    <ToolForm
      description="Create an encrypted message that your chosen contact can open."
      action={action}
      title="Encrypt message"
      busyTitle="Encrypting…"
      disabled={!message || !recipient.trim()}
      onSubmit={onEncrypt}
      result={
        action.result && (
          <ToolPayloadResult
            title="Message encrypted"
            description="Send the encrypted payload to your recipient."
            value={action.result}
          />
        )
      }>
      {unlockPrompt}
      <ToolContact
        value={recipient}
        onChange={action.edit(setRecipient)}
        disabled={busy}
      />
      <TextField
        label="Message"
        value={message}
        onChangeText={action.edit(setMessage)}
        placeholder="Enter the message to encrypt"
        editable={!busy}
        multiline
        autoCorrect={false}
        spellCheck={false}
      />
      <ToolToggle
        label="Sign with my identity"
        hint="Let your recipient verify who signed the message."
        value={sign}
        onChange={action.edit(setSign)}
        disabled={busy}
      />
      {sign ? <ToolIdentity verb="Signing" /> : null}
    </ToolForm>
  );
}
