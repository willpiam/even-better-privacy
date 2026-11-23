import React, {useState} from 'react';
import {Text} from 'react-native';
import {fingerprintFromPublicIdentity} from '../../services/identityHelpers';
import {ToolForm, ToolHint} from './ToolForm';
import {ToolImportField} from './ToolInputs';
import {ToolCopy, ToolResult, toolResultStyles} from './ToolResult';
import {useToolAction} from './useToolAction';

export default function FingerprintToolScreen(): JSX.Element {
  const [publicIdentity, setPublicIdentity] = useState('');
  const action = useToolAction<string>();

  const onCompute = () =>
    action.run(() => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(publicIdentity.trim());
      } catch {
        throw new Error(
          'Public identity JSON is invalid. Check the export and try again.',
        );
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Public identity JSON must contain an object.');
      }
      return fingerprintFromPublicIdentity(parsed);
    });

  return (
    <ToolForm
      description="Calculate a fingerprint from someone’s public identity export so you can compare it with theirs."
      action={action}
      title="Calculate fingerprint"
      disabled={!publicIdentity.trim()}
      onSubmit={onCompute}
      result={
        action.result && (
          <ToolResult title="Public identity fingerprint">
            <Text style={toolResultStyles.text} selectable>
              {action.result}
            </Text>
            <ToolCopy title="Copy fingerprint" value={action.result} />
            <ToolHint>
              Compare the full fingerprint with the owner through a channel you
              trust.
            </ToolHint>
          </ToolResult>
        )
      }>
      <ToolImportField
        action={action}
        label="Public identity JSON"
        placeholder="Paste a public identity export"
        value={publicIdentity}
        onChange={action.edit(setPublicIdentity)}
        pasteMessage="Pasted public identity"
      />
    </ToolForm>
  );
}
