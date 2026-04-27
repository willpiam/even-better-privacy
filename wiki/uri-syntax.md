---
title: "URI Syntax and URL Handling"
type: concept
status: active
last_updated: 2026-04-27
source_count: 2
tags:
  - uri
  - url
  - web
  - normalization
  - security
---

# URI Syntax and URL Handling

EBP uses URLs and URI-shaped strings for public server endpoints, browser verifier calls, OAuth redirects, and local GUI backend URLs. [[source-rfc-3986]] provides the generic syntax layer for these identifiers.

## Core Model

RFC 3986 defines a URI as a compact identifier with common components such as scheme, authority, path, query, and fragment. It deliberately separates generic parsing from scheme-specific behavior: `https://...` behavior is defined by HTTP/TLS/browser standards, while RFC 3986 defines the shared component grammar and reference-resolution rules.

The RFC also separates identification from interaction. A URI identifies a resource; the protocol, application, or containing format determines what operation is performed when that identifier is dereferenced.

DIDs are also URI-shaped identifiers. [[source-did-1-1]] builds DID and DID URL syntax on RFC 3986, then leaves method-specific interpretation to DID method specifications. EBP can compare against that architecture without treating EBP fingerprints as DID URLs.

## Normalization and Decoding

URI handling should preserve RFC 3986's decoding order:

- Split a URI into components and subcomponents before decoding percent-encoded octets.
- Decode unreserved percent-encoded characters when normalizing comparisons.
- Treat reserved delimiter characters differently from unreserved characters because decoding a reserved character can change interpretation.
- Apply dot-segment removal when resolving or normalizing hierarchical paths.

This matters for EBP surfaces that compare server URLs, accept redirect-like values, or pass path/query data to HTTP handlers.

## Security Notes

RFC 3986 warns that URIs are commonly displayed, stored in browser history, logged by user agents, and logged by intermediaries. EBP should avoid placing secrets, long-lived bearer tokens, private keys, or password-like material in URLs when a body, header, or local-only channel can carry them instead.

The RFC also notes semantic attacks using the `userinfo@host` authority form and implementation differences around unusual IP literal formats. UI and validation code should parse authority components structurally rather than relying on string prefixes.

## Related Pages

- [[component-server]]
- [[component-website]]
- [[decentralized-identifiers]]
- [[overview]]

## Sources

- `wiki/raw/rfc3986.txt` → [[source-rfc-3986]]
- `wiki/raw/Decentralized Identifiers (DIDs) v1.1.pdf` → [[source-did-1-1]]
