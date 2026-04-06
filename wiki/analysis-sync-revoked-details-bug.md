---
title: "Analysis: Sync From Server Does Not Strip Revoked Details"
type: analysis
status: active
last_updated: 2026-04-06
source_count: 0
tags:
  - bug
  - revocation
  - gui
  - mobile
  - sync
---

# Sync From Server Does Not Strip Revoked Details

## Summary

When a user revokes a detail and then presses "Sync From Server" on a known contact, the revoked details still appeared in the contact's detail list. The root cause was that both the GUI local-backend and the mobile app failed to filter out revoked details from the server response before saving the contact to disk.

## Affected Components

- [[component-gui]] — local backend `/api/v1/fetch` handler (`gui/local-backend/main.ts`)
- Mobile app — `normalizeExternalIdentity` in `mobile/src/services/contacts.ts`

## Root Cause

### Server returns revoked details in the `details` map

`handleGetIdentity` in `server/main.ts` calls `getDetailsMap()` which selects **all** details without filtering on `revoked_at`. It returns them in the `details` field alongside a separate `revokedDetails` array. This is by design—the single-identity endpoint exposes raw data and leaves filtering to the consumer.

Note: the list (`/api/v1/identities`) and search (`/api/v1/identities/search`) endpoints **do** strip revoked details from their responses before returning.

### Consumers did not strip revoked details

- The GUI local backend's `/api/v1/fetch` handler did not read the `revokedDetails` field from the server response at all. It saved `details` directly to the contact JSON file.
- The mobile app's `normalizeExternalIdentity` parsed `revokedDetails` but did not remove the corresponding entries from the `details` (or `detailsMeta`) map before returning.

## Fix

Both consumers now strip revoked detail paths from the `details` and `detailsMeta` maps before persisting the contact:

```
for (const path of revokedDetails) {
  delete details[path];
  delete detailsMeta[path];
}
```

## Related Pages

- [[revocation-system]]
- [[component-gui]]
- [[component-server]]

## Sources

- `gui/local-backend/main.ts` — `/api/v1/fetch` handler
- `mobile/src/services/contacts.ts` — `normalizeExternalIdentity`
- `server/main.ts` — `handleGetIdentity`, `handleListIdentities`
- `server/db.ts` — `getDetailsMap`, `getRevokedDetailPaths`
