# Google Play Data safety for EBP Android

Use this inventory for the Android release and confirm it against the exact bundle and services submitted in Play Console. The flows below are user-selected. Use **App functionality** for mail, identity publication, and verification, **Account management** for hosted mailbox provisioning and removal, and **Fraud prevention, security, and compliance** for address retirement and transaction safety.

| Play data type | Android flow and disclosure |
| --- | --- |
| Personal info → Name, Email address, User IDs | An optional name and other identity details can be published or put in a message. A hosted signup publishes an email address and links it to the public identity fingerprint. Mail uses addresses for account access and delivery. |
| Messages → Emails | Hosted mail stores messages, headers, and delivery metadata. The Android client also reads and sends mail through providers selected by the user. Ordinary mail is readable by the provider. Only apply the end-to-end encryption exemption to data that meets Google's definition throughout the whole flow. |
| Files and docs, Photos and videos, Audio files | The app can send user-selected attachments. Hosted mail retains attachments in the mailbox. File cryptography performed entirely on the device does not itself collect files. |
| Contacts, Other user-generated content | Contacts imported and kept on the device are local. Account for addresses used in mail or submitted in network lookups, and user-entered profile details sent for publication. |
| Financial info → Purchase history and Other financial info | If the release includes test-address checkout, review its order records, wallet addresses and public transaction identifiers. The app enables the checkout from Settings, so include the flow in the review of that release. |

- **Collected and shared.** Apply Google's off-device collection definition to each flow. Review the sharing exceptions for transfers to service providers and user-initiated delivery. Public identity publication, mail to recipients, and transfer to a configured mail provider have different audiences and purposes.
- **Service logs.** Network requests to the key service are logged with IP address, request path, time, and response status for operations and abuse prevention. The application does not infer location from the IP address.
- **Encryption in transit.** Android authenticates the mail server and uses TLS before sending mail credentials or messages. The production key server uses HTTPS. Review off-device processing by mail and checkout providers before selecting the app-wide answer.
- **Deletion.** Provide the [public mailbox deletion URL](https://pqpost.com/delete-mailbox.html) in the account deletion field. The app also offers server-side deletion for managed accounts. The [privacy policy](https://pqpost.com/privacy) describes retained records and how to request deletion of separately published data.

[Google Play Data safety form guidance](https://support.google.com/googleplay/android-developer/answer/10787469)
