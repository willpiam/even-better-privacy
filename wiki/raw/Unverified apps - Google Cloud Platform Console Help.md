---
title: "Unverified apps - Google Cloud Platform Console Help"
source: "https://support.google.com/cloud/answer/7454865"
author:
published:
created: 2026-05-07
description: "An unverified app is an app or Apps Script that requests a sensitive or restricted OAuth scope, but hasn't gone through the Google verification process. Users of unverified apps or your test builds mi"
tags:
  - "clippings"
---
## Unverified apps

An unverified app is an app or Apps Script that requests a sensitive or restricted OAuth scope, but hasn't gone through the Google verification process. Users of unverified apps or your test builds might get warnings based on the OAuth scopes you're using. This is to protect users and their data from deceptive apps.

## Unverified app warnings

Unverified app warnings are shown in the following ways:

### Unverified app screen

The app or script might display an "unverified app" screen before it displays the consent screen. This is based on the specific scopes that your app includes in the request. This warning will display when:

- Your app uses sensitive or restricted scopes and you haven't configured them in your [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent) configuration page and requested verification.
- Your app uses sensitive or restricted scopes that you haven't selected on the OAuth consent screen configuration page.
- You selected sensitive or restricted scopes on the [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent) configuration page and requested verification, but the verification is not yet complete.

When the scopes requested in your app code differ from the scopes requested in your [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent) configuration page, your users see an "unverified app" screen. Make sure that scopes you request in your app are the same as what's in your OAuth consent screen.

> ![Unverified app screen on mobile](https://lh3.googleusercontent.com/YQHB9uDgEEXUFs7BMwoCckumFUpGOvKePMCbdmmRINaFjqC5-S5vgYot9uZiZQ1Qug=w426)

### Security Checkup

[Security Checkup](https://myaccount.google.com/security-checkup) might show your app as risky and unverified. When an app is “unverified,” it has not fully completed the OAuth app verification. Depending on the sensitivity of the data being requested, [verification](https://support.google.com/cloud/answer/9110914#verification-types) might require several months for the app to complete.

> ![Security Checkup on mobile for a risky app](https://lh3.googleusercontent.com/rQ1otafyPmK4Ny0pKtoP2-Q8YGlUADeOuIFf-GH8t7wqjSild4XJ1G1pBWLGoGgPzx8=w426)

### Unverified app user cap

To protect users and Google systems from abuse, apps that use OAuth and Cloud Identity have certain quota restrictions based on the risk level of the OAuth scopes an app uses.

> ![Sign in with Google temporarily disabled window](https://lh3.googleusercontent.com/29JLsM6bC3fFQbHZZ8GpZ7vYS82DmReRSfSYF4VYOkyUpLiIU6KHjvDOTCieyRv0Grk=w895)

### Upcoming Policy Enforcement Notice

Google is continuously re-evaluating the risk associated with user data access, and may upgrade the risk of certain data types and scopes to sensitive or restricted. When this happens, apps using such scopes may become unverified, but will be given a grace period to go through verification before the unverified app screen and user cap are applied to them. If your app is impacted, you will receive email notifications about the verification deadline. A warning message will be displayed on the consent screen in order to prepare your users for potential loss of functionality if your app is unverified and it is close to the deadline. If your app remains unverified, the unverified app screen will be displayed before the consent screen, and your app will be limited to 100 new users until it is verified.

> ![](https://storage.googleapis.com/support-kms-prod/t2AEOtJUWFwSbeUL1EkyVLH1xcJFh9UWZnzw)

To protect users and Google systems from abuse, apps that use OAuth and Cloud Identity have certain quota restrictions based on the risk level of the OAuth scopes an app uses.

## When to go through verification

You need to go through verification before you launch a **user-facing app**. You can continue to build and test your app while waiting to complete verification. When your app is successfully verified, the unverified app screen is removed from your client.

You don't need to go through verification for the following kinds of apps:

- **Apps in development:** if your app is experimental or a test build, you don't need to go through verification unless you decide to launch it to the public.
- **OAuth-based plugins:** if you're setting up an OAuth-based plugin for a popular platform, such as SMTP for WordPress, you don't need to go through the verification process.
- **Internal apps:** if your app is an internal web app for users in the same G Suite domain and the app is associated with a Cloud Organization that all of your users belong to, you don't need to go through verification. For more information, see [public and internal applications](https://support.google.com/cloud/answer/6158849#public-and-internal).

**Note:** If you change your client or use new scopes after verification, you might have to go through verification again.

## Verification for apps

Before you start the verification process, review the [OAuth Application Verification FAQ](https://support.google.com/cloud/answer/9110914). This will help your verification process go quickly. To start the verification process for apps, do the following steps:

1. Update the [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent) details in the Google Cloud Platform Console APIs & Services Credentials:
	- You must have a privacy policy URL.
		- Add URLs for your homepage and Terms of Service if you have them.
2. Verify your website ownership through [Search Console](https://www.google.com/webmasters/tools/home) by using an account that is a Project Owner or a Project Editor on your OAuth project.
	- The same account must be a verified owner of the property in Search Console. For more information about Search Console permissions, see [Managing owners, users, and permissions](https://support.google.com/webmasters/answer/7687615).
		- We can't approve your OAuth verification request until your site ownership verification is complete. For more information, see [Verify your site ownership](https://support.google.com/webmasters/answer/9008080).
3. To start the verification process, submit a verification request by using the following process. Note that the **Verification required** dialog is a beta feature that might not be available for all users at this time.
	1. On the GCP Console [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent), click **Submit** or **Save**.
		2. If a **Verification required** dialog displays:
		1. Add information in the text boxes for Google to verify your OAuth consent screen.
				2. When you're finished entering details, click **Submit**.

**Note:** If you add any new redirect URLs or JavaScript origins, or if you change your product name after verification, you have to go through verification again.

## Verification for Apps Script

If a new Apps Script script requests OAuth access to data that belongs to consumers or users in other domains, the "unverified app" screen might display before the OAuth consent flow. For more information about how this affects Apps Script developers and users, including instructions for verifying Apps Script OAuth clients, see the [Apps Script OAuth client verification](https://developer.google.com/apps-script/guides/client-verification) documentation.

## OAuth user quotas

The OAuth user quotas are summarized in the following table. These might be adjusted for specific apps based on the app history, developer reputation, and riskiness.

|  | Applicable apps | Quota | Appeal |
| --- | --- | --- | --- |
| New user cap | Apps that present the [unverified app screen](https://support.google.com/cloud/answer/7454865) to users | 100 new users in total, after the app presents the unverified app screen | [Request verification for your app](#verification) |

For more information, see the [OAuth Application Rate Limits](https://support.google.com/cloud/answer/9028764) page.

## App users

If you were using an app and you were redirected here from an error page, reach out to the app developer directly to make them aware of the situation. The app developer may need to take action before you and other new users can access it.