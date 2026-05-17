---
title: "Google Cloud: Unverified apps (OAuth)"
type: source-summary
status: active
last_updated: 2026-05-07
source_count: 1
tags:
  - source
  - oauth
  - google
  - mail
  - identity-provider
---

# Google Cloud: Unverified apps (OAuth)

Clipped Google Cloud Platform Console Help describing how Google surfaces **unverified** OAuth clients and what developers must do before launching user-facing apps that use sensitive or restricted scopes.

## Summary

Google defines an **unverified app** as one (including Apps Script) that requests **sensitive or restricted OAuth scopes** but has not completed Google's OAuth app verification. Users may see warnings (for example an “unverified app” screen before the consent screen, Security Checkup risk labeling, or “Sign in with Google” restrictions) intended to reduce deceptive apps.

The **unverified app** interstitial can appear when: scopes are sensitive/restricted but not configured and submitted for verification on the OAuth consent screen; selected scopes on the consent screen omit what the code requests; or verification was requested but is not yet complete. **Requested scopes in application code must match** the OAuth consent screen configuration.

**Quotas:** Apps that show the unverified app screen are subject to a **100 new users (total)** cap after that screen is shown; Google may adjust quotas per app history, reputation, and risk (details also reference OAuth Application Rate Limits).

**Policy changes:** Google may upgrade data types/scopes to sensitive or restricted; affected apps may temporarily remain usable during a grace period with email and consent-screen warnings, then face the unverified screen and cap if still unverified.

**When verification is required:** User-facing apps generally need verification before public launch; **internal** apps (same Google Workspace domain, Cloud Organization association), **development/test** builds not launched broadly, and some **OAuth-based plugins** for popular platforms are called out as cases that may not require the full process (per Google's page—confirm current policy for a given client type).

**Verification steps (high level):** Complete OAuth consent screen details (including a **privacy policy URL**; homepage and Terms URLs if applicable), verify **website ownership in Search Console** with a project Owner/Editor who is also a verified property owner, then submit verification (UI details on the source page may be beta or evolve).

Changing the client, **redirect URLs**, **JavaScript origins**, **product name**, or **scopes** after verification may require re-verification.

## EBP relevance

EBP's [[component-gui]] Gmail integration and [[component-server]] mail OAuth proxy endpoints depend on Google OAuth clients registered in Google Cloud. Operators and integrators should expect **unverified-app UX and the 100-user cap** until verification completes for the scopes in use. The [[component-email-extension]] path also depends on provider OAuth when end users connect Google accounts; published Chrome Web Store extensions have their own distribution and verification expectations that intersect with Google's OAuth program.

## Sources

- `wiki/raw/Unverified apps - Google Cloud Platform Console Help.md` (clipped from https://support.google.com/cloud/answer/7454865)

## Related

- [[source-google-oauth2-web-server]]
- [[source-google-cross-account-protection-risc]]
- [[component-server]]
- [[component-gui]]
- [[component-email-extension]]
- [[email-transport]]
