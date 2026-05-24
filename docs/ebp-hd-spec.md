# EBP-HD v1 Specification

Status: implementation draft

EBP-HD adapts the structural lessons from BIP32, BIP39, BIP43, and BIP44 to
EBP's post-quantum identity model. It does not reuse Bitcoin's secp256k1
child-key math. Instead, it derives deterministic seed material that is fed into
EBP's existing PQ key generators.

## Goals

- One paper backup can recreate many EBP identities.
- Each derived leaf remains a normal EBP identity: signing key + ML-KEM key,
  existing fingerprint, existing storage, existing revocation.
- Existing non-HD identities remain valid and are never imported into the HD
  tree.
- v1 exposes no extended-public-key API. Paths may contain non-hardened notation
  for BIP44 familiarity, but derivation is always performed from private root
  material.

## Mnemonic Layer

Version: `ebp-mnemonic-v1`

The mnemonic layer uses BIP39-style mechanics:

1. Generate 128, 160, 192, 224, or 256 bits of CSPRNG entropy.
2. Append `ENT / 32` checksum bits from `SHA-256(entropy)`.
3. Split into 11-bit indices.
4. Encode using the fixed EBP v1 2048-word index set (`ebp000` through
   `ebp7ff`).

The EBP wordlist is deliberately project-owned in v1 so EBP does not imply
byte-for-byte BIP39 compatibility. A future revision may adopt the BIP39 English
list if product and interoperability needs justify that choice.

Seed extraction:

```text
seed = PBKDF2-HMAC-SHA512(
  password = normalized_mnemonic,
  salt = "ebp-mnemonic-v1:" || NFKD(passphrase),
  iterations = 2048,
  dkLen = 64
)
```

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

- mnemonic validation result,
- seed hex,
- path,
- signing public key,
- encryption public key,
- identity fingerprint.
