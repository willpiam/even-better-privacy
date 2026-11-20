#!/usr/bin/env python3
"""Generate Sepolia and Cardano preview receiving wallets.

Public addresses are written to hidden/addresses.json. Private keys are
encrypted to the verified william@pqpost.com identity and written to
hidden/testnet-wallet-keys.ebp.json as an ebp-encrypted-message payload.
Decrypt that file with the matching identity:

    deno task cli decrypt hidden/testnet-wallet-keys.ebp.json

The C core needs OpenSSL 3.5, which this machine does not have, so encryption
uses the same Deno ML-KEM path as the CLI.
"""

from __future__ import annotations

import hashlib
import json
import os
import stat
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519
from Crypto.Hash import keccak

REPO = Path(__file__).resolve().parents[1]
HIDDEN = REPO / "hidden"
ADDRESSES_PATH = HIDDEN / "addresses.json"
ENCRYPTED_PATH = HIDDEN / "testnet-wallet-keys.ebp.json"
RECIPIENT_EMAIL = "william@pqpost.com"
KEY_SERVER = "https://keys.pqpost.com"
ML_KEM_1024_PUBLIC_BYTES = 1568
ML_KEM_1024_CIPHERTEXT_BYTES = 1568
AES_GCM_NONCE_BYTES = 12
AES_GCM_TAG_BYTES = 16

BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
# BIP-173 witness v0 program for bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4.
_BIP173_PROGRAM = bytes.fromhex("751e76e8199196d454941c45d1b3a323f1433bd6")
_BIP173_ADDRESS = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
# secp256k1 private key 1, uncompressed keccak address.
_ETH_KEY_ONE = bytes.fromhex("01".zfill(64))
_ETH_ADDRESS_ONE = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf"


def bech32_polymod(values: list[int]) -> int:
    generator = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3]
    checksum = 1
    for value in values:
        top = checksum >> 25
        checksum = ((checksum & 0x1FFFFFF) << 5) ^ value
        for index in range(5):
            checksum ^= generator[index] if ((top >> index) & 1) else 0
    return checksum


def bech32_hrp_expand(hrp: str) -> list[int]:
    return [ord(char) >> 5 for char in hrp] + [0] + [ord(char) & 31 for char in hrp]


def bech32_create_checksum(hrp: str, data: list[int]) -> list[int]:
    polymod = bech32_polymod(bech32_hrp_expand(hrp) + data + [0, 0, 0, 0, 0, 0]) ^ 1
    return [(polymod >> 5 * (5 - index)) & 31 for index in range(6)]


def bech32_encode(hrp: str, data: list[int]) -> str:
    combined = data + bech32_create_checksum(hrp, data)
    return hrp + "1" + "".join(BECH32_CHARSET[value] for value in combined)


def convertbits(data: bytes, from_bits: int, to_bits: int, pad: bool = True) -> list[int]:
    accumulator = 0
    bits = 0
    result: list[int] = []
    max_value = (1 << to_bits) - 1
    max_accumulator = (1 << (from_bits + to_bits - 1)) - 1
    for value in data:
        if value < 0 or value >> from_bits:
            raise ValueError("invalid bech32 data")
        accumulator = ((accumulator << from_bits) | value) & max_accumulator
        bits += from_bits
        while bits >= to_bits:
            bits -= to_bits
            result.append((accumulator >> bits) & max_value)
    if pad:
        if bits:
            result.append((accumulator << (to_bits - bits)) & max_value)
    elif bits >= from_bits or ((accumulator << (to_bits - bits)) & max_value):
        raise ValueError("invalid bech32 padding")
    return result


