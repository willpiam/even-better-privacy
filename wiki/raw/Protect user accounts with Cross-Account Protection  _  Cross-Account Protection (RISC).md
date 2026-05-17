---
title: "Protect user accounts with Cross-Account Protection  |  Cross-Account Protection (RISC)"
source: "https://developers.google.com/identity/protocols/risc"
author:
published:
created: 2026-05-17
description: "Protect user accounts with Cross-Account Protection"
tags:
  - "clippings"
---
## Page Summary

- Cross-Account Protection helps improve the security of user accounts in your app that use Google Sign-in by sending security event notifications.
- These notifications are delivered as cryptographically signed security event tokens to an endpoint you set up.
- To use Cross-Account Protection, you need to set up a Google Cloud project, create an event receiver endpoint, and register your endpoint with Google.
- Your receiver endpoint must validate and decode the security event tokens it receives before handling the events described within the tokens.
- Cross-Account Protection supports various event types, and you should respond to them by taking appropriate security actions on the affected user's account within your app.

If your app lets users sign in to their accounts using Google, you can improve the security of these shared users' accounts by listening and responding to the security event notifications provided by the Cross-Account Protection service.

These notifications alert you of major changes to the Google Accounts of your users, which can often also have security implications for their accounts with your app. For instance, if a user's Google Account were hijacked, it could potentially lead to compromise of the user's account with your app through email account recovery or the use of single sign-on.

To help you mitigate the risk potential of such events, Google sends your service objects called security event tokens. These tokens expose very little information—just the type of security event and when it occurred, and the identifier of the affected user—but you can use them to take appropriate action in response. For example, if a user's Google Account were compromised, you could temporarily disable Sign In With Google for that user and prevent account recovery emails from being sent to the user's Gmail address.

