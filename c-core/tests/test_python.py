import base64
import hashlib
import ssl
import unittest
from ebp_core import sha256, encrypt_with_key, decrypt_with_key, encrypt, decrypt, derive_storage_key, hd_identity_seeds, identity_fingerprint, pq_keygen, ML_DSA_87, entropy_to_mnemonic, mnemonic_to_entropy, mnemonic_to_seed, generate_mnemonic, validate_mnemonic, Identity, canonicalize_json, canonical_json, compute_state_hash, decode_fingerprint, short_fingerprint, parse_hd_path, format_hd_path
from ebp_core import hex_encode, hex_decode, base64_encode, base64_decode, random_hex, verify_detail_proof_result, create_hierarchy_certificate, verify_hierarchy_certificate_result
from ebp_core import ML_DSA_44, ML_DSA_65, ML_KEM_512, ML_KEM_768
from ebp_core import validate_hierarchy_result, hd_provenance, build_identity_state
from ebp_core import openssl_version


class CoreTests(unittest.TestCase):
    def test_openssl_version_after_python_ssl_import(self):
        self.assertTrue(ssl.OPENSSL_VERSION.startswith("OpenSSL "))
        version = openssl_version()
        self.assertTrue(version.startswith("OpenSSL "))
        self.assertGreaterEqual(tuple(map(int, version.split()[1].split(".")[:3])), (3, 5, 0))
        with Identity() as identity:
            self.assertTrue(identity.public_data()["fingerprint"])

    def test_canonical_json(self):
        expected = '{"10":3,"2":2,"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27]}'
        self.assertEqual(canonicalize_json('{"2":2,"10":3,"numbers":[333333333.33333329,1E30,4.50,2e-3,1e-27]}'), expected)
        self.assertEqual(compute_state_hash({"b": 2, "a": 1}), hashlib.sha256(b'{"a":1,"b":2}').hexdigest())
        for invalid in ('{"a":1,"a":2}', '{"\\u0000":1}', '"\\ud800"', '1e999'):
            with self.assertRaises(ValueError): canonicalize_json(invalid)
        with self.assertRaises(ValueError): canonical_json(float('nan'))
        self.assertEqual(canonical_json({"x": "\ud83d\ude00"}), '{"x":"😀"}')
        self.assertEqual(canonicalize_json('"\ud83d\ude00"'), '"😀"')
        with self.assertRaises(ValueError): canonical_json({"x": "\ud800"})

    def test_hd_path_and_public_fingerprint(self):
        path = format_hd_path("dilithium", 3, "internal", 5)
        self.assertEqual(path, "m/ebp'/dilithium'/3'/1/5")
        self.assertEqual(parse_hd_path(path)["account"], 3)
        self.assertEqual(hd_provenance(path)["change"], "internal")
        with Identity() as identity:
            fp = identity.public_data()["fingerprint"]
            self.assertEqual(decode_fingerprint(fp)[0], "dilithium")
            self.assertEqual(short_fingerprint(fp), fp[:12] + "…" + fp[-12:])
            with self.assertRaises(ValueError): decode_fingerprint(fp[:-1] + ("q" if fp[-1] != "q" else "p"))
            state = build_identity_state(identity.public_data(), {})
            self.assertEqual(state["fingerprint"], fp)
            self.assertEqual(compute_state_hash(state), hashlib.sha256(canonical_json(state).encode()).hexdigest())

    def test_sha256(self):
        for data in (b"", b"abc", "snowman ☃".encode(), bytes(range(256))):
            self.assertEqual(sha256(data), hashlib.sha256(data).digest())

    def test_encoding_helpers(self):
        for data in (b"", b"hello", bytes(range(256))):
            self.assertEqual(hex_decode(hex_encode(data)), data)
            self.assertEqual(base64_decode(base64_encode(data)), data)
        self.assertEqual(base64_decode(" T W E=\n"), b"Ma")
        with self.assertRaises(ValueError): hex_decode("fg")
        with self.assertRaises(ValueError): base64_decode("!!!")
        self.assertEqual(len(bytes.fromhex(random_hex(16))), 16)
        self.assertEqual(random_hex(0), "")
        with self.assertRaises(ValueError): random_hex(65537)

    def test_structured_verification(self):
        with Identity() as identity, Identity() as child:
            cert = identity.create_revocation("identity", 0, 1)
            self.assertTrue(identity.verify_revocation_result(cert)["ok"])
            self.assertFalse(identity.verify_revocation_result("xyz")["ok"])
            public = base64.b64decode(identity.public_data()["signingKey"])
            proof = identity.create_detail_proof("email", "a@b", 1, 2)
            self.assertTrue(verify_detail_proof_result(ML_DSA_87, public, "email", "a@b", proof)["ok"])
            self.assertEqual(verify_detail_proof_result(ML_DSA_87, public, "email", "changed", proof)["error"], "identity or field mismatch")
            hierarchy = create_hierarchy_certificate(identity, child, 1, salt="salt")
            self.assertTrue(verify_hierarchy_certificate_result(identity, child, hierarchy)["ok"])
            self.assertEqual(verify_hierarchy_certificate_result(child, identity, hierarchy)["error"], "identity or field mismatch")
        self.assertEqual(validate_hierarchy_result([("a", "b")], ("b", "a"))["error"], "hierarchy contains a loop")
        self.assertTrue(validate_hierarchy_result([("a", "b")], ("b", "c"))["ok"])

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

    def test_public_exports_and_detail_validation(self):
        with Identity() as identity:
            identity.attach_detail("email", "person@example.org", timestamp=1)
            self.assertTrue(identity.verify_details())
            public = identity.public_export(include_signing_key=False)
            self.assertIn("signingKeyHash", public)
            self.assertNotIn("signingKey", public)
            with Identity.from_public_data(public) as contact:
                self.assertEqual(contact.public_export(include_signing_key=False), public)
            with Identity.from_embedded_data(identity.public_data(), identity.public_data()["fingerprint"]) as contact:
                self.assertEqual(contact.public_data()["fingerprint"], identity.public_data()["fingerprint"])
            embedded = dict(identity.public_data(), details=None, detailsMeta=None, extra="ignored")
            with Identity.from_embedded_data(embedded) as contact:
                self.assertEqual(contact.public_data()["details"], {})
                self.assertEqual(contact.public_data()["detailsMeta"], {})
                self.assertNotIn("extra", contact.public_data())
            with self.assertRaises(ValueError): Identity.from_embedded_data(identity.public_data(), "wrong")
            identity.revoke_detail("email", timestamp=2)
            self.assertEqual(identity.revocation_certificate("email")["version"], 2)
            self.assertIsNone(identity.revocation_certificate())

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

    def test_signed_multi_recipient_content_key(self):
        with Identity("dilithium") as sender, Identity("dilithium") as recipient:
            key = bytes(range(32))
            packet = sender.sign_and_encrypt_many("hello", [recipient], content_key=key)
            self.assertEqual(packet["contentKey"], key.hex())
            result = recipient.decrypt_and_verify_many(packet, sender)
            self.assertTrue(result["verified"])
            self.assertEqual(result["message"], "hello")
            with self.assertRaises(ValueError):
                sender.sign_and_encrypt_many("hello", [recipient], content_key=b"short")
            with self.assertRaises(ValueError):
                sender.sign_and_encrypt_many("hello", [])

    def test_signed_multi_recipient_mixed_key_variants(self):
        with Identity.from_variants(ML_DSA_44, ML_KEM_512) as alice, Identity.from_variants(ML_DSA_65, ML_KEM_768) as bob:
            packet = alice.sign_and_encrypt_many("hello", [alice, bob])
            self.assertTrue(alice.decrypt_and_verify_many(packet, alice)["verified"])
            self.assertTrue(bob.decrypt_and_verify_many(packet, alice)["verified"])

    def test_invalid_inputs(self):
        with self.assertRaises(ValueError): decrypt_with_key(bytes(32), "not base64!")
        with self.assertRaises(ValueError): decrypt_with_key(bytes(32), "AA==")
        with self.assertRaises(ValueError): encrypt_with_key(b"short", b"", bytes(16))
        with self.assertRaises(ValueError): encrypt_with_key(bytes(32), b"", b"short")

if __name__ == "__main__":
    unittest.main()