def ethereum_address(private_key: bytes) -> str:
    if len(private_key) != 32:
        raise ValueError("ethereum private key must be 32 bytes")
    key = ec.derive_private_key(int.from_bytes(private_key, "big"), ec.SECP256K1())
    public = key.public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    if len(public) != 65 or public[0] != 4:
        raise ValueError("unexpected secp256k1 public key")
    digest = keccak.new(data=public[1:], digest_bits=256).digest()
    body = digest[-20:].hex()
    hashed = keccak.new(data=body.encode("ascii"), digest_bits=256).hexdigest()
    checksummed = "".join(
        character.upper() if int(hashed[index], 16) >= 8 else character
        for index, character in enumerate(body)
    )
    return "0x" + checksummed


def cardano_preview_address(public_key: bytes) -> str:
    """Enterprise address on the Cardano testnets (header 0x60, addr_test)."""
    if len(public_key) != 32:
        raise ValueError("cardano public key must be 32 bytes")
    payment_hash = hashlib.blake2b(public_key, digest_size=28).digest()
    payload = bytes([0x60]) + payment_hash
    return bech32_encode("addr_test", convertbits(payload, 8, 5))


def self_test() -> None:
    if bech32_encode("bc", [0] + convertbits(_BIP173_PROGRAM, 8, 5)) != _BIP173_ADDRESS:
        raise RuntimeError("bech32 self-test failed")
    if ethereum_address(_ETH_KEY_ONE) != _ETH_ADDRESS_ONE:
        raise RuntimeError("ethereum address self-test failed")
    private = ed25519.Ed25519PrivateKey.generate()
    public = private.public_key().public_bytes(
        serialization.Encoding.Raw,
        serialization.PublicFormat.Raw,
    )
    independent = deno_cardano_address(public.hex())
    if cardano_preview_address(public) != independent:
        raise RuntimeError("cardano address self-test failed")


def deno_json(script: str, payload: dict | None = None, args: list[str] | None = None) -> str:
    with tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".ts",
        prefix="ebp-wallet-",
        dir="/tmp",
        delete=False,
        encoding="utf-8",
    ) as handle:
        handle.write(script)
        helper = handle.name
    try:
        completed = subprocess.run(
            [
                "deno",
                "run",
                "--quiet",
                "--config",
                str(REPO / "deno.json"),
                "--allow-read",
                "--allow-env",
                "--allow-net",
                helper,
                *(args or []),
            ],
            input=None if payload is None else json.dumps(payload),
            text=True,
            capture_output=True,
            cwd=REPO,
            env={**os.environ, "NO_COLOR": "1"},
            check=False,
        )
    finally:
        os.unlink(helper)
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip()
        raise RuntimeError(detail or "deno helper failed")
    return completed.stdout.strip()


def deno_cardano_address(public_key_hex: str) -> str:
    script = """
import { bech32 } from "bech32";
import { blake2b } from "jsr:@noble/hashes@1.8.0/blake2b";
const hex = Deno.args[0];
if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("public key must be 32 bytes");
const publicKey = Uint8Array.from(hex.match(/../g).map((byte) => Number.parseInt(byte, 16)));
const payload = new Uint8Array(29);
payload[0] = 0x60;
payload.set(blake2b(publicKey, { dkLen: 28 }), 1);
console.log(bech32.encode("addr_test", bech32.toWords(payload)));
"""
    return deno_json(script, args=[public_key_hex])


def fetch_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"accept": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.status != 200:
            raise RuntimeError(f"key server returned {response.status}")
        body = json.load(response)
    if not isinstance(body, dict):
        raise RuntimeError("key server returned an unexpected document")
    return body


