# GUI / mobile interop fixtures

Golden payloads for cross-client decrypt/verify tests.

## Manual smoke checklist

1. GUI: sign+encrypt message with public keys → copy armored body → mobile decrypt (no saved contact).
2. Mobile: sign+encrypt with sign=true → GUI decrypt without saved contact.
3. Mobile: paste `encrypted-signed-message-multi.json` (or GUI mail multi-recipient export).
4. Mobile: create identity with weak password → rejected; strong password → opens in GUI.

## Files

- `armored-encrypted-message.txt` — PEM-wrapped minimal payload for `parseEbpPayloadInput`
- `encrypted-signed-file-v1.json` — file payload shape with `version` field
