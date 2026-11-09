import {groupChatConversations, type ChatConversation} from '../../../../core/ChatChannel';
import {resolveSelectedAccount} from './accountStore';
import {listChatMessages, markMessagesSeen} from './imap';

export async function loadChatConversations(identityName: string): Promise<{
  ownAddress: string;
  conversations: ChatConversation[];
}> {
  const resolved = await resolveSelectedAccount(identityName);
  if (!resolved) {
    throw new Error('Configure a mail account first');
  }
  const ownAddress =
    resolved.account.config.fromEmail || resolved.account.config.username;
  const rows = await listChatMessages(resolved.account.config, resolved.secrets);
  return {
    ownAddress,
    conversations: groupChatConversations(rows, ownAddress),
  };
}

export async function markChatSeen(
  identityName: string,
  folder: string,
  uids: number[],
): Promise<void> {
  if (!uids.length) {
    return;
  }
  const resolved = await resolveSelectedAccount(identityName);
  if (!resolved) {
    throw new Error('Configure a mail account first');
  }
  await markMessagesSeen(
    resolved.account.config,
    resolved.secrets,
    folder,
    uids,
  );
}
