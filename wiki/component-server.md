---
title: "EBP Server Component"
type: component
status: seed
last_updated: 2026-04-05
source_count: 1
tags:
  - component
  - server
  - api
---

# Server Component

The server acts as a publish/discovery layer for public identities and revocation state.

## Responsibilities

- store and return public identity information
- validate and store revocation certificates
- return revocation status fields with identity queries

## Trust Boundary Notes

Server data is useful for discovery and status, but cryptographic verification remains essential on the client side.

## Related Pages

- [[component-cli]]
- [[revocation-system]]
- [[identity-model]]

## Sources

- `ReadMe.md`

