import React, {useState} from 'react';
import {Alert} from 'react-native';
import TextField from '../../components/TextField';
import {useIdentityUnlock} from '../../hooks/useIdentityUnlock';
import {signMessage} from '../../services/signVerify';
import {getCurrentIdentityRequired} from '../../services/storage';
import {ToolDisclosure, ToolForm, ToolIdentity, ToolToggle} from './ToolForm';
import {ToolPayloadResult} from './ToolResult';
import {useToolAction} from './useToolAction';

export default function SignMessageScreen(): JSX.Element {
  const {ensureUnlocked, unlockPrompt} = useIdentityUnlock();
  const [message, setMessage] = useState('');
  const [detached, setDetached] = useState(false);
  const [includeIdentity, setIncludeIdentity] = useState(true);
  const [includeSalt, setIncludeSalt] = useState(true);
  const action = useToolAction<string>();
  const busy = action.pending !== null;

  const onSign = () =>
    action.run(async () => {
      const identityName = await getCurrentIdentityRequired();
      const confirmed = await new Promise<boolean>(resolve => {
        Alert.alert(
          'Confirm sign',
          `Sign this message with ${identityName}?`,
          [
            {text: 'Cancel', style: 'cancel', onPress: () => resolve(false)},
            {text: 'Sign', onPress: () => resolve(true)},
          ],
          {cancelable: true, onDismiss: () => resolve(false)},
        );
      });
      if (!confirmed || !(await ensureUnlocked(identityName))) {
        return;
      }
      const payload = await signMessage({
        identityName,
        message,
        options: {detached, includeIdentity, includeSalt},
      });
      return JSON.stringify(payload, null, 2);
    });

  return (
    <ToolForm
      description="Create a signature so someone can verify who signed your message and whether it changed."
      action={action}
      title="Sign message"
      busyTitle="Signing…"
      testID="sign-message-submit"
      disabled={!message}
      onSubmit={onSign}
      result={
        action.result && (
          <ToolPayloadResult
            testID="sign-message-output"
            title="Message signed"
            description={
              detached
                ? 'Send the signature and the original message separately.'
                : 'The payload includes your message in plain text.'
            }
            value={action.result}
          />
        )
      }>
      {unlockPrompt}
      <ToolIdentity verb="Signing" />
      <TextField
        label="Message"
        testID="sign-message-input"
        value={message}
        onChangeText={action.edit(setMessage)}
        placeholder="Enter the exact text to sign"
        editable={!busy}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
      />
      <ToolDisclosure
        label="Signature options"
        disabled={busy}
        testID="sign-options">
        <ToolToggle
          label="Detached signature"
          hint="Keep the original message separate from its signature."
          testID="sign-detached"
          value={detached}
          onChange={action.edit(setDetached)}
          disabled={busy}
        />
        <ToolToggle
          label="Include public identity"
          hint="Include the public keys needed to check the signature."
          testID="sign-include-identity"
          value={includeIdentity}
          onChange={action.edit(setIncludeIdentity)}
          disabled={busy}
        />
        <ToolToggle
          label="Include random salt"
          hint="Use a new random value each time you sign."
          testID="sign-include-salt"
          value={includeSalt}
          onChange={action.edit(setIncludeSalt)}
          disabled={busy}
        />
      </ToolDisclosure>
    </ToolForm>
  );
}
