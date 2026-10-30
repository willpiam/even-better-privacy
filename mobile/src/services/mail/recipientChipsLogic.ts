import {
  deriveComposeIntent,
  parseAddressList,
  type ComposeChip,
  type ComposeIntent,
} from '../../../../core/ComposeRecipients';
import type {
  StoredContact,
  VerifiedRecipientResolution,
} from '../contacts';

export {deriveComposeIntent};
export type {ComposeIntent};

export type RecipientChip = ComposeChip & {
  id: string;
  /** Saved contacts that share this address (shown first in the resolve modal). */
  preferredContacts?: StoredContact[];
};

export type InitialRecipient = {
  email: string;
  contact?: string;
  intent?: 'encrypted' | 'unencrypted';
};

let chipCounter = 0;

function newChipId(): string {
  chipCounter += 1;
  return `chip-${Date.now().toString(36)}-${chipCounter}`;
}

function buildChips(
  existing: readonly RecipientChip[],
  entries: readonly InitialRecipient[],
): RecipientChip[] {
  const seen = existing.map(chip => chip.email);
  const out: RecipientChip[] = [];
  for (const entry of entries) {
    const [parsed] = parseAddressList(entry.email, seen);
    if (!parsed) {
      continue;
    }
    seen.push(parsed.email);
    let state: RecipientChip['state'] = 'resolving';
    if (!parsed.valid) {
      state = 'invalid';
    } else if (entry.contact?.trim()) {
      state = 'encrypted';
    } else if (entry.intent === 'unencrypted') {
      state = 'plaintext';
    }
    out.push({
      id: newChipId(),
      email: parsed.email,
      state,
      contact: state === 'encrypted' ? entry.contact?.trim() : undefined,
    });
  }
  return out;
}

export function chipsFromInitial(
  entries: readonly InitialRecipient[] | undefined,
): RecipientChip[] {
  return buildChips([], entries ?? []);
}

/** Append every address in `text` as a new chip, skipping duplicates. */
export function appendAddresses(
  chips: readonly RecipientChip[],
  text: string,
): RecipientChip[] {
  const parsed = parseAddressList(
    text,
    chips.map(chip => chip.email),
  );
  if (!parsed.length) {
    return chips as RecipientChip[];
  }
  return [...chips, ...buildChips(chips, parsed.map(({email}) => ({email})))];
}

/**
 * Split live input at the last separator: everything before it is ready to
 * become chips, the remainder stays in the text box.
 */
export function splitPendingInput(text: string): {
  complete: string;
  rest: string;
} {
  const match = text.match(/^([\s\S]*[,;\n])([^,;\n]*)$/);
  if (!match) {
    return {complete: '', rest: text};
  }
  return {complete: match[1], rest: match[2]};
}

export type ChipResolution = Pick<
  RecipientChip,
  'state' | 'contact' | 'note' | 'preferredContacts'
>;

/** Local contacts (email and opaque::email), then the key server. */
export async function resolveChipAddress(
  email: string,
  deps: {
    resolveVerifiedRecipient: (
      email: string,
    ) => Promise<VerifiedRecipientResolution>;
    findContactsByEmail: (email: string) => Promise<StoredContact[]>;
  },
): Promise<ChipResolution> {
  try {
    const outcome = await deps.resolveVerifiedRecipient(email);
    if (outcome.status === 'unique') {
      return {state: 'encrypted', contact: outcome.name};
    }
    const matches = await deps.findContactsByEmail(email);
    return {
      state: 'unresolved',
      contact: undefined,
      preferredContacts: matches,
      note:
        outcome.status === 'ambiguous'
          ? matches.length > 1
            ? 'More than one saved contact uses this address.'
            : 'More than one verified identity publishes this address.'
          : undefined,
    };
  } catch (error) {
    return {
      state: 'unresolved',
      contact: undefined,
      note: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Apply a resolution only if the chip still exists with the same address. */
export function applyResolution(
  chips: readonly RecipientChip[],
  id: string,
  email: string,
  resolution: ChipResolution,
): RecipientChip[] {
  return chips.map(chip =>
    chip.id === id && chip.email === email && chip.state === 'resolving'
      ? {...chip, ...resolution}
      : chip,
  );
}
