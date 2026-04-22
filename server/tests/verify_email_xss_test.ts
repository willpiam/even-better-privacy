import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.6";
import { handleVerifyEmailPage, renderVerifyEmailPage } from "../verify-email.ts";

// F-SERVER-01: the reflected `token` query parameter, along with error
// messages interpolated as `title`/`message`, must be HTML-escaped before
// reaching `renderVerifyEmailPage`'s template. The page also needs a strong
// Content-Security-Policy to defence-in-depth against any future bypass.

Deno.test({
	name: "F-SERVER-01: renderVerifyEmailPage escapes malicious token attribute",
	fn: () => {
		const rendered = renderVerifyEmailPage({
			title: "Confirm email verification",
			message: "Click the button below.",
			token: `"><script>alert(1)</script><`,
			showButton: true,
		});
		assert(!rendered.includes("<script>alert(1)</script>"));
		assertStringIncludes(rendered, "&lt;script&gt;alert(1)&lt;/script&gt;");
	},
});

Deno.test({
	name: "F-SERVER-01: renderVerifyEmailPage escapes injected title/message",
	fn: () => {
		const rendered = renderVerifyEmailPage({
			title: "<img src=x onerror=alert(1)>",
			message: "<svg onload=alert(2)>",
		});
		assert(!rendered.includes("<img src=x onerror=alert(1)>"));
		assert(!rendered.includes("<svg onload=alert(2)>"));
		assertStringIncludes(rendered, "&lt;img src=x onerror=alert(1)&gt;");
		assertStringIncludes(rendered, "&lt;svg onload=alert(2)&gt;");
	},
});

Deno.test({
	name: "F-SERVER-01: handleVerifyEmailPage emits strong CSP",
	fn: () => {
		const res = handleVerifyEmailPage(new URL("https://example.test/api/v1/verify-email?token=abc"));
		const csp = res.headers.get("content-security-policy") ?? "";
		assertStringIncludes(csp, "default-src 'none'");
		assertStringIncludes(csp, "form-action 'self'");
		assertEquals(res.headers.get("x-content-type-options"), "nosniff");
	},
});

Deno.test({
	name: "F-SERVER-01: handleVerifyEmailPage escapes the reflected token in the HTML response",
	fn: async () => {
		const payload = `"><script>alert('x')</script>`;
		const res = handleVerifyEmailPage(
			new URL(`https://example.test/api/v1/verify-email?token=${encodeURIComponent(payload)}`),
		);
		const body = await res.text();
		assert(!body.includes("<script>alert('x')</script>"));
		assertStringIncludes(body, "&lt;script&gt;alert(&#x27;x&#x27;)&lt;/script&gt;");
	},
});
