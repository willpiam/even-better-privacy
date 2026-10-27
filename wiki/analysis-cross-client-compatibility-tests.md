---
title: "Cross-Client Compatibility Tests"
type: analysis
status: active
last_updated: 2026-10-27
source_count: 14
tags:
  - analysis
  - testing
  - interoperability
  - cli
  - gui
  - mobile
  - website
---

# Cross-Client Compatibility Tests

Whether automated tests confirm that [[component-mobile|the app]],
[[component-gui|the GUI]], [[component-cli|the CLI]], and
[[component-website|the website]] accept each other's payloads.

## Verdict

**CLI, GUI, mobile, core, and website payload checks pass.**
`cli/tests/gui_compat_test.ts`, `cli/tests/mobile_compat_test.ts`, and
`cli/tests/core_compat_test.ts` sign, verify, encrypt, and decrypt across the
CLI, the GUI local backend, the mobile helpers, and `core/`.
`cli/tests/website_verify_test.ts`, `cli/tests/gui_website_verify_test.ts`,
`test/mobile-website_verify_test.ts`, and `test/core-website_verify_test.ts`
pass after `website/crypto.js` was aligned with `core/` on 2026-10-27.

The CLI is still a supported interface. `ReadMe.md` documents `deno task cli`
as sharing `~/.ebp/` with the GUI, and `deno.json` still defines the `cli`
and `test:cli-utils` tasks. [[component-cli]] is active; nothing in the wiki
marks it deprecated. `cli/tests/gui_compat_test.ts` now signs, verifies,
encrypts, and decrypts through both the CLI and the GUI local backend.

The website is verification-only for cryptography. `website/` is a static
landing page plus `verify.html`, which locally checks
`ebp-signed-message`, detached `ebp-signature`, and `ebp-signed-file`
([[component-website]]). It does not sign, encrypt, or store identities.

## What each surface actually tests

| Surface | Automated tests | Cross-surface? |
|---|---|---|
| Shared `core/` | `deno task test:core`, including `test/MessageExchange_test.ts`, `test/core-website_verify_test.ts`, and `test/core-mobile_compat_test.ts`. `cli/tests/core_compat_test.ts` checks CLI and GUI payloads with `Identity` directly. | CLI ↔ core, GUI ↔ core, core ↔ mobile, and core → website **pass** (2026-10-27). |
| CLI | `deno task test:cli-utils` → `cli/tests/`. Utils, permissions, password prompt, revocation, plus `cli_roundtrip_test.ts`, `gui_compat_test.ts`, `mobile_compat_test.ts`, `core_compat_test.ts`, `website_verify_test.ts`, and `gui_website_verify_test.ts`. | Same CLI, CLI ↔ GUI, CLI ↔ mobile, CLI ↔ core, and CLI → website **pass**. |
| GUI | `deno task test:gui-backend` plus Playwright `deno task test:e2e` (`gui/e2e/`). Identity spec covers detached verify, tamper reject, two-identity encrypt, and signed file encrypt/decrypt inside one GUI. `cli/tests/gui_mobile_compat_test.ts` calls `handleRequest`. | Same GUI session, plus CLI ↔ GUI, GUI ↔ mobile, GUI ↔ core, and GUI → website **pass**. |
| Mobile app | Jest (`deno task test:mobile`) and Android Maestro (`deno task test:e2e:mobile`). Maestro `sign-verify.yaml` signs and verifies inside the app. Deno `test/mobile-signVerify_parity_test.ts` and `test/mobile-encryptDecrypt_parity_test.ts` call mobile logic and `core/` in one process. `test/mobile-website_verify_test.ts` calls `website/crypto.js`. `cli/tests/mobile_compat_test.ts`, `cli/tests/gui_mobile_compat_test.ts`, and `test/core-mobile_compat_test.ts` call `signVerifyLogic.ts` and `encryptDecryptLogic.ts`. | CLI ↔ mobile, GUI ↔ mobile, core ↔ mobile, and mobile → website **pass** (2026-10-27). Not a device run. |
| Website verifier | `deno task lint:website-csp` checks CSP meta tags and `_headers`. `cli/tests/website_verify_test.ts`, `cli/tests/gui_website_verify_test.ts`, `test/mobile-website_verify_test.ts`, and `test/core-website_verify_test.ts` import `website/crypto.js`. | CLI, GUI, mobile, and core → website all **pass** (2026-10-27). `website/crypto.js` remains a separate browser copy of the verifier. |

