"""Bindings for the implemented subset of the EBP C core."""
import base64
import ctypes
import os
from pathlib import Path

_library = Path(os.environ.get("EBP_CORE_LIBRARY", Path(__file__).resolve().parents[2] / "c-core" / "libebp_core.so"))
_lib = ctypes.CDLL(str(_library))
_U8 = ctypes.c_ubyte
_P = ctypes.POINTER(_U8)
_lib.ebp_free.argtypes = [ctypes.c_void_p]
_lib.ebp_free.restype = None
_lib.ebp_secure_free.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
_lib.ebp_secure_free.restype = None
_lib.ebp_derive_storage_key.argtypes = [_P, ctypes.c_size_t, _P, _P]
_lib.ebp_derive_storage_key.restype = ctypes.c_int
_lib.ebp_sha256.argtypes = [_P, ctypes.c_size_t, _P]
_lib.ebp_sha256.restype = ctypes.c_int
_lib.ebp_aes_encrypt.argtypes = [_P, _P, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_aes_encrypt.restype = ctypes.c_int
_lib.ebp_aes_decrypt.argtypes = [_P, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_aes_decrypt.restype = ctypes.c_int


def _buffer(data):
    if not isinstance(data, bytes):
        raise TypeError("expected bytes")
    return (_U8 * len(data)).from_buffer_copy(data)


def sha256(data: bytes) -> bytes:
    """Return the SHA-256 digest of bytes (UTF-8 encode text first)."""
    data_buf = _buffer(data)
    digest = (_U8 * 32)()
    if not _lib.ebp_sha256(data_buf, len(data), digest):
        raise RuntimeError("SHA-256 failed")
    return bytes(digest)


def _key(key):
    if not isinstance(key, bytes) or len(key) != 32:
        raise ValueError("key must be 32 bytes")
    return _buffer(key)


def encrypt_with_key(key: bytes, plaintext: bytes, salt: bytes, aad: bytes = b"") -> str:
    """Encrypt bytes into the TypeScript AES.encryptWithKey base64 format."""
    key_buf = _key(key)
    if not isinstance(salt, bytes) or len(salt) != 16:
        raise ValueError("salt must be 16 bytes")
    salt_buf, plain_buf, aad_buf = _buffer(salt), _buffer(plaintext), _buffer(aad)
    out, length = _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_aes_encrypt(key_buf, salt_buf, plain_buf, len(plaintext), aad_buf, len(aad), ctypes.byref(out), ctypes.byref(length)):
            raise RuntimeError("encryption failed")
        return base64.b64encode(ctypes.string_at(out, length.value)).decode("ascii")
    finally:
        _lib.ebp_free(out)
        ctypes.memset(key_buf, 0, len(key_buf))
        ctypes.memset(plain_buf, 0, len(plain_buf))


def decrypt_with_key(key: bytes, encoded: str, aad: bytes = b"") -> bytes:
    """Decrypt an EBP v4 base64 blob; raise ValueError on invalid input or authentication failure."""
    key_buf = _key(key)
    try:
        blob = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError) as exc:
        raise ValueError("invalid ciphertext encoding") from exc
    blob_buf, aad_buf = _buffer(blob), _buffer(aad)
    out, length = _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_aes_decrypt(key_buf, blob_buf, len(blob), aad_buf, len(aad), ctypes.byref(out), ctypes.byref(length)):
            raise ValueError("invalid ciphertext or authentication failed")
        return ctypes.string_at(out, length.value)
    finally:
        _lib.ebp_secure_free(out, length.value)
        ctypes.memset(key_buf, 0, len(key_buf))


def derive_storage_key(password: str, salt: bytes) -> bytes:
    """Derive an EBP v4 storage key with Argon2id; password is UTF-8 encoded."""
    if not isinstance(password, str):
        raise TypeError("password must be a string")
    if not isinstance(salt, bytes) or len(salt) != 16:
        raise ValueError("salt must be 16 bytes")
    password_bytes = password.encode("utf-8")
    password_buf, salt_buf = _buffer(password_bytes), _buffer(salt)
    key = (_U8 * 32)()
    try:
        if not _lib.ebp_derive_storage_key(password_buf, len(password_bytes), salt_buf, key):
            raise RuntimeError("Argon2id derivation failed")
        return bytes(key)
    finally:
        ctypes.memset(password_buf, 0, len(password_buf))
        ctypes.memset(key, 0, len(key))


def encrypt(password: str, plaintext: bytes, aad: bytes = b"") -> str:
    """Encrypt using the current password-based EBP storage format."""
    salt = os.urandom(16)
    return encrypt_with_key(derive_storage_key(password, salt), plaintext, salt, aad)


def decrypt(password: str, encoded: str, aad: bytes = b"") -> bytes:
    """Decrypt an authenticated current-format password-encrypted EBP blob."""
    try:
        blob = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError) as exc:
        raise ValueError("invalid ciphertext encoding") from exc
    if len(blob) < 45 or blob[0] != 4:
        raise ValueError("invalid ciphertext or unsupported version")
    return decrypt_with_key(derive_storage_key(password, blob[1:17]), encoded, aad)

