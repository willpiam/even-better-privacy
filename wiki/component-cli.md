---
title: "EBP CLI Component"
type: component
status: active
last_updated: 2026-04-10
source_count: 2
tags:
  - component
  - cli
  - tooling
  - deno
---

# CLI Component

The CLI (`cli/main.ts`) is the primary scriptable interface for identity management, cryptographic operations, and server interaction. It runs via `deno task cli` (or as the compiled `ebp` binary). Subcommand implementations are organized in `cli/commands/` (identity, contacts, crypto, files, details, server) with shared helpers in `cli/utils.ts`.

## Commands

### Identity Lifecycle

| Command | Description |
|---|---|
| `generate [name]` | Create a new identity (default signing: dilithium, encryption: kyber) |
| `identities` | List available identities, marking the current one |
| `use <name>` | Switch active identity |
| `info` | Show fingerprint, key types, protocol version |
| `details` | Show fingerprint, key types, and all attached details |
| `export-public` | Export public identity JSON for sharing |

### Contacts

| Command | Description |
|---|---|
| `import <file>` | Import a contact's public key |
| `contacts` | List all contacts |
| `fetch <fingerprint>` | Fetch a contact from the [[component-server|server]] |

### Crypto Operations

| Command | Description |
|---|---|
| `sign [file]` | Sign a message (supports `--detached`, `--no-salt`) |
| `verify [file]` | Verify a signed message (supports `--signature` for detached) |
| `encrypt [file]` | Encrypt a message for a recipient (supports `--sign`) |
| `decrypt [file]` | Decrypt a message (supports `--sender` for signed messages) |
| `encrypt-file <file>` | Encrypt a file into a JSON payload |
| `decrypt-file <file>` | Decrypt a file payload back to a file |

### Details

| Command | Description |
|---|---|
| `detail <path> <value>` | Attach a detail (name, email, etc.) with `--push` and `--opaque` options |

**Updating a detail:** You cannot overwrite an existing detail directly — the server rejects duplicate paths with a 409 error. To change a detail, revoke the old value first, then set the new one. For example, to change an email: `ebp revoke-detail email --push` followed by `ebp detail email newemail@example.com --push`. See [[identity-model#Updating a Detail]].

### Revocation

| Command | Description |
|---|---|
| `revoke-detail <path>` | Revoke a detail (`--reason`, `--push`) |
| `revoke` | Revoke the entire identity (`--force` required, `--push`) |
| `generate-revocation-cert` | Generate an emergency revocation certificate |

### Server

| Command | Description |
|---|---|
| `server [url]` | Show or set the server base URL (`--clear` to remove) |
| `publish` | Publish current identity to server |
| `server-identities` | List identities on the server (`--page`, `--search`) |

## Identity Storage

Identities are stored under `~/.ebp/` as `<name>.identity.json` files using the v2 storage format (public data unencrypted, private keys AES-encrypted). See [[identity-model]].

## Key Implementation Details

- Built with Deno, uses `@std/cli/parse-args` for argument parsing.
- All crypto operations go through the shared `core/` module.
- Signing uses a hash envelope pattern: `SHA-256(message)` combined with an optional random salt, then signed. This prevents signing raw user input directly.
- File encryption supports a max file size limit (`MAX_ENCRYPTED_FILE_BYTES`).

## Related Pages

- [[identity-model]]
- [[revocation-system]]
- [[component-server]]
- [[component-gui]]
- [[overview]]

## Sources

- `ReadMe.md`
- `cli/main.ts`, `cli/commands/`, `cli/utils.ts`
