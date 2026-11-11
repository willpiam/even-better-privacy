import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
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

Deno.test("compileRawMessage adds threading headers", async () => {
  const raw = await compileRawMessage({
    from: "Ada <ada@pqpost.com>",
    to: "bob@pqpost.com",
    subject: "Re: Hello",
    text: "armor",
    messageId: "<abc@pqpost.com>",
    inReplyTo: "<prev@pqpost.com>",
    references: "<prev@pqpost.com>",
  });
  const text = new TextDecoder().decode(raw);
  assertStringIncludes(text, "Subject: Re: Hello");
  assertStringIncludes(text, "Message-ID: <abc@pqpost.com>");
  assertStringIncludes(text, "In-Reply-To: <prev@pqpost.com>");
  assertStringIncludes(text, "References: <prev@pqpost.com>");
});

Deno.test("mail list search returns every message when the query is empty", () => {
  assertEquals(mailListSearchQuery(""), { all: true });
  assertEquals(mailListSearchQuery("bob"), {
    or: [{ from: "bob" }, { subject: "bob" }, { body: "bob" }],
  });
});
