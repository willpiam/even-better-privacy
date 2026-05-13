---
title: "Hashcash — A Denial of Service Counter-Measure (Back, 2002)"
type: source-summary
status: active
last_updated: 2026-05-11
source_count: 1
tags:
  - proof-of-work
  - hashcash
  - email
  - dos
  - adam-back
---

# Hashcash — A Denial of Service Counter-Measure (Back, 2002)

Adam Back's August 2002 paper revisits the **hashcash** proposal from May 1997 as a way to throttle systematic abuse of unmetered internet resources (notably email and anonymous remailers). It unifies terminology for **CPU cost-functions**, surveys improvements and related work, and discusses early experiments.

## Cost-function framework

A **cost-function** is parameterised by an expected work factor: a client runs **MINT()** to produce a token; a server runs **VALUE()** to check it before continuing a protocol.

- **Interactive** cost-functions add **CHAL()**: the server issues a challenge; suited to connection-oriented protocols (TCP, TLS, SSH, IPsec).
- **Non-interactive** cost-functions omit **CHAL()**: the client picks its own random start value—needed for store-and-forward or packet-oriented settings where no return channel exists for a challenge.

The paper distinguishes **publicly auditable** verification (third parties can check tokens efficiently, without trapdoor secrets), **trapdoor-free** minting (the server cannot cheaply forge arbitrary tokens—contrast “known solution” puzzles where the issuer has an advantage), and **probabilistic** cost (expected time predictable, actual time random—unbounded vs bounded variants).

## Hashcash construction (non-interactive)

**Hashcash** is classified as: non-interactive, publicly auditable, trapdoor-free, **unbounded probabilistic** cost.

Tokens are minted by finding a **partial hash collision** (in the paper’s updated simplification) against a leading string of zero bits in the hash output; the fastest generic approach described is brute-force search over a randomised start string. Tokens are bound to a **service-name** (any bit-string that uniquely identifies the service, such as a hostname or email address) so tokens minted for one recipient cannot be replayed elsewhere.

**Servers** must maintain a **double-spend database** of used tokens. To bound database growth, the service string can include a **mint time**, enabling expiry and deletion of old entries (with allowance for clock skew, compute time, and network delay).

The paper notes an improvement (Hal Finney and Thomas Boschloo, personal communications, March 2002): collide against a **fixed all-zero** \(k\)-bit target instead of hashing the service-name into the target—still fair, simpler, and roughly **halves verification cost** compared with the earlier formulation.

## Interactive hashcash and “hashcash-cookies”

An **interactive** variant lets the server choose the challenge, enabling **dynamic throttling** of the work factor under load and optional use only during overload (graceful degradation).

For **TCP connection-slot depletion**, the paper sketches **hashcash-cookies**: combine syn-cookie–style statelessness (challenge embedded in a **keyed MAC** / “symmetric key certificate” the client returns) with a CPU cost before the server commits per-connection state—analogous to syn-cookies but with an added proof-of-work.

## Pre-computation and beacons

For pure non-interactive stamps, a motivated adversary might **pre-compute** many tokens for future use (the paper gives a “year of precomputation, one-day flood” sketch for email abuse). Including a slowly changing **beacon** (authenticated unpredictable value, e.g. weekly lottery numbers) in the start string limits how far ahead tokens remain valid.

## Related constructions (position of the paper)

The paper contrasts hashcash with **Juels–Brainard client puzzles** (known-solution, server trapdoor, not publicly auditable without modification) and **Rivest–Shamir–Wagner time-lock puzzles** (fixed cost, non-parallelizable in principle, but trapdoor verification, heavier verification, key-management and parameter-rotation concerns). Back argues that for many DoS settings, the simpler hashcash-style approach is preferable despite parallelizability of hash preimage search.

Prior and related citations in the paper include Dwork–Naor (1992) on CPU pricing for junk mail, Juels–Brainard (1999), Jakobsson–Juels (1999), TLS client puzzles (Dean & Stubblefield, 2001), and applications (Freenet, Publius, Tangler, SCF, USENET gateways, Wei Dai’s b-money).

## Relation to EBP

EBP does **not** implement hashcash or generic client proof-of-work stamps on SMTP/IMAP. End-to-end abuse resistance in EBP’s email flows comes from **post-quantum signing and encryption** inside payloads ([[message-payload-formats]]), not from CPU tokens at transport layer. Operational **rate limiting** on the public server is a separate, conventional control ([[component-server]]). For a short wiki-native summary of Back’s model, see [[hashcash-cost-functions]].

## Sources

- `wiki/raw/hashcash.pdf`
