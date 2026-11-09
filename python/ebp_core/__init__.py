"""Bindings for the implemented subset of the EBP C core."""
import base64
import ctypes
import importlib.util
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
_lib.ebp_identity_from_hd_seed.argtypes = [_P, ctypes.c_size_t, ctypes.c_int, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32, ctypes.POINTER(ctypes.c_void_p)]
_lib.ebp_identity_from_hd_seed.restype = ctypes.c_int
_lib.ebp_identity_public_json.argtypes = [ctypes.c_void_p, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_identity_public_json.restype = ctypes.c_int
_lib.ebp_identity_from_public_json.argtypes = [_P, ctypes.c_size_t, ctypes.POINTER(ctypes.c_void_p)]
_lib.ebp_identity_from_public_json.restype = ctypes.c_int
_lib.ebp_identity_store.argtypes = [ctypes.c_void_p, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_identity_store.restype = ctypes.c_int
_lib.ebp_identity_load.argtypes = [_P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.c_int, ctypes.POINTER(ctypes.c_void_p)]
_lib.ebp_identity_load.restype = ctypes.c_int
_lib.ebp_identity_sign.argtypes = [ctypes.c_void_p, ctypes.c_int, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_identity_sign.restype = ctypes.c_int
_lib.ebp_identity_verify.argtypes = [ctypes.c_void_p, ctypes.c_int, _P, ctypes.c_size_t, _P, ctypes.c_size_t, _P, ctypes.c_size_t]
_lib.ebp_identity_verify.restype = ctypes.c_int
_lib.ebp_detail_proof_create.argtypes = [ctypes.c_void_p, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.c_uint64, ctypes.c_int64, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_detail_proof_create.restype = ctypes.c_int
_lib.ebp_detail_proof_verify.argtypes = [ctypes.c_int, _P, ctypes.c_size_t, _P, ctypes.c_size_t, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(ctypes.c_uint64), ctypes.POINTER(ctypes.c_int64)]
_lib.ebp_detail_proof_verify.restype = ctypes.c_int
_lib.ebp_revocation_create.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_uint64, ctypes.c_int64, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_revocation_create.restype = ctypes.c_int
_lib.ebp_revocation_verify.argtypes = [ctypes.c_void_p, _P, ctypes.c_size_t, ctypes.c_int, _P, ctypes.c_size_t]
_lib.ebp_revocation_verify.restype = ctypes.c_int
_lib.ebp_identity_attach_detail.argtypes = [ctypes.c_void_p, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.c_int64]
_lib.ebp_identity_attach_detail.restype = ctypes.c_int
_lib.ebp_identity_get_detail.argtypes = [ctypes.c_void_p, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_identity_get_detail.restype = ctypes.c_int
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
        """Load a public export containing both public keys."""
        import json
        encoded = json.dumps(data, ensure_ascii=False).encode("utf-8")
        handle = ctypes.c_void_p()
        if not _lib.ebp_identity_from_public_json(_buffer(encoded), len(encoded), ctypes.byref(handle)):
            raise ValueError("invalid or incomplete public identity")
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


def _payload_transform(text: str, function) -> str:
    encoded = text.encode("utf-8")
    buf, out, length = _buffer(encoded), _P(), ctypes.c_size_t()
    try:
        if not function(buf, len(encoded), ctypes.byref(out), ctypes.byref(length)):
            raise ValueError("invalid or unsupported payload")
        return ctypes.string_at(out, length.value).decode("utf-8")
    finally:
        _lib.ebp_free(out)


def parse_payload(text: str) -> dict:
    """Parse a current-version EBP JSON or armored payload without authenticating it."""
    import json
    return json.loads(_payload_transform(text, _lib.ebp_payload_parse))


def armor_payload(payload: dict) -> str:
    """Armor a current-version EBP payload without authenticating it."""
    import json
    return _payload_transform(json.dumps(payload, ensure_ascii=False), _lib.ebp_payload_armor)


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

_lib.ebp_hierarchy_create.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint64, ctypes.c_uint64, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_hierarchy_create.restype = ctypes.c_int
_lib.ebp_hierarchy_verify.argtypes = [ctypes.c_void_p, ctypes.c_void_p, _P, ctypes.c_size_t]
_lib.ebp_hierarchy_verify.restype = ctypes.c_int


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

class _HierarchyEdge(ctypes.Structure):
    _fields_ = [("master", ctypes.c_char_p), ("child", ctypes.c_char_p)]


_lib.ebp_hierarchy_validate.argtypes = [ctypes.POINTER(_HierarchyEdge), ctypes.c_size_t, ctypes.POINTER(_HierarchyEdge)]
_lib.ebp_hierarchy_validate.restype = ctypes.c_int
_lib.ebp_hierarchy_expired.argtypes = [ctypes.c_uint64, ctypes.c_uint64]
_lib.ebp_hierarchy_expired.restype = ctypes.c_int


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


def hierarchy_expired(expiry: int, now: int) -> bool:
    """Return whether a nonzero hierarchy expiry is at or before now."""
    if any(not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 9007199254740991 for value in (expiry, now)):
        raise ValueError("expiry and now must be nonnegative safe integers")
    return bool(_lib.ebp_hierarchy_expired(expiry, now))

_lib.ebp_file_envelope_create.argtypes = [_P, ctypes.c_size_t, _P, ctypes.c_size_t, _P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_file_envelope_create.restype = ctypes.c_int
_lib.ebp_file_envelope_parse.argtypes = [_P, ctypes.c_size_t, ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(_P), ctypes.POINTER(ctypes.c_size_t)]
_lib.ebp_file_envelope_parse.restype = ctypes.c_int


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
