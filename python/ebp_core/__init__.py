"""Bindings for the implemented subset of the EBP C core."""
import base64
import ctypes
import importlib.util
import json
import os
from pathlib import Path

_override = os.environ.get("EBP_CORE_LIBRARY")
_native_spec = importlib.util.find_spec(__name__ + "._native") if not _override else None
_library = Path(_override or (_native_spec.origin if _native_spec else Path(__file__).resolve().parents[2] / "c-core" / "libebp_core.so"))
_lib = ctypes.CDLL(str(_library))
_U8 = ctypes.c_ubyte
_P = ctypes.POINTER(_U8)
_lib.ebp_free.argtypes = [ctypes.c_void_p]
_lib.ebp_free.restype = None
_lib.ebp_openssl_version.argtypes = []
_lib.ebp_openssl_version.restype = ctypes.c_char_p
_lib.ebp_secure_free.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
_lib.ebp_secure_free.restype = None
_lib.ebp_derive_storage_key.argtypes = [_P, ctypes.c_size_t, _P, _P]
_lib.ebp_derive_storage_key.restype = ctypes.c_int
_lib.ebp_sha256.argtypes = [_P, ctypes.c_size_t, _P]
_lib.ebp_sha256.restype = ctypes.c_int
_lib.ebp_verify_status_message.argtypes = [ctypes.c_int]
_lib.ebp_verify_status_message.restype = ctypes.c_char_p
_lib.ebp_random_hex.argtypes = [ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_random_hex.restype = ctypes.c_int
_lib.ebp_json_canonical.argtypes = [_P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_json_canonical.restype = ctypes.c_int
_lib.ebp_identity_state_from_external.argtypes = [_P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_identity_state_from_external.restype = ctypes.c_int
for _name in ("ebp_hex_encode", "ebp_hex_decode", "ebp_base64_encode", "ebp_base64_decode"):
    getattr(_lib, _name).argtypes = [_P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
    getattr(_lib, _name).restype = ctypes.c_int
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


def openssl_version() -> str:
    """Return the OpenSSL version used by the native EBP library."""
    return _lib.ebp_openssl_version().decode("ascii")


def _encode_transform(data: bytes, function) -> bytes:
    buf, out, length = _buffer(data), _P(), ctypes.c_size_t()
    try:
        if not function(buf, len(data), ctypes.byref(out), ctypes.byref(length)):
            raise ValueError("invalid encoding")
        return ctypes.string_at(out, length.value)
    finally:
        _lib.ebp_free(out)


def hex_encode(data: bytes) -> str:
    return _encode_transform(data, _lib.ebp_hex_encode).decode("ascii")


def hex_decode(text: str) -> bytes:
    return _encode_transform(text.encode("ascii"), _lib.ebp_hex_decode)


def base64_encode(data: bytes) -> str:
    return _encode_transform(data, _lib.ebp_base64_encode).decode("ascii")


def base64_decode(text: str) -> bytes:
    return _encode_transform(text.encode("ascii"), _lib.ebp_base64_decode)


def random_hex(byte_length: int = 16) -> str:
    if not isinstance(byte_length, int) or isinstance(byte_length, bool) or byte_length < 0 or byte_length > 65536:
        raise ValueError("invalid byte length")
    out, length = _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_random_hex(byte_length, ctypes.byref(out), ctypes.byref(length)):
            raise RuntimeError("random generation failed")
        return ctypes.string_at(out, length.value).decode("ascii")
    finally:
        _lib.ebp_free(out)


def _verification_failure(code: int) -> dict:
    return {"ok": False, "error": _lib.ebp_verify_status_message(code).decode("utf-8")}


def canonicalize_json(text: str) -> str:
    """Canonicalize JSON using RFC 8785 and the EBP input restrictions."""
    if not isinstance(text, str):
        raise TypeError("JSON input must be text")
    try:
        encoded = text.encode("utf-16-le", "surrogatepass").decode("utf-16-le").encode("utf-8")
    except UnicodeError as exc:
        raise ValueError("invalid Unicode in JSON") from exc
    buf, out, length = _buffer(encoded), _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_json_canonical(buf, len(encoded), ctypes.byref(out), ctypes.byref(length)):
            raise ValueError("invalid JSON or unsupported JSON value")
        return ctypes.string_at(out, length.value).decode("utf-8")
    finally:
        _lib.ebp_free(out)


def canonical_json(value) -> str:
    """Serialize a Python JSON value using RFC 8785 canonical bytes."""
    try:
        text = json.dumps(value, ensure_ascii=True, allow_nan=False, separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        raise ValueError("value is not valid JSON") from exc
    return canonicalize_json(text)


def compute_state_hash(state) -> str:
    """Return the SHA-256 hex digest of the canonical identity state."""
    return sha256(canonical_json(state).encode("utf-8")).hex()


def build_identity_state(external: dict, details: dict) -> dict:
    """Build the identity state whose canonical bytes are hashed."""
    ext = json.dumps(external, ensure_ascii=True, allow_nan=False).encode("utf-8")
    det = json.dumps(details, ensure_ascii=True, allow_nan=False).encode("utf-8")
    out, length = _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_identity_state_from_external(_buffer(ext), len(ext), _buffer(det), len(det), ctypes.byref(out), ctypes.byref(length)):
            raise ValueError("invalid identity state")
        return json.loads(ctypes.string_at(out, length.value))
    finally:
        _lib.ebp_free(out)


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
ML_DSA_44 = 4
ML_DSA_65 = 5
ML_KEM_512 = 6
ML_KEM_768 = 7
SLH_DSA_SHA2_128F = 8
SLH_DSA_SHA2_128S = 9
SLH_DSA_SHA2_192F = 10
SLH_DSA_SHA2_192S = 11
SLH_DSA_SHA2_256F = 12
SLH_DSA_SHAKE_128F = 13
SLH_DSA_SHAKE_128S = 14
SLH_DSA_SHAKE_192F = 15
SLH_DSA_SHAKE_192S = 16
SLH_DSA_SHAKE_256F = 17
SLH_DSA_SHAKE_256S = 18
_lib.ebp_pq_keygen.argtypes = [ctypes.c_int, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_pq_keygen.restype = ctypes.c_int
_lib.ebp_pq_sign.argtypes = [ctypes.c_int, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_pq_sign.restype = ctypes.c_int
_lib.ebp_pq_verify.argtypes = [ctypes.c_int, _P, ctypes.c_size_t, _P, ctypes.c_size_t, _P, ctypes.c_size_t]
_lib.ebp_pq_verify.restype = ctypes.c_int
_lib.ebp_pq_encapsulate_variant.argtypes = [ctypes.c_int, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t), _P]
_lib.ebp_pq_encapsulate_variant.restype = ctypes.c_int
_lib.ebp_pq_decapsulate_variant.argtypes = [ctypes.c_int, _P, ctypes.c_size_t, _P, ctypes.c_size_t, _P]
_lib.ebp_pq_decapsulate_variant.restype = ctypes.c_int


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


def pq_encapsulate(public_key: bytes, algorithm: int = ML_KEM_1024) -> tuple[bytes, bytes]:
    pub = _buffer(public_key)
    out, length, secret = _P(), ctypes.c_size_t(), (_U8 * 32)()
    try:
        if not _lib.ebp_pq_encapsulate_variant(algorithm, pub, len(public_key), ctypes.byref(out), ctypes.byref(length), secret):
            raise ValueError("encapsulation failed")
        return ctypes.string_at(out, length.value), bytes(secret)
    finally:
        _lib.ebp_free(out)
        ctypes.memset(secret, 0, len(secret))


def pq_decapsulate(private_key: bytes, ciphertext: bytes, algorithm: int = ML_KEM_1024) -> bytes:
    priv, ct = _buffer(private_key), _buffer(ciphertext)
    secret = (_U8 * 32)()
    try:
        if not _lib.ebp_pq_decapsulate_variant(algorithm, priv, len(private_key), ct, len(ciphertext), secret):
            raise ValueError("decapsulation failed")
        return bytes(secret)
    finally:
        ctypes.memset(priv, 0, len(priv))
        ctypes.memset(secret, 0, len(secret))

_lib.ebp_hd_master.argtypes = [_P, ctypes.c_size_t, _P]
_lib.ebp_hd_master.restype = ctypes.c_int
_lib.ebp_hd_child.argtypes = [_P, ctypes.c_uint32, ctypes.c_uint32, _P]
_lib.ebp_hd_child.restype = ctypes.c_int

class _HdPath(ctypes.Structure):
    _fields_ = [("indices", ctypes.c_uint32 * 5), ("hardened", ctypes.c_int * 5),
                ("normalized_offset", ctypes.c_size_t), ("normalized_len", ctypes.c_size_t)]

_lib.ebp_hd_parse_path.argtypes = [_P, ctypes.c_size_t, ctypes.POINTER(_HdPath)]
_lib.ebp_hd_parse_path.restype = ctypes.c_int
_lib.ebp_hd_format_path.argtypes = [ctypes.c_int, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_hd_format_path.restype = ctypes.c_int
_lib.ebp_hd_provenance.argtypes = [_P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_hd_provenance.restype = ctypes.c_int
_lib.ebp_hd_derive_path.argtypes = [_P, ctypes.c_size_t, _P, ctypes.c_size_t, _P, ctypes.POINTER(ctypes.c_int)]
_lib.ebp_hd_derive_path.restype = ctypes.c_int
_lib.ebp_hd_identity_seeds.argtypes = [_P, ctypes.c_int, _P, ctypes.c_size_t, _P]
_lib.ebp_hd_identity_seeds.restype = ctypes.c_int


def parse_hd_path(path: str) -> dict:
    """Parse a supported EBP-HD path, preserving normalized segment labels."""
    data = path.encode("utf-8")
    parsed = _HdPath()
    if not _lib.ebp_hd_parse_path(_buffer(data), len(data), ctypes.byref(parsed)):
        raise ValueError("invalid HD path")
    normalized = data[parsed.normalized_offset:parsed.normalized_offset + parsed.normalized_len].decode("utf-8")
    labels = normalized[2:].split("/")
    return {"path": normalized, "segments": [{"label": label[:-1] if hardened else label, "index": index, "hardened": bool(hardened)}
            for label, index, hardened in zip(labels, parsed.indices, parsed.hardened)],
            "profile": "sphincs" if parsed.indices[1] else "dilithium", "account": parsed.indices[2],
            "change": "internal" if parsed.indices[3] else "external", "index": parsed.indices[4]}


def format_hd_path(profile: str, account: int, change: str, index: int) -> str:
    if profile not in ("dilithium", "sphincs") or change not in ("external", "internal") or any(not isinstance(n, int) or isinstance(n, bool) or n < 0 or n >= 2**31 for n in (account, index)):
        raise ValueError("invalid HD path fields")
    out, length = _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_hd_format_path(int(profile == "sphincs"), account, int(change == "internal"), index, ctypes.byref(out), ctypes.byref(length)):
            raise ValueError("invalid HD path fields")
        return ctypes.string_at(out, length.value).decode("utf-8")
    finally:
        _lib.ebp_free(out)


def hd_provenance(path: str) -> dict:
    data = path.encode("utf-8")
    out, length = _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_hd_provenance(_buffer(data), len(data), ctypes.byref(out), ctypes.byref(length)):
            raise ValueError("invalid HD path")
        return json.loads(ctypes.string_at(out, length.value))
    finally:
        _lib.ebp_free(out)


def hd_node_from_path(seed: bytes, path: str) -> tuple[bytes, bytes, str]:
    """Derive a key, chain code and profile from an EBP five-segment path."""
    encoded = path.encode("utf-8")
    seed_buf, path_buf, node, profile = _buffer(seed), _buffer(encoded), (_U8 * 64)(), ctypes.c_int()
    try:
        if not _lib.ebp_hd_derive_path(seed_buf, len(seed), path_buf, len(encoded), node, ctypes.byref(profile)):
            raise ValueError("invalid HD path or seed")
        return bytes(node[:32]), bytes(node[32:]), "sphincs" if profile.value else "dilithium"
    finally:
        ctypes.memset(seed_buf, 0, len(seed_buf))
        ctypes.memset(node, 0, len(node))


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
_lib.ebp_fingerprint_decode.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_int), _P]
_lib.ebp_fingerprint_decode.restype = ctypes.c_int
_lib.ebp_short_fingerprint.argtypes = [_P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_short_fingerprint.restype = ctypes.c_int


def identity_fingerprint(profile: str, signing_key: bytes, encryption_key: bytes) -> str:
    """Compute the current EBP bech32 fingerprint from raw public keys."""
    if profile not in ("dilithium", "sphincs"):
        raise ValueError("invalid signing profile")
    sign, enc = _buffer(signing_key), _buffer(encryption_key)
    result = ctypes.create_string_buffer(65)
    if not _lib.ebp_identity_fingerprint(int(profile == "sphincs"), sign, len(signing_key), enc, len(encryption_key), result):
        raise ValueError("invalid public keys")
    return result.value.decode("ascii")


def decode_fingerprint(fingerprint: str) -> tuple[str, bytes]:
    """Decode and validate an EBP identity fingerprint."""
    encoded = fingerprint.encode("ascii")
    if b"\0" in encoded: raise ValueError("invalid fingerprint")
    profile, root = ctypes.c_int(), (_U8 * 32)()
    if not _lib.ebp_fingerprint_decode(encoded, ctypes.byref(profile), root):
        raise ValueError("invalid fingerprint")
    return ("sphincs" if profile.value else "dilithium", bytes(root))


def short_fingerprint(fingerprint: str) -> str:
    encoded = fingerprint.encode("ascii")
    out, length = _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_short_fingerprint(_buffer(encoded), len(encoded), ctypes.byref(out), ctypes.byref(length)):
            raise ValueError("invalid fingerprint")
        return ctypes.string_at(out, length.value).decode("utf-8")
    finally:
        _lib.ebp_free(out)

_lib.ebp_message_envelope.argtypes = [ctypes.c_int, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_message_envelope.restype = ctypes.c_int
_lib.ebp_file_sign_message.argtypes = [_P, ctypes.c_size_t, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_file_sign_message.restype = ctypes.c_int


def build_file_sign_message(file_hash: str, salt: str = "", context: str = "") -> str:
    hash_bytes, salt_bytes, context_bytes = file_hash.encode("utf-8"), salt.encode("utf-8"), context.encode("utf-8")
    out, length = _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_file_sign_message(_buffer(hash_bytes), len(hash_bytes), _buffer(salt_bytes), len(salt_bytes), _buffer(context_bytes), len(context_bytes), ctypes.byref(out), ctypes.byref(length)):
            raise ValueError("invalid file signing message")
        return ctypes.string_at(out, length.value).decode("utf-8")
    finally:
        _lib.ebp_free(out)


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

_lib.ebp_kem_encrypt_variant.argtypes = [ctypes.c_int, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_kem_encrypt_variant.restype = ctypes.c_int
_lib.ebp_kem_decrypt_variant.argtypes = [ctypes.c_int, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_kem_decrypt_variant.restype = ctypes.c_int


def encrypt_for_key(public_key: bytes, plaintext: bytes, algorithm: int = ML_KEM_1024) -> str:
    """Encrypt bytes into the current TypeScript KyberEncryptionKey hex format."""
    pub, msg, out, length = _buffer(public_key), _buffer(plaintext), _P(), ctypes.c_size_t()
    if not _lib.ebp_kem_encrypt_variant(algorithm, pub, len(public_key), msg, len(plaintext), ctypes.byref(out), ctypes.byref(length)):
        raise ValueError("encryption failed")
    try:
        return ctypes.string_at(out, length.value).hex()
    finally:
        _lib.ebp_free(out)


def decrypt_for_key(private_key: bytes, ciphertext: str, algorithm: int = ML_KEM_1024) -> bytes:
    """Decrypt a TypeScript KyberEncryptionKey hex ciphertext."""
    try:
        blob = bytes.fromhex(ciphertext)
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid ciphertext encoding") from exc
    priv, ct, out, length = _buffer(private_key), _buffer(blob), _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_kem_decrypt_variant(algorithm, priv, len(private_key), ct, len(blob), ctypes.byref(out), ctypes.byref(length)):
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

_lib.ebp_entropy_to_mnemonic.argtypes = [_P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_entropy_to_mnemonic.restype = ctypes.c_int
_lib.ebp_mnemonic_to_entropy.argtypes = [_P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_mnemonic_to_entropy.restype = ctypes.c_int
_lib.ebp_mnemonic_to_seed.argtypes = [_P, ctypes.c_size_t, _P, ctypes.c_size_t, _P]
_lib.ebp_mnemonic_to_seed.restype = ctypes.c_int


def entropy_to_mnemonic(entropy: bytes) -> str:
    """Convert 16–32 bytes of entropy into an EBP mnemonic."""
    data, out, length = _buffer(entropy), _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_entropy_to_mnemonic(data, len(entropy), ctypes.byref(out), ctypes.byref(length)):
            raise ValueError("entropy must be 16, 20, 24, 28, or 32 bytes")
        return ctypes.string_at(out, length.value).decode("ascii")
    finally:
        ctypes.memset(data, 0, len(data))
        _lib.ebp_secure_free(out, length.value)


def mnemonic_to_entropy(mnemonic: str) -> bytes:
    """Validate an EBP mnemonic and return its original entropy."""
    phrase = mnemonic.encode("utf-8")
    data, out, length = _buffer(phrase), _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_mnemonic_to_entropy(data, len(phrase), ctypes.byref(out), ctypes.byref(length)):
            raise ValueError("invalid mnemonic")
        return ctypes.string_at(out, length.value)
    finally:
        ctypes.memset(data, 0, len(data))
        _lib.ebp_secure_free(out, length.value)


def mnemonic_to_seed(mnemonic: str, passphrase: str = "") -> bytes:
    """Derive the current EBP-HD seed from a valid mnemonic and passphrase."""
    phrase, password = mnemonic.encode("utf-8"), passphrase.encode("utf-8")
    phrase_buf, pass_buf, seed = _buffer(phrase), _buffer(password), (_U8 * 64)()
    try:
        if not _lib.ebp_mnemonic_to_seed(phrase_buf, len(phrase), pass_buf, len(password), seed):
            raise ValueError("invalid mnemonic or passphrase")
        return bytes(seed)
    finally:
        for buf in (phrase_buf, pass_buf, seed):
            ctypes.memset(buf, 0, len(buf))


def generate_mnemonic(strength: int = 256) -> str:
    """Generate a mnemonic using operating-system entropy."""
    if not isinstance(strength, int) or isinstance(strength, bool) or strength not in (128, 160, 192, 224, 256):
        raise ValueError("mnemonic strength must be 128, 160, 192, 224, or 256 bits")
    return entropy_to_mnemonic(os.urandom(strength // 8))


def validate_mnemonic(mnemonic: str) -> bool:
    try:
        mnemonic_to_entropy(mnemonic)
        return True
    except (ValueError, UnicodeError):
        return False

_lib.ebp_content_encrypt.argtypes = [_P, _P, ctypes.c_size_t, _P, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_content_encrypt.restype = ctypes.c_int
_lib.ebp_content_decrypt.argtypes = [_P, _P, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_content_decrypt.restype = ctypes.c_int
_lib.ebp_wrap_content_key_variant.argtypes = [ctypes.c_int, _P, ctypes.c_size_t, _P, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_wrap_content_key_variant.restype = ctypes.c_int
_lib.ebp_unwrap_content_key_variant.argtypes = [ctypes.c_int, _P, ctypes.c_size_t, _P, ctypes.c_size_t, _P]
_lib.ebp_unwrap_content_key_variant.restype = ctypes.c_int


def encrypt_content(plaintext: bytes, content_key: bytes) -> tuple[str, str]:
    """Return (nonce, ciphertext) as hex for the EBP multi-recipient format."""
    key, plain, nonce = _key(content_key), _buffer(plaintext), (_U8 * 12)()
    out, length = _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_content_encrypt(key, plain, len(plaintext), nonce, ctypes.byref(out), ctypes.byref(length)):
            raise ValueError("content encryption failed")
        return bytes(nonce).hex(), ctypes.string_at(out, length.value).hex()
    finally:
        _lib.ebp_free(out)
        ctypes.memset(key, 0, len(key))
        ctypes.memset(plain, 0, len(plain))


def decrypt_content(ciphertext: str, nonce: str, content_key: bytes) -> bytes:
    """Authenticate and decrypt EBP multi-recipient content."""
    try:
        cipher_bytes, nonce_bytes = bytes.fromhex(ciphertext), bytes.fromhex(nonce)
    except (ValueError, TypeError) as exc:
        raise ValueError("invalid ciphertext encoding") from exc
    if len(nonce_bytes) != 12:
        raise ValueError("invalid content nonce")
    key, cipher, iv = _key(content_key), _buffer(cipher_bytes), _buffer(nonce_bytes)
    out, length = _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_content_decrypt(key, iv, cipher, len(cipher_bytes), ctypes.byref(out), ctypes.byref(length)):
            raise ValueError("invalid ciphertext or authentication failed")
        return ctypes.string_at(out, length.value)
    finally:
        _lib.ebp_secure_free(out, length.value)
        ctypes.memset(key, 0, len(key))


def wrap_content_key(content_key: bytes, fingerprint: str, public_key: bytes) -> dict[str, str]:
    """Wrap a content key for one ML-KEM recipient."""
    if not isinstance(fingerprint, str):
        raise TypeError("fingerprint must be a string")
    algorithm = {800: ML_KEM_512, 1184: ML_KEM_768, 1568: ML_KEM_1024}.get(len(public_key))
    if algorithm is None:
        raise ValueError("invalid recipient public key")
    kem_len = {ML_KEM_512: 768, ML_KEM_768: 1088, ML_KEM_1024: 1568}[algorithm]
    pub, key = _buffer(public_key), _key(content_key)
    out, length = _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_wrap_content_key_variant(algorithm, pub, len(public_key), key, ctypes.byref(out), ctypes.byref(length)):
            raise ValueError("content key wrapping failed")
        wrapped = ctypes.string_at(out, length.value)
        return {"fingerprint": fingerprint, "kemCiphertext": wrapped[:kem_len].hex(),
                "keyWrapNonce": wrapped[kem_len:kem_len + 12].hex(), "wrappedContentKey": wrapped[kem_len + 12:].hex()}
    finally:
        _lib.ebp_free(out)
        ctypes.memset(key, 0, len(key))


def unwrap_content_key(entry: dict[str, str], private_key: bytes) -> bytes:
    """Authenticate and unwrap a recipient's content key."""
    try:
        kem = bytes.fromhex(entry["kemCiphertext"])
        nonce = bytes.fromhex(entry["keyWrapNonce"])
        ciphertext = bytes.fromhex(entry["wrappedContentKey"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("invalid recipient entry") from exc
    algorithm = {768: ML_KEM_512, 1088: ML_KEM_768, 1568: ML_KEM_1024}.get(len(kem))
    if algorithm is None or len(nonce) != 12:
        raise ValueError("invalid recipient entry")
    blob = kem + nonce + ciphertext
    priv, wrapped, key = _buffer(private_key), _buffer(blob), (_U8 * 32)()
    try:
        if not _lib.ebp_unwrap_content_key_variant(algorithm, priv, len(private_key), wrapped, len(blob), key):
            raise ValueError("failed to unwrap content key")
        return bytes(key)
    finally:
        ctypes.memset(priv, 0, len(priv))
        ctypes.memset(key, 0, len(key))


def encrypt_for_recipients(plaintext: bytes, recipients: list[tuple[str, bytes]], content_key: bytes | None = None) -> dict:
    """Encrypt content and wrap its key once per distinct recipient fingerprint."""
    if not recipients:
        raise ValueError("at least one recipient is required")
    key = os.urandom(32) if content_key is None else content_key
    if not isinstance(key, bytes) or len(key) != 32:
        raise ValueError("content key must be 32 bytes")
    nonce, ciphertext = encrypt_content(plaintext, key)
    seen, entries = set(), []
    for fingerprint, public_key in recipients:
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        entries.append(wrap_content_key(key, fingerprint, public_key))
    return {"recipients": entries, "contentNonce": nonce, "ciphertext": ciphertext, "contentKey": key}


def decrypt_for_recipient(encrypted: dict, fingerprint: str, private_key: bytes) -> bytes:
    """Decrypt a multi-recipient result for the named recipient."""
    for entry in encrypted["recipients"]:
        if entry["fingerprint"] == fingerprint:
            key = unwrap_content_key(entry, private_key)
            return decrypt_content(encrypted["ciphertext"], encrypted["contentNonce"], key)
    raise ValueError("recipient not found")

# Identity objects handle JSON and cryptographic operations in memory only.
_lib.ebp_identity_create.argtypes = [ctypes.c_int, ctypes.POINTER(ctypes.c_void_p)]
_lib.ebp_identity_create.restype = ctypes.c_int
_lib.ebp_identity_create_variants.argtypes = [ctypes.c_int, ctypes.c_int, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(ctypes.c_void_p)]
_lib.ebp_identity_create_variants.restype = ctypes.c_int
_lib.ebp_identity_from_hd_seed.argtypes = [_P, ctypes.c_size_t, ctypes.c_int, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32, ctypes.POINTER(ctypes.c_void_p)]
_lib.ebp_identity_from_hd_seed.restype = ctypes.c_int
_lib.ebp_identity_from_hd_node.argtypes = [_P, _P, ctypes.c_size_t, ctypes.POINTER(ctypes.c_void_p)]
_lib.ebp_identity_from_hd_node.restype = ctypes.c_int
_lib.ebp_identity_public_json.argtypes = [ctypes.c_void_p, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_identity_public_json.restype = ctypes.c_int
_lib.ebp_identity_public_export.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_identity_public_export.restype = ctypes.c_int
_lib.ebp_identity_from_public_json.argtypes = [_P, ctypes.c_size_t, ctypes.POINTER(ctypes.c_void_p)]
_lib.ebp_identity_from_public_json.restype = ctypes.c_int
_lib.ebp_identity_from_embedded_json.argtypes = [_P, ctypes.c_size_t, ctypes.c_char_p, ctypes.POINTER(ctypes.c_void_p)]
_lib.ebp_identity_from_embedded_json.restype = ctypes.c_int
_lib.ebp_identity_store.argtypes = [ctypes.c_void_p, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_identity_store.restype = ctypes.c_int
_lib.ebp_identity_store_with_key.argtypes = [ctypes.c_void_p, _P, _P, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_identity_store_with_key.restype = ctypes.c_int
_lib.ebp_identity_load.argtypes = [_P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.c_int, ctypes.POINTER(ctypes.c_void_p)]
_lib.ebp_identity_load.restype = ctypes.c_int
_lib.ebp_identity_load_with_key.argtypes = [_P, ctypes.c_size_t, _P, ctypes.POINTER(ctypes.c_void_p)]
_lib.ebp_identity_load_with_key.restype = ctypes.c_int
_lib.ebp_identity_sign.argtypes = [ctypes.c_void_p, ctypes.c_int, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_identity_sign.restype = ctypes.c_int
_lib.ebp_identity_verify.argtypes = [ctypes.c_void_p, ctypes.c_int, _P, ctypes.c_size_t, _P, ctypes.c_size_t, _P, ctypes.c_size_t]
_lib.ebp_identity_verify.restype = ctypes.c_int
_lib.ebp_detail_proof_create.argtypes = [ctypes.c_void_p, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.c_uint64, ctypes.c_int64, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_detail_proof_create.restype = ctypes.c_int
_lib.ebp_detail_proof_verify.argtypes = [ctypes.c_int, _P, ctypes.c_size_t, _P, ctypes.c_size_t, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(ctypes.c_uint64), ctypes.POINTER(ctypes.c_int64)]
_lib.ebp_detail_proof_verify.restype = ctypes.c_int
_lib.ebp_detail_proof_verify_ex.argtypes = _lib.ebp_detail_proof_verify.argtypes
_lib.ebp_detail_proof_verify_ex.restype = ctypes.c_int
_lib.ebp_revocation_create.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_uint64, ctypes.c_int64, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_revocation_create.restype = ctypes.c_int
_lib.ebp_revocation_verify.argtypes = [ctypes.c_void_p, _P, ctypes.c_size_t, ctypes.c_int, _P, ctypes.c_size_t]
_lib.ebp_revocation_verify.restype = ctypes.c_int
_lib.ebp_revocation_verify_ex.argtypes = _lib.ebp_revocation_verify.argtypes
_lib.ebp_revocation_verify_ex.restype = ctypes.c_int
_lib.ebp_revocation_unsigned.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_uint64, ctypes.c_int64, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_revocation_unsigned.restype = ctypes.c_int
_lib.ebp_revocation_signature_payload.argtypes = [_P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_revocation_signature_payload.restype = ctypes.c_int
_lib.ebp_revocation_encode.argtypes = [_P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_revocation_encode.restype = ctypes.c_int
_lib.ebp_revocation_decode.argtypes = [_P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_revocation_decode.restype = ctypes.c_int
_lib.ebp_identity_attach_detail.argtypes = [ctypes.c_void_p, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.c_int64]
_lib.ebp_identity_attach_detail.restype = ctypes.c_int
_lib.ebp_identity_get_detail.argtypes = [ctypes.c_void_p, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_identity_get_detail.restype = ctypes.c_int
_lib.ebp_identity_verify_details.argtypes = [ctypes.c_void_p]
_lib.ebp_identity_verify_details.restype = ctypes.c_int
_lib.ebp_identity_sign_multi.argtypes = [ctypes.c_void_p, _P, ctypes.c_size_t, _P, ctypes.c_size_t, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_identity_sign_multi.restype = ctypes.c_int
_lib.ebp_identity_verify_multi.argtypes = [ctypes.c_void_p, _P, ctypes.c_size_t, _P, ctypes.c_size_t, _P, ctypes.c_size_t, _P, ctypes.c_size_t, _P, ctypes.c_size_t]
_lib.ebp_identity_verify_multi.restype = ctypes.c_int
_lib.ebp_identity_sign_encrypt_many.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p), ctypes.c_size_t, _P, ctypes.c_size_t, _P, ctypes.c_size_t, _P, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_identity_sign_encrypt_many.restype = ctypes.c_int
_lib.ebp_identity_decrypt_verify_many.argtypes = [ctypes.c_void_p, ctypes.c_void_p, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_identity_decrypt_verify_many.restype = ctypes.c_int
_lib.ebp_identity_sign_encrypt.argtypes = [ctypes.c_void_p, ctypes.c_void_p, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_identity_sign_encrypt.restype = ctypes.c_int
_lib.ebp_identity_decrypt_verify.argtypes = [ctypes.c_void_p, ctypes.c_void_p, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(ctypes.c_int)]
_lib.ebp_identity_decrypt_verify.restype = ctypes.c_int
_lib.ebp_identity_revoke.argtypes = [ctypes.c_void_p, ctypes.c_int, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.c_int64, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_identity_revoke.restype = ctypes.c_int
_lib.ebp_identity_is_revoked.argtypes = [ctypes.c_void_p]
_lib.ebp_identity_is_revoked.restype = ctypes.c_int
_lib.ebp_identity_is_detail_revoked.argtypes = [ctypes.c_void_p, _P, ctypes.c_size_t]
_lib.ebp_identity_is_detail_revoked.restype = ctypes.c_int
_lib.ebp_identity_revocation_json.argtypes = [ctypes.c_void_p, ctypes.c_int, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_identity_revocation_json.restype = ctypes.c_int
_lib.ebp_identity_is_private.argtypes = [ctypes.c_void_p]
_lib.ebp_identity_is_private.restype = ctypes.c_int
_lib.ebp_identity_free.argtypes = [ctypes.c_void_p]
_lib.ebp_identity_free.restype = None


class Identity:
    """In-memory EBP identity supporting current-format storage and signing."""

    def __init__(self, profile: str = "dilithium"):
        if profile not in ("dilithium", "sphincs"):
            raise ValueError("invalid signing profile")
        self._handle = ctypes.c_void_p()
        if not _lib.ebp_identity_create(int(profile == "sphincs"), ctypes.byref(self._handle)):
            raise RuntimeError("identity creation failed")

    @classmethod
    def from_variants(cls, signing_algorithm: int, kem_algorithm: int,
                      signing_seed: bytes | None = None, kem_seed: bytes | None = None) -> "Identity":
        """Create an identity using supported signing and ML-KEM variants."""
        if signing_seed is not None and not isinstance(signing_seed, bytes):
            raise TypeError("signing seed must be bytes")
        if kem_seed is not None and not isinstance(kem_seed, bytes):
            raise TypeError("KEM seed must be bytes")
        sign_buf = _buffer(signing_seed) if signing_seed is not None else None
        kem_buf = _buffer(kem_seed) if kem_seed is not None else None
        handle = ctypes.c_void_p()
        try:
            if not _lib.ebp_identity_create_variants(signing_algorithm, kem_algorithm, sign_buf, len(signing_seed or b""), kem_buf, len(kem_seed or b""), ctypes.byref(handle)):
                raise ValueError("invalid identity variants or seeds")
            obj = cls.__new__(cls)
            obj._handle = handle
            return obj
        finally:
            if sign_buf is not None: ctypes.memset(sign_buf, 0, len(sign_buf))
            if kem_buf is not None: ctypes.memset(kem_buf, 0, len(kem_buf))

    @classmethod
    def from_hd_node(cls, node: bytes, path: str) -> "Identity":
        """Create an identity from a 64-byte HD node and its path."""
        if not isinstance(node, bytes) or len(node) != 64:
            raise ValueError("HD node must be 64 bytes")
        path_bytes, node_buf, handle = path.encode("utf-8"), _buffer(node), ctypes.c_void_p()
        try:
            if not _lib.ebp_identity_from_hd_node(node_buf, _buffer(path_bytes), len(path_bytes), ctypes.byref(handle)):
                raise ValueError("invalid HD node or path")
            obj = cls.__new__(cls)
            obj._handle = handle
            return obj
        finally:
            ctypes.memset(node_buf, 0, len(node_buf))

    @classmethod
    def from_hd_seed(cls, seed: bytes, profile: str = "dilithium", account: int = 0, change: str = "external", index: int = 0) -> "Identity":
        """Create an identity from an EBP-HD seed and standard account path."""
        if profile not in ("dilithium", "sphincs") or change not in ("external", "internal"):
            raise ValueError("invalid HD profile or change")
        if any(not isinstance(n, int) or isinstance(n, bool) or n < 0 or n >= 2**31 for n in (account, index)):
            raise ValueError("HD account and index must be integers from 0 to 2^31-1")
        seed_buf, handle = _buffer(seed), ctypes.c_void_p()
        try:
            if not _lib.ebp_identity_from_hd_seed(seed_buf, len(seed), int(profile == "sphincs"), account, int(change == "internal"), index, ctypes.byref(handle)):
                raise ValueError("HD identity creation failed")
            obj = cls.__new__(cls)
            obj._handle = handle
            return obj
        finally:
            ctypes.memset(seed_buf, 0, len(seed_buf))

    @classmethod
    def from_public_data(cls, data: dict) -> "Identity":
        """Load a public export containing at least one public key."""
        import json
        encoded = json.dumps(data, ensure_ascii=True).encode("utf-8")
        handle = ctypes.c_void_p()
        if not _lib.ebp_identity_from_public_json(_buffer(encoded), len(encoded), ctypes.byref(handle)):
            raise ValueError("invalid or incomplete public identity")
        obj = cls.__new__(cls)
        obj._handle = handle
        return obj

    @classmethod
    def from_embedded_data(cls, data: dict, expected_fingerprint: str | None = None) -> "Identity":
        """Validate an embedded identity and optionally bind its expected fingerprint."""
        encoded = json.dumps(data, ensure_ascii=True, allow_nan=False).encode("utf-8")
        expected = None if expected_fingerprint is None else expected_fingerprint.encode("utf-8")
        if expected is not None and b"\0" in expected: raise ValueError("invalid expected fingerprint")
        handle = ctypes.c_void_p()
        if not _lib.ebp_identity_from_embedded_json(_buffer(encoded), len(encoded), expected, ctypes.byref(handle)):
            raise ValueError("invalid embedded identity or fingerprint")
        obj = cls.__new__(cls)
        obj._handle = handle
        return obj

    @classmethod
    def from_storage(cls, data: str, password: str | None = None) -> "Identity":
        """Load a current identity JSON string; omit the password for public-only access."""
        encoded = data.encode("utf-8")
        password_bytes = b"" if password is None else password.encode("utf-8")
        data_buf, password_buf = _buffer(encoded), _buffer(password_bytes)
        handle = ctypes.c_void_p()
        try:
            if not _lib.ebp_identity_load(data_buf, len(encoded), password_buf, len(password_bytes), int(password is not None), ctypes.byref(handle)):
                raise ValueError("invalid identity storage, password, or keys")
            obj = cls.__new__(cls)
            obj._handle = handle
            return obj
        finally:
            ctypes.memset(password_buf, 0, len(password_buf))

    @classmethod
    def from_storage_with_key(cls, data: str, key: bytes) -> "Identity":
        """Load an identity using its pre-derived AES key."""
        encoded, key_buf, handle = data.encode("utf-8"), _key(key), ctypes.c_void_p()
        try:
            if not _lib.ebp_identity_load_with_key(_buffer(encoded), len(encoded), key_buf, ctypes.byref(handle)):
                raise ValueError("invalid identity storage, key, or identity keys")
            obj = cls.__new__(cls)
            obj._handle = handle
            return obj
        finally:
            ctypes.memset(key_buf, 0, len(key_buf))

    def _get_handle(self):
        if not getattr(self, "_handle", None) or not self._handle.value:
            raise ValueError("identity is closed")
        return self._handle

    @property
    def is_private(self) -> bool:
        return bool(_lib.ebp_identity_is_private(self._get_handle()))

    def public_data(self) -> dict:
        import json
        out, length = _P(), ctypes.c_size_t()
        if not _lib.ebp_identity_public_json(self._get_handle(), ctypes.byref(out), ctypes.byref(length)):
            raise RuntimeError("could not export public identity")
        try:
            return json.loads(ctypes.string_at(out, length.value))
        finally:
            _lib.ebp_free(out)

    def public_export(self, include_signing_key: bool = True, include_encryption_key: bool = True, include_details: bool = True) -> dict:
        """Export public identity data, optionally replacing one key with its hash."""
        out, length = _P(), ctypes.c_size_t()
        try:
            if not _lib.ebp_identity_public_export(self._get_handle(), int(include_signing_key), int(include_encryption_key), int(include_details), ctypes.byref(out), ctypes.byref(length)):
                raise ValueError("invalid public export options or required key unavailable")
            return json.loads(ctypes.string_at(out, length.value))
        finally:
            _lib.ebp_free(out)

    def to_storage(self, password: str) -> str:
        """Return current-format identity JSON, with private keys password-encrypted."""
        password_bytes = password.encode("utf-8")
        password_buf, out, length = _buffer(password_bytes), _P(), ctypes.c_size_t()
        try:
            if not _lib.ebp_identity_store(self._get_handle(), password_buf, len(password_bytes), ctypes.byref(out), ctypes.byref(length)):
                raise ValueError("private identity required or storage encryption failed")
            return ctypes.string_at(out, length.value).decode("utf-8")
        finally:
            _lib.ebp_free(out)
            ctypes.memset(password_buf, 0, len(password_buf))

    def to_storage_with_key(self, key: bytes, salt: bytes) -> str:
        """Return encrypted identity JSON using a pre-derived AES key and salt."""
        if not isinstance(salt, bytes) or len(salt) != 16:
            raise ValueError("salt must be 16 bytes")
        key_buf, out, length = _key(key), _P(), ctypes.c_size_t()
        try:
            if not _lib.ebp_identity_store_with_key(self._get_handle(), key_buf, _buffer(salt), ctypes.byref(out), ctypes.byref(length)):
                raise ValueError("private identity required or storage encryption failed")
            return ctypes.string_at(out, length.value).decode("utf-8")
        finally:
            _lib.ebp_free(out)
            ctypes.memset(key_buf, 0, len(key_buf))

    def sign(self, message: str, salt: str = "", purpose: str = "message") -> str:
        purposes = {"message": 1, "detail-proof": 2, "revocation": 3, "hierarchy": 4}
        if purpose not in purposes:
            raise ValueError("invalid signature purpose")
        text, salt_bytes = message.encode("utf-8"), salt.encode("utf-8")
        text_buf, salt_buf, out, length = _buffer(text), _buffer(salt_bytes), _P(), ctypes.c_size_t()
        try:
            if not _lib.ebp_identity_sign(self._get_handle(), purposes[purpose], text_buf, len(text), salt_buf, len(salt_bytes), ctypes.byref(out), ctypes.byref(length)):
                raise ValueError("private identity required or signing failed")
            return base64.b64encode(ctypes.string_at(out, length.value)).decode("ascii")
        finally:
            _lib.ebp_free(out)
            ctypes.memset(text_buf, 0, len(text_buf))

    def attach_detail(self, path: str, detail: str, timestamp: int | None = None) -> None:
        """Attach a signed detail to a private identity."""
        if timestamp is None:
            import time
            timestamp = time.time_ns() // 1_000_000
        if not isinstance(timestamp, int) or isinstance(timestamp, bool) or not -9007199254740991 <= timestamp <= 9007199254740991:
            raise ValueError("timestamp must be a safe integer")
        path_bytes, detail_bytes = path.encode("utf-8"), detail.encode("utf-8")
        detail_buf = _buffer(detail_bytes)
        try:
            if not _lib.ebp_identity_attach_detail(self._get_handle(), _buffer(path_bytes), len(path_bytes), detail_buf, len(detail_bytes), timestamp):
                raise ValueError("could not attach detail")
        finally:
            ctypes.memset(detail_buf, 0, len(detail_buf))

    def get_detail(self, path: str) -> str | None:
        """Return a detail only if its current-format proof verifies."""
        path_bytes = path.encode("utf-8")
        out, length = _P(), ctypes.c_size_t()
        try:
            if not _lib.ebp_identity_get_detail(self._get_handle(), _buffer(path_bytes), len(path_bytes), ctypes.byref(out), ctypes.byref(length)):
                return None
            return ctypes.string_at(out, length.value).decode("utf-8")
        finally:
            _lib.ebp_secure_free(out, length.value)

    def verify_details(self) -> bool:
        """Check detail structure and ordering; this does not verify signatures."""
        return bool(_lib.ebp_identity_verify_details(self._get_handle()))

    def revocation_certificate(self, path: str | None = None) -> dict | None:
        """Decode a stored identity or detail revocation without verifying its signature."""
        encoded = path.encode("utf-8") if path is not None else b""
        out, length = _P(), ctypes.c_size_t()
        try:
            if not _lib.ebp_identity_revocation_json(self._get_handle(), 1 if path is not None else 2, _buffer(encoded), len(encoded), ctypes.byref(out), ctypes.byref(length)):
                return None
            return json.loads(ctypes.string_at(out, length.value))
        finally:
            _lib.ebp_free(out)

    def sign_for_recipients(self, message: str, recipient_fingerprints: list[str], attachment_manifest: list[dict] | None = None, salt: str = "") -> str:
        """Sign the v3 recipient set and attachment manifest."""
        import json
        text, recipients = message.encode("utf-8"), json.dumps(recipient_fingerprints, ensure_ascii=True).encode("utf-8")
        manifest = json.dumps([] if attachment_manifest is None else attachment_manifest, ensure_ascii=True).encode("utf-8")
        salt_bytes = salt.encode("utf-8")
        out, length = _P(), ctypes.c_size_t()
        try:
            if not _lib.ebp_identity_sign_multi(self._get_handle(), _buffer(text), len(text), _buffer(recipients), len(recipients), _buffer(manifest), len(manifest), _buffer(salt_bytes), len(salt_bytes), ctypes.byref(out), ctypes.byref(length)):
                raise ValueError("multi-recipient signing failed")
            return base64.b64encode(ctypes.string_at(out, length.value)).decode("ascii")
        finally:
            _lib.ebp_free(out)

    def verify_for_recipients(self, message: str, signature: str, recipient_fingerprints: list[str], attachment_manifest: list[dict] | None = None, salt: str = "") -> bool:
        """Verify the v3 recipient set and attachment manifest signature."""
        import json
        try:
            signature_bytes = base64.b64decode(signature, validate=True)
        except (ValueError, TypeError):
            return False
        text, recipients = message.encode("utf-8"), json.dumps(recipient_fingerprints, ensure_ascii=True).encode("utf-8")
        manifest = json.dumps([] if attachment_manifest is None else attachment_manifest, ensure_ascii=True).encode("utf-8")
        salt_bytes = salt.encode("utf-8")
        return bool(_lib.ebp_identity_verify_multi(self._get_handle(), _buffer(text), len(text), _buffer(recipients), len(recipients), _buffer(manifest), len(manifest), _buffer(salt_bytes), len(salt_bytes), _buffer(signature_bytes), len(signature_bytes)))

    def sign_and_encrypt_many(self, message: str, recipients: list["Identity"], attachment_manifest: list[dict] | None = None, content_key: bytes | None = None) -> dict:
        """Create a current signed, recipient-bound multi-recipient message."""
        import json
        text = message.encode("utf-8")
        manifest = json.dumps([] if attachment_manifest is None else attachment_manifest, ensure_ascii=True).encode("utf-8")
        handles = (ctypes.c_void_p * len(recipients))(*(recipient._get_handle().value for recipient in recipients))
        key_buf = None if content_key is None else _key(content_key)
        out, length = _P(), ctypes.c_size_t()
        try:
            if not _lib.ebp_identity_sign_encrypt_many(self._get_handle(), handles, len(recipients), _buffer(text), len(text), _buffer(manifest), len(manifest), key_buf, ctypes.byref(out), ctypes.byref(length)):
                raise ValueError("multi-recipient signing or encryption failed")
            return json.loads(ctypes.string_at(out, length.value))
        finally:
            _lib.ebp_secure_free(out, length.value)
            if key_buf is not None:
                ctypes.memset(key_buf, 0, len(key_buf))

    def decrypt_and_verify_many(self, payload: dict, sender: "Identity") -> dict:
        """Decrypt and verify a v3 message; callers must inspect `verified`."""
        import json
        encoded = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        out, length = _P(), ctypes.c_size_t()
        try:
            if not _lib.ebp_identity_decrypt_verify_many(self._get_handle(), sender._get_handle(), _buffer(encoded), len(encoded), ctypes.byref(out), ctypes.byref(length)):
                raise ValueError("multi-recipient decryption failed or invalid payload")
            return json.loads(ctypes.string_at(out, length.value))
        finally:
            _lib.ebp_secure_free(out, length.value)

    def sign_and_encrypt(self, message: str, recipient: "Identity") -> str:
        """Sign and encrypt a current-format message for one recipient."""
        encoded = message.encode("utf-8")
        text, out, length = _buffer(encoded), _P(), ctypes.c_size_t()
        try:
            if not _lib.ebp_identity_sign_encrypt(self._get_handle(), recipient._get_handle(), text, len(encoded), ctypes.byref(out), ctypes.byref(length)):
                raise ValueError("signing or encryption failed")
            return ctypes.string_at(out, length.value).hex()
        finally:
            _lib.ebp_free(out)
            ctypes.memset(text, 0, len(text))

    def decrypt_and_verify(self, ciphertext: str, sender: "Identity") -> dict:
        """Decrypt a current message and report whether its recipient-bound signature is valid."""
        try:
            encoded = bytes.fromhex(ciphertext)
        except (TypeError, ValueError) as exc:
            raise ValueError("invalid ciphertext encoding") from exc
        buf, out, length, verified = _buffer(encoded), _P(), ctypes.c_size_t(), ctypes.c_int()
        try:
            if not _lib.ebp_identity_decrypt_verify(self._get_handle(), sender._get_handle(), buf, len(encoded), ctypes.byref(out), ctypes.byref(length), ctypes.byref(verified)):
                raise ValueError("decryption failed or invalid message")
            return {"message": ctypes.string_at(out, length.value).decode("utf-8"), "verified": bool(verified.value), "verifyStatus": "valid" if verified.value else "invalid"}
        finally:
            _lib.ebp_secure_free(out, length.value)

    def create_detail_proof(self, path: str, detail: str, nonce: int, timestamp: int) -> str:
        """Sign a detail proof without changing the identity's stored details."""
        if not isinstance(nonce, int) or isinstance(nonce, bool) or not 0 <= nonce <= 9007199254740991:
            raise ValueError("nonce must be a nonnegative safe integer")
        if not isinstance(timestamp, int) or isinstance(timestamp, bool) or not -9007199254740991 <= timestamp <= 9007199254740991:
            raise ValueError("timestamp must be a safe integer")
        path_bytes, detail_bytes = path.encode("utf-8"), detail.encode("utf-8")
        path_buf, detail_buf, out, length = _buffer(path_bytes), _buffer(detail_bytes), _P(), ctypes.c_size_t()
        try:
            if not _lib.ebp_detail_proof_create(self._get_handle(), path_buf, len(path_bytes), detail_buf, len(detail_bytes), nonce, timestamp, ctypes.byref(out), ctypes.byref(length)):
                raise ValueError("private identity required or detail proof creation failed")
            return ctypes.string_at(out, length.value).decode("ascii")
        finally:
            _lib.ebp_secure_free(out, length.value)
            ctypes.memset(detail_buf, 0, len(detail_buf))

    def create_revocation(self, revocation_type: str, nonce: int, timestamp: int, reason: str | None = None, target: str | None = None) -> str:
        """Create a signed revocation certificate without changing stored identity state."""
        kinds = {"detail": 1, "identity": 2}
        if revocation_type not in kinds or (revocation_type == "detail" and target is None):
            raise ValueError("invalid revocation type or target")
        if not isinstance(nonce, int) or isinstance(nonce, bool) or not 0 <= nonce <= 9007199254740991:
            raise ValueError("nonce must be a nonnegative safe integer")
        if not isinstance(timestamp, int) or isinstance(timestamp, bool) or not -9007199254740991 <= timestamp <= 9007199254740991:
            raise ValueError("timestamp must be a safe integer")
        reason_bytes = None if reason is None else reason.encode("utf-8")
        target_bytes = None if target is None else target.encode("utf-8")
        reason_buf = None if reason_bytes is None else _buffer(reason_bytes)
        target_buf = None if target_bytes is None else _buffer(target_bytes)
        out, length = _P(), ctypes.c_size_t()
        try:
            if not _lib.ebp_revocation_create(self._get_handle(), kinds[revocation_type], nonce, timestamp, reason_buf, len(reason_bytes or b""), target_buf, len(target_bytes or b""), ctypes.byref(out), ctypes.byref(length)):
                raise ValueError("revocation creation failed")
            return ctypes.string_at(out, length.value).decode("ascii")
        finally:
            _lib.ebp_free(out)

    def verify_revocation(self, certificate: str, expected_type: str | None = None, expected_target: str | None = None) -> bool:
        """Verify a current certificate against this identity and optional expectations."""
        kinds = {None: 0, "detail": 1, "identity": 2}
        if expected_type not in kinds:
            raise ValueError("invalid expected revocation type")
        try:
            encoded = certificate.encode("ascii")
        except UnicodeError:
            return False
        target_bytes = None if expected_target is None else expected_target.encode("utf-8")
        target_buf = None if target_bytes is None else _buffer(target_bytes)
        return bool(_lib.ebp_revocation_verify(self._get_handle(), _buffer(encoded), len(encoded), kinds[expected_type], target_buf, len(target_bytes or b"")))

    def verify_revocation_result(self, certificate: str, expected_type: str | None = None, expected_target: str | None = None) -> dict:
        """Verify a certificate and return a structured result and failure reason."""
        kinds = {None: 0, "detail": 1, "identity": 2}
        if expected_type not in kinds: raise ValueError("invalid expected revocation type")
        try:
            encoded = certificate.encode("ascii")
        except UnicodeError:
            return _verification_failure(1)
        target = None if expected_target is None else expected_target.encode("utf-8")
        status = _lib.ebp_revocation_verify_ex(self._get_handle(), _buffer(encoded), len(encoded), kinds[expected_type],
                                                None if target is None else _buffer(target), len(target or b""))
        return {"ok": True, "certificate": decode_revocation_certificate(certificate)} if status == 0 else _verification_failure(status)

    def _revoke(self, kind: int, target: str | None, reason: str | None, timestamp: int | None) -> str:
        if timestamp is None:
            import time
            timestamp = time.time_ns() // 1_000_000
        if not isinstance(timestamp, int) or isinstance(timestamp, bool) or not -9007199254740991 <= timestamp <= 9007199254740991:
            raise ValueError("timestamp must be a safe integer")
        target_bytes = None if target is None else target.encode("utf-8")
        reason_bytes = None if reason is None else reason.encode("utf-8")
        target_buf = None if target_bytes is None else _buffer(target_bytes)
        reason_buf = None if reason_bytes is None else _buffer(reason_bytes)
        out, length = _P(), ctypes.c_size_t()
        try:
            if not _lib.ebp_identity_revoke(self._get_handle(), kind, target_buf, len(target_bytes or b""), reason_buf, len(reason_bytes or b""), timestamp, ctypes.byref(out), ctypes.byref(length)):
                raise ValueError("identity revocation failed")
            return ctypes.string_at(out, length.value).decode("ascii")
        finally:
            _lib.ebp_free(out)

    def revoke_detail(self, path: str, reason: str | None = None, timestamp: int | None = None) -> str:
        return self._revoke(1, path, reason, timestamp)

    def revoke_identity(self, reason: str | None = None, timestamp: int | None = None) -> str:
        return self._revoke(2, None, reason, timestamp)

    @property
    def is_revoked(self) -> bool:
        return bool(_lib.ebp_identity_is_revoked(self._get_handle()))

    def is_detail_revoked(self, path: str) -> bool:
        encoded = path.encode("utf-8")
        return bool(_lib.ebp_identity_is_detail_revoked(self._get_handle(), _buffer(encoded), len(encoded)))

    def emergency_revocation(self, reason: str = "Emergency revocation certificate", timestamp: int | None = None) -> str:
        """Create an emergency certificate without modifying the identity."""
        if timestamp is None:
            import time
            timestamp = time.time_ns() // 1_000_000
        return self.create_revocation("identity", 2**31, timestamp, reason)

    def verify(self, message: str, signature: str, salt: str = "", purpose: str = "message") -> bool:
        purposes = {"message": 1, "detail-proof": 2, "revocation": 3, "hierarchy": 4}
        if purpose not in purposes:
            raise ValueError("invalid signature purpose")
        try:
            raw_signature = base64.b64decode(signature, validate=True)
        except (ValueError, TypeError):
            return False
        text, salt_bytes = message.encode("utf-8"), salt.encode("utf-8")
        text_buf, salt_buf, sig_buf = _buffer(text), _buffer(salt_bytes), _buffer(raw_signature)
        try:
            return bool(_lib.ebp_identity_verify(self._get_handle(), purposes[purpose], text_buf, len(text), salt_buf, len(salt_bytes), sig_buf, len(raw_signature)))
        finally:
            ctypes.memset(text_buf, 0, len(text_buf))

    def close(self):
        handle = getattr(self, "_handle", None)
        if handle and handle.value:
            _lib.ebp_identity_free(handle)
            self._handle = ctypes.c_void_p()

    def __enter__(self):
        self._get_handle()
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.close()

    def __del__(self):
        self.close()

_lib.ebp_payload_parse.argtypes = [_P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_payload_parse.restype = ctypes.c_int
_lib.ebp_payload_armor.argtypes = [_P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_payload_armor.restype = ctypes.c_int
_lib.ebp_payload_build.argtypes = [ctypes.c_char_p, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_payload_build.restype = ctypes.c_int
_lib.ebp_multi_recipient_entries_parse.argtypes = [_P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_multi_recipient_entries_parse.restype = ctypes.c_int


def build_payload(payload_type: str, fields: dict) -> dict:
    """Build a current message or file payload; this does not authenticate it."""
    encoded = json.dumps(fields, ensure_ascii=True, allow_nan=False).encode("utf-8")
    out, length = _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_payload_build(payload_type.encode("ascii"), _buffer(encoded), len(encoded), ctypes.byref(out), ctypes.byref(length)):
            raise ValueError("invalid payload fields or type")
        return json.loads(ctypes.string_at(out, length.value))
    finally:
        _lib.ebp_free(out)


def parse_multi_recipient_entries(value) -> list[dict]:
    """Extract complete recipient entries; this does not authenticate them."""
    text = json.dumps(value, ensure_ascii=True, allow_nan=False)
    return json.loads(_payload_transform(text, _lib.ebp_multi_recipient_entries_parse))


def _payload_transform(text: str, function) -> str:
    encoded = text.encode("utf-8")
    buf, out, length = _buffer(encoded), _P(), ctypes.c_size_t()
    try:
        if not function(buf, len(encoded), ctypes.byref(out), ctypes.byref(length)):
            raise ValueError("invalid or unsupported payload")
        return ctypes.string_at(out, length.value).decode("utf-8")
    finally:
        _lib.ebp_free(out)


def unsigned_revocation_certificate(kind: str, fingerprint: str, nonce: int, timestamp: int,
                                    reason: str | None = None, target: str | None = None) -> dict:
    """Construct an unsigned revocation certificate."""
    if kind not in ("identity", "detail") or not isinstance(nonce, int) or isinstance(nonce, bool) or not 0 <= nonce <= 9007199254740991:
        raise ValueError("invalid revocation type or nonce")
    if not isinstance(timestamp, int) or isinstance(timestamp, bool) or not -9007199254740991 <= timestamp <= 9007199254740991:
        raise ValueError("timestamp must be a safe integer")
    fp = fingerprint.encode("utf-8")
    if b"\0" in fp: raise ValueError("invalid fingerprint")
    reason_bytes = None if reason is None else reason.encode("utf-8")
    target_bytes = None if target is None else target.encode("utf-8")
    out, length = _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_revocation_unsigned(1 if kind == "detail" else 2, fp, nonce, timestamp,
                                             _buffer(reason_bytes) if reason_bytes is not None else None, len(reason_bytes or b""),
                                             _buffer(target_bytes) if target_bytes is not None else None, len(target_bytes or b""),
                                             ctypes.byref(out), ctypes.byref(length)):
            raise ValueError("invalid revocation fields")
        return json.loads(ctypes.string_at(out, length.value))
    finally:
        _lib.ebp_free(out)


def revocation_signature_payload(certificate: dict) -> str:
    return _payload_transform(json.dumps(certificate, ensure_ascii=True, allow_nan=False), _lib.ebp_revocation_signature_payload)


def encode_revocation_certificate(certificate: dict) -> str:
    return _payload_transform(json.dumps(certificate, ensure_ascii=True, allow_nan=False), _lib.ebp_revocation_encode)


def decode_revocation_certificate(certificate: str) -> dict:
    return json.loads(_payload_transform(certificate, _lib.ebp_revocation_decode))


def parse_payload(text: str) -> dict:
    """Parse a current-version EBP JSON or armored payload without authenticating it."""
    import json
    return json.loads(_payload_transform(text, _lib.ebp_payload_parse))


def armor_payload(payload: dict) -> str:
    """Armor a current-version EBP payload without authenticating it."""
    import json
    return _payload_transform(json.dumps(payload, ensure_ascii=True), _lib.ebp_payload_armor)


def verify_detail_proof(algorithm: int, public_key: bytes, path: str, detail: str, proof: str) -> tuple[int, int] | None:
    """Verify a current detail proof and return (nonce, timestamp), or None."""
    try:
        proof_bytes = proof.encode("ascii")
    except UnicodeError:
        return None
    path_bytes, detail_bytes = path.encode("utf-8"), detail.encode("utf-8")
    pub, path_buf, detail_buf, proof_buf = _buffer(public_key), _buffer(path_bytes), _buffer(detail_bytes), _buffer(proof_bytes)
    nonce, timestamp = ctypes.c_uint64(), ctypes.c_int64()
    try:
        if not _lib.ebp_detail_proof_verify(algorithm, pub, len(public_key), path_buf, len(path_bytes), detail_buf, len(detail_bytes), proof_buf, len(proof_bytes), ctypes.byref(nonce), ctypes.byref(timestamp)):
            return None
        return nonce.value, timestamp.value
    finally:
        ctypes.memset(detail_buf, 0, len(detail_buf))
        ctypes.memset(proof_buf, 0, len(proof_buf))


def verify_detail_proof_result(algorithm: int, public_key: bytes, path: str, detail: str, proof: str) -> dict:
    try:
        encoded = proof.encode("ascii")
    except UnicodeError:
        return _verification_failure(1)
    path_bytes, detail_bytes = path.encode("utf-8"), detail.encode("utf-8")
    nonce, timestamp = ctypes.c_uint64(), ctypes.c_int64()
    status = _lib.ebp_detail_proof_verify_ex(algorithm, _buffer(public_key), len(public_key), _buffer(path_bytes), len(path_bytes),
                                              _buffer(detail_bytes), len(detail_bytes), _buffer(encoded), len(encoded), ctypes.byref(nonce), ctypes.byref(timestamp))
    return {"ok": True, "record": {"nonce": nonce.value, "timestamp": timestamp.value}} if status == 0 else _verification_failure(status)

_lib.ebp_hierarchy_create.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint64, ctypes.c_uint64, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_hierarchy_create.restype = ctypes.c_int
_lib.ebp_hierarchy_verify.argtypes = [ctypes.c_void_p, ctypes.c_void_p, _P, ctypes.c_size_t]
_lib.ebp_hierarchy_verify.restype = ctypes.c_int
_lib.ebp_hierarchy_verify_ex.argtypes = _lib.ebp_hierarchy_verify.argtypes
_lib.ebp_hierarchy_verify_ex.restype = ctypes.c_int


def create_hierarchy_certificate(master: Identity, child: Identity, timestamp: int, expiry: int = 0, context: str = "", salt: str | None = None) -> str:
    """Create a certificate signed by two private identities, without changing either identity."""
    if any(not isinstance(n, int) or isinstance(n, bool) or not 0 <= n <= 9007199254740991 for n in (timestamp, expiry)):
        raise ValueError("timestamp and expiry must be nonnegative safe integers")
    if salt is None:
        salt = os.urandom(16).hex()
    context_bytes, salt_bytes = context.encode("utf-8"), salt.encode("utf-8")
    out, length = _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_hierarchy_create(master._get_handle(), child._get_handle(), timestamp, expiry, _buffer(context_bytes), len(context_bytes), _buffer(salt_bytes), len(salt_bytes), ctypes.byref(out), ctypes.byref(length)):
            raise ValueError("hierarchy certificate creation failed")
        return ctypes.string_at(out, length.value).decode("ascii")
    finally:
        _lib.ebp_free(out)


def verify_hierarchy_certificate(master: Identity, child: Identity, certificate: str) -> bool:
    """Check both signatures and identities; expiry and graph checks are separate."""
    try:
        encoded = certificate.encode("ascii")
    except UnicodeError:
        return False
    return bool(_lib.ebp_hierarchy_verify(master._get_handle(), child._get_handle(), _buffer(encoded), len(encoded)))


def verify_hierarchy_certificate_result(master: Identity, child: Identity, certificate: str) -> dict:
    """Return verification status; expiration and graph validation are separate."""
    try:
        encoded = certificate.encode("ascii")
    except UnicodeError:
        return _verification_failure(1)
    status = _lib.ebp_hierarchy_verify_ex(master._get_handle(), child._get_handle(), _buffer(encoded), len(encoded))
    return {"ok": True, "certificate": decode_hierarchy_certificate(certificate)} if status == 0 else _verification_failure(status)

class _HierarchyEdge(ctypes.Structure):
    _fields_ = [("master", ctypes.c_char_p), ("child", ctypes.c_char_p)]


_lib.ebp_hierarchy_validate.argtypes = [ctypes.POINTER(_HierarchyEdge), ctypes.c_size_t, ctypes.POINTER(_HierarchyEdge)]
_lib.ebp_hierarchy_validate.restype = ctypes.c_int
_lib.ebp_hierarchy_validate_ex.argtypes = _lib.ebp_hierarchy_validate.argtypes
_lib.ebp_hierarchy_validate_ex.restype = ctypes.c_int
_lib.ebp_hierarchy_expired.argtypes = [ctypes.c_uint64, ctypes.c_uint64]
_lib.ebp_hierarchy_expired.restype = ctypes.c_int
_lib.ebp_hierarchy_unsigned.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint64, ctypes.c_uint64, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_hierarchy_unsigned.restype = ctypes.c_int
_lib.ebp_hierarchy_signature_payload.argtypes = [_P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_hierarchy_signature_payload.restype = ctypes.c_int
_lib.ebp_hierarchy_sign_part.argtypes = [ctypes.c_void_p, ctypes.c_int, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_hierarchy_sign_part.restype = ctypes.c_int
_lib.ebp_hierarchy_encode.argtypes = [_P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_hierarchy_encode.restype = ctypes.c_int
_lib.ebp_hierarchy_decode.argtypes = [_P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_hierarchy_decode.restype = ctypes.c_int
_lib.ebp_hierarchy_decode_draft.argtypes = _lib.ebp_hierarchy_decode.argtypes
_lib.ebp_hierarchy_decode_draft.restype = ctypes.c_int


def unsigned_hierarchy_certificate(master: str, child: str, timestamp: int, expiry: int = 0, context: str = "", salt: str | None = None) -> dict:
    """Create an unsigned hierarchy certificate for separately held signers."""
    if any(not isinstance(v, int) or isinstance(v, bool) or not 0 <= v <= 9007199254740991 for v in (timestamp, expiry)):
        raise ValueError("timestamp and expiry must be nonnegative safe integers")
    if salt is None: salt = os.urandom(16).hex()
    master_bytes, child_bytes, ctx, salt_bytes = master.encode("utf-8"), child.encode("utf-8"), context.encode("utf-8"), salt.encode("utf-8")
    if b"\0" in master_bytes or b"\0" in child_bytes: raise ValueError("invalid fingerprint")
    out, length = _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_hierarchy_unsigned(master_bytes, child_bytes, timestamp, expiry, _buffer(ctx), len(ctx), _buffer(salt_bytes), len(salt_bytes), ctypes.byref(out), ctypes.byref(length)):
            raise ValueError("invalid hierarchy fields")
        return json.loads(ctypes.string_at(out, length.value))
    finally:
        _lib.ebp_free(out)


def hierarchy_signature_payload(certificate: dict) -> str:
    """Return the canonical message signed by each hierarchy participant."""
    return _payload_transform(json.dumps(certificate, ensure_ascii=True, allow_nan=False), _lib.ebp_hierarchy_signature_payload)


def sign_hierarchy_part(signer: Identity, certificate: dict, child: bool = False) -> dict:
    """Add one participant's signature without requiring the other private key."""
    encoded = json.dumps(certificate, ensure_ascii=True, allow_nan=False).encode("utf-8")
    out, length = _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_hierarchy_sign_part(signer._get_handle(), int(child), _buffer(encoded), len(encoded), ctypes.byref(out), ctypes.byref(length)):
            raise ValueError("invalid hierarchy certificate or signer")
        return json.loads(ctypes.string_at(out, length.value))
    finally:
        _lib.ebp_free(out)


def encode_hierarchy_certificate(certificate: dict) -> str:
    return _payload_transform(json.dumps(certificate, ensure_ascii=True, allow_nan=False), _lib.ebp_hierarchy_encode)


def decode_hierarchy_certificate(certificate: str) -> dict:
    return json.loads(_payload_transform(certificate, _lib.ebp_hierarchy_decode))


def decode_hierarchy_draft(certificate: str) -> dict:
    """Decode a hierarchy record that may be awaiting either signature."""
    return json.loads(_payload_transform(certificate, _lib.ebp_hierarchy_decode_draft))


def validate_hierarchy(edges: list[tuple[str, str]], proposed: tuple[str, str] | None = None) -> bool:
    """Check duplicate parents and cycles; does not verify certificates."""
    def edge(pair):
        master, child = (value.encode("utf-8") for value in pair)
        if b"\0" in master or b"\0" in child:
            raise ValueError("fingerprints cannot contain NUL")
        return _HierarchyEdge(master, child)
    entries = (_HierarchyEdge * len(edges))(*(edge(pair) for pair in edges))
    extra = None if proposed is None else edge(proposed)
    return bool(_lib.ebp_hierarchy_validate(entries, len(edges), ctypes.byref(extra) if extra is not None else None))


def validate_hierarchy_result(edges: list[tuple[str, str]], proposed: tuple[str, str] | None = None) -> dict:
    """Validate graph structure and return a structured failure reason."""
    def edge(pair):
        master, child = (value.encode("utf-8") for value in pair)
        if b"\0" in master or b"\0" in child: raise ValueError("fingerprints cannot contain NUL")
        return _HierarchyEdge(master, child)
    entries = (_HierarchyEdge * len(edges))(*(edge(pair) for pair in edges))
    extra = None if proposed is None else edge(proposed)
    status = _lib.ebp_hierarchy_validate_ex(entries, len(edges), ctypes.byref(extra) if extra is not None else None)
    return {"ok": True} if status == 0 else _verification_failure(status)


def hierarchy_expired(expiry: int, now: int) -> bool:
    """Return whether a nonzero hierarchy expiry is at or before now."""
    if any(not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 9007199254740991 for value in (expiry, now)):
        raise ValueError("expiry and now must be nonnegative safe integers")
    return bool(_lib.ebp_hierarchy_expired(expiry, now))

_lib.ebp_file_envelope_create.argtypes = [_P, ctypes.c_size_t, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_file_envelope_create.restype = ctypes.c_int
_lib.ebp_file_envelope_parse.argtypes = [_P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_file_envelope_parse.restype = ctypes.c_int
_lib.ebp_email_attachment_create.argtypes = [_P, ctypes.c_size_t, _P, ctypes.c_size_t, _P, ctypes.c_size_t, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_email_attachment_create.restype = ctypes.c_int
_lib.ebp_email_attachment_parse.argtypes = [_P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_email_attachment_parse.restype = ctypes.c_int
_lib.ebp_encrypted_email_attachment_parse.argtypes = [_P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_encrypted_email_attachment_parse.restype = ctypes.c_int


def create_file_envelope(file_bytes: bytes, file_name: str, mime_type: str = "application/octet-stream") -> dict:
    """Create a current cleartext file envelope; does not read a file."""
    import json
    name, mime = file_name.encode("utf-8"), mime_type.encode("utf-8")
    data, out, length = _buffer(file_bytes), _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_file_envelope_create(data, len(file_bytes), _buffer(name), len(name), _buffer(mime), len(mime), ctypes.byref(out), ctypes.byref(length)):
            raise ValueError("invalid file envelope input")
        return json.loads(ctypes.string_at(out, length.value))
    finally:
        ctypes.memset(data, 0, len(data))
        _lib.ebp_secure_free(out, length.value)


def parse_file_envelope(data: str) -> dict:
    """Parse a cleartext envelope and return file bytes and metadata; does not write a file."""
    encoded = data.encode("utf-8")
    file, name, mime = _P(), _P(), _P()
    file_len, name_len, mime_len = ctypes.c_size_t(), ctypes.c_size_t(), ctypes.c_size_t()
    try:
        if not _lib.ebp_file_envelope_parse(_buffer(encoded), len(encoded), ctypes.byref(file), ctypes.byref(file_len), ctypes.byref(name), ctypes.byref(name_len), ctypes.byref(mime), ctypes.byref(mime_len)):
            raise ValueError("invalid file envelope")
        return {"fileBytes": ctypes.string_at(file, file_len.value), "fileName": ctypes.string_at(name, name_len.value).decode("utf-8"),
                "mimeType": ctypes.string_at(mime, mime_len.value).decode("utf-8"), "fileSize": file_len.value}
    finally:
        _lib.ebp_secure_free(file, file_len.value)
        _lib.ebp_free(name)
        _lib.ebp_free(mime)


def create_email_attachment(file_bytes: bytes, file_name: str, attachment_id: str,
                            mime_type: str = "application/octet-stream", body_payload_hash: str | None = None) -> dict:
    """Create a cleartext email-attachment envelope without reading a file."""
    name, mime, attachment = file_name.encode("utf-8"), mime_type.encode("utf-8"), attachment_id.encode("utf-8")
    body = None if body_payload_hash is None else body_payload_hash.encode("utf-8")
    file_buf, out, length = _buffer(file_bytes), _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_email_attachment_create(file_buf, len(file_bytes), _buffer(name), len(name), _buffer(mime), len(mime),
                                                _buffer(attachment), len(attachment), _buffer(body) if body is not None else None,
                                                len(body or b""), ctypes.byref(out), ctypes.byref(length)):
            raise ValueError("invalid email attachment")
        return json.loads(ctypes.string_at(out, length.value))
    finally:
        ctypes.memset(file_buf, 0, len(file_buf))
        _lib.ebp_secure_free(out, length.value)


def parse_email_attachment(data: str) -> dict:
    """Parse a cleartext email-attachment envelope and return bytes and metadata."""
    encoded = data.encode("utf-8")
    file, metadata = _P(), _P()
    file_len, metadata_len = ctypes.c_size_t(), ctypes.c_size_t()
    try:
        if not _lib.ebp_email_attachment_parse(_buffer(encoded), len(encoded), ctypes.byref(file), ctypes.byref(file_len), ctypes.byref(metadata), ctypes.byref(metadata_len)):
            raise ValueError("invalid email attachment")
        result = json.loads(ctypes.string_at(metadata, metadata_len.value))
        result["fileBytes"] = ctypes.string_at(file, file_len.value)
        return result
    finally:
        _lib.ebp_secure_free(file, file_len.value)
        _lib.ebp_free(metadata)


def parse_encrypted_email_attachment(payload: dict) -> dict:
    """Validate attachment metadata; this does not authenticate ciphertext."""
    encoded = json.dumps(payload, ensure_ascii=True, allow_nan=False).encode("utf-8")
    return json.loads(_payload_transform(encoded.decode("utf-8"), _lib.ebp_encrypted_email_attachment_parse))

_lib.ebp_multi_envelope.argtypes = [_P, ctypes.c_size_t, _P, ctypes.c_size_t, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_multi_envelope.restype = ctypes.c_int


def multi_recipient_envelope(message: str, recipient_fingerprints: list[str], attachment_manifest: list[dict] | None = None, salt: str = "") -> bytes:
    """Construct the current v3 recipient-set and attachment-bound signature envelope."""
    import json
    message_bytes, salt_bytes = message.encode("utf-8"), salt.encode("utf-8")
    recipients = json.dumps(recipient_fingerprints, ensure_ascii=True).encode("utf-8")
    manifest = json.dumps([] if attachment_manifest is None else attachment_manifest, ensure_ascii=True).encode("utf-8")
    out, length = _P(), ctypes.c_size_t()
    try:
        if not _lib.ebp_multi_envelope(_buffer(message_bytes), len(message_bytes), _buffer(recipients), len(recipients), _buffer(manifest), len(manifest), _buffer(salt_bytes), len(salt_bytes), ctypes.byref(out), ctypes.byref(length)):
            raise ValueError("invalid multi-recipient envelope input")
        return ctypes.string_at(out, length.value)
    finally:
        _lib.ebp_secure_free(out, length.value)
