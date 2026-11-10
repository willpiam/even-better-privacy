import { assert, assertEquals, assertMatch, assertStringIncludes } from "jsr:@std/assert";
import { EBP_CHAT_SUBJECT } from "../../../common/ChatChannel.ts";
import { mailListSearchQuery } from "../mail-imap.ts";
import { compileRawMessage } from "../mail-send.ts";

Deno.test("compileRawMessage builds a CRLF RFC822 message", async () => {
  const raw = await compileRawMessage({
    from: "Ada <ada@ex.com>",
    to: "Bob <bob@ex.com>",
    subject: "Hello",
    text: "See you",
  });
  const text = new TextDecoder().decode(raw);
  assertStringIncludes(text, "Subject: Hello");
  assertStringIncludes(text, "To: Bob <bob@ex.com>");
  assertStringIncludes(text, "See you");
  assert(text.includes("\r\n"));
});

Deno.test("compileRawMessage adds the chat channel header and threading", async () => {
  const raw = await compileRawMessage({
    from: "Ada <ada@pqpost.com>",
    to: "bob@pqpost.com",
    subject: EBP_CHAT_SUBJECT,
    text: "armor",
    headers: { "X-EBP-Channel": "chat" },
    messageId: "<abc@pqpost.com>",
    inReplyTo: "<prev@pqpost.com>",
    references: "<prev@pqpost.com>",
  });
  const text = new TextDecoder().decode(raw);
  assertStringIncludes(text, "Subject: Chat");
  assertMatch(text, /X-EBP-Channel:\s*chat/i);
  assertStringIncludes(text, "Message-ID: <abc@pqpost.com>");
  assertStringIncludes(text, "In-Reply-To: <prev@pqpost.com>");
  assertStringIncludes(text, "References: <prev@pqpost.com>");
});

Deno.test("mail list search excludes the chat header", () => {
  assertEquals(mailListSearchQuery(""), {
    not: { header: { "X-EBP-Channel": "chat" } },
  });
  assertEquals(mailListSearchQuery("bob"), {
    not: { header: { "X-EBP-Channel": "chat" } },
    or: [{ from: "bob" }, { subject: "bob" }, { body: "bob" }],
  });
});