## GUI ↔ mobile (2026-10-27)

`cli/tests/gui_mobile_compat_test.ts` passed in about 41 seconds. The GUI
creates Dilithium and SPHINCS+ identities through
`POST /api/v1/identity/generate` and signs or encrypts through `handleRequest`.
Mobile sign, verify, encrypt, and decrypt go through `signVerifyLogic.ts` and
`encryptDecryptLogic.ts`. The test loads the GUI identity files with
`Identity.fromStorageFormat`. It is not a device run.

Covered both ways, for Dilithium: attached, unsalted, and detached
signatures; unsigned encrypt; signed encrypt. SPHINCS+ signatures both ways.
A tampered signature is rejected by both verifiers. Public export from the
GUI matches the loaded identity. File encrypt and decrypt are not in this
test. Hierarchy propose/accept between the GUI and the phone is still not
automated.

## CLI ↔ CLI (2026-10-27)

`cli/tests/cli_roundtrip_test.ts` passed in about 30 seconds. One CLI process
signs or encrypts. A second CLI process verifies or decrypts that file.
Public keys are imported as contacts so `--sender` and `--recipient` resolve.

Covered: Dilithium attached, unsalted, and detached signatures; a SPHINCS+
signature; unsigned encrypt; signed encrypt. A tampered signature makes
`verify` exit non-zero. File encrypt and decrypt are not in this test.

## CLI ↔ GUI (2026-10-26)

`cli/tests/gui_compat_test.ts` passed in about 52 seconds. It uses one
temporary home for the CLI process and `gui/local-backend/routes.ts`
`handleRequest` (CSRF and host checks included).

Covered, both directions, for Dilithium: attached, unsalted, and detached
signatures; unsigned encrypt; signed encrypt. SPHINCS+ attached signatures
both directions. Public export from the CLI matches the GUI export, and the
GUI fingerprint helper agrees with that fingerprint. A tampered CLI signature
is rejected by the GUI.

`deno task test:cli-utils` grants `--allow-sys=hostname` because loading the
GUI backend pulls in a logger that reads the hostname.

## CLI and GUI ↔ core (2026-10-27)

`cli/tests/core_compat_test.ts` passed: CLI round-trip about 51 seconds, GUI
round-trip about 48 seconds.

Both tests load the identity files with `Identity.fromStorageFormat` and
check payloads with `Identity.VerifySignature`, `encryptionKey.decrypt`, and
`decryptAndVerify`. The other direction builds payloads with `core/Payloads.ts`
and feeds them to the CLI process or `handleRequest`.

Covered both ways: Dilithium attached and unsalted signatures, SPHINCS+
signature, unsigned encrypt, and signed encrypt. A tampered CLI signature
fails `VerifySignature`. CLI and GUI public exports match the keys loaded by
`core/`.

## core → website (2026-10-27)

Resolved later the same day in `website/crypto.js`. The notes below describe the failure before that fix.

`test/core-website_verify_test.ts` builds Dilithium and SPHINCS+ identities
with `new Identity`, signs with `Identity.signMessage`, and wraps the
results in `buildSignedMessagePayload` and `buildDetachedSignaturePayload`.
The signed-file payload hashes the file text with `sha256Hex`, signs
`ebp::filehash::...` with an empty signature salt, and checks that payload
the way `website/verify.js` does. It runs under `deno task test:core`.

The run took about 4 seconds and failed all three tests: Dilithium and
SPHINCS+ attached, unsalted, and detached signatures; salted and unsalted
`ebp-signed-file` payloads; and the fingerprint helper. One Dilithium
fingerprint from `core/` was
`ebpdk1a7cluc75lj5mhxcts3fpf7cwteev7ez2ur0qf8ksayfg2amksy5sn6c8gt`. The
website helper computed
`ebpdk1tja3sjda5n578qtvmk5upq6mzuxr3hcrdpdpr4z7up7nfjdp2nrsvzrzvt`.

The causes match the CLI, GUI, and mobile runs. `Identity.signMessage`
signs `ebp::message::v1::`. The website still checks `ebp::messagehash::`.
The fingerprint helper still hashes the Kyber public key as hex text, while
`core/Fingerprint.ts` hashes the decoded key bytes.

