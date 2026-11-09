import base64
import hashlib
import unittest
from ebp_core import sha256, encrypt_with_key, decrypt_with_key


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

    def test_invalid_inputs(self):
        with self.assertRaises(ValueError): decrypt_with_key(bytes(32), "not base64!")
        with self.assertRaises(ValueError): decrypt_with_key(bytes(32), "AA==")
        with self.assertRaises(ValueError): encrypt_with_key(b"short", b"", bytes(16))
        with self.assertRaises(ValueError): encrypt_with_key(bytes(32), b"", b"short")

if __name__ == "__main__":
    unittest.main()