# Experimental low-level operations for the current identity profiles.
ML_DSA_87 = 1
SLH_DSA_SHA2_256S = 2
ML_KEM_1024 = 3
_lib.ebp_pq_keygen.argtypes = [ctypes.c_int, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_pq_keygen.restype = ctypes.c_int
_lib.ebp_pq_sign.argtypes = [ctypes.c_int, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_pq_sign.restype = ctypes.c_int
_lib.ebp_pq_verify.argtypes = [ctypes.c_int, _P, ctypes.c_size_t, _P, ctypes.c_size_t, _P, ctypes.c_size_t]
_lib.ebp_pq_verify.restype = ctypes.c_int
_lib.ebp_pq_encapsulate.argtypes = [_P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t), _P]
_lib.ebp_pq_encapsulate.restype = ctypes.c_int
_lib.ebp_pq_decapsulate.argtypes = [_P, ctypes.c_size_t, _P, ctypes.c_size_t, _P]
_lib.ebp_pq_decapsulate.restype = ctypes.c_int


def pq_keygen(algorithm: int, seed: bytes | None = None) -> tuple[bytes, bytes]:
    """Return raw (public, private) keys; an optional seed enables HD derivation."""
    seed_buf = _buffer(seed) if seed is not None else None
    pub, priv, pub_len, priv_len = _P(), _P(), ctypes.c_size_t(), ctypes.c_size_t()
    try:
        if not _lib.ebp_pq_keygen(algorithm, seed_buf, len(seed) if seed is not None else 0, ctypes.byref(pub), ctypes.byref(pub_len), ctypes.byref(priv), ctypes.byref(priv_len)):
            raise ValueError("invalid algorithm or seed, or algorithm unavailable")
        return ctypes.string_at(pub, pub_len.value), ctypes.string_at(priv, priv_len.value)
    finally:
        _lib.ebp_free(pub)
        _lib.ebp_secure_free(priv, priv_len.value)
        if seed_buf is not None:
            ctypes.memset(seed_buf, 0, len(seed_buf))


def pq_sign(algorithm: int, private_key: bytes, message: bytes) -> bytes:
    priv, msg = _buffer(private_key), _buffer(message)
    out, length = _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_pq_sign(algorithm, priv, len(private_key), msg, len(message), ctypes.byref(out), ctypes.byref(length)):
            raise ValueError("signing failed")
        return ctypes.string_at(out, length.value)
    finally:
        _lib.ebp_free(out)
        ctypes.memset(priv, 0, len(priv))


def pq_verify(algorithm: int, public_key: bytes, message: bytes, signature: bytes) -> bool:
    pub, msg, sig = _buffer(public_key), _buffer(message), _buffer(signature)
    return bool(_lib.ebp_pq_verify(algorithm, pub, len(public_key), msg, len(message), sig, len(signature)))


def pq_encapsulate(public_key: bytes) -> tuple[bytes, bytes]:
    pub = _buffer(public_key)
    out, length, secret = _P(), ctypes.c_size_t(), (_U8 * 32)()
    try:
        if not _lib.ebp_pq_encapsulate(pub, len(public_key), ctypes.byref(out), ctypes.byref(length), secret):
            raise ValueError("encapsulation failed")
        return ctypes.string_at(out, length.value), bytes(secret)
    finally:
        _lib.ebp_free(out)
        ctypes.memset(secret, 0, len(secret))


def pq_decapsulate(private_key: bytes, ciphertext: bytes) -> bytes:
    priv, ct = _buffer(private_key), _buffer(ciphertext)
    secret = (_U8 * 32)()
    try:
        if not _lib.ebp_pq_decapsulate(priv, len(private_key), ct, len(ciphertext), secret):
            raise ValueError("decapsulation failed")
        return bytes(secret)
    finally:
        ctypes.memset(priv, 0, len(priv))
        ctypes.memset(secret, 0, len(secret))

_lib.ebp_hd_master.argtypes = [_P, ctypes.c_size_t, _P]
_lib.ebp_hd_master.restype = ctypes.c_int
_lib.ebp_hd_child.argtypes = [_P, ctypes.c_uint32, ctypes.c_uint32, _P]
_lib.ebp_hd_child.restype = ctypes.c_int
_lib.ebp_hd_identity_seeds.argtypes = [_P, ctypes.c_int, _P, ctypes.c_size_t, _P]
_lib.ebp_hd_identity_seeds.restype = ctypes.c_int


def hd_identity_seeds(seed: bytes, profile: str, account: int = 0, change: str = "external", index: int = 0) -> tuple[bytes, bytes]:
    """Derive signing and KEM seeds for a standard EBP-HD account path."""
    if profile not in ("dilithium", "sphincs") or change not in ("external", "internal"):
        raise ValueError("invalid HD profile or change")
    if any(not isinstance(n, int) or isinstance(n, bool) or n < 0 or n >= 2**31 for n in (account, index)):
        raise ValueError("HD account and index must be integers from 0 to 2^31-1")
    seed_buf, node, child = _buffer(seed), (_U8 * 64)(), (_U8 * 64)()
    sign = (_U8 * (96 if profile == "sphincs" else 32))()
    kem = (_U8 * 64)()
    try:
        if not _lib.ebp_hd_master(seed_buf, len(seed), node):
            raise RuntimeError("HD master derivation failed")
        segments = (0x454250 | 0x80000000, (profile == "sphincs") | 0x80000000,
                    account | 0x80000000, int(change == "internal"), index)
        for depth, segment in enumerate(segments, 1):
            if not _lib.ebp_hd_child(node, segment, depth, child):
                raise RuntimeError("HD child derivation failed")
            ctypes.memmove(node, child, 64)
        if not _lib.ebp_hd_identity_seeds(node, int(profile == "sphincs"), sign, len(sign), kem):
            raise RuntimeError("HD seed derivation failed")
        return bytes(sign), bytes(kem)
    finally:
        for buf in (seed_buf, node, child, sign, kem):
            ctypes.memset(buf, 0, len(buf))

_lib.ebp_identity_fingerprint.argtypes = [ctypes.c_int, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(ctypes.c_char)]
_lib.ebp_identity_fingerprint.restype = ctypes.c_int


def identity_fingerprint(profile: str, signing_key: bytes, encryption_key: bytes) -> str:
    """Compute the current EBP bech32 fingerprint from raw public keys."""
    if profile not in ("dilithium", "sphincs"):
        raise ValueError("invalid signing profile")
    sign, enc = _buffer(signing_key), _buffer(encryption_key)
    result = ctypes.create_string_buffer(65)
    if not _lib.ebp_identity_fingerprint(int(profile == "sphincs"), sign, len(signing_key), enc, len(encryption_key), result):
        raise ValueError("invalid public keys")
    return result.value.decode("ascii")

_lib.ebp_message_envelope.argtypes = [ctypes.c_int, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_message_envelope.restype = ctypes.c_int


def message_envelope(message: str, salt: str = "", purpose: str = "message") -> bytes:
    """Return the current EBP purpose-bound bytes for signing a text message."""
    purposes = {"message": 1, "detail-proof": 2, "revocation": 3, "hierarchy": 4}
    if purpose not in purposes:
        raise ValueError("invalid signature purpose")
    message_bytes, salt_bytes = message.encode("utf-8"), salt.encode("utf-8")
    msg, salt_buf, out, length = _buffer(message_bytes), _buffer(salt_bytes), _P(), ctypes.c_size_t()
    if not _lib.ebp_message_envelope(purposes[purpose], msg, len(message_bytes), salt_buf, len(salt_bytes), ctypes.byref(out), ctypes.byref(length)):
        raise RuntimeError("envelope construction failed")
    try:
        return ctypes.string_at(out, length.value)
    finally:
        _lib.ebp_free(out)


def sign_message(algorithm: int, private_key: bytes, message: str, salt: str = "", purpose: str = "message") -> str:
    """Sign an EBP purpose-bound message and return a base64 signature."""
    return base64.b64encode(pq_sign(algorithm, private_key, message_envelope(message, salt, purpose))).decode("ascii")


def verify_message(algorithm: int, public_key: bytes, message: str, signature: str, salt: str = "", purpose: str = "message") -> bool:
    """Verify a current-format EBP message signature."""
    try:
        raw = base64.b64decode(signature, validate=True)
    except (ValueError, TypeError):
        return False
    return pq_verify(algorithm, public_key, message_envelope(message, salt, purpose), raw)

_lib.ebp_kem_encrypt.argtypes = [_P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_kem_encrypt.restype = ctypes.c_int
_lib.ebp_kem_decrypt.argtypes = [_P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_kem_decrypt.restype = ctypes.c_int


def encrypt_for_key(public_key: bytes, plaintext: bytes) -> str:
    """Encrypt bytes into the current TypeScript KyberEncryptionKey hex format."""
    pub, msg, out, length = _buffer(public_key), _buffer(plaintext), _P(), ctypes.c_size_t()
    if not _lib.ebp_kem_encrypt(pub, len(public_key), msg, len(plaintext), ctypes.byref(out), ctypes.byref(length)):
        raise ValueError("encryption failed")
    try:
        return ctypes.string_at(out, length.value).hex()
    finally:
        _lib.ebp_free(out)


def decrypt_for_key(private_key: bytes, ciphertext: str) -> bytes:
    """Decrypt a TypeScript KyberEncryptionKey hex ciphertext."""
    try:
        blob = bytes.fromhex(ciphertext)
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid ciphertext encoding") from exc
    priv, ct, out, length = _buffer(private_key), _buffer(blob), _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_kem_decrypt(priv, len(private_key), ct, len(blob), ctypes.byref(out), ctypes.byref(length)):
            raise ValueError("invalid ciphertext or authentication failed")
        return ctypes.string_at(out, length.value)
    finally:
        ctypes.memset(priv, 0, len(priv))
        _lib.ebp_secure_free(out, length.value)

_lib.ebp_recipient_envelope.argtypes = [_P, ctypes.c_size_t, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_recipient_envelope.restype = ctypes.c_int


def recipient_envelope(recipient_fingerprint: str, message: str, salt: str = "") -> bytes:
    """Return the current signature envelope bound to one recipient."""
    recipient, text, salt_bytes = (v.encode("utf-8") for v in (recipient_fingerprint, message, salt))
    recipient_buf, text_buf, salt_buf = _buffer(recipient), _buffer(text), _buffer(salt_bytes)
    out, length = _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_recipient_envelope(recipient_buf, len(recipient), text_buf, len(text), salt_buf, len(salt_bytes), ctypes.byref(out), ctypes.byref(length)):
            raise RuntimeError("recipient envelope construction failed")
        return ctypes.string_at(out, length.value)
    finally:
        _lib.ebp_free(out)
