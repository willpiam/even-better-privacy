"""JSON bridge used by the Deno interoperability tests."""
import json
import sys
from ebp_core import decrypt_with_key, encrypt_with_key, sha256, derive_storage_key, encrypt, decrypt, pq_keygen, pq_sign, pq_verify, pq_encapsulate, pq_decapsulate, hd_identity_seeds, identity_fingerprint, message_envelope, sign_message, verify_message, encrypt_for_key, decrypt_for_key, recipient_envelope

request = json.load(sys.stdin)
key = bytes.fromhex(request.get("key", ""))
aad = request.get("aad", "").encode("utf-8")
try:
    if request["operation"] == "encrypt":
        result = encrypt_with_key(key, request["text"].encode("utf-8"), bytes.fromhex(request["salt"]), aad)
    elif request["operation"] == "decrypt":
        result = decrypt_with_key(key, request["ciphertext"], aad).decode("utf-8")
    elif request["operation"] == "recipient_envelope":
        result = recipient_envelope(request["recipient"], request["text"], request["salt"]).decode("utf-8")
    elif request["operation"] == "verify_recipient":
        result = pq_verify(int(request["algorithm"]), bytes.fromhex(request["public"]), recipient_envelope(request["recipient"], request["text"], request["salt"]), bytes.fromhex(request["signature"]))
    elif request["operation"] == "sign_recipient":
        result = pq_sign(int(request["algorithm"]), bytes.fromhex(request["private"]), recipient_envelope(request["recipient"], request["text"], request["salt"])).hex()
    elif request["operation"] == "kem_encrypt":
        result = encrypt_for_key(bytes.fromhex(request["public"]), request["text"].encode("utf-8"))
    elif request["operation"] == "kem_decrypt":
        result = decrypt_for_key(bytes.fromhex(request["private"]), request["ciphertext"]).decode("utf-8")
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
        ct, secret = pq_encapsulate(bytes.fromhex(request["public"]))
        result = {"ciphertext": ct.hex(), "secret": secret.hex()}
    elif request["operation"] == "pq_decapsulate":
        result = pq_decapsulate(bytes.fromhex(request["private"]), bytes.fromhex(request["ciphertext"])).hex()
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