def recipient_identity() -> dict:
    verified = fetch_json(
        KEY_SERVER
        + "/api/v1/identities/by-verified-email?email="
        + urllib.parse.quote(RECIPIENT_EMAIL)
    )
    matches = verified.get("identities")
    if not isinstance(matches, list) or len(matches) != 1:
        count = len(matches) if isinstance(matches, list) else 0
        raise RuntimeError(
            f"expected one verified identity for {RECIPIENT_EMAIL}, found {count}"
        )
    fingerprint = matches[0].get("fingerprint")
    if not isinstance(fingerprint, str) or not fingerprint.startswith("ebp"):
        raise RuntimeError("verified identity is missing a fingerprint")

    search = fetch_json(
        KEY_SERVER
        + "/api/v1/identities/search?limit=100&query="
        + urllib.parse.quote(RECIPIENT_EMAIL)
    )
    others = []
    for identity in search.get("identities") or []:
        if identity.get("revoked"):
            continue
        email = (identity.get("details") or {}).get("email")
        value = email[0] if isinstance(email, list) and email else ""
        if str(value).casefold() == RECIPIENT_EMAIL and identity.get("fingerprint") != fingerprint:
            others.append(identity.get("fingerprint"))
    if others:
        raise RuntimeError(
            "more than one active identity publishes "
            + RECIPIENT_EMAIL
            + ": "
            + ", ".join(str(item) for item in others)
        )

    identity = fetch_json(f"{KEY_SERVER}/api/v1/identity/{fingerprint}")
    if identity.get("fingerprint") != fingerprint or identity.get("revoked"):
        raise RuntimeError("published identity is revoked or does not match the lookup")
    email = (identity.get("details") or {}).get("email")
    if not isinstance(email, list) or str(email[0]).casefold() != RECIPIENT_EMAIL:
        raise RuntimeError("published identity email does not match " + RECIPIENT_EMAIL)
    meta = (identity.get("detailsMeta") or {}).get("email") or {}
    if not meta.get("verified"):
        raise RuntimeError("published email detail is not verified")
    if identity.get("encryptionKeyType") != "kyber":
        raise RuntimeError("published encryption key is not ML-KEM")
    details = identity.get("encryptionKeyDetails") or {}
    if details.get("variant") != "ml_kem1024":
        raise RuntimeError("published encryption key is not ML-KEM-1024")
    public_key = identity.get("encryptionKey")
    if not isinstance(public_key, str) or len(bytes.fromhex(public_key)) != ML_KEM_1024_PUBLIC_BYTES:
        raise RuntimeError("published encryption key has an unexpected length")
    return {
        "fingerprint": fingerprint,
        "encryptionKeyType": "kyber",
        "encryptionKey": public_key,
        "encryptionKeyDetails": {"variant": "ml_kem1024"},
    }


def generate_ethereum() -> dict:
    private_key = ec.generate_private_key(ec.SECP256K1()).private_numbers().private_value.to_bytes(32, "big")
    address = ethereum_address(private_key)
    return {"address": address, "privateKey": "0x" + private_key.hex()}


def generate_cardano() -> dict:
    private_key = ed25519.Ed25519PrivateKey.generate()
    seed = private_key.private_bytes(
        serialization.Encoding.Raw,
        serialization.PrivateFormat.Raw,
        serialization.NoEncryption(),
    )
    public_key = private_key.public_key().public_bytes(
        serialization.Encoding.Raw,
        serialization.PublicFormat.Raw,
    )
    address = cardano_preview_address(public_key)
    if address != deno_cardano_address(public_key.hex()) or not address.startswith("addr_test1"):
        raise RuntimeError("cardano address did not match the independent encoder")
    return {
        "address": address,
        "kind": "enterprise",
        "seedEncoding": "rfc8032",
        "paymentSigningKey": {
            "type": "PaymentSigningKey_ed25519",
            "description": "Payment Signing Key",
            "cborHex": "5820" + seed.hex(),
        },
        "paymentVerificationKey": {
            "type": "PaymentVerificationKey_ed25519",
            "description": "Payment Verification Key",
            "cborHex": "5820" + public_key.hex(),
        },
    }


