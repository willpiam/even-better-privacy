import { assertEquals } from "jsr:@std/assert";
import {
	armorPayload,
	buildEncryptedSignedMessageMultiPayload,
	extractArmoredPayload,
} from "./Payloads.ts";

Deno.test("Payloads: multi-recipient encrypted signed payload round-trips through armor", () => {
	const payload = buildEncryptedSignedMessageMultiPayload({
		senderFingerprint: "ebpdk1sender",
		recipients: [
			{
				fingerprint: "ebpdk1alice",
				kemCiphertext: "aa",
				keyWrapNonce: "bb",
				wrappedContentKey: "cc",
			},
			{
				fingerprint: "ebpdk1bob",
				kemCiphertext: "dd",
				keyWrapNonce: "ee",
				wrappedContentKey: "ff",
			},
		],
		contentNonce: "0123",
		ciphertext: "4567",
	});
	const armored = armorPayload(payload);
	const parsed = extractArmoredPayload(armored);
	assertEquals(parsed?.type, "ebp-encrypted-signed-message-multi");
	assertEquals(parsed?.version, 1);
	assertEquals(Array.isArray(parsed?.recipients), true);
	assertEquals((parsed?.recipients as unknown[])?.length, 2);
});
