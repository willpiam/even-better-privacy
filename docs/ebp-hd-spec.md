# EBP-HD v1 Specification

Status: implementation draft

EBP-HD adapts the structural lessons from BIP32, BIP39, BIP43, and BIP44 to
EBP's post-quantum identity model. It does not reuse Bitcoin's secp256k1
child-key math. Instead, it derives deterministic seed material that is fed into
EBP's existing PQ key generators.

## Conformance

An implementation conforms to `ebp-hd-v1` when it matches the normative behavior
in this document and the canonical vectors in
`core/tests/fixtures/ebp-hd/test-vectors.json`.

Conforming implementations must:

- Use the canonical BIP39 English 2048-word list, pinned by the SHA-256 digest
  in `core/bip39-english.ts`.
- Support 128, 160, 192, 224, and 256 bits of entropy, with BIP39-style
  `ENT / 32` checksum bits, 11-bit word indices, and 12/15/18/21/24-word
  mnemonics.
- Derive seeds with PBKDF2-HMAC-SHA512, 2048 iterations, 64-byte output, and
  salt `"ebp-mnemonic-v2:" || NFKD(passphrase)`.
- Parse and format paths as `m/ebp'/profile'/account'/change/index`, with `ebp'`
  equal to `0x454250`.
- Derive master and child nodes with HKDF-SHA512 and the EBP domain tags defined
  below.
- Expand leaves to the profile-specific signing seed and ML-KEM seed lengths
  defined below.
- Produce identity fingerprints matching the canonical vectors.

Changes to the mnemonic salt, path grammar, purpose constant, profile names,
HKDF labels, seed lengths, or leaf derivation semantics require a new EBP-HD
version.

## Goals

- One paper backup can recreate many EBP identities.
- Each derived leaf remains a normal EBP identity: signing key + ML-KEM key,
  existing fingerprint, existing storage, existing revocation.
- Existing non-HD identities remain valid and are never imported into the HD
  tree.
- v1 exposes no extended-public-key API. Paths may contain non-hardened notation
  for BIP44 familiarity, but derivation is always performed from private root
  material.

## Non-goals and Structural Non-compatibility

`ebp-hd-v1` intentionally does not claim broad BIP32/39/43/44 compliance.

- It does not implement BIP32 secp256k1 `CKDpriv` / `CKDpub` derivation.
- It does not serialize or consume BIP32 xpub/xprv extended keys.
- It does not use BIP39's seed salt (`"mnemonic" || passphrase`) and is not
  seed-compatible with Bitcoin wallets.
- It does not implement literal BIP44 wallet semantics such as `coin_type'`,
  addresses, change outputs, or on-chain account discovery.

The imported BIP surface is limited to BIP39 English mnemonic format mechanics:
wordlist, checksum, and 11-bit grouping. BIP32/43/44 are design influences for
tree structure, namespace discipline, and account/change/index UX.

## Mnemonic Layer

Version: `ebp-mnemonic-v2`

The mnemonic layer uses BIP39 English-wordlist mechanics:

1. Generate 128, 160, 192, 224, or 256 bits of CSPRNG entropy.
2. Append `ENT / 32` checksum bits from `SHA-256(entropy)`.
3. Split into 11-bit indices.
4. Encode using the canonical BIP39 English 2048-word list from
   `bip-0039/english.txt`.

The wordlist is the BIP39 English list for paper-backup interoperability and
familiar recovery UX. The mnemonic remains an EBP mnemonic because seed
extraction uses an EBP-domain-separated salt.

Seed extraction:

```text
seed = PBKDF2-HMAC-SHA512(
  password = normalized_mnemonic_NFKD,
  salt = "ebp-mnemonic-v2:" || NFKD(passphrase),
  iterations = 2048,
  dkLen = 64
)
```

Compatibility:

