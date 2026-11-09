# Python bindings for the C core (partial)

These bindings expose SHA-256, password and key-based EBP v4 AES-GCM, and
selected post-quantum, HD, fingerprint, and message-signing operations. They
are **not a replacement for the TypeScript core**: identity management,
mnemonic handling, payload handling, and other core APIs are not implemented yet.
The C library uses OpenSSL libcrypto for SHA-256, AES-GCM, random IVs, and
experimental ML-DSA-87, SLH-DSA-SHA2-256s and ML-KEM-1024 operations,
and the reference Argon2 library for password key derivation.

On Linux, install a C compiler, make, OpenSSL 3.5 or newer, and Argon2 development headers, then run
from the repository root:

```sh
make -C c-core
PYTHONPATH=python python3 -c 'from ebp_core import sha256; print(sha256(b"hello").hex())'
```

The bindings locate `c-core/libebp_core.so` relative to the source tree. Set
`EBP_CORE_LIBRARY` to an absolute path to use a different build. The build and
loader currently target Linux; no Python package or binary distribution is
provided.

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
`pq_decapsulate` functions operate on raw keys and messages; they do not yet
implement EBP identities or message envelopes. They require OpenSSL 3.5 or newer.
ML-KEM decapsulation uses implicit rejection: a modified, correctly sized
ciphertext can produce a different secret instead of an error. Authenticate
the resulting encryption; `encrypt_for_key` and `decrypt_for_key` use AES-GCM.

For standard account paths, `hd_identity_seeds` derives raw signing and KEM
seeds, and `identity_fingerprint` computes a fingerprint from raw public keys.
These are building blocks; they do not create or store EBP identities.
`sign_message` and `verify_message` accept raw signing keys and use the
current purpose-bound message envelope; recipient-bound signing convenience
functions and identity objects are not implemented.

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
Use the full TypeScript implementation for complete message workflows.
