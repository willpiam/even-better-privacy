import { stableStringify } from "./StateHash.ts";

export function canonicalJsonStringify(value: unknown): string {
	return stableStringify(value);
}