- EBP-HD uses the BIP39 English wordlist and checksum rules.
- EBP-HD does **not** use BIP39's seed salt (`"mnemonic" || passphrase`). The
  same words and passphrase therefore produce a different 64-byte seed in EBP
  than in a Bitcoin wallet.
- EBP-HD does not use BIP32 secp256k1 child-key derivation; the seed enters the
  EBP-HD HKDF tree below.

The mnemonic encodes computer-generated entropy. It must not be treated as a
brainwallet phrase.

## Path Namespace

Path template:

```text
m / ebp' / profile' / account' / change / index
```

Segments:

- `ebp'`: EBP-private purpose constant (`0x454250`, the ASCII string `EBP` as an
  integer).
- `profile'`: `dilithium'` or `sphincs'`.
- `account'`: user-facing persona or organization account.
- `change`: `0` for external/published identities, `1` for internal/recovery
  identities.
- `index`: sequential identity slot.

Only `ebp'`, `profile'`, and `account'` are syntactically hardened in v1.
Because v1 has no extended-public-key API, `change` and `index` do not create
public derivation capability; they are labels inside private-root derivation.

## Purpose Namespace Versioning

The `ebp'` purpose segment is private to EBP-HD and maps to `0x454250`, the
ASCII string `EBP` as an integer. It is not BIP44's `44'` purpose and is not a
registered blockchain `coin_type'`.

Within `ebp-hd-v1`, the purpose constant, profile labels, hardening rules, and
HKDF domain tags are stable conformance surface. Any incompatible change to
those values must create `ebp-hd-v2` rather than silently changing v1
derivation.

## Node Derivation

Master node:

```text
material = HKDF-SHA512(
  ikm = seed,
  salt = "ebp-hd-v1:master-salt",
  info = "ebp-hd-v1:master-node",
  len = 64
)
node.key = material[0..32)
node.chainCode = material[32..64)
```

Child node:

```text
material = HKDF-SHA512(
  ikm = parent.key || ser32(childIndex),
  salt = parent.chainCode,
  info = "ebp-hd-v1:child:" || depth,
  len = 64
)
child.key = material[0..32)
child.chainCode = material[32..64)
```

`childIndex` is the 31-bit segment index plus `0x80000000` when the path segment
is hardened.

## Leaf Expansion

For a parsed path and derived node:

```text
signingSeed = HKDF-SHA512(
  ikm = node.key,
  salt = node.chainCode,
  info = "ebp-hd-v1:leaf:" || profile || ":sign-seed",
  len = profileSeedLength
)

encryptionSeed = HKDF-SHA512(
  ikm = node.key,
  salt = node.chainCode,
  info = "ebp-hd-v1:leaf:kyber:kem-seed",
  len = 64
)
```

Seed lengths:

- `dilithium`: 32 bytes for `ml_dsa87.keygen(seed)`.
- `sphincs`: 96 bytes for `slh_dsa_sha2_256s.keygen(seed)`.
- `kyber`: 64 bytes for `ml_kem1024.keygen(seed)`.

## Storage

HD-derived identities are written using the existing identity storage format.
The public portion may include optional `hdProvenance`:

```json
{
  "version": "ebp-hd-v1",
  "path": "m/ebp'/dilithium'/0'/0/0",
  "profile": "dilithium",
  "account": 0,
  "change": "external",
  "index": 0
}
```

Absence of `hdProvenance` means the identity is not HD-derived.

## Discovery

Clients may discover derived identities by deriving expected fingerprints for
external paths and looking for matching local identity files or published server
records. The default gap limit is 20 consecutive unpublished or absent external
slots per account/profile.

Discovery must not publish paths or account numbers to the server. The server
sees only normal EBP fingerprints and public identities.

## Test Vectors

Canonical vectors live in `core/tests/fixtures/ebp-hd/test-vectors.json`.
Implementations must match:

- vector `version` and `mnemonicVersion`,
- entropy-to-mnemonic output,
- mnemonic validation result,
- seed hex,
- path,
- path-derived account metadata,
- identity fingerprint.
