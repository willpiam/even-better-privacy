# Python bindings for the C core

These bindings expose hashing, current-format encryption, post-quantum keys,
mnemonics, HD derivation, identity storage, and message-signing operations.
The compatibility matrix describes the current coverage and remaining gaps.
The C library uses OpenSSL for cryptographic operations and the reference Argon2
library for password key derivation.

On Linux, install a C compiler, Python development headers, OpenSSL 3.5 or
newer, and Argon2, utf8proc, and Jansson development headers. Install from the
repository root using `python3 -m pip install .`. The resulting platform-specific
wheel links to those native libraries; it does not bundle them.

For source-tree development, build the shared C library and set `PYTHONPATH`:

```sh
make -C c-core
PYTHONPATH=python python3 -c 'from ebp_core import sha256; print(sha256(b"hello").hex())'
```

The installed package loads its compiled native module. In a source checkout,
the bindings fall back to `c-core/libebp_core.so`. Set `EBP_CORE_LIBRARY` to
an absolute path to use a different build. The build currently targets Linux;
no prebuilt binary distribution is provided.

```python
import os
from ebp_core import encrypt_with_key, decrypt_with_key

key = os.urandom(32)  # Store and protect this key separately.
salt = os.urandom(16)  # Format metadata; use the derivation salt when applicable.
encoded = encrypt_with_key(key, b"hello", salt, b"context")
assert decrypt_with_key(key, encoded, b"context") == b"hello"
```

`encrypt_with_key` returns the same base64 v4 format as TypeScript's
`AES.encryptWithKey`; `decrypt_with_key` accepts version 4 only. Supply the same
32-byte key and UTF-8 encoded AAD on both sides. Older ciphertext versions are
rejected. The salt is stored in the ciphertext, but these functions do not
derive a key from a password. Use authenticated key management and never treat
a password as a key. Invalid or unauthenticated ciphertext raises `ValueError`.
Python `bytes` and ctypes copies cannot be reliably erased from memory.

Run `make -C c-core test` for Python tests. With Deno installed and project
dependencies available, run the cross-implementation tests from the repo root:

```sh
deno test --allow-run=python3 --allow-read --allow-env c-core/tests/interop_test.ts
```

Password-based encryption uses Argon2id with the same parameters as TypeScript:

```python
from ebp_core import encrypt, decrypt

encoded = encrypt("a strong password", b"hello", b"context")
assert decrypt("a strong password", encoded, b"context") == b"hello"
```

Use a strong password and protect it independently. Both password and AAD
must match to decrypt. Only v4 ciphertext is accepted.

The low-level `pq_keygen`, `pq_sign`, `pq_verify`, `pq_encapsulate`, and
`pq_decapsulate` functions support the TypeScript-exposed ML-DSA, SLH-DSA,
and ML-KEM variants and operate on raw keys and messages, without managing
identities. They require OpenSSL 3.5 or newer.
ML-KEM decapsulation uses implicit rejection: a modified, correctly sized
ciphertext can produce a different secret instead of an error. Authenticate
the resulting encryption; `encrypt_for_key` and `decrypt_for_key` use AES-GCM.

For standard account paths, `hd_identity_seeds` derives raw signing and KEM
seeds. `hd_node_from_path` derives a node from a supported five-segment path,
and `identity_fingerprint` computes a fingerprint from raw public keys.
These are building blocks; they do not themselves create or store EBP identities.
`sign_message` and `verify_message` accept raw signing keys and use the
current purpose-bound message envelope. The `Identity` API also provides
recipient-bound signed encryption.

For low-level current-profile interoperability, a message can be signed or
sent to an ML-KEM public key:

```python
from ebp_core import (ML_DSA_87, ML_KEM_1024, pq_keygen, sign_message,
                      verify_message, encrypt_for_key, decrypt_for_key)

signing_public, signing_private = pq_keygen(ML_DSA_87)
encryption_public, encryption_private = pq_keygen(ML_KEM_1024)
signature = sign_message(ML_DSA_87, signing_private, "hello")
assert verify_message(ML_DSA_87, signing_public, "hello", signature)
ciphertext = encrypt_for_key(encryption_public, b"hello")
assert decrypt_for_key(encryption_private, ciphertext) == b"hello"
```

