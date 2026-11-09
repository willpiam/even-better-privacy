import { assertEquals } from "jsr:@std/assert";
import {
  includeSenderAmongRecipients,
  isSentFolderRequest,
  parseImapListLine,
  pickSentMailbox,
} from "./SentMailbox.ts";

Deno.test("pickSentMailbox prefers the \\Sent special-use mailbox", () => {
  const path = pickSentMailbox([
    { path: "Sent", flags: [] },
    { path: "Sent Items", flags: ["\\HasNoChildren", "\\Sent"] },
    { path: "INBOX", flags: ["\\Inbox"] },
  ]);
  assertEquals(path, "Sent Items");
});

Deno.test("pickSentMailbox uses specialUse and then common names", () => {
  assertEquals(
    pickSentMailbox([
      { path: "[Gmail]/Sent Mail", specialUse: "\\Sent" },
      { path: "Sent", flags: [] },
    ]),
    "[Gmail]/Sent Mail",
  );
  assertEquals(
    pickSentMailbox([
      { path: "INBOX", flags: [] },
      { path: "Sent Messages", flags: [] },
    ]),
    "Sent Messages",
  );
  assertEquals(pickSentMailbox([{ path: "INBOX", flags: [] }]), null);
});

Deno.test("parseImapListLine reads flags and quoted mailbox names", () => {
  assertEquals(
    parseImapListLine('* LIST (\\HasNoChildren \\Sent) "/" "Sent Items"'),
    { path: "Sent Items", flags: ["\\HasNoChildren", "\\Sent"] },
  );
  assertEquals(
    parseImapListLine('* LIST (\\HasNoChildren) "/" INBOX'),
    { path: "INBOX", flags: ["\\HasNoChildren"] },
  );
  assertEquals(
    parseImapListLine('* LIST (\\Sent) NIL "[Gmail]/Sent Mail"'),
    { path: "[Gmail]/Sent Mail", flags: ["\\Sent"] },
  );
  assertEquals(parseImapListLine("s1 OK LIST completed"), null);
});

Deno.test("isSentFolderRequest matches the Sent picker and provider names", () => {
  assertEquals(isSentFolderRequest("Sent"), true);
  assertEquals(isSentFolderRequest(" sent items "), true);
  assertEquals(isSentFolderRequest("[Gmail]/Sent Mail"), true);
  assertEquals(isSentFolderRequest("INBOX"), false);
  assertEquals(isSentFolderRequest("Archive"), false);
});

Deno.test("includeSenderAmongRecipients adds the sender once", () => {
  const alice = { fingerprint: "alice", name: "Alice" };
  const bob = { fingerprint: "bob", name: "Bob" };
  assertEquals(
    includeSenderAmongRecipients([bob], alice).map((item) => item.fingerprint),
    ["bob", "alice"],
  );
  assertEquals(
    includeSenderAmongRecipients([alice], alice).map((item) => item.name),
    ["Alice"],
  );
});
