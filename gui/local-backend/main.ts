#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net --allow-run

import { serve } from "std/http/server";
import { loadSync } from "std/dotenv";
import { handleRequest } from "./routes.ts";
import { initSecurity, getTokenPersistPath } from "./security.ts";
import { fixLegacyPerms } from "../../cli/utils.ts";

let envLoaded = false;
function loadEnvOnce(): void {
	if (envLoaded) return;
	// Try loading .env from several locations so OAuth client IDs can be
	// picked up even when the app is installed (not running from the source tree).
	const candidates: string[] = [];
	try { candidates.push(new URL(".env", import.meta.url).pathname); } catch { /* ignore */ }
	const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "";
	if (home) {
		candidates.push(`${home}/.ebp/.env`);
	}
	// Default: CWD (Deno dotenv's default behaviour)
	try {
		loadSync({ export: true });
	} catch {
		// ignore missing .env in CWD
	}
	for (const envPath of candidates) {
		try {
			loadSync({ envPath, export: true });
		} catch {
			// ignore missing file
		}
	}
	envLoaded = true;
}
loadEnvOnce();

const HOST = Deno.env.get("GUI_BACKEND_HOST") ?? "127.0.0.1";
const PORT = Number(Deno.env.get("GUI_BACKEND_PORT") ?? "8787");

await initSecurity({ host: HOST, port: PORT });
const tokenPath = getTokenPersistPath();
if (tokenPath) {
	console.log(`EBP GUI local backend CSRF token written to ${tokenPath}`);
}

// F-STORAGE-01/04: tighten permissions on any pre-existing ~/.ebp/ tree.
const ebpHome = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? "";
if (ebpHome) {
	await fixLegacyPerms(`${ebpHome}/.ebp`);
}

serve(handleRequest, { port: PORT, hostname: HOST });
console.log(`EBP GUI local backend listening on http://${HOST}:${PORT}`);
