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
    if not _lib.ebp_aes_encrypt(key_buf, salt_buf, plain_buf, len(plaintext), aad_buf, len(aad), ctypes.byref(out), ctypes.byref(length)):
        raise RuntimeError("encryption failed")
    try:
        return base64.b64encode(ctypes.string_at(out, length.value)).decode("ascii")
    finally:
        _lib.ebp_free(out)


def decrypt_with_key(key: bytes, encoded: str, aad: bytes = b"") -> bytes:
    """Decrypt an EBP v1-v4 base64 blob; raise ValueError on invalid input or authentication failure."""
    key_buf = _key(key)
    try:
        blob = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError) as exc:
        raise ValueError("invalid ciphertext encoding") from exc
    blob_buf, aad_buf = _buffer(blob), _buffer(aad)
    out, length = _P(), ctypes.c_size_t()
    if not _lib.ebp_aes_decrypt(key_buf, blob_buf, len(blob), aad_buf, len(aad), ctypes.byref(out), ctypes.byref(length)):
        raise ValueError("invalid ciphertext or authentication failed")
    try:
        return ctypes.string_at(out, length.value)
    finally:
        _lib.ebp_free(out)
