import base64
import hashlib
import unittest
from ebp_core import sha256, encrypt_with_key, decrypt_with_key, encrypt, decrypt, derive_storage_key, hd_identity_seeds, identity_fingerprint, pq_keygen, ML_DSA_87, entropy_to_mnemonic, mnemonic_to_entropy, mnemonic_to_seed, generate_mnemonic, validate_mnemonic, Identity


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

    def test_mnemonics(self):
        entropy = bytes(16)
        phrase = "abandon " * 11 + "about"
        self.assertEqual(entropy_to_mnemonic(entropy), phrase)
        self.assertEqual(mnemonic_to_entropy(phrase), entropy)
        self.assertEqual(mnemonic_to_seed(phrase, "é"), mnemonic_to_seed(phrase, "e\N{COMBINING ACUTE ACCENT}"))
        self.assertTrue(validate_mnemonic(generate_mnemonic()))
        self.assertFalse(validate_mnemonic("abandon " * 12))
        for bad in (0, 129, True, 128.0):
            with self.assertRaises(ValueError): generate_mnemonic(bad)
        with self.assertRaises(ValueError): entropy_to_mnemonic(b"short")
        with self.assertRaises(ValueError): mnemonic_to_seed("abandon " * 12)

    def test_identity_storage(self):
        with Identity("dilithium") as original:
            self.assertTrue(original.is_private)
            signature = original.sign("hello", "salt")
            self.assertTrue(original.verify("hello", signature, "salt"))
            self.assertFalse(original.verify("changed", signature, "salt"))
            storage = original.to_storage("secret-password")
            with Identity.from_storage(storage, "secret-password") as loaded:
                self.assertTrue(loaded.is_private)
                self.assertEqual(loaded.public_data()["fingerprint"], original.public_data()["fingerprint"])
                self.assertTrue(loaded.verify("hello", signature, "salt"))
            with Identity.from_storage(storage) as public:
                self.assertFalse(public.is_private)
                self.assertTrue(public.verify("hello", signature, "salt"))
                with self.assertRaises(ValueError): public.sign("hello")
                with self.assertRaises(ValueError): public.to_storage("secret-password")
            with self.assertRaises(ValueError): Identity.from_storage(storage, "wrong")
        with self.assertRaises(ValueError): original.public_data()

    def test_revocation_input_and_atomicity(self):
        with Identity("dilithium") as identity:
            before = identity.public_data()
            with self.assertRaises(ValueError):
                identity.revoke_detail("missing", timestamp=1)
            self.assertEqual(identity.public_data(), before)
            with self.assertRaises(ValueError):
                identity.create_revocation("identity", 0, 1, "😀" * 513)
            certificate = identity.create_revocation("identity", 0, 1, "😀" * 512)
            self.assertTrue(identity.verify_revocation(certificate, "identity"))
            self.assertFalse(identity.is_revoked)
            self.assertEqual(identity.public_data(), before)

    def test_invalid_inputs(self):
        with self.assertRaises(ValueError): decrypt_with_key(bytes(32), "not base64!")
        with self.assertRaises(ValueError): decrypt_with_key(bytes(32), "AA==")
        with self.assertRaises(ValueError): encrypt_with_key(b"short", b"", bytes(16))
        with self.assertRaises(ValueError): encrypt_with_key(bytes(32), b"", b"short")

if __name__ == "__main__":
    unittest.main()
