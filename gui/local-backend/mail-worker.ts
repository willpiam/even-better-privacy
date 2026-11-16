import {Buffer} from "node:buffer";
import { simpleParser } from "mailparser";

type ParsedAttachment = {filename?: string; contentType?: string; size?: number; content?: string | Uint8Array};

type ParseMode = "message" | "attachment";

type ParseRequest = {
  mode: ParseMode;
  source: Uint8Array;
};

self.onmessage = async (event: MessageEvent<ParseRequest>) => {
  try {
    const parsed = await simpleParser(Buffer.from(event.data.source));
    if (event.data.mode === "attachment") {
      const attachments = (parsed.attachments ?? []).map((att: ParsedAttachment) => ({
        filename: att.filename ?? "attachment",
        contentType: att.contentType ?? "application/octet-stream",
        size: att.size ?? 0,
        content:
          typeof att.content === "string"
            ? att.content
            : att.content instanceof Uint8Array
              ? new TextDecoder().decode(att.content)
              : "",
      }));
      self.postMessage({ ok: true, data: { attachments } });
      return;
    }
    const attachments = (parsed.attachments ?? []).map((att: ParsedAttachment) => ({
      filename: att.filename ?? "attachment",
      contentType: att.contentType ?? "application/octet-stream",
      size: att.size ?? 0,
    }));
    self.postMessage({
      ok: true,
      data: {
        text: parsed.text ?? "",
        html: parsed.html ? String(parsed.html) : "",
        attachments,
      },
    });
  } catch (err) {
    self.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
