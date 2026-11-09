import { assertEquals } from "jsr:@std/assert";
import {
  chatPeerAllowed,
  EBP_CHAT_HEADER,
  formatMessageId,
  generateMessageId,
  groupChatConversations,
  isChatChannelHeader,
  latestThreadingTarget,
  messagesForThreadBodies,
  type ChatSourceMessage,
} from "./ChatChannel.ts";

Deno.test("isChatChannelHeader matches the chat value only", () => {
  assertEquals(isChatChannelHeader("chat"), true);
  assertEquals(isChatChannelHeader(" Chat "), true);
  assertEquals(isChatChannelHeader("mail"), false);
  assertEquals(isChatChannelHeader(""), false);
  assertEquals(isChatChannelHeader(null), false);
  assertEquals(EBP_CHAT_HEADER, "X-EBP-Channel");
});

Deno.test("chatPeerAllowed requires the same domain and a different address", () => {
  assertEquals(chatPeerAllowed("Me <me@pqpost.com>", "bob@pqpost.com"), true);
  assertEquals(chatPeerAllowed("me@pqpost.com", "me@pqpost.com"), false);
  assertEquals(chatPeerAllowed("me@pqpost.com", "bob@example.com"), false);
  assertEquals(chatPeerAllowed("me@pqpost.com", "not-an-email"), false);
});

Deno.test("formatMessageId and generateMessageId wrap an id", () => {
  assertEquals(formatMessageId("abc@example.com"), "<abc@example.com>");
  assertEquals(formatMessageId("<abc@example.com>"), "<abc@example.com>");
  assertEquals(formatMessageId("  "), "");
  const generated = generateMessageId("Me <me@pqpost.com>");
  assertEquals(generated.startsWith("<"), true);
  assertEquals(generated.endsWith("@pqpost.com>"), true);
});

function row(partial: Partial<ChatSourceMessage> & Pick<ChatSourceMessage, "uid" | "folderKind" | "from" | "to">): ChatSourceMessage {
  return {
    folder: partial.folderKind === "sent" ? "Sent" : "INBOX",
    date: partial.date ?? partial.uid * 1000,
    seen: partial.seen ?? true,
    messageId: partial.messageId ?? `<${partial.uid}@pqpost.com>`,
    ...partial,
  };
}

Deno.test("groupChatConversations keys inbox by From and sent by To", () => {
  const conversations = groupChatConversations([
    row({
      uid: 2,
      folderKind: "inbox",
      from: "Bob <bob@pqpost.com>",
      to: "me@pqpost.com",
      seen: false,
      date: 2000,
    }),
    row({
      uid: 1,
      folderKind: "sent",
      from: "me@pqpost.com",
      to: "Bob <bob@pqpost.com>",
      date: 1000,
    }),
    row({
      uid: 3,
      folderKind: "inbox",
      from: "me@pqpost.com",
      to: "me@pqpost.com",
      date: 3000,
    }),
    row({
      uid: 4,
      folderKind: "inbox",
      from: "Ada <ada@pqpost.com>",
      to: "me@pqpost.com",
      seen: true,
      date: 500,
    }),
  ], "me@pqpost.com");

  assertEquals(conversations.map((item) => item.peer), ["bob@pqpost.com", "ada@pqpost.com"]);
  assertEquals(conversations[0].unread, 1);
  assertEquals(conversations[0].messages.map((item) => item.uid), [1, 2]);
  assertEquals(conversations[0].messages.map((item) => item.outbound), [true, false]);
  assertEquals(conversations[0].latestDate, 2000);
});

Deno.test("thread helpers keep the newest bodies and the latest message id", () => {
  const messages = [1, 2, 3, 4].map((uid) => ({ uid, messageId: uid === 3 ? null : `<${uid}@h>` }));
  const window = messagesForThreadBodies(messages, 2);
  assertEquals(window.hiddenCount, 2);
  assertEquals(window.shown.map((item) => item.uid), [3, 4]);
  assertEquals(latestThreadingTarget(messages), {
    inReplyTo: "<4@h>",
    references: "<4@h>",
  });
  assertEquals(latestThreadingTarget([{ messageId: null }]), null);
});
