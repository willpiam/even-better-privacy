# EBP Roadmap

Internal notes and future plans for EBP development.

## Core

*'Core' refers to the library of objects and functions used by the CLI, server, and GUI*

- What other tests could be useful?
- Identify anti-patterns and places to improve the code, both in functionality and elegance

## CLI

- How do I make the CLI tool installable? Is that even something needed for the reference implementation? Perhaps not
- What kind of tests make sense for the CLI?
- Password input should hide user input like Unix programs usually handle password inputs

## Server

- Users can create identities on the server by uploading their public identity info (public keys + details)
- Go to /api/identity/<fingerprint> to see public keys and details
- Adding a detail can be done by providing a signature
- Users can import contacts from the server (get details by fingerprint)
- CLI interacts with server
- `~/.ebp/state.json` holds pointer to server URI
- How to prevent spam?
- How to make dependable?
    - Federated servers?
    - Post state commitments to blockchain (QRL? Cardano? Both?)
- Implement web of trust
    - Alice signs some object which is NOT a 'detail'
    - This object is basically a certificate saying Alice vouches for Bob's public-key/identity fingerprint

## Future Features

- Support for revocation certificates to remove an identity from a server
    - Ability to specify a parent identity when creating a new identity
    - This parent identity should contribute to the created identity's fingerprint
    - This parent identity can generate a revocation certificate for the child identity
    - Parent does not *automatically* endorse the child
    - Option to create a revocation certificate upon creation of a key
- Parent-child endorsement certificates
    - Both parent and child keys sign the same certificate and maintain a pointer to it
    - Parent and child both attest to the relationship
    - Perhaps this certificate contains extra details about the nature of the relationship between the two identities
- Support expiry dates for identities
- Easily make backups of the server state
- Decentralize/Federate the server side
    - Aim is to decrease centralization
    - What would this mean in practice?
    - What has been the PGP approach?
- Server spam resistance
- Endorse other EBP identities as your own (two-way binding)
- plugin: Make it harder to accidentally send email without first encrypting
- plugin: hide password inputs
- hashed details
    - hashed email endorsement
        - take hash of your email address
        - sign hash
        - send hash & email address & signature to public key server
        - server sends email for you to confirm your email
        - server never makes unhashed email public. Perhaps even deletes raw email address after the user has confirmed it. 
        - users who receive signed emails from you can still confrim that the email address is associated with the provided EBP identity. 
        - reduce your exposure to spam

## Other

- Create diagrams documenting how this works at all levels
    - Code
    - Client/server interactions

