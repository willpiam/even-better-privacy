"""JSON bridge used by the Deno interoperability tests."""
import json
import sys
from ebp_core import decrypt_with_key, encrypt_with_key, sha256

request = json.load(sys.stdin)
key = bytes.fromhex(request.get("key", ""))
aad = request.get("aad", "").encode("utf-8")
try:
    if request["operation"] == "encrypt":
        result = encrypt_with_key(key, request["text"].encode("utf-8"), bytes.fromhex(request["salt"]), aad)
    elif request["operation"] == "decrypt":
        result = decrypt_with_key(key, request["ciphertext"], aad).decode("utf-8")
    else:
        result = sha256(request["text"].encode("utf-8")).hex()
    print(json.dumps({"result": result}))
except ValueError:
    print(json.dumps({"error": "invalid ciphertext"}))