Cross-Account Protection is based on the [RISC standard](https://openid.net/wg/sse/), developed at the OpenID Foundation.

## Overview

To use Cross-Account Protection with your app or service, you must complete the following tasks:

1. Set up your project in the API Console.
2. Create an event receiver endpoint, to which Google will send security event tokens. This endpoint is responsible for validating the tokens it receives and then responding to security events in whatever way you choose.
3. Register your endpoint with Google to start receiving security event tokens.

### Prerequisite

You only receive security event tokens for Google users who have granted your service permission to access their profile information or email addresses. You get this permission by requesting the `profile` or `email` scopes. The newer [Sign In With Google](https://developers.google.com/identity/gsi/web) or the legacy [Google Sign-in](https://developers.google.com/identity/sign-in/web/sign-in) SDKs request these scopes by default, but if you don't use the default settings, or if you access Google's [OpenID Connect endpoint](https://developers.google.com/identity/protocols/oauth2/openid-connect) directly, ensure you are requesting at least one of these scopes.

## Set up a project in the API Console

Before you can start receiving security event tokens, you must create a service account and enable the RISC API in your API Console project. You must use the same API Console project you use to access Google services, such as Google Sign-in, in your app.

To create the service account:

1. Open the [API Console Credentials page](https://console.developers.google.com/apis/credentials?project=_). When prompted, choose the API Console project you use to access Google services in your app.
2. Click **Create credentials > Service account**.
3. Create a new service account with the RISC Configuration Admin role ([`roles/riscconfigs.admin`](https://cloud.google.com/iam/docs/understanding-roles#riscconfigs.admin)) by following [these instructions](https://cloud.google.com/iam/docs/granting-roles-to-service-accounts).
4. Create a key for your newly created service account. Choose the JSON key type and then click **Create**. When the key is created, you will download a JSON file that contains your service account credentials. Keep this file somewhere safe, but also accessible to your event receiver endpoint.

While you're on your project's Credentials page, also take note of the client IDs you use for Sign In With Google or Google Sign-in (legacy). Typically, you have a client ID for each platform you support. You will need these client IDs to validate security event tokens, as described in the next section.

To enable the RISC API:

1. Open the [RISC API page](https://console.developers.google.com/apis/library/risc.googleapis.com) in the API Console. Make sure the project you use to access Google services is still selected.
2. Read the [RISC Terms](https://console.cloud.google.com/tos?id=risc) and ensure you understand the requirements.
	If you are enabling the API for a project owned by an organization, ensure you are authorized to bind your organization to the RISC Terms.
3. Click **Enable** only if you consent to the RISC Terms.

## Create an event receiver endpoint

To receive security event notifications from Google, you create an HTTPS endpoint that handles HTTPS POST requests. After you register this endpoint (see below), Google will begin posting cryptographically signed strings called security event tokens to the endpoint. Security event tokens are signed JWTs that contain information about a single security-related event.

For each security event token you receive at your endpoint, first validate and decode the token, then handle the security event as appropriate for your service. It is **essential** to validate the event token before decoding to prevent malicious attacks from bad actors. The following sections describe these tasks:

### 1\. Decode and validate the security event token

Because security event tokens are a specific kind of JWT, you can use any JWT library, such as one listed on [jwt.io](https://jwt.io/), to decode and validate them. Whichever library you use, your token validation code must do the following:

1. Get the Cross-Account Protection issuer identifier (`issuer`) and signing key certificate URI (`jwks_uri`) from Google's RISC configuration document, which you can find at `https://accounts.google.com/.well-known/risc-configuration`.
2. Using the JWT library of your choice, get the signing key ID from the header of the security event token.
3. From Google's signing key certificate document, get the public key with the key ID you got in the previous step. If the document doesn't contain a key with the ID you're looking for, it is likely the security event token is invalid, and your endpoint should return HTTP error 400.
4. Using the JWT library of your choice, verify the following:
	- The security event token is signed using the public key you got in the previous step.
		- The `aud` claim of the token is one of your apps' client IDs.
		- The `iss` claim of the token matches the issuer identifier you got from the RISC discovery document. Note that you don't need to verify the token's expiration (`exp`) because security event tokens represent historical events and as such, don't expire.

For example:

Using [java-jwt](https://github.com/auth0/java-jwt) and [jwks-rsa-java](https://github.com/auth0/jwks-rsa-java):

```
public DecodedJWT validateSecurityEventToken(String token) {
    DecodedJWT jwt = null;
    try {
        // In a real implementation, get these values from
        // https://accounts.google.com/.well-known/risc-configuration
        String issuer = "accounts.google.com";
        String jwksUri = "https://www.googleapis.com/oauth2/v3/certs";

        // Get the ID of the key used to sign the token.
        DecodedJWT unverifiedJwt = JWT.decode(token);
        String keyId = unverifiedJwt.getKeyId();

        // Get the public key from Google.
        JwkProvider googleCerts = new UrlJwkProvider(new URL(jwksUri), null, null);
        PublicKey publicKey = googleCerts.get(keyId).getPublicKey();

        // Verify and decode the token.
        Algorithm rsa = Algorithm.RSA256((RSAPublicKey) publicKey, null);
        JWTVerifier verifier = JWT.require(rsa)
                .withIssuer(issuer)
                // Get your apps' client IDs from the API console:
                // https://console.developers.google.com/apis/credentials?project=_
                .withAudience("123456789-abcedfgh.apps.googleusercontent.com",
                              "123456789-ijklmnop.apps.googleusercontent.com",
                              "123456789-qrstuvwx.apps.googleusercontent.com")
                .acceptLeeway(Long.MAX_VALUE)  // Don't check for expiration.
                .build();
        jwt = verifier.verify(token);
    } catch (JwkException e) {
        // Key not found. Return HTTP 400.
    } catch (InvalidClaimException e) {

    } catch (JWTDecodeException exception) {
        // Malformed token. Return HTTP 400.
    } catch (MalformedURLException e) {
        // Invalid JWKS URI.
    }
    return jwt;
}
```

```
import json
import jwt       # pip install pyjwt
import requests  # pip install requests

def validate_security_token(token, client_ids):
    # Get Google's RISC configuration.
    risc_config_uri = 'https://accounts.google.com/.well-known/risc-configuration'
    risc_config = requests.get(risc_config_uri).json()

    # Get the public key used to sign the token.
    google_certs = requests.get(risc_config['jwks_uri']).json()
    jwt_header = jwt.get_unverified_header(token)
    key_id = jwt_header['kid']
    public_key = None
    for key in google_certs['keys']:
        if key['kid'] == key_id:
            public_key = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(key))
    if not public_key:
        raise Exception('Public key certificate not found.')
        # In this situation, return HTTP 400

    # Decode the token, validating its signature, audience, and issuer.
    try:
        token_data = jwt.decode(token, public_key, algorithms='RS256',
                                options={'verify_exp': False},
                                audience=client_ids, issuer=risc_config['issuer'])
    except:
        raise
        # Validation failed. Return HTTP 400.
    return token_data

# Get your apps' client IDs from the API console:
# https://console.developers.google.com/apis/credentials?project=_
client_ids = ['123456789-abcedfgh.apps.googleusercontent.com',
              '123456789-ijklmnop.apps.googleusercontent.com',
              '123456789-qrstuvwx.apps.googleusercontent.com']
token_data = validate_security_token(token, client_ids)
```

If the token is valid and was successfully decoded, return HTTP status 202. Then, handle the security event indicated by the token.

### 2\. Handle security events

When decoded, a security event token looks like the following example:

```
{
  "iss": "https://accounts.google.com/",
  "aud": "123456789-abcedfgh.apps.googleusercontent.com",
  "iat": 1508184845,
  "jti": "756E69717565206964656E746966696572",
  "events": {
    "https://schemas.openid.net/secevent/risc/event-type/account-disabled": {
      "subject": {
        "subject_type": "iss-sub",
        "iss": "https://accounts.google.com/",
        "sub": "7375626A656374"
      },
      "reason": "hijacking"
    }
  }
}
```

The `iss` and `aud` claims indicate the issuer of the token (Google) and the token's intended recipient (your service). You verified these claims in the previous step.

The `jti` claim is a string that identifies a single security event, and is unique to the stream. You can use this identifier to track which security events you have received.

The `events` claim contains information about the security event the token represents. This claim is a mapping from an event type identifier to a `subject` claim, which specifies the user this event concerns, and to any additional details about the event that might be available.

The `subject` claim identifies a particular user with the user's unique Google Account ID (`sub`). This Google Account ID is the same identifier (`sub`) contained in the JWT ID tokens issued by the newer Sign In With Google ([Javascript](https://developers.google.com/identity/gsi/web/reference/js-reference#CredentialResponse), [HTML](https://developers.google.com/identity/gsi/web/reference/html-reference#id-token-handler-endpoint)) library, legacy [Google Sign-in](https://developers.google.com/identity/sign-in/web/backend-auth) library, or [OpenID Connect](https://developers.google.com/identity/protocols/oauth2/openid-connect#obtainuserinfo). When the `subject_type` of the claim is `id_token_claims`, it might also include an `email` field with the user's email address.

Use the information in the `events` claim to take appropriate action for the event type on the specified user's account.

### OAuth token identifiers

For OAuth events about individual tokens, the [token subject](https://openid.net/specs/oauth-event-types-1_0-01.html#subject-identifier-token) identifier type contains the following fields:

- `token_type`: Only `refresh_token` is supported.
- `token_identifier_alg`: See table below for possible values.
- `token`: See table below.

| **token\_identifier\_alg** | **token** |
| --- | --- |
| `prefix` | The first 16 characters of the token. |
| `hash_base64_sha512_sha512` | The double hash of the token using SHA-512. |

If you integrate with these events, it is suggested to index your tokens based on these possible values to ensure a quick match when the event is received.

### Supported event types

Cross-Account Protection supports the following types of security events:

| **Event Type** | **Attributes** | **How to Respond** |
| --- | --- | --- |
| `https://schemas.openid.net/secevent/risc/event-type/sessions-revoked` |  | **Required**: Re-secure the user's account by ending their currently open sessions. |
| `https://schemas.openid.net/secevent/oauth/event-type/tokens-revoked` |  | **Required**: If the token is for Google Sign-in, terminate their currently open sessions. Additionally, you may want to suggest to the user to set up an alternate sign-in method.  **Suggested**: If the token is for access to other Google APIs, delete any of the user's OAuth tokens you have stored. |
| `https://schemas.openid.net/secevent/oauth/event-type/token-revoked` | See [OAuth token identifiers](#token_identifiers) section for token identifiers | **Required**: If you store the corresponding refresh token, delete it and request the user to re-consent next time an access token is needed. |
| `https://schemas.openid.net/secevent/risc/event-type/account-disabled` | `reason=hijacking`,   `reason=bulk-account` | **Required**: If the reason the account was disabled was `hijacking`, re-secure the user's account by ending their currently open sessions.  **Suggested**: If the reason the account was disabled was `bulk-account`, analyze the user's activity on your service and determine appropriate follow-up actions.  **Suggested**: If no reason was provided, disable Google Sign-in for the user and disable account recovery using the email address associated with the user's Google Account (usually, but not necessarily, a Gmail account). Offer the user an alternate sign-in method. |
| `https://schemas.openid.net/secevent/risc/event-type/account-enabled` |  | **Suggested**: Re-enable Google Sign-in for the user and re-enable account recovery with the user's Google Account email address. |
| `https://schemas.openid.net/secevent/risc/event-type/account-credential-change-required` |  | **Suggested**: Look out for suspicious activity on your service and take appropriate action. |
| `https://schemas.openid.net/secevent/risc/event-type/verification` | state= state | **Suggested**: Log that a test token was received. |

### Duplicated and missed events

Cross-Account Protection will attempt to redeliver events that it believes have not been delivered. Therefore, you may sometimes receive the same event multiple times. If this could cause repeated actions that inconvenience your users, consider using the `jti` claim (which is a unique identifier for an event) to de-dup the events. There are external tools like [Google Cloud Dataflow](https://cloud.google.com/dataflow/) that may help you to execute the de-dup dataflow.

Note that events are delivered with limited retries so if your receiver is down for an extended period of time you may permanently miss some events.

## Register your receiver

To begin receiving security events, register your receiver endpoint using the RISC API. Calls to the RISC API must be accompanied by an authorization token.

You will receive security events only for the users of your app, so you need to have an OAuth consent screen [configured](https://support.google.com/cloud/answer/6158849) in your GCP project as a prerequisite for the steps described below.

### 1\. Generate an authorization token

To generate an authorization token for the RISC API, create a JWT with the following claims:

```
{
  "iss": SERVICE_ACCOUNT_EMAIL,
  "sub": SERVICE_ACCOUNT_EMAIL,
  "aud": "https://risc.googleapis.com/google.identity.risc.v1beta.RiscManagementService",
  "iat": CURRENT_TIME,
  "exp": CURRENT_TIME + 3600
}
```

Sign the JWT using your service account's private key, which you can find in the JSON file you downloaded when you created the service account key.

For example:

Using [java-jwt](https://github.com/auth0/java-jwt) and [Google's auth library](https://github.com/googleapis/google-auth-library-java):

```
public static String makeBearerToken() {
    String token = null;
    try {
        // Get signing key and client email address.
        FileInputStream is = new FileInputStream("your-service-account-credentials.json");
        ServiceAccountCredentials credentials =
               (ServiceAccountCredentials) GoogleCredentials.fromStream(is);
        PrivateKey privateKey = credentials.getPrivateKey();
        String keyId = credentials.getPrivateKeyId();
        String clientEmail = credentials.getClientEmail();

        // Token must expire in exactly one hour.
        Date issuedAt = new Date();
        Date expiresAt = new Date(issuedAt.getTime() + 3600000);

        // Create signed token.
        Algorithm rsaKey = Algorithm.RSA256(null, (RSAPrivateKey) privateKey);
        token = JWT.create()
                .withIssuer(clientEmail)
                .withSubject(clientEmail)
                .withAudience("https://risc.googleapis.com/google.identity.risc.v1beta.RiscManagementService")
                .withIssuedAt(issuedAt)
                .withExpiresAt(expiresAt)
                .withKeyId(keyId)
                .sign(rsaKey);
    } catch (ClassCastException e) {
        // Credentials file doesn't contain a service account key.
    } catch (IOException e) {
        // Credentials file couldn't be loaded.
    }
    return token;
}
```

```
import json
import time

import jwt  # pip install pyjwt

def make_bearer_token(credentials_file):
    with open(credentials_file) as service_json:
        service_account = json.load(service_json)
        issuer = service_account['client_email']
        subject = service_account['client_email']
        private_key_id = service_account['private_key_id']
        private_key = service_account['private_key']
    issued_at = int(time.time())
    expires_at = issued_at + 3600
    payload = {'iss': issuer,
               'sub': subject,
               'aud': 'https://risc.googleapis.com/google.identity.risc.v1beta.RiscManagementService',
               'iat': issued_at,
               'exp': expires_at}
    encoded = jwt.encode(payload, private_key, algorithm='RS256',
                         headers={'kid': private_key_id})
    return encoded

auth_token = make_bearer_token('your-service-account-credentials.json')
```

This authorization token can be used to make RISC API calls for one hour. When the token expires, generate a new one to continue to make RISC API calls.

### 2\. Call the RISC stream configuration API

Now that you have an authorization token, you can use the RISC API to configure your project's security event stream, including registering your receiver endpoint.

To do so, make an HTTPS POST request to `https://risc.googleapis.com/v1beta/stream:update`, specifying your receiver endpoint and the [types of security events](#supported_event_types) you're interested in:

```
POST /v1beta/stream:update HTTP/1.1
Host: risc.googleapis.com
Authorization: Bearer AUTH_TOKEN

{
  "delivery": {
    "delivery_method":
      "https://schemas.openid.net/secevent/risc/delivery-method/push",
    "url": RECEIVER_ENDPOINT
  },
  "events_requested": [
    SECURITY_EVENT_TYPES
  ]
}
```

For example:

```
public static void configureEventStream(final String receiverEndpoint,
                                        final List<String> eventsRequested,
                                        String authToken) throws IOException {
    ObjectMapper jsonMapper = new ObjectMapper();
    String streamConfig = jsonMapper.writeValueAsString(new Object() {
        public Object delivery = new Object() {
            public String delivery_method =
                    "https://schemas.openid.net/secevent/risc/delivery-method/push";
            public String url = receiverEndpoint;
        };
        public List<String> events_requested = eventsRequested;
    });

    HttpPost updateRequest = new HttpPost("https://risc.googleapis.com/v1beta/stream:update");
    updateRequest.addHeader("Content-Type", "application/json");
    updateRequest.addHeader("Authorization", "Bearer " + authToken);
    updateRequest.setEntity(new StringEntity(streamConfig));

    HttpResponse updateResponse = new DefaultHttpClient().execute(updateRequest);
    Header[] responseContentTypeHeaders = updateResponse.getHeaders("Content-Type");
    StatusLine responseStatus = updateResponse.getStatusLine();
    int statusCode = responseStatus.getStatusCode();
    HttpEntity entity = updateResponse.getEntity();
    // Now handle response
}

// ...

configureEventStream(
        "https://your-service.example.com/security-event-receiver",
        Arrays.asList(
                "https://schemas.openid.net/secevent/risc/event-type/account-credential-change-required",
                "https://schemas.openid.net/secevent/risc/event-type/account-disabled"),
        authToken);
```

```
import requests

def configure_event_stream(auth_token, receiver_endpoint, events_requested):
    stream_update_endpoint = 'https://risc.googleapis.com/v1beta/stream:update'
    headers = {'Authorization': 'Bearer {}'.format(auth_token)}
    stream_cfg = {'delivery': {'delivery_method': 'https://schemas.openid.net/secevent/risc/delivery-method/push',
                               'url': receiver_endpoint},
                  'events_requested': events_requested}
    response = requests.post(stream_update_endpoint, json=stream_cfg, headers=headers)
    response.raise_for_status()  # Raise exception for unsuccessful requests

configure_event_stream(auth_token, 'https://your-service.example.com/security-event-receiver',
                       ['https://schemas.openid.net/secevent/risc/event-type/account-credential-change-required',
                        'https://schemas.openid.net/secevent/risc/event-type/account-disabled'])
```

If the request returns HTTP 200, the event stream was successfully configured and your receiver endpoint should start receiving security event tokens. The next section describes how you can test your stream configuration and endpoint to verify everything is working correctly together.

#### Get and update your current stream configuration

If, in the future, you ever want to modify your stream configuration, you can do so by making an authorized GET request to `https://risc.googleapis.com/v1beta/stream` to get the current stream configuration, modifying the response body, and then POSTing the modified configuration back to `https://risc.googleapis.com/v1beta/stream:update` as described above.

#### Stop and resume the event stream

If you ever need to stop the event stream from Google, make an authorized POST request to `https://risc.googleapis.com/v1beta/stream/status:update` with `{ "status": "disabled" }` in the request body. While the stream is deactivated, Google doesn't send events to your endpoint and doesn't buffer security events when they occur. To reenable the event stream, POST `{ "status": "enabled" }` to the same endpoint.

### 3\. Optional: Test your stream configuration

You can verify that your stream configuration and receiver endpoint are working together correctly by sending a verification token through your event stream. This token can contain a unique string that you can use use to verify that the token was received at your endpoint. To use this flow, make sure to subscribe to https://schemas.openid.net/secevent/risc/event-type/verification event type when [registering your receiver](#register_receiver).

To request a verification token, make an authorized HTTPS POST request to `https://risc.googleapis.com/v1beta/stream:verify`. In the body of the request, specify some identifying string:

```
{
  "state": "ANYTHING"
}
```

For example:

```
public static void testEventStream(final String stateString,
                                   String authToken) throws IOException {
    ObjectMapper jsonMapper = new ObjectMapper();
    String json = jsonMapper.writeValueAsString(new Object() {
        public String state = stateString;
    });

    HttpPost updateRequest = new HttpPost("https://risc.googleapis.com/v1beta/stream:verify");
    updateRequest.addHeader("Content-Type", "application/json");
    updateRequest.addHeader("Authorization", "Bearer " + authToken);
    updateRequest.setEntity(new StringEntity(json));

    HttpResponse updateResponse = new DefaultHttpClient().execute(updateRequest);
    Header[] responseContentTypeHeaders = updateResponse.getHeaders("Content-Type");
    StatusLine responseStatus = updateResponse.getStatusLine();
    int statusCode = responseStatus.getStatusCode();
    HttpEntity entity = updateResponse.getEntity();
    // Now handle response
}

// ...

testEventStream("Test token requested at " + new Date().toString(), authToken);
```

```
import requests
import time

def test_event_stream(auth_token, nonce):
    stream_verify_endpoint = 'https://risc.googleapis.com/v1beta/stream:verify'
    headers = {'Authorization': 'Bearer {}'.format(auth_token)}
    state = {'state': nonce}
    response = requests.post(stream_verify_endpoint, json=state, headers=headers)
    response.raise_for_status()  # Raise exception for unsuccessful requests

test_event_stream(auth_token, 'Test token requested at {}'.format(time.ctime()))
```

If the request succeeds, the verification token will be sent to the endpoint you registered. Then, for example, if your endpoint handles verification tokens by simply logging them, you can examine your logs to confirm the token was received.

### Error code reference

The following errors can be returned by the RISC API:

| **Error Code** | **Error Message** | **Suggested Actions** |
| --- | --- | --- |
| **400** | Stream configuration must contain $fieldname field. | Your request to the https://risc.googleapis.com/v1beta/stream:update endpoint is invalid or cannot be parsed. Please include $fieldname in your request. |
| **401** | Unauthorized. | Authorization failed. Be sure you attached an [authorization token](#auth_token) with the request and that the token is valid and hasn't expired. |
| **403** | The delivery endpoint must be an HTTPS URL. | Your delivery endpoint (i.e. the endpoint you expect RISC events to be delivered to) must be HTTPS. We do not send RISC events to HTTP URLs. |
| **403** | Existing stream configuration does not have spec-compliant delivery method for RISC. | Your Google Cloud project must already have a RISC configuration. If you are using Firebase and have Google Sign-In enabled, then Firebase will be managing RISC for your project; you will not be able to create a custom configuration. If you are not using Google Sign-In for your Firebase project, please disable it, and then try to update again after an hour. |
| **403** | Project could not be found. | Make sure you are using the correct service account for the correct project. You may be using a service account associated with a deleted project. Learn [how to see all service accounts associated with a project](https://cloud.google.com/iam/docs/service-accounts-list-edit#listing_service_accounts). |
| **403** | Service account needs permission to access your RISC configuration | Go to your project's API Console and assign the "RISC Configuration Admin" role ([`roles/riscconfigs.admin`](https://cloud.google.com/iam/docs/understanding-roles#riscconfigs.admin)) to the service account that is making the calls to your project by following [these instructions](https://cloud.google.com/iam/docs/granting-roles-to-service-accounts). |
| **403** | Stream management APIs should only be called by a service account. | Here's more information on [how you can call Google APIs with a service account](https://developers.google.com/identity/protocols/oauth2/service-account). |
| **403** | The delivery endpoint does not belong to any of your project's domains. | Every project has a set of [authorized domains.](https://support.google.com/cloud/answer/6158849#authorized-domains) If your delivery endpoint (i.e. the endpoint you expect RISC events to be delivered to) is not hosted on one of them, we require that you add the endpoint's domain to that set. |
| **403** | To use this API your project must have at least one OAuth client configured. | RISC only works if you build an app that supports [Google Sign In](https://developers.google.com/identity). This connection requires an OAuth client. If your project has no OAuth clients, it's likely that RISC will not be useful for you. Learn more about [Google's use of OAuth for our APIs](https://developers.google.com/identity/protocols/oauth2). |
| **403** | Unsupported status.  Invalid status. | We only support the stream statuses “ `enabled` ” and “ `disabled` ” at this time. |
| **404** | Project has no RISC configuration.  Project has no existing RISC configuration, cannot update status. | Call the https://risc.googleapis.com/v1beta/stream:update endpoint to create a new stream configuration. |
| **4XX/5XX** | Unable to update status. | Check the detailed error message for more information. |

### Access token scopes

Should you decide to use access tokens for authenticating to the RISC API, these are the scopes your application must request:

| **Endpoint** | **Scope** |
| --- | --- |
| `https://risc.googleapis.com/v1beta/stream/status` | `https://www.googleapis.com/auth/risc.status.readonly` OR `https://www.googleapis.com/auth/risc.status.readwrite` |
| `https://risc.googleapis.com/v1beta/stream/status:update` | `https://www.googleapis.com/auth/risc.status.readwrite` |
| `https://risc.googleapis.com/v1beta/stream` | `https://www.googleapis.com/auth/risc.configuration.readonly` OR `https://www.googleapis.com/auth/risc.configuration.readwrite` |
| `https://risc.googleapis.com/v1beta/stream:update` | `https://www.googleapis.com/auth/risc.configuration.readwrite` |
| `https://risc.googleapis.com/v1beta/stream:verify` | `https://www.googleapis.com/auth/risc.verify` |

## Need Help?

First, check out our [error code reference](#error_codes) section. If you still have questions, post them on Stack Overflow with the [#SecEvents](https://stackoverflow.com/questions/tagged/SecEvents) tag.