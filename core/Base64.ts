
export function bytesToBase64(bytes: Uint8Array): string {
	const chunks: string[] = [];
	// Bound argument counts on Hermes/JSC as well as V8; avoid a rope per byte.
	for (let offset = 0; offset < bytes.length; offset += 8192) {
		chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
	}
	return btoa(chunks.join(""));
}

export function base64ToBytes(b64: string): Uint8Array {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
