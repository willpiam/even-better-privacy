# Python bindings for the C core (partial)

These bindings currently expose SHA-256 and the key-based AES-256-GCM EBP
ciphertext format. They are **not a replacement for the TypeScript core**:
identity management, post-quantum operations, password-based key derivation,
HD keys, payload handling, and the other core APIs are not implemented yet.
The C library uses OpenSSL libcrypto for SHA-256, AES-GCM, and random IVs.

On Linux, install a C compiler, make, and OpenSSL development headers, then run
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
