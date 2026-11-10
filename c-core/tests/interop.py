"""JSON bridge used by the Deno interoperability tests."""
import json
import sys
from ebp_core import decrypt_with_key, encrypt_with_key, sha256, derive_storage_key, encrypt, decrypt, pq_keygen, pq_sign, pq_verify, pq_encapsulate, pq_decapsulate, hd_identity_seeds, identity_fingerprint, message_envelope, sign_message, verify_message, encrypt_for_key, decrypt_for_key, recipient_envelope, entropy_to_mnemonic, mnemonic_to_entropy, mnemonic_to_seed, encrypt_for_recipients, decrypt_for_recipient, Identity, parse_payload, armor_payload, verify_detail_proof, create_hierarchy_certificate, verify_hierarchy_certificate, validate_hierarchy, hierarchy_expired, create_file_envelope, parse_file_envelope, multi_recipient_envelope, hd_node_from_path, canonicalize_json, parse_hd_path, build_payload
from ebp_core import create_email_attachment, parse_email_attachment, parse_encrypted_email_attachment
from ebp_core import unsigned_hierarchy_certificate, hierarchy_signature_payload, sign_hierarchy_part, encode_hierarchy_certificate, decode_hierarchy_certificate, decode_hierarchy_draft, unsigned_revocation_certificate, revocation_signature_payload, encode_revocation_certificate, decode_revocation_certificate

