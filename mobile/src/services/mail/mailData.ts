import {fetchMessageDetail, listMailboxMessages} from './imap';
import type {
  ListMailboxMessagesParams,
  ListMailboxMessagesResult,
} from './imap';
import type {
  MailAccountRecord,
  MailAuthSecrets,
  MailMessageDetail,
} from './types';
import {createMailCache, registerMailCache} from './mailCache';

type MailContext = {account: MailAccountRecord; secrets: MailAuthSecrets};
const pages = createMailCache<ListMailboxMessagesResult>(
  30,
  1024 * 1024,
  5 * 60_000,
);
const bodies = createMailCache<MailMessageDetail>(20, 8 * 1024 * 1024, 60_000);
registerMailCache(pages);
registerMailCache(bodies);
function scope(identityName: string, context: MailContext): string {
  return JSON.stringify([
    identityName,
    context.account.id,
    context.account.updatedAt,
    context.account.config,
  ]);
}
function pageKey(
  identityName: string,
  context: MailContext,
  params: ListMailboxMessagesParams,
): string {
  return JSON.stringify([
    scope(identityName, context),
    params.folder ?? 'INBOX',
    params.search ?? '',
    params.page ?? 1,
    params.limit ?? 20,
  ]);
}
export function getCachedMailPage(
  identityName: string,
  context: MailContext,
  params: ListMailboxMessagesParams,
) {
  return pages.get(pageKey(identityName, context, params));
}
export function refreshMailPage(
  identityName: string,
  context: MailContext,
  params: ListMailboxMessagesParams,
) {
  return pages.load(
    pageKey(identityName, context, params),
    () => listMailboxMessages(context.account.config, context.secrets, params),
    true,
  );
}
export function loadMailMessage(
  identityName: string,
  context: MailContext,
  uid: number,
  folder: string,
) {
  const key = JSON.stringify([scope(identityName, context), folder, uid]);
  return bodies.load(key, () =>
    fetchMessageDetail(context.account.config, context.secrets, uid, folder),
  );
}
export function invalidateMailBodies() {
  bodies.clear();
}
