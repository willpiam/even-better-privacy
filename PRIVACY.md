# Privacy Policy

Starling Kestrel Laboratories Inc. operates Even Better Privacy (EBP). The [public privacy policy](https://pqpost.com/privacy) and this summary cover the EBP apps and services.

## Identities and verification

The key service stores public keys, identity fingerprints, signatures, and profile details you submit for publication. Managed mailbox signup publishes the identity and links its verified email address to the public key. Other users can look up published details. Email verification processes the address and a confirmation token to prove ownership. In the Android app, private identity keys and cryptographic passwords stay on your device. Signing, encryption, and decryption take place on your device.

## Hosted mailboxes

When you create a `pqpost.com` or `test.pqpost.com` mailbox, EBP processes the address, identity fingerprint, signed proof, and mailbox password to provision access. The key service keeps the address, identity link, creation date, and internal account identifier. The mail server maintains login credentials and stores messages, headers, folders, and attachments. The server can read ordinary email. Message bodies protected with EBP end-to-end encryption are stored as ciphertext and regular delivery metadata remains visible.

Test-address checkout also processes order and transaction records, which may include a wallet address and public transaction identifiers. These are used for address reservations, payment confirmation, and support.

## Third-party mail and local data

The Android app connects directly to the IMAP and SMTP servers you configure to read and send mail. The provider operates that mailbox under its own policy. The app encrypts mail credentials you save on the device. Locally stored identities, contacts, and settings stay on the device until you choose a feature that transmits information. Android mail uses TLS for login and mail data. The production key service uses HTTPS.

The key service logs request time, path, response status, and IP address for operations, troubleshooting, and abuse prevention. The request log omits message and signature payloads.

## Sharing

EBP does not sell user data. Recipients and mail providers receive data as part of delivery. Service providers process data to operate the key and mail infrastructure. EBP discloses information when required by law. Data you submit for publication and public blockchain records are visible to others.

## Retention and deletion

Hosted mail remains on the service while the mailbox exists. Deletion removes the active account, messages, folders, and attachments. Backup copies may remain until the backup that contains them expires. EBP retains the retired address and its identity link to prevent reassignment and impersonation. EBP may keep revocation proofs and related security records for replay prevention, and payment records to resolve transactions, prevent fraud, or meet legal obligations. Other recipients and providers control their own copies.

Public identity data has no automatic expiry. Revocation removes affected details from active use. Locally saved credentials remain until the account is removed on the device. Use the [mailbox deletion page](https://pqpost.com/delete-mailbox.html) to request deletion of a hosted mailbox and associated data. For separately published identity data or privacy questions, email [postmaster@pqpost.com](mailto:postmaster@pqpost.com).

Effective November 25, 2026.