These raw key operations do not create signed-and-encrypted EBP payloads.
`recipient_envelope` constructs the bytes for a recipient-bound signature;
the caller must sign and verify those bytes with the appropriate raw key.
Use the `Identity` methods below for signed message workflows.

Create and recover EBP-HD seed material from a mnemonic:

```python
from ebp_core import generate_mnemonic, mnemonic_to_seed, hd_identity_seeds

mnemonic = generate_mnemonic()
# Store the mnemonic securely and obtain a passphrase from your application.
seed = mnemonic_to_seed(mnemonic, "an optional passphrase")
signing_seed, encryption_seed = hd_identity_seeds(seed, "dilithium")
```

The mnemonic and derived seeds are secrets. Python strings and bytes cannot be
reliably erased from memory. The library does not store them or prompt the user.

## In-memory identity storage

```python
from ebp_core import Identity

with Identity("dilithium") as identity:
    public_data = identity.public_data()
    signature = identity.sign("hello")
    storage_json = identity.to_storage("a strong password")

# The application chooses where to store the JSON and how to obtain passwords.
with Identity.from_storage(storage_json, "a strong password") as unlocked:
    assert unlocked.is_private
    assert unlocked.verify("hello", signature)

with Identity.from_storage(storage_json) as public_only:
    assert not public_only.is_private
    assert public_only.verify("hello", signature)
```

The JSON format stores public identity metadata in plaintext and encrypts the
private keys. Loading validates the fingerprint and verifies that private keys
match public keys. Identity storage with a JSON object key containing an embedded
NUL is rejected because the JSON library cannot represent that key. JSON with
unpaired Unicode surrogates is also rejected. Only the current identity storage version, protocol version
and AES version are supported; old formats are rejected. Existing details are
preserved. `get_detail` verifies the requested detail proof; loading an identity
does not automatically verify all details. The object holds key
material until closed; use a context manager or `close()`. Python and the JSON
library may retain secret copies in memory even after cleanup.

## Multi-recipient encryption

`encrypt_for_recipients` takes plaintext bytes and `(fingerprint, public_key)`
pairs; `decrypt_for_recipient` accepts the resulting dictionary, the recipient
fingerprint, and their private key. These operations encrypt content and wrap
keys; they do not sign the message or bind the recipient list. For signed
messages, use `Identity.sign_and_encrypt_many` and
`Identity.decrypt_and_verify_many` instead. `sign_and_encrypt_many` accepts an
optional 32-byte `content_key` for attachment workflows; otherwise it generates
one with OpenSSL.

## Payload input

`parse_payload` accepts current-version EBP JSON or armored text, and
`armor_payload` produces an armored string from a payload dictionary. These
functions check only the type and version. They do not validate all fields,
verify signatures or recipients, or establish authenticity.

`Identity.create_detail_proof(path, detail, nonce, timestamp)` signs a detail
proof without attaching it to the identity. `verify_detail_proof` validates a
current-format proof against an explicit public signing key and returns its
nonce and timestamp, or `None` if invalid. Nonces and timestamps must be safe
integers; legacy proof signatures are not accepted.

`attach_detail` creates and stores a signed detail; `get_detail` returns its
value only after proof verification. `revoke_detail` and `revoke_identity`
create certificates and update in-memory state. `emergency_revocation` creates
a certificate without changing state. The application remains responsible for
persisting the updated storage JSON.
`verify_detail_proof_result`, `identity.verify_revocation_result`, and
`verify_hierarchy_certificate_result` return dictionaries with an `ok` flag
and a failure reason. The simpler boolean/optional-result functions remain
available.

`create_hierarchy_certificate` and `verify_hierarchy_certificate` create and
verify both signatures. Verification does not check expiration or graph
constraints: call `hierarchy_expired` and `validate_hierarchy` separately.
Detail, revocation and hierarchy proof timestamps and nonces are restricted to
JavaScript safe integers; legacy formats and fractional timestamps are rejected.

`Identity.from_public_data` accepts current public exports with both keys or
with one key replaced by its hash. Verification requires the signing key,
and encryption requires the encryption key.
`sign_and_encrypt` and `decrypt_and_verify` implement current
single-recipient messages. Always check `verified` before trusting a returned
message; decryption can succeed even if its signature is invalid.

