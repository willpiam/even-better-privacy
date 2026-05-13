---
title: "RFC 4648 — Base16, Base32, and Base64 Data Encodings"
type: source-summary
status: active
last_updated: 2026-05-11
source_count: 1
tags:
  - ietf
  - encoding
  - base64
  - base32
  - hex
  - interoperability
---

# RFC 4648 — Base16, Base32, and Base64 Data Encodings

RFC 4648 (October 2006, Standards Track) obsoletes RFC 3548 and consolidates commonly used **base 16**, **base 32**, and **base 64** schemes. Its goal is to reduce ambiguity when other specifications say “base64” without defining alphabet, padding, line wrapping, or treatment of non-alphabet characters.

## Encodings Defined

- **Base64** (“base64”): 6 bits per symbol; alphabet in Table 1 uses `A–Z`, `a–z`, `0–9`, `+`, `/`, with `=` padding for final quanta shorter than 24 bits. Pad bits in the final quantum **must** be zero in conforming encoders so canonical encodings exist; decoders **may** reject non-zero pad bits if a referring specification mandates it.
- **Base64url**: Same as base64 except positions 62 and 63 use `-` and `_` instead of `+` and `/`. RFC 4648 states this encoding **must not** be called only “base64” without clarification; unqualified “base64” means the previous section’s alphabet.
- **Base32** / **base32hex**: 5 bits per symbol; distinct uppercase (RFC) alphabets with `=` padding rules for 40-bit output groups. **base32hex** uses an “extended hex” alphabet and preserves sort order of underlying octets when compared bitwise—different from base32.
- **Base16**: Case-insensitive hex; two characters per octet; **no** padding character.

## Interoperability Rules

- **Line feeds**: Implementations **must not** insert line breaks into base-encoded output unless the specification that references RFC 4648 explicitly requires them (MIME’s 76-character wrapping is a MIME rule, not intrinsic to “base64” in this document).
- **Padding**: Implementations **must** include correct `=` padding unless the referring specification explicitly waives it.
- **Non-alphabet characters**: When interpreting encoded data, implementations **must reject** input that contains characters outside the defined alphabet **unless** the referring specification explicitly allows otherwise (for example MIME’s practice of ignoring some characters). Ignoring non-alphabet data enables covert channels and can interact badly with security comparisons; the document calls this out in Security Considerations.

## Security Considerations (Summary)

The RFC warns about implementation hazards (buffer overflows, decoders breaking on invalid input such as embedded NUL), covert channels if non-alphabet characters are ignored, manipulation of case in case-insensitive alphabets, abuse of non-significant padding bits, and the fact that base encoding **does not** provide confidentiality or entropy—it only re-represents bytes and can obscure secrets in logs or screenshots.

## Relation to EBP

EBP JSON payloads use standard Base64 (Table 1) for several byte fields (for example signing public keys and signatures) and lowercase hex where documented. Interoperable ports should treat "Base64" as RFC 4648 Base64 unless a field's documentation explicitly names another alphabet (for example base64url). See [[message-payload-formats]], [[identity-model]], [[ml-dsa]], [[slh-dsa]], and [[analysis-reimplementation-building-blocks]].

## Sources

- `wiki/raw/rfc4648.txt`
