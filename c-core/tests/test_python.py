import base64
import hashlib
import unittest
from ebp_core import sha256, encrypt_with_key, decrypt_with_key, encrypt, decrypt, derive_storage_key, hd_identity_seeds, identity_fingerprint, pq_keygen, ML_DSA_87


class CoreTests(unittest.TestCase):
    def test_sha256(self):
        for data in (b"", b"abc", "snowman ☃".encode(), bytes(range(256))):
            self.assertEqual(sha256(data), hashlib.sha256(data).digest())

    def test_encryption_and_authentication(self):
        key, salt, aad = bytes(range(32)), bytes(range(16)), b"metadata"
        for plain in (b"", b"hello\0world", bytes(range(256))):
            encoded = encrypt_with_key(key, plain, salt, aad)
            raw = bytearray(base64.b64decode(encoded))
            self.assertEqual(raw[:17], b"\x04" + salt)
            self.assertEqual(decrypt_with_key(key, encoded, aad), plain)
            for offset in (17, len(raw) - 1):
                changed = raw.copy()
                changed[offset] ^= 1
                with self.assertRaises(ValueError):
                    decrypt_with_key(key, base64.b64encode(changed).decode(), aad)
            with self.assertRaises(ValueError):
                decrypt_with_key(key, encoded, b"wrong")
            with self.assertRaises(ValueError):
                decrypt_with_key(bytes(32), encoded, aad)

    def test_password_encryption(self):
        encoded = encrypt("sëcret", b"hello", b"metadata")
        self.assertEqual(decrypt("sëcret", encoded, b"metadata"), b"hello")
        with self.assertRaises(ValueError): decrypt("wrong", encoded, b"metadata")
        with self.assertRaises(ValueError): decrypt("sëcret", encoded, b"wrong")
        with self.assertRaises(ValueError): derive_storage_key("test", b"short")

    def test_hd_input_validation(self):
        for profile, account, change, index in (("bad", 0, "external", 0), ("sphincs", -1, "external", 0), ("dilithium", 0, "bad", 0), ("sphincs", 0, "internal", 2**31)):
            with self.assertRaises(ValueError): hd_identity_seeds(bytes(64), profile, account, change, index)
        with self.assertRaises(ValueError): identity_fingerprint("bad", b"a", b"b")
        with self.assertRaises(ValueError): pq_keygen(ML_DSA_87, b"short")

    def test_invalid_inputs(self):
        with self.assertRaises(ValueError): decrypt_with_key(bytes(32), "not base64!")
        with self.assertRaises(ValueError): decrypt_with_key(bytes(32), "AA==")
        with self.assertRaises(ValueError): encrypt_with_key(b"short", b"", bytes(16))
        with self.assertRaises(ValueError): encrypt_with_key(bytes(32), b"", b"short")

if __name__ == "__main__":
    unittest.main()