## core ↔ mobile (2026-10-27)

`test/core-mobile_compat_test.ts` passed in about 10 seconds. It builds
Dilithium and SPHINCS+ identities with `new Identity`. Core signs with
`Identity.signMessage` and wraps payloads in `core/Payloads.ts`. Mobile
signs, verifies, encrypts, and decrypts through `signVerifyLogic.ts` and
`encryptDecryptLogic.ts`. Both sides run in one Deno process. It is not a
device run.

Covered both ways, for Dilithium: attached, unsalted, and detached
signatures; unsigned encrypt; signed encrypt. SPHINCS+ signatures both ways.
A tampered signature is rejected by both verifiers. File encrypt and decrypt
are not in this test.

## CLI ↔ mobile (2026-10-27)

`cli/tests/mobile_compat_test.ts` passed in about 42 seconds. The CLI runs
as its own process. Mobile sign and verify go through `signVerifyLogic.ts`.
Encrypt and decrypt go through `encryptMessageWithIdentity` and
`decryptMessageWithIdentity` in `encryptDecryptLogic.ts`, which
`encryptDecrypt.ts` calls after it loads storage. The test is not a device
run. Identities are generated by the CLI and loaded with
`Identity.fromStorageFormat` so the mobile helpers use those keys.

Covered both ways, for Dilithium: attached, unsalted, and detached
signatures; unsigned encrypt; signed encrypt. SPHINCS+ attached signatures
both ways. A tampered CLI signature is rejected by
`verifyMessagePayload`. Public export from the CLI matches the loaded
identity. File encrypt and decrypt are not in this test.

## GUI → website (2026-10-27)

Resolved later the same day in `website/crypto.js`. The notes below describe the failure before that fix.

`cli/tests/gui_website_verify_test.ts` creates Dilithium and SPHINCS+
identities through `POST /api/v1/identity/generate`, signs through
`POST /api/v1/sign`, and checks the results with `website/crypto.js`.
The signed-file step follows `gui/app.js`: the page hashes the file, asks
for a detached signature over `ebp::filehash::...` with an empty signature
salt, then assembles `ebp-signed-file`.

The run took about 24 seconds and failed all four steps: Dilithium attached,
unsalted, and detached signatures; a SPHINCS+ signature; salted and unsalted
`ebp-signed-file` payloads; and the fingerprint helper. A Dilithium export
fingerprint was `ebpdk1jtcldsarc7nf8amw93fltqsk36ug83g4443jeledl4sq05qhlz6qtpytgh`.
The website helper computed
`ebpdk13n5y8ssxcaedr559j64xp405dzhek8hvkghd0u2r8lpep69xqhyq45elh5`.

The causes match the CLI and mobile runs. The GUI signs
`ebp::message::v1::`. The website still checks `ebp::messagehash::`, including
after it hashes a reconstructed `ebp::filehash::...` string. The fingerprint
helper still hashes the Kyber public key as hex text.

## CLI → website (2026-10-26)

Resolved on 2026-10-27 in `website/crypto.js`. The notes below describe the failure before that fix.

`cli/tests/website_verify_test.ts` runs the CLI in a temp `--home`, generates
a Dilithium identity and a SPHINCS+ identity, exports the public identity,
and signs one message three ways (salted attached, `--no-salt`, `--detached`).
It then calls `website/crypto.js` the way `website/verify.js` does.

Both steps failed:

- `verifySignature` returned false for a genuine salted CLI signature. The
  CLI signs `ebp::message::v1::<sha256>::<salt>`. The website still verifies
  `ebp::messagehash::<sha256>::<salt>`.
- `computeIdentityFingerprint` did not match the CLI export. The website
  hashes the hex encryption key as text. `core/Fingerprint.ts` hashes the
  decoded key bytes. `verify.js` rejects the identity on that mismatch
  before it shows a verify result.

`verify.js` itself is not executed here. It needs a browser DOM. The test
covers the module that page calls.

## Mobile → website (2026-10-27)

Resolved later the same day in `website/crypto.js`. The notes below describe the failure before that fix.

`test/mobile-website_verify_test.ts` signs with
`mobile/src/services/signVerifyLogic.ts` (the helpers the app screens call)
and checks the payloads with `website/crypto.js`. It is not a device run.
`deno task test:core` now allows network so that file can import the website
module.