def encrypt_for_recipient(recipient: dict, message: str) -> str:
    script = """
import { Identity } from "__IDENTITY__";
const input = JSON.parse(new TextDecoder().decode(await new Response(Deno.stdin.readable).bytes()));
if (typeof input.message !== "string" || !input.recipient) throw new Error("missing message");
const ciphertext = Identity.EncryptFor(input.recipient, input.message);
if (!/^[0-9a-f]+$/.test(ciphertext)) throw new Error("encryption failed");
console.log(ciphertext);
""".replace("__IDENTITY__", str(REPO / "core" / "Identity.ts"))
    ciphertext = deno_json(script, {"recipient": recipient, "message": message})
    expected = (ML_KEM_1024_CIPHERTEXT_BYTES + AES_GCM_NONCE_BYTES + len(message.encode("utf-8")) + AES_GCM_TAG_BYTES) * 2
    if len(ciphertext) != expected:
        raise RuntimeError("encrypted payload has an unexpected length")
    return ciphertext


def write_private(path: Path, text: str) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    descriptor = os.open(path, flags, 0o600)
    try:
        os.write(descriptor, text.encode("utf-8"))
    finally:
        os.close(descriptor)
    os.chmod(path, 0o600)


def assert_private_material_stays_encrypted(secrets: list[str]) -> None:
    public_text = ADDRESSES_PATH.read_text(encoding="utf-8")
    encrypted_text = ENCRYPTED_PATH.read_text(encoding="utf-8")
    for secret in secrets:
        if secret and secret in public_text:
            raise RuntimeError("private key material was written to the address file")
        if secret and secret in encrypted_text:
            raise RuntimeError("private key material was stored without encryption")


def main() -> int:
    if ADDRESSES_PATH.exists() or ENCRYPTED_PATH.exists():
        print("hidden wallet files already exist; leaving them in place", file=sys.stderr)
        return 1
    self_test()
    recipient = recipient_identity()
    ethereum = generate_ethereum()
    cardano = generate_cardano()
    created = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    secret = {
        "recipient": RECIPIENT_EMAIL,
        "recipientFingerprint": recipient["fingerprint"],
        "created": created,
        "ethereum-sepolia": ethereum,
        "cardano-preview": cardano,
    }
    message = json.dumps(secret, indent=2) + "\n"
    ciphertext = encrypt_for_recipient(recipient, message)
    payload = {
        "type": "ebp-encrypted-message",
        "version": 1,
        "recipientFingerprint": recipient["fingerprint"],
        "ciphertext": ciphertext,
    }
    addresses = {
        "recipient": RECIPIENT_EMAIL,
        "recipientFingerprint": recipient["fingerprint"],
        "created": created,
        "decrypt": "deno task cli decrypt hidden/testnet-wallet-keys.ebp.json",
        "ethereum-sepolia": {
            "address": ethereum["address"],
            "note": "This address is valid on every Ethereum network. Fund it only on Sepolia.",
        },
        "cardano-preview": {
            "address": cardano["address"],
            "kind": "enterprise",
            "note": "Preview testnet enterprise address, payment key only.",
        },
    }
    secrets = [
        ethereum["privateKey"],
        ethereum["privateKey"][2:],
        cardano["paymentSigningKey"]["cborHex"],
        cardano["paymentSigningKey"]["cborHex"][4:],
    ]
    HIDDEN.mkdir(mode=0o700, exist_ok=True)
    os.chmod(HIDDEN, 0o700)
    try:
        write_private(ENCRYPTED_PATH, json.dumps(payload, indent=2) + "\n")
        write_private(ADDRESSES_PATH, json.dumps(addresses, indent=2) + "\n")
        assert_private_material_stays_encrypted(secrets)
    except Exception:
        for path in (ENCRYPTED_PATH, ADDRESSES_PATH):
            if path.exists():
                path.unlink()
        raise
    os.chmod(ADDRESSES_PATH, stat.S_IRUSR | stat.S_IWUSR)
    print(f"recipient {RECIPIENT_EMAIL}")
    print(f"fingerprint {recipient['fingerprint']}")
    print(f"ethereum-sepolia {ethereum['address']}")
    print(f"cardano-preview {cardano['address']}")
    print(f"addresses {ADDRESSES_PATH}")
    print(f"encrypted {ENCRYPTED_PATH}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