Use `identity.public_export(include_signing_key=False)` to export an encryption
key and a hash of the signing key. To store with a pre-derived AES key, call
`identity.to_storage_with_key(key, salt)` and load with
`Identity.from_storage_with_key(json_text, key)`. The key must be 32 bytes and
the salt must be 16 bytes. The caller is responsible for deriving and protecting
the key and for retaining the salt when needed.

`Identity.from_variants(signing_algorithm, kem_algorithm)` creates identities
using the supported raw signing and ML-KEM variants. `parse_hd_path`,
`format_hd_path`, and `Identity.from_hd_node` cover arbitrary supported paths.
`decode_fingerprint` validates a fingerprint and returns its profile and raw
root. `Identity.verify_details()` checks structure and ordering only; use
`get_detail` to verify an individual signature.

`create_file_envelope` and `parse_file_envelope` exchange file bytes and
metadata in the current cleartext file-envelope format. They do not access the
filesystem. Encrypting, signing, and persisting the resulting payload remain
separate operations.

Signed multi-recipient messages use v4 envelopes and deterministic UTF-16
ordering of attachment identifiers and ciphertext hashes. Decryption returns the content key and can return
plaintext with `verified` set to `False`; treat the key as secret and always
check verification before trusting the message or attachment manifest.

```python
from ebp_core import Identity

with Identity() as sender, Identity() as alice, Identity() as bob:
    packet = sender.sign_and_encrypt_many("hello", [alice, bob])
    received = alice.decrypt_and_verify_many(packet, sender)
    if not received["verified"]:
        raise ValueError("invalid sender signature or recipient binding")
    assert received["message"] == "hello"
```

For a single recipient, use `sender.sign_and_encrypt(message, recipient)` and
`recipient.decrypt_and_verify(ciphertext, sender)` and check `verified`.

`canonicalize_json` canonicalizes JSON text using RFC 8785. `canonical_json`
does the same for a Python JSON value, and `compute_state_hash` returns the
SHA-256 hash of its canonical bytes. Duplicate keys, NUL object keys, unpaired
surrogates, and non-finite numbers are rejected. The current signed proof,
revocation, hierarchy, and multi-recipient formats use these canonical rules;
older versions are not accepted.
Identity storage itself retains its v2 format. Stored detail proofs and
revocation certificates created under the former canonicalization rules must
be recreated; old signed multi-recipient messages cannot be verified by the
new v4 workflow. Deploy updated server and clients together because state hashes
also use the new canonicalization.

`build_payload` builds supported current message and file payloads.
`create_email_attachment`, `parse_email_attachment`, and
`parse_encrypted_email_attachment` operate on attachment bytes and metadata in
memory. Parsing validates the format, not the authenticity of ciphertext.
For separately held hierarchy signers, use `unsigned_hierarchy_certificate`,
`hierarchy_signature_payload`, `sign_hierarchy_part`, and
`encode_hierarchy_certificate`; verify the completed certificate before use.

```python
import time
from ebp_core import (Identity, unsigned_hierarchy_certificate,
                      sign_hierarchy_part, encode_hierarchy_certificate,
                      decode_hierarchy_draft, verify_hierarchy_certificate)

with Identity() as master, Identity() as child:
    draft = unsigned_hierarchy_certificate(
        master.public_data()["fingerprint"], child.public_data()["fingerprint"],
        timestamp=int(time.time() * 1000), context="team")
    draft = sign_hierarchy_part(master, draft)
    # The encoded draft can be sent to the separately held child identity.
    draft = decode_hierarchy_draft(encode_hierarchy_certificate(draft))
    completed = sign_hierarchy_part(child, draft, child=True)
    certificate = encode_hierarchy_certificate(completed)
    assert verify_hierarchy_certificate(master, child, certificate)
```

For pre-derived-key storage, retain the salt with your key-management metadata:

```python
import os
from ebp_core import Identity, derive_storage_key

salt = os.urandom(16)
key = derive_storage_key("a strong password", salt)
with Identity() as identity:
    stored = identity.to_storage_with_key(key, salt)
with Identity.from_storage_with_key(stored, key) as unlocked:
    assert unlocked.is_private
```