All three tests failed: Dilithium and SPHINCS+ attached signatures, an
`ebp-signed-file` payload, and the fingerprint helper. The causes match the
CLI run. Mobile calls `Identity.signMessage`, which signs
`ebp::message::v1::`. The website still checks `ebp::messagehash::`, including
for signed files after it hashes `ebp::filehash::...`. The fingerprint helper
still hashes the Kyber public key as hex text.

## Closest things to interop tests

These are real, and they are narrower than a four-way compatibility proof:

- **GUI ↔ mobile wire-format drift** was closed in code on 2026-06-02 by
  sharing `core/` modules ([[analysis-gui-mobile-parity-deltas]]). The
  automated check is `test/interop-fixtures_test.ts`, which parses two
  golden files and asserts `buildFileSignMessage` string shape. It does not
  decrypt or verify a payload produced by the other client.
- `test/fixtures/interop/README.md` lists a **manual** GUI ↔ mobile smoke
  checklist (armored decrypt, multi-recipient paste, password policy). That
  checklist is not a test run.
- **Hierarchy** propose/accept is covered GUI-to-GUI and mobile-to-mobile.
  There is still no GUI ↔ mobile hierarchy E2E
  ([[analysis-hierarchy-gui-e2e-coverage]]).
- A 2026-04-28 wiki log entry records a **one-off local check** of the
  website verifier against `ebp-signed-message-756ec50c.json` after a noble
  argument-order bug. That file is not wired into `deno task test:*`.

## What "full" would still require

For the website, full compatibility means signatures from the app, GUI, and
CLI (attached message, detached signature, and signed file, both ML-DSA and
SLH-DSA) verify in `website/crypto.js`. Encrypt and decrypt are outside the
website's job.

For the other three, full compatibility means a payload or identity file
written by one is accepted by the other two, including shared `~/.ebp/`
between CLI and GUI and export/import between the phone and desktop. Storage
roots stay intentionally separate for mobile
([[analysis-gui-mobile-parity-deltas]]).

CLI, GUI, mobile, and core signatures are checked against the website, and
those checks pass. `website/crypto.js` now tries `ebp::message::v1::` before
the legacy `ebp::messagehash::` envelope, and it hashes the Kyber public key
from decoded hex bytes. CLI ↔ GUI, CLI ↔ mobile, GUI ↔ mobile, and CLI, GUI,
and mobile against `core/` are automated and pass. Phone ↔ desktop
export/import is still not automated.

## Related

- [[component-cli]]
- [[component-gui]]
- [[component-mobile]]
- [[component-website]]
- [[analysis-hierarchy-gui-e2e-coverage]]
- [[analysis-mobile-e2e-framework]]
- [[analysis-mobile-testing-and-gui-gaps]]
- [[analysis-gui-mobile-parity-deltas]]
- [[message-payload-formats]]

## Sources

- [[component-cli]], [[component-gui]], [[component-website]]
- [[analysis-hierarchy-gui-e2e-coverage]]
- [[analysis-gui-mobile-parity-deltas]]
- [[analysis-mobile-e2e-framework]]
- [[analysis-mobile-testing-and-gui-gaps]]
- `deno.json` (`cli`, `test:cli-utils`, `test:core`, `test:e2e`, `test:e2e:mobile`, `lint:website-csp`)
- `ReadMe.md` (CLI section and Tests section)
- `cli/tests/` (`utils_test.ts`, `perms_test.ts`, `read_password_test.ts`, `revocation_test.ts`, `cli_roundtrip_test.ts`, `gui_compat_test.ts`, `gui_mobile_compat_test.ts`, `mobile_compat_test.ts`, `core_compat_test.ts`, `website_verify_test.ts`, `gui_website_verify_test.ts`)
- `test/mobile-website_verify_test.ts`
- `test/core-website_verify_test.ts`
- `test/core-mobile_compat_test.ts`
- `test/interop-fixtures_test.ts`, `test/fixtures/interop/README.md`
- `test/MessageExchange_test.ts`
- `scripts/lint_website_csp.ts`
- `gui/e2e/identity.spec.ts`
- `website/crypto.js` (imported by the CLI, GUI, mobile, and core website tests)
- `gui/app.js` (sign-file form assembly reproduced by `gui_website_verify_test.ts`)
