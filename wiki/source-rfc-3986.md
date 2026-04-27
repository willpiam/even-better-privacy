---
title: "RFC 3986: URI Generic Syntax"
type: source-summary
status: active
last_updated: 2026-04-27
source_count: 1
tags:
  - source
  - rfc
  - uri
  - url
  - normalization
  - web
---

# RFC 3986: URI Generic Syntax

**Raw file:** `wiki/raw/rfc3986.txt`
**Published:** January 2005
**Status:** Standards Track / STD 66

## Summary

RFC 3986 defines the generic syntax for Uniform Resource Identifiers (URIs), including scheme, authority, path, query, and fragment components. The grammar is scheme-independent: it lets software parse common URI components before applying scheme-specific rules.

The RFC is relevant to EBP because the project accepts and displays HTTP(S) server URLs in places such as the hosted verifier, local GUI backend redirects, OAuth flows, and public API calls. It provides the normative background for URL/URI parsing, percent-encoding, relative reference resolution, and comparison.

## Key Topics

- URI components: scheme, authority, userinfo, host, port, path, query, and fragment.
- Percent-encoding rules, including the distinction between reserved delimiter characters and unreserved characters.
- Relative reference resolution against a base URI, including the `remove_dot_segments` algorithm.
- URI normalization and comparison, including case normalization, percent-encoding normalization, and path segment normalization.
- Security considerations for decoding order, rare IP address formats, sensitive data in URIs, misleading userinfo, and malicious construction with unexpected ports.

## EBP Relevance

RFC 3986 supports [[uri-syntax]] and URL handling notes in [[component-server]] and [[component-website]]:

- EBP documentation should distinguish generic URI syntax from scheme-specific HTTPS or browser behavior.
- URI components should be parsed before decoding percent-encoded octets, so decoded delimiters are not mistaken for original syntax.
- Secrets such as passwords, bearer tokens, or verification tokens should not be placed in URIs when avoidable because URIs are commonly logged, stored in history, and exposed through intermediaries.
- URI comparison should account for normalization limits: normalization can reduce false mismatches, but it does not prove two different URIs identify different resources.

## Caveats

RFC 3986 does not define the full behavior of HTTP(S), browser fetch, OAuth redirect validation, or Internationalized Resource Identifiers. It is the generic URI layer that those protocols build on.

## Related Pages

- [[uri-syntax]]
- [[component-server]]
- [[component-website]]
- [[overview]]

## Sources

- `wiki/raw/rfc3986.txt`