request = json.load(sys.stdin)
key = bytes.fromhex(request.get("key", ""))
aad = request.get("aad", "").encode("utf-8")
try:
    if request["operation"] == "canonical_json":
        result = canonicalize_json(request["text"])
    elif request["operation"] == "encrypt":
        result = encrypt_with_key(key, request["text"].encode("utf-8"), bytes.fromhex(request["salt"]), aad)
    elif request["operation"] == "decrypt":
        result = decrypt_with_key(key, request["ciphertext"], aad).decode("utf-8")
    elif request["operation"] == "hierarchy_staged":
        with Identity.from_storage(request["master"], request["password"]) as master, Identity.from_storage(request["child"], request["password"]) as child:
            cert = unsigned_hierarchy_certificate(master.public_data()["fingerprint"], child.public_data()["fingerprint"], int(request["timestamp"]), int(request["expiry"]), request["context"], request["salt"])
            unsigned = dict(cert)
            payload = hierarchy_signature_payload(cert)
            cert = sign_hierarchy_part(master, cert)
            draft = encode_hierarchy_certificate(cert)
            cert = decode_hierarchy_draft(draft)
            cert = sign_hierarchy_part(child, cert, child=True)
            encoded = encode_hierarchy_certificate(cert)
            result = {"unsigned": unsigned, "payload": payload, "draft": draft, "encoded": encoded, "decoded": decode_hierarchy_certificate(encoded)}
    elif request["operation"] == "revocation_staged":
        with Identity.from_storage(request["storage"], request["password"]) as identity:
            cert = unsigned_revocation_certificate("identity", identity.public_data()["fingerprint"], 3, int(request["timestamp"]), "rotation")
            unsigned = dict(cert)
            payload = revocation_signature_payload(cert)
            cert["signature"] = identity.sign(payload, purpose="revocation")
            encoded = encode_revocation_certificate(cert)
            result = {"unsigned": unsigned, "payload": payload, "encoded": encoded, "decoded": decode_revocation_certificate(encoded)}
    elif request["operation"] == "email_attachment_create":
        result = create_email_attachment(bytes.fromhex(request["file"]), request["name"], request["id"], request["mime"], request.get("body"))
    elif request["operation"] == "email_attachment_parse":
        result = parse_email_attachment(request["text"])
        result["fileBytes"] = result["fileBytes"].hex()
    elif request["operation"] == "encrypted_email_attachment_parse":
        result = parse_encrypted_email_attachment(json.loads(request["text"]))
    elif request["operation"] == "payload_build":
        result = build_payload(request["type"], json.loads(request["fields"]))
    elif request["operation"] == "identity_hd_node":
        key_node, chain, _ = hd_node_from_path(bytes.fromhex(request["seed"]), request["path"])
        with Identity.from_hd_node(key_node + chain, request["path"]) as identity:
            result = {"parsed": parse_hd_path(request["path"]), "public": identity.public_data()}
    elif request["operation"] == "public_identity_import":
        with Identity.from_public_data(json.loads(request["public"])) as identity:
            result = identity.public_data()["fingerprint"]
    elif request["operation"] == "identity_variants":
        with Identity.from_variants(int(request["signing"]), int(request["kem"])) as identity:
            result = {"storage": identity.to_storage(request["password"]), "signature": identity.sign(request["message"])}
    elif request["operation"] == "identity_export_options":
        with Identity.from_storage(request["storage"]) as identity:
            result = identity.public_export(request["signing"] == "yes", request["encryption"] == "yes", request["details"] == "yes")
    elif request["operation"] == "identity_storage_with_key":
        with Identity.from_storage(request["storage"], request["password"]) as identity:
            result = identity.to_storage_with_key(bytes.fromhex(request["key"]), bytes.fromhex(request["salt"]))
    elif request["operation"] == "identity_load_with_key":
        with Identity.from_storage_with_key(request["storage"], bytes.fromhex(request["key"])) as identity:
            result = identity.public_data()["fingerprint"]
    elif request["operation"] == "identity_revoke":
        with Identity.from_storage(request["storage"], request["password"]) as identity:
            certificate = identity.revoke_detail(request["path"], request.get("reason"), int(request["timestamp"])) if request["kind"] == "detail" else identity.revoke_identity(request.get("reason"), int(request["timestamp"]))
            result = {"certificate": certificate, "storage": identity.to_storage(request["password"]), "is_revoked": identity.is_revoked, "detail_revoked": identity.is_detail_revoked(request.get("path", ""))}
    elif request["operation"] == "identity_attach_detail":
        with Identity.from_storage(request["storage"], request["password"]) as identity:
            identity.attach_detail(request["path"], request["detail"], int(request["timestamp"]))
            result = {"public": identity.public_data(), "storage": identity.to_storage(request["password"]), "detail": identity.get_detail(request["path"])}
    elif request["operation"] == "identity_get_detail":
        with Identity.from_storage(request["storage"]) as identity:
            result = identity.get_detail(request["path"])
    elif request["operation"] == "public_identity_verify":
        with Identity.from_public_data(json.loads(request["public"])) as identity:
            result = identity.verify(request["text"], request["signature"], request["salt"])
    elif request["operation"] == "public_identity_encrypt":
        with Identity.from_storage(request["sender"], request["password"]) as sender, Identity.from_public_data(json.loads(request["public"])) as recipient:
            result = sender.sign_and_encrypt(request["text"], recipient)
    elif request["operation"] == "multi_signed_encrypt":
        from contextlib import ExitStack
        with ExitStack() as stack:
            sender = stack.enter_context(Identity.from_storage(request["sender"], request["password"]))
            recipients = [stack.enter_context(Identity.from_storage(storage)) for storage in json.loads(request["recipient_storages"])]
            key = bytes.fromhex(request["content_key"]) if "content_key" in request else None
            result = sender.sign_and_encrypt_many(request["message"], recipients, json.loads(request["manifest"]), content_key=key)
    elif request["operation"] == "multi_signed_decrypt":
        with Identity.from_storage(request["recipient"], request["password"]) as recipient, Identity.from_storage(request["sender"]) as sender:
            result = recipient.decrypt_and_verify_many(json.loads(request["payload"]), sender)
    elif request["operation"] == "identity_sign_multi":
        with Identity.from_storage(request["storage"], request["password"]) as identity:
            result = identity.sign_for_recipients(request["message"], json.loads(request["recipients"]), json.loads(request["manifest"]), request["salt"])
    elif request["operation"] == "identity_verify_multi":
        with Identity.from_storage(request["storage"]) as identity:
            result = identity.verify_for_recipients(request["message"], request["signature"], json.loads(request["recipients"]), json.loads(request["manifest"]), request["salt"])
    elif request["operation"] == "identity_sign_encrypt":
        with Identity.from_storage(request["sender"], request["password"]) as sender, Identity.from_storage(request["recipient"]) as recipient:
            result = sender.sign_and_encrypt(request["text"], recipient)
    elif request["operation"] == "identity_decrypt_verify":
        with Identity.from_storage(request["recipient"], request["password"]) as recipient, Identity.from_storage(request["sender"]) as sender:
            result = recipient.decrypt_and_verify(request["ciphertext"], sender)
    elif request["operation"] == "validate_hierarchy":
        result = validate_hierarchy(json.loads(request["edges"]), json.loads(request["proposed"]) if request.get("proposed") else None)
    elif request["operation"] == "hierarchy_expired":
        result = hierarchy_expired(int(request["expiry"]), int(request["now"]))
    elif request["operation"] == "create_hierarchy":
        with Identity.from_storage(request["master"], request["password"]) as master, Identity.from_storage(request["child"], request["password"]) as child:
            result = create_hierarchy_certificate(master, child, int(request["timestamp"]), int(request["expiry"]), request["context"], request["salt"])
    elif request["operation"] == "verify_hierarchy":
        with Identity.from_storage(request["master"]) as master, Identity.from_storage(request["child"]) as child:
            result = verify_hierarchy_certificate(master, child, request["certificate"])
    elif request["operation"] == "create_revocation":
        with Identity.from_storage(request["storage"], request["password"]) as identity:
            result = identity.create_revocation(request["revocation_type"], int(request["nonce"]), int(request["timestamp"]), request.get("reason"), request.get("target"))
    elif request["operation"] == "verify_revocation":
        with Identity.from_storage(request["storage"]) as identity:
            result = identity.verify_revocation(request["certificate"], request.get("expected_type"), request.get("expected_target"))
    elif request["operation"] == "create_detail_proof":
        with Identity.from_storage(request["storage"], request["password"]) as identity:
            result = identity.create_detail_proof(request["path"], request["detail"], int(request["nonce"]), int(request["timestamp"]))
    elif request["operation"] == "verify_detail_proof":
        result = verify_detail_proof(int(request["algorithm"]), bytes.fromhex(request["public"]), request["path"], request["detail"], request["proof"])
    elif request["operation"] == "hd_path":
        key, chain, profile = hd_node_from_path(bytes.fromhex(request["seed"]), request["path"])
        result = {"key": key.hex(), "chain": chain.hex(), "profile": profile}
    elif request["operation"] == "multi_envelope":
        result = multi_recipient_envelope(request["message"], json.loads(request["recipients"]), json.loads(request["manifest"]), request["salt"]).decode("utf-8")
    elif request["operation"] == "file_create":
        result = create_file_envelope(bytes.fromhex(request["file"]), request["name"], request["mime"])
    elif request["operation"] == "file_parse":
        result = parse_file_envelope(request["text"])
        result["fileBytes"] = result["fileBytes"].hex()
    elif request["operation"] == "payload_parse":
        result = parse_payload(request["text"])
    elif request["operation"] == "payload_armor":
        result = armor_payload(json.loads(request["payload"]))
    elif request["operation"] == "identity_hd":
        with Identity.from_hd_seed(bytes.fromhex(request["seed"]), request["profile"], int(request["account"]), request["change"], int(request["index"])) as identity:
            result = {"public": identity.public_data(), "storage": identity.to_storage(request["password"])}
    elif request["operation"] == "identity_create":
        with Identity(request["profile"]) as identity:
            result = {"public": identity.public_data(), "storage": identity.to_storage(request["password"]), "signature": identity.sign(request["text"], request["salt"])}
    elif request["operation"] == "identity_load":
        password = request["password"] if request.get("unlock") == "yes" else None
        with Identity.from_storage(request["storage"], password) as identity:
            result = {"public": identity.public_data(), "is_private": identity.is_private}
            if identity.is_private:
                result["signature"] = identity.sign(request["text"], request["salt"])
                if request.get("restore") == "yes":
                    result["storage"] = identity.to_storage(request["password"])
    elif request["operation"] == "identity_verify":
        with Identity.from_storage(request["storage"]) as identity:
            result = identity.verify(request["text"], request["signature"], request["salt"])
    elif request["operation"] == "multi_encrypt":
        recipients = [(entry["fingerprint"], bytes.fromhex(entry["public"])) for entry in json.loads(request["recipients"])]
        encrypted = encrypt_for_recipients(request["text"].encode("utf-8"), recipients, bytes.fromhex(request["content_key"]))
        encrypted["contentKey"] = encrypted["contentKey"].hex()
        result = encrypted
    elif request["operation"] == "multi_decrypt":
        result = decrypt_for_recipient(json.loads(request["encrypted"]), request["fingerprint"], bytes.fromhex(request["private"])).decode("utf-8")
    elif request["operation"] == "entropy_to_mnemonic":
        result = entropy_to_mnemonic(bytes.fromhex(request["entropy"]))
    elif request["operation"] == "mnemonic_to_entropy":
        result = mnemonic_to_entropy(request["mnemonic"]).hex()
    elif request["operation"] == "mnemonic_to_seed":
        result = mnemonic_to_seed(request["mnemonic"], request["passphrase"]).hex()
    elif request["operation"] == "recipient_envelope":
        result = recipient_envelope(request["recipient"], request["text"], request["salt"]).decode("utf-8")
    elif request["operation"] == "verify_recipient":
        result = pq_verify(int(request["algorithm"]), bytes.fromhex(request["public"]), recipient_envelope(request["recipient"], request["text"], request["salt"]), bytes.fromhex(request["signature"]))
    elif request["operation"] == "sign_recipient":
        result = pq_sign(int(request["algorithm"]), bytes.fromhex(request["private"]), recipient_envelope(request["recipient"], request["text"], request["salt"])).hex()
    elif request["operation"] == "kem_encrypt":
        result = encrypt_for_key(bytes.fromhex(request["public"]), request["text"].encode("utf-8"), int(request.get("algorithm", "3")))
    elif request["operation"] == "kem_decrypt":
        result = decrypt_for_key(bytes.fromhex(request["private"]), request["ciphertext"], int(request.get("algorithm", "3"))).decode("utf-8")
    elif request["operation"] == "envelope":
        result = message_envelope(request["text"], request["salt"], request["purpose"]).decode("utf-8")
    elif request["operation"] == "sign_message":
        result = sign_message(int(request["algorithm"]), bytes.fromhex(request["private"]), request["text"], request["salt"], request["purpose"])
    elif request["operation"] == "verify_message":
        result = verify_message(int(request["algorithm"]), bytes.fromhex(request["public"]), request["text"], request["signature"], request["salt"], request["purpose"])
    elif request["operation"] == "hd_fingerprint":
        sign_seed, kem_seed = hd_identity_seeds(bytes.fromhex(request["seed"]), request["profile"], int(request["account"]), request["change"], int(request["index"]))
        signing, _ = pq_keygen(1 if request["profile"] == "dilithium" else 2, sign_seed)
        encryption, _ = pq_keygen(3, kem_seed)
        result = identity_fingerprint(request["profile"], signing, encryption)
    elif request["operation"] == "fingerprint":
        result = identity_fingerprint(request["profile"], bytes.fromhex(request["signing"]), bytes.fromhex(request["encryption"]))
    elif request["operation"] == "hd_identity_seeds":
        sign, kem = hd_identity_seeds(bytes.fromhex(request["seed"]), request["profile"], int(request["account"]), request["change"], int(request["index"]))
        result = {"sign": sign.hex(), "kem": kem.hex()}
    elif request["operation"] == "pq_keygen":
        pub, priv = pq_keygen(int(request["algorithm"]), bytes.fromhex(request["seed"]))
        result = {"public": pub.hex(), "private": priv.hex()}
    elif request["operation"] == "pq_sign":
        result = pq_sign(int(request["algorithm"]), bytes.fromhex(request["private"]), bytes.fromhex(request["message"])).hex()
    elif request["operation"] == "pq_verify":
        result = pq_verify(int(request["algorithm"]), bytes.fromhex(request["public"]), bytes.fromhex(request["message"]), bytes.fromhex(request["signature"]))
    elif request["operation"] == "pq_encapsulate":
        ct, secret = pq_encapsulate(bytes.fromhex(request["public"]), int(request.get("algorithm", "3")))
        result = {"ciphertext": ct.hex(), "secret": secret.hex()}
    elif request["operation"] == "pq_decapsulate":
        result = pq_decapsulate(bytes.fromhex(request["private"]), bytes.fromhex(request["ciphertext"]), int(request.get("algorithm", "3"))).hex()
    elif request["operation"] == "derive":
        result = derive_storage_key(request["password"], bytes.fromhex(request["salt"])).hex()
    elif request["operation"] == "encrypt_password":
        result = encrypt(request["password"], request["text"].encode("utf-8"), aad)
    elif request["operation"] == "decrypt_password":
        result = decrypt(request["password"], request["ciphertext"], aad).decode("utf-8")
    else:
        result = sha256(request["text"].encode("utf-8")).hex()
    print(json.dumps({"result": result}))
except ValueError:
    print(json.dumps({"error": "invalid ciphertext"}))
