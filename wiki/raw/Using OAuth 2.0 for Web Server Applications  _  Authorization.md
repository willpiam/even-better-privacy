---
title: "Using OAuth 2.0 for Web Server Applications  |  Authorization"
source: "https://developers.google.com/identity/protocols/oauth2/web-server#incrementalAuth"
author:
published:
created: 2026-05-17
description:
tags:
  - "clippings"
---
## Page Summary

- Web server applications can use Google API Client Libraries or Google OAuth 2.0 endpoints for OAuth 2.0 authorization to access Google APIs.
- This OAuth 2.0 flow is designed for applications that can securely store confidential information and maintain state.
- Obtaining OAuth 2.0 access tokens involves setting parameters, redirecting the user to Google's server for consent, handling the response with an authorization code, and exchanging the code for access and refresh tokens.
- After obtaining an access token, it should be included in API requests, preferably as an `Authorization: Bearer` HTTP header.
- Key concepts include scopes, access tokens, refresh tokens, redirect URIs, incremental authorization, token revocation, time-based access, and cross-account protection.

This document explains how web server applications use Google API Client Libraries or Google OAuth 2.0 endpoints to implement OAuth 2.0 authorization to access Google APIs.

OAuth 2.0 allows users to share specific data with an application while keeping their usernames, passwords, and other information private. For example, an application can use OAuth 2.0 to obtain permission from users to store files in their Google Drives.

This OAuth 2.0 flow is specifically for user authorization. It is designed for applications that can store confidential information and maintain state. A properly authorized web server application can access an API while the user interacts with the application or after the user has left the application.

Web server applications frequently also use [service accounts](https://developers.google.com/identity/protocols/oauth2/service-account) to authorize API requests, particularly when calling Cloud APIs to access project-based data rather than user-specific data. Web server applications can use service accounts in conjunction with user authorization.

## Client libraries

The language-specific examples on this page use [Google API Client Libraries](https://developers.google.com/api-client-library) to implement OAuth 2.0 authorization. To run the code samples, you must first install the client library for your language.

When you use a Google API Client Library to handle your application's OAuth 2.0 flow, the client library performs many actions that the application would otherwise need to handle on its own. For example, it determines when the application can use or refresh stored access tokens as well as when the application must reacquire consent. The client library also generates correct redirect URLs and helps to implement redirect handlers that exchange authorization codes for access tokens.

Google API Client Libraries for server-side applications are available for the following languages:

- [Go](https://github.com/googleapis/google-api-go-client)
- [Java](https://github.com/googleapis/google-auth-library-java)
- [.NET](https://developers.google.com/api-client-library/dotnet)
- [Node.js](https://github.com/googleapis/google-api-nodejs-client)
- [Dart](https://dart.dev/googleapis/)
- [PHP](https://github.com/googleapis/google-api-php-client)
- [Python](https://github.com/googleapis/google-api-python-client)
- [Ruby](https://github.com/googleapis/google-api-ruby-client)

## Prerequisites

### Enable APIs for your project

Any application that calls Google APIs needs to enable those APIs in the API Console.

To enable an API for your project:

1. [Open the API Library](https://console.developers.google.com/apis/library) in the Google API Console.
2. If prompted, select a project, or create a new one.
3. The API Library lists all available APIs, grouped by product family and popularity. If the API you want to enable isn't visible in the list, use search to find it, or click **View All** in the product family it belongs to.
4. Select the API you want to enable, then click the **Enable** button.
5. If prompted, enable billing.
6. If prompted, read and accept the API's Terms of Service.

### Create authorization credentials

Any application that uses OAuth 2.0 to access Google APIs must have authorization credentials that identify the application to Google's OAuth 2.0 server. The following steps explain how to create credentials for your project. Your applications can then use the credentials to access APIs that you have enabled for that project.

1. Go to the [Clients page](https://console.developers.google.com/auth/clients).
2. Click **Create Client**.
3. Select the **Web application** application type.
4. Fill in the form and click **Create**. Applications that use languages and frameworks like PHP, Java, Python, Ruby, and.NET must specify authorized **redirect URIs**. The redirect URIs are the endpoints to which the OAuth 2.0 server can send responses. These endpoints must adhere to [Google’s validation rules](#uri-validation).
	For testing, you can specify URIs that refer to the local machine, such as `http://localhost:8080`. With that in mind, please note that all of the examples in this document use `http://localhost:8080` as the redirect URI.
	We recommend that you [design your app's auth endpoints](#protectauthcode) so that your application does not expose authorization codes to other resources on the page.

After creating your credentials, download the **client\_secret.json** file from the API Console. Securely store the file in a location that only your application can access.

### Identify access scopes

Scopes enable your application to only request access to the resources that it needs while also enabling users to control the amount of access that they grant to your application. Thus, there may be an inverse relationship between the number of scopes requested and the likelihood of obtaining user consent.

Before you start implementing OAuth 2.0 authorization, we recommend that you identify the scopes that your app will need permission to access.

We also recommend that your application request access to authorization scopes via an [incremental authorization](#incrementalAuth) process, in which your application requests access to user data in context. This best practice helps users to more easily understand why your application needs the access it is requesting.

The [OAuth 2.0 API Scopes](https://developers.google.com/identity/protocols/oauth2/scopes) document contains a full list of scopes that you might use to access Google APIs.

### Language-specific requirements

To run any of the code samples in this document, you'll need a Google account, access to the Internet, and a web browser. If you are using one of the API client libraries, also see the language-specific requirements below.

To run the PHP code samples in this document, you'll need:

- PHP 8.0 or greater with the command-line interface (CLI) and JSON extension installed.
- The [Composer](https://getcomposer.org/) dependency management tool.
- The Google APIs Client Library for PHP:
	```
	composer require google/apiclient:^2.15.0
	```

See [Google APIs Client Library for PHP](https://github.com/googleapis/google-api-php-client) for more information.

To run the Python code samples in this document, you'll need:

- Python 3.7 or greater
- The [pip](https://pypi.org/project/pip/) package management tool.
- The Google APIs Client Library for Python 2.0 release:
	```
	pip install --upgrade google-api-python-client
	```
- The `google-auth`, `google-auth-oauthlib`, and `google-auth-httplib2` for user authorization.
	```
	pip install --upgrade google-auth google-auth-oauthlib google-auth-httplib2
	```
- The Flask Python web application framework.
	```
	pip install --upgrade flask
	```
- The `requests` HTTP library.
	```
	pip install --upgrade requests
	```

Review the Google API Python client library [release note](https://github.com/googleapis/google-api-python-client?tab=readme-ov-file#version-20-release) if you aren't able to upgrade python and associated migration guide.

To run the Ruby code samples in this document, you'll need:

- Ruby 2.6 or greater
- The Google Auth Library for Ruby:
	```
	gem install googleauth
	```
- The client libraries for Drive and Calendar Google APIs:
	```
	gem install google-apis-drive_v3 google-apis-calendar_v3
	```
- The Sinatra Ruby web application framework.
	```
	gem install sinatra
	```

To run the Node.js code samples in this document, you'll need:

- The maintenance LTS, active LTS, or current release of Node.js.
- The Google APIs Node.js Client:
	```
	npm install googleapis crypto express express-session
	```

You do not need to install any libraries to be able to directly call the OAuth 2.0 endpoints.

## Obtaining OAuth 2.0 access tokens

The following steps show how your application interacts with Google's OAuth 2.0 server to obtain a user's consent to perform an API request on the user's behalf. Your application must have that consent before it can execute a Google API request that requires user authorization.

The list below quickly summarizes these steps:

1. Your application identifies the permissions it needs.
2. Your application redirects the user to Google along with the list of requested permissions.
3. The user decides whether to grant the permissions to your application.
4. Your application finds out what the user decided.
5. If the user granted the requested permissions, your application retrieves tokens needed to make API requests on the user's behalf.

### Step 1: Set authorization parameters

Your first step is to create the authorization request. That request sets parameters that identify your application and define the permissions that the user will be asked to grant to your application.

- If you use a Google client library for OAuth 2.0 authentication and authorization, you create and configure an object that defines these parameters.
- If you call the Google OAuth 2.0 endpoint directly, you'll generate a URL and set the parameters on that URL.

The tabs below define the supported authorization parameters for web server applications. The language-specific examples also show how to use a client library or authorization library to configure an object that sets those parameters.

The following code snippet creates a `Google\Client()` object, which defines the parameters in the authorization request.

That object uses information from your **client\_secret.json** file to identify your application. (See [creating authorization credentials](#creatingcred) for more about that file.) The object also identifies the scopes that your application is requesting permission to access and the URL to your application's auth endpoint, which will handle the response from Google's OAuth 2.0 server. Finally, the code sets the optional `access_type` and `include_granted_scopes` parameters.

For example, this code requests read-only, offline access to a user's Google Drive metadata and Calendar events:

```
use Google\Client;

$client = new Client();

// Required, call the setAuthConfig function to load authorization credentials from
// client_secret.json file.
$client->setAuthConfig('client_secret.json');

// Required, to set the scope value, call the addScope function
$client->addScope([Google\Service\Drive::DRIVE_METADATA_READONLY, Google\Service\Calendar::CALENDAR_READONLY]);

// Required, call the setRedirectUri function to specify a valid redirect URI for the
// provided client_id
$client->setRedirectUri('http://' . $_SERVER['HTTP_HOST'] . '/oauth2callback.php');

// Recommended, offline access will give you both an access and refresh token so that
// your app can refresh the access token without user interaction.
$client->setAccessType('offline');

// Recommended, call the setState function. Using a state value can increase your assurance that
// an incoming connection is the result of an authentication request.
$client->setState($sample_passthrough_value);

// Optional, if your application knows which user is trying to authenticate, it can use this
// parameter to provide a hint to the Google Authentication Server.
$client->setLoginHint('hint@example.com');

// Optional, call the setPrompt function to set "consent" will prompt the user for consent
$client->setPrompt('consent');

// Optional, call the setIncludeGrantedScopes function with true to enable incremental
// authorization
$client->setIncludeGrantedScopes(true);
```

The following code snippet uses the `google-auth-oauthlib.flow` module to construct the authorization request.

The code constructs a `Flow` object, which identifies your application using information from the **client\_secret.json** file that you downloaded after [creating authorization credentials](#creatingcred). That object also identifies the scopes that your application is requesting permission to access and the URL to your application's auth endpoint, which will handle the response from Google's OAuth 2.0 server. Finally, the code sets the optional `access_type` and `include_granted_scopes` parameters.

For example, this code requests read-only, offline access to a user's Google Drive metadata and Calendar events:

```
import google.oauth2.credentials
import google_auth_oauthlib.flow

# Required, call the from_client_secrets_file method to retrieve the client ID from a
# client_secret.json file. The client ID (from that file) and access scopes are required. (You can
# also use the from_client_config method, which passes the client configuration as it originally
# appeared in a client secrets file but doesn't access the file itself.)
flow = google_auth_oauthlib.flow.Flow.from_client_secrets_file('client_secret.json',
    scopes=['https://www.googleapis.com/auth/drive.metadata.readonly',
            'https://www.googleapis.com/auth/calendar.readonly'])

# Required, indicate where the API server will redirect the user after the user completes
# the authorization flow. The redirect URI is required. The value must exactly
# match one of the authorized redirect URIs for the OAuth 2.0 client, which you
# configured in the API Console. If this value doesn't match an authorized URI,
# you will get a 'redirect_uri_mismatch' error.
flow.redirect_uri = 'https://www.example.com/oauth2callback'

# Generate URL for request to Google's OAuth 2.0 server.
# Use kwargs to set optional request parameters.
authorization_url, state = flow.authorization_url(
    # Recommended, enable offline access so that you can refresh an access token without
    # re-prompting the user for permission. Recommended for web server apps.
    access_type='offline',
    # Optional, enable incremental authorization. Recommended as a best practice.
    include_granted_scopes='true',
    # Optional, if your application knows which user is trying to authenticate, it can use this
    # parameter to provide a hint to the Google Authentication Server.
    login_hint='hint@example.com',
    # Optional, set prompt to 'consent' will prompt the user for consent
    prompt='consent')
```

Use the client\_secrets.json file that you created to configure a client object in your application. When you configure a client object, you specify the scopes your application needs to access, along with the URL to your application's auth endpoint, which will handle the response from the OAuth 2.0 server.

For example, this code requests read-only, offline access to a user's Google Drive metadata and Calendar events:

```
require 'googleauth'
require 'googleauth/web_user_authorizer'
require 'googleauth/stores/redis_token_store'

require 'google/apis/drive_v3'
require 'google/apis/calendar_v3'

# Required, call the from_file method to retrieve the client ID from a
# client_secret.json file.
client_id = Google::Auth::ClientId.from_file('/path/to/client_secret.json')

# Required, scope value 
# Access scopes for two non-Sign-In scopes: Read-only Drive activity and Google Calendar.
scope = ['Google::Apis::DriveV3::AUTH_DRIVE_METADATA_READONLY',
         'Google::Apis::CalendarV3::AUTH_CALENDAR_READONLY']

# Required, Authorizers require a storage instance to manage long term persistence of
# access and refresh tokens.
token_store = Google::Auth::Stores::RedisTokenStore.new(redis: Redis.new)

# Required, indicate where the API server will redirect the user after the user completes
# the authorization flow. The redirect URI is required. The value must exactly
# match one of the authorized redirect URIs for the OAuth 2.0 client, which you
# configured in the API Console. If this value doesn't match an authorized URI,
# you will get a 'redirect_uri_mismatch' error.
callback_uri = '/oauth2callback'

# To use OAuth2 authentication, we need access to a CLIENT_ID, CLIENT_SECRET, AND REDIRECT_URI
# from the client_secret.json file. To get these credentials for your application, visit
# https://console.cloud.google.com/apis/credentials.
authorizer = Google::Auth::WebUserAuthorizer.new(client_id, scope,
                                                token_store, callback_uri)
```

Your application uses the client object to perform OAuth 2.0 operations, such as generating authorization request URLs and applying access tokens to HTTP requests.

The following code snippet creates a `google.auth.OAuth2` object, which defines the parameters in the authorization request.

That object uses information from your client\_secret.json file to identify your application. To ask for permissions from a user to retrieve an access token, you redirect them to a consent page. To create a consent page URL:

```
const {google} = require('googleapis');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');

/**
 * To use OAuth2 authentication, we need access to a CLIENT_ID, CLIENT_SECRET, AND REDIRECT_URI
 * from the client_secret.json file. To get these credentials for your application, visit
 * https://console.cloud.google.com/apis/credentials.
 */
const oauth2Client = new google.auth.OAuth2(
  YOUR_CLIENT_ID,
  YOUR_CLIENT_SECRET,
  YOUR_REDIRECT_URL
);

// Access scopes for two non-Sign-In scopes: Read-only Drive activity and Google Calendar.
const scopes = [
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/calendar.readonly'
];

// Generate a secure random state value.
const state = crypto.randomBytes(32).toString('hex');

// Store state in the session
req.session.state = state;

// Generate a url that asks permissions for the Drive activity and Google Calendar scope
const authorizationUrl = oauth2Client.generateAuthUrl({
  // 'online' (default) or 'offline' (gets refresh_token)
  access_type: 'offline',
  /** Pass in the scopes array defined above.
    * Alternatively, if only one scope is needed, you can pass a scope URL as a string */
  scope: scopes,
  // Enable incremental authorization. Recommended as a best practice.
  include_granted_scopes: true,
  // Include the state parameter to reduce the risk of CSRF attacks.
  state: state
});
```

**Important Note** - The `refresh_token` is only returned on the first authorization. More details [here](https://github.com/googleapis/google-api-nodejs-client/issues/750#issuecomment-304521450).

Google's OAuth 2.0 endpoint is at `https://accounts.google.com/o/oauth2/v2/auth`. This endpoint is accessible only over HTTPS. Plain HTTP connections are refused.

The Google authorization server supports the following query string parameters for web server applications:

<table><thead><tr><th colspan="2">Parameters</th></tr></thead><tbody><tr><td><code>client_id</code></td><td><strong>Required</strong><p>The client ID for your application. You can find this value in the Cloud Console <a href="https://console.developers.google.com/auth/clients">Clients page</a>.</p></td></tr><tr><td><code>redirect_uri</code></td><td><strong>Required</strong><p>Determines where the API server redirects the user after the user completes the authorization flow. The value must exactly match one of the authorized redirect URIs for the OAuth 2.0 client, which you configured in your client's Cloud Console <a href="https://console.developers.google.com/auth/clients">Clients page</a>. If this value doesn't match an authorized redirect URI for the provided <code>client_id</code> you will get a <code>redirect_uri_mismatch</code> error.</p><p>Note that the <code>http</code> or <code>https</code> scheme, case, and trailing slash (' <code>/</code> ') must all match.</p></td></tr><tr><td><code>response_type</code></td><td><strong>Required</strong><p>Determines whether the Google OAuth 2.0 endpoint returns an authorization code.</p><p>Set the parameter value to <code>code</code> for web server applications.</p></td></tr><tr><td><code>scope</code></td><td><strong>Required</strong><p>A space-delimited list of scopes that identify the resources that your application could access on the user's behalf. These values inform the consent screen that Google displays to the user.</p><p>Scopes enable your application to only request access to the resources that it needs while also enabling users to control the amount of access that they grant to your application. Thus, there is an inverse relationship between the number of scopes requested and the likelihood of obtaining user consent.</p><p>We recommend that your application request access to authorization scopes in context whenever possible. By requesting access to user data in context, using <a href="#incrementalAuth">incremental authorization</a>, you help users to understand why your application needs the access it is requesting.</p></td></tr><tr><td><code>access_type</code></td><td><strong>Recommended</strong><p>Indicates whether your application can refresh access tokens when the user is not present at the browser. Valid parameter values are <code>online</code>, which is the default value, and <code>offline</code>.</p><p>Set the value to <code>offline</code> if your application needs to refresh access tokens when the user is not present at the browser. This is the method of refreshing access tokens described later in this document. This value instructs the Google authorization server to return a refresh token <em>and</em> an access token the first time that your application exchanges an authorization code for tokens.</p></td></tr><tr><td><code>state</code></td><td><strong>Recommended</strong><p>Specifies any string value that your application uses to maintain state between your authorization request and the authorization server's response. The server returns the exact value that you send as a <code>name=value</code> pair in the URL query component (<code>?</code>) of the <code>redirect_uri</code> after the user consents to or denies your application's access request.</p><p>You can use this parameter for several purposes, such as directing the user to the correct resource in your application, sending nonces, and mitigating cross-site request forgery. Since your <code>redirect_uri</code> can be guessed, using a <code>state</code> value can increase your assurance that an incoming connection is the result of an authentication request. If you generate a random string or encode the hash of a cookie or another value that captures the client's state, you can validate the response to additionally ensure that the request and response originated in the same browser, providing protection against attacks such as <a href="https://datatracker.ietf.org/doc/html/rfc6749#section-10.12">cross-site request forgery</a>. See the <a href="https://developers.google.com/identity/protocols/oauth2/openid-connect#createxsrftoken">OpenID Connect</a> documentation for an example of how to create and confirm a <code>state</code> token.</p></td></tr><tr><td><code>include_granted_scopes</code></td><td><strong>Optional</strong><p>Enables applications to use incremental authorization to request access to additional scopes in context. If you set this parameter's value to <code>true</code> and the authorization request is granted, then the new access token will also cover any scopes to which the user previously granted the application access. See the <a href="#incrementalAuth">incremental authorization</a> section for examples.</p></td></tr><tr><td><code>login_hint</code></td><td><strong>Optional</strong><p>If your application knows which user is trying to authenticate, it can use this parameter to provide a hint to the Google Authentication Server. The server uses the hint to simplify the login flow either by prefilling the email field in the sign-in form or by selecting the appropriate multi-login session.</p><p>Set the parameter value to an email address or <code>sub</code> identifier, which is equivalent to the user's Google ID.</p></td></tr><tr><td><code>prompt</code></td><td><strong>Optional</strong><p>A space-delimited, case-sensitive list of prompts to present the user. If you don't specify this parameter, the user will be prompted only the first time your project requests access. See <a href="https://developers.google.com/identity/protocols/oauth2/openid-connect#re-consent">Prompting re-consent</a> for more information.</p><p>Possible values are:</p><div><table><tbody><tr><td><code>none</code></td><td>Don't display any authentication or consent screens. Must not be specified with other values.</td></tr><tr><td><code>consent</code></td><td>Prompt the user for consent.</td></tr><tr><td><code>select_account</code></td><td>Prompt the user to select an account.</td></tr></tbody></table></div></td></tr></tbody></table>

### Step 2: Redirect to Google's OAuth 2.0 server

Redirect the user to Google's OAuth 2.0 server to initiate the authentication and authorization process. Typically, this occurs when your application first needs to access the user's data. In the case of [incremental authorization](#incrementalAuth), this step also occurs when your application first needs to access additional resources that it does not yet have permission to access.

1. Generate a URL to request access from Google's OAuth 2.0 server:
	```
	$auth_url = $client->createAuthUrl();
	```
2. Redirect the user to `$auth_url`:
	```
	header('Location: ' . filter_var($auth_url, FILTER_SANITIZE_URL));
	```

This example shows how to redirect the user to the authorization URL using the Flask web application framework:

```
return flask.redirect(authorization_url)
```

1. Generate a URL to request access from Google's OAuth 2.0 server:
	```
	auth_uri = authorizer.get_authorization_url(request: request)
	```
2. Redirect the user to `auth_uri`.

1. Use the generated URL `authorizationUrl` from [Step 1](#creatingclient) `generateAuthUrl` method to request access from Google's OAuth 2.0 server.
2. Redirect the user to `authorizationUrl`.
	```
	res.redirect(authorizationUrl);
	```

#### Sample redirect to Google's authorization server

An example URL is shown below, with line breaks and spaces for readability.

```
https://accounts.google.com/o/oauth2/v2/auth?
 scope=https%3A//www.googleapis.com/auth/drive.metadata.readonly%20https%3A//www.googleapis.com/auth/calendar.readonly&
 access_type=offline&
 include_granted_scopes=true&
 response_type=code&
 state=state_parameter_passthrough_value&
 redirect_uri=https%3A//developers.google.com/oauthplayground&
 client_id=client_id
```

After you create the request URL, redirect the user to it.

Google's OAuth 2.0 server authenticates the user and obtains consent from the user for your application to access the requested scopes. The response is sent back to your application using the redirect URL you specified.

### Step 3: Google prompts user for consent

In this step, the user decides whether to grant your application the requested access. At this stage, Google displays a consent window that shows the name of your application and the Google API services that it is requesting permission to access with the user's authorization credentials and a summary of the scopes of access to be granted. The user can then consent to grant access to one or more scopes requested by your application or refuse the request.

Your application doesn't need to do anything at this stage as it waits for the response from Google's OAuth 2.0 server indicating whether any access was granted. That response is explained in the following step.

#### Errors

Requests to Google's OAuth 2.0 authorization endpoint may display user-facing error messages instead of the expected authentication and authorization flows. Common error codes and suggested resolutions are:

##### admin\_policy\_enforced

The Google Account is unable to authorize one or more scopes requested due to the policies of their Google Workspace administrator. See the Google Workspace Admin help article [Control which third-party & internal apps access Google Workspace data](https://support.google.com/a/answer/7281227) for more information about how an administrator may restrict access to all scopes or sensitive and restricted scopes until access is explicitly granted to your OAuth client ID.

##### disallowed\_useragent

The authorization endpoint is displayed inside an embedded user-agent disallowed by Google's [OAuth 2.0 Policies](https://developers.google.com/identity/protocols/oauth2/policies#browsers).

iOS and macOS developers may encounter this error when opening authorization requests in [`WKWebView`](https://developer.apple.com/documentation/webkit/wkwebview). Developers should instead use iOS libraries such as [Google Sign-In for iOS](https://developers.google.com/identity/sign-in/ios) or OpenID Foundation's [AppAuth for iOS](https://openid.github.io/AppAuth-iOS/).

Web developers may encounter this error when an iOS or macOS app opens a general web link in an embedded user-agent and a user navigates to Google's OAuth 2.0 authorization endpoint from your site. Developers should allow general links to open in the default link handler of the operating system, which includes both [Universal Links](https://developer.apple.com/ios/universal-links/) handlers or the default browser app. The [`SFSafariViewController`](https://developer.apple.com/documentation/safariservices/sfsafariviewcontroller) library is also a supported option.

##### org\_internal

The OAuth client ID in the request is part of a project limiting access to Google Accounts in a specific [Google Cloud Organization](https://cloud.google.com/resource-manager/docs/cloud-platform-resource-hierarchy#organizations). For more information about this configuration option see the [User type](https://support.google.com/cloud/answer/10311615#user-type) section in the Setting up your OAuth consent screen help article.

##### invalid\_client

The OAuth client secret is incorrect. Review the [OAuth client configuration](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow#creatingcred), including the client ID and secret used for this request.

##### deleted\_client

The OAuth client being used to make the request has been deleted. Deletion can happen manually or automatically in the case of [unused clients](https://support.google.com/cloud/answer/15549257#unused-client-deletion) . Deleted clients can be restored within 30 days of the deletion. [Learn more](https://support.google.com/cloud/answer/15549257#delete-oauth-clients) .

##### invalid\_grant

[When refreshing an access token](#offline) or using [incremental authorization](#incrementalAuth), the token may have expired or has been invalidated. Authenticate the user again and ask for user consent to obtain new tokens. If you are continuing to see this error, ensure that your application has been configured correctly and that you are using the correct tokens and parameters in your request. Otherwise, the user account may have been deleted or disabled.

##### redirect\_uri\_mismatch

The `redirect_uri` passed in the authorization request does not match an authorized redirect URI for the OAuth client ID. Review authorized redirect URIs in the Google Cloud Console [Clients page](https://console.developers.google.com/auth/clients).

The `redirect_uri` parameter may refer to the OAuth out-of-band (OOB) flow that has been deprecated and is no longer supported. Refer to the [migration guide](https://developers.google.com/identity/protocols/oauth2/resources/oob-migration) to update your integration.

##### invalid\_request

There was something wrong with the request you made. This could be due to a number of reasons:

- The request was not properly formatted
- The request was missing required parameters
- The request uses an authorization method that Google doesn't support. Verify your OAuth integration uses a recommended integration method

### Step 4: Handle the OAuth 2.0 server response

The OAuth 2.0 server responds to your application's access request by using the URL specified in the request.

If the user approves the access request, then the response contains an authorization code. If the user does not approve the request, the response contains an error message. The authorization code or error message that is returned to the web server appears on the query string, as shown below:

An error response:

```
https://oauth2.example.com/auth?error=access_denied
```

An authorization code response:

```
https://oauth2.example.com/auth?code=4/P7q7W91a-oMsCeLvIaQm6bTrgtp7
```

#### Sample OAuth 2.0 server response

You can test this flow by clicking on the following sample URL, which requests read-only access to view metadata for files in your Google Drive and read-only access to view your Google Calendar events:

```
https://accounts.google.com/o/oauth2/v2/auth?
 scope=https%3A//www.googleapis.com/auth/drive.metadata.readonly%20https%3A//www.googleapis.com/auth/calendar.readonly&
 access_type=offline&
 include_granted_scopes=true&
 response_type=code&
 state=state_parameter_passthrough_value&
 redirect_uri=https%3A//developers.google.com/oauthplayground&
 client_id=client_id
```

After completing the OAuth 2.0 flow, your browser redirects you to the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/), a tool for testing OAuth flows. You will see that the OAuth 2.0 Playground has automatically captured the authorization code.

### Step 5: Exchange authorization code for refresh and access tokens

After the web server receives the authorization code, it can exchange the authorization code for an access token.

To exchange an authorization code for an access token, use the `fetchAccessTokenWithAuthCode` method:

```
$access_token = $client->fetchAccessTokenWithAuthCode($_GET['code']);
```

On your callback page, use the `google-auth` library to verify the authorization server response. Then, use the `flow.fetch_token` method to exchange the authorization code in that response for an access token:

```
state = flask.session['state']
flow = google_auth_oauthlib.flow.Flow.from_client_secrets_file(
    'client_secret.json',
    scopes=['https://www.googleapis.com/auth/drive.metadata.readonly'],
    state=state)
flow.redirect_uri = flask.url_for('oauth2callback', _external=True)

authorization_response = flask.request.url
flow.fetch_token(authorization_response=authorization_response)

# Store the credentials in browser session storage, but for security: client_id, client_secret,
# and token_uri are instead stored only on the backend server.
credentials = flow.credentials
flask.session['credentials'] = {
    'token': credentials.token,
    'refresh_token': credentials.refresh_token,
    'granted_scopes': credentials.granted_scopes}
```

On your callback page, use the `googleauth` library to verify the authorization server response. Use the `authorizer.handle_auth_callback_deferred` method to save the authorization code and redirect back to the URL that originally requested authorization. This defers the exchange of the code by temporarily stashing the results in the user's session.

```
target_url = Google::Auth::WebUserAuthorizer.handle_auth_callback_deferred(request)
redirect target_url
```

To exchange an authorization code for an access token, use the `getToken` method:

```
const url = require('url');

// Receive the callback from Google's OAuth 2.0 server.
app.get('/oauth2callback', async (req, res) => {
  let q = url.parse(req.url, true).query;

  if (q.error) { // An error response e.g. error=access_denied
    console.log('Error:' + q.error);
  } else if (q.state !== req.session.state) { //check state value
    console.log('State mismatch. Possible CSRF attack');
    res.end('State mismatch. Possible CSRF attack');
  } else { // Get access and refresh tokens (if access_type is offline)

    let { tokens } = await oauth2Client.getToken(q.code);
    oauth2Client.setCredentials(tokens);
});
```

To exchange an authorization code for an access token, call the `https://oauth2.googleapis.com/token` endpoint and set the following parameters:

<table><thead><tr><th colspan="2">Fields</th></tr></thead><tbody><tr><td><code>client_id</code></td><td>The client ID obtained from the Cloud Console <a href="https://console.developers.google.com/auth/clients">Clients page</a>.</td></tr><tr><td><code>client_secret</code></td><td><strong>Optional</strong><p>The client secret obtained from the Cloud Console <a href="https://console.developers.google.com/auth/clients">Clients page</a>.</p></td></tr><tr><td><code>code</code></td><td>The authorization code returned from the initial request.</td></tr><tr><td><code>grant_type</code></td><td><a href="https://tools.ietf.org/html/rfc6749#section-4.1.3">As defined in the OAuth 2.0 specification</a>, this field's value must be set to <code>authorization_code</code>.</td></tr><tr><td><code>redirect_uri</code></td><td>One of the redirect URIs listed for your project in the Cloud Console <a href="https://console.developers.google.com/auth/clients">Clients page</a> for the given <code>client_id</code>.</td></tr></tbody></table>

The following snippet shows a sample request:

```
POST /token HTTP/1.1
Host: oauth2.googleapis.com
Content-Type: application/x-www-form-urlencoded

code=4/P7q7W91a-oMsCeLvIaQm6bTrgtp7&
client_id=your_client_id&
redirect_uri=https%3A//developers.google.com/oauthplayground&
grant_type=authorization_code
```

Google responds to this request by returning a JSON object that contains a short-lived access token and a refresh token. Note that the refresh token is only returned if your application set the `access_type` parameter to `offline` in [the initial request to Google's authorization server](#creatingclient).

The response contains the following fields:

<table><thead><tr><th colspan="2">Fields</th></tr></thead><tbody><tr><td><code>access_token</code></td><td>The token that your application sends to authorize a Google API request.</td></tr><tr><td><code>expires_in</code></td><td>The remaining lifetime of the access token in seconds.</td></tr><tr><td><code>refresh_token</code></td><td>A token that you can use to obtain a new access token. Refresh tokens are valid until the user revokes access or the refresh token expires. Again, this field is only present in this response if you set the <code>access_type</code> parameter to <code>offline</code> in the initial request to Google's authorization server.</td></tr><tr><td><code>refresh_token_expires_in</code></td><td>The remaining lifetime of the refresh token in seconds. This value is only set when the user grants <a href="https://developers.google.com/identity/protocols/oauth2/web-server#time-based-access">time-based access</a>.</td></tr><tr><td><code>scope</code></td><td>The scopes of access granted by the <code>access_token</code> expressed as a list of space-delimited, case-sensitive strings.</td></tr><tr><td><code>token_type</code></td><td>The type of token returned. At this time, this field's value is always set to <code>Bearer</code>.</td></tr></tbody></table>

The following snippet shows a sample response:

```
{
  "access_token": "1/fFAGRNJru1FTz70BzhT3Zg",
  "expires_in": 3920,
  "token_type": "Bearer",
  "scope": "https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/calendar.readonly",
  "refresh_token": "1//xEoDL4iW3cxlI7yDbSRFYNG01kVKM2C-259HOF2aQbI"
}
```

#### Errors

When exchanging the authorization code for an access token you may encounter the following error instead of the expected response. Common error codes and suggested resolutions are listed below.

##### invalid\_grant

The supplied authorization code is invalid or in the wrong format. Request a new code by [restarting the OAuth process](#creatingclient) to prompt the user for consent again.

### Step 6: Check which scopes users granted

When requesting **multiple** permissions (scopes), users may not grant your app access to all of them. Your app must verify which scopes were actually granted and gracefully handle situations where some permissions are denied, typically by disabling the features that rely on those denied scopes.

However, there are exceptions. Google Workspace Enterprise apps with [domain-wide delegation of authority](https://support.google.com/a/answer/162106), or apps marked as [Trusted](https://support.google.com/a/answer/7281227#zippy=%2Cchange-access-from-the-app-list), bypass the granular permissions consent screen. For these apps, users won't see the granular permission consent screen. Instead, your app will either receive all requested scopes or none.

For more detailed information, see [How to handle granular permissions](https://developers.google.com/identity/protocols/oauth2/resources/granular-permissions).

To check which scopes the user has granted, use the `getGrantedScope()` method:

```
// Space-separated string of granted scopes if it exists, otherwise null.
$granted_scopes = $client->getOAuth2Service()->getGrantedScope();

// Determine which scopes user granted and build a dictionary
$granted_scopes_dict = [
  'Drive' => str_contains($granted_scopes, Google\Service\Drive::DRIVE_METADATA_READONLY),
  'Calendar' => str_contains($granted_scopes, Google\Service\Calendar::CALENDAR_READONLY)
];
```

The returned `credentials` object has a `granted_scopes` property, which is a list of scopes the user has granted to your app.

```
credentials = flow.credentials
flask.session['credentials'] = {
    'token': credentials.token,
    'refresh_token': credentials.refresh_token,
    'granted_scopes': credentials.granted_scopes}
```

The following function checks which scopes the user has granted to your app.

```
def check_granted_scopes(credentials):
  features = {}
  if 'https://www.googleapis.com/auth/drive.metadata.readonly' in credentials['granted_scopes']:
    features['drive'] = True
  else:
    features['drive'] = False

  if 'https://www.googleapis.com/auth/calendar.readonly' in credentials['granted_scopes']:
    features['calendar'] = True
  else:
    features['calendar'] = False

  return features
```

When requesting **multiple** scopes at once, check which scopes were granted through the `scope` property of the `credentials` object.

```
# User authorized the request. Now, check which scopes were granted.
if credentials.scope.include?(Google::Apis::DriveV3::AUTH_DRIVE_METADATA_READONLY)
  # User authorized read-only Drive activity permission.
  # Calling the APIs, etc
else
  # User didn't authorize read-only Drive activity permission.
  # Update UX and application accordingly
end

# Check if user authorized Calendar read permission.
if credentials.scope.include?(Google::Apis::CalendarV3::AUTH_CALENDAR_READONLY)
  # User authorized Calendar read permission.
  # Calling the APIs, etc.
else
  # User didn't authorize Calendar read permission.
  # Update UX and application accordingly
end
```

When requesting **multiple** scopes at once, check which scopes were granted through the `scope` property of the `tokens` object.

```
// User authorized the request. Now, check which scopes were granted.
if (tokens.scope.includes('https://www.googleapis.com/auth/drive.metadata.readonly'))
{
  // User authorized read-only Drive activity permission.
  // Calling the APIs, etc.
}
else
{
  // User didn't authorize read-only Drive activity permission.
  // Update UX and application accordingly
}

// Check if user authorized Calendar read permission.
if (tokens.scope.includes('https://www.googleapis.com/auth/calendar.readonly'))
{
  // User authorized Calendar read permission.
  // Calling the APIs, etc.
}
else
{
  // User didn't authorize Calendar read permission.
  // Update UX and application accordingly
}
```

To check whether the user has granted your application access to a particular scope, exam the `scope` field in the access token response. The scopes of access granted by the access\_token expressed as a list of space-delimited, case-sensitive strings.

For example, the following sample access token response indicates that the user has granted your application access to the read-only Drive activity and Calendar events permissions:

```
{
  "access_token": "1/fFAGRNJru1FTz70BzhT3Zg",
  "expires_in": 3920,
  "token_type": "Bearer",
  "scope": "https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/calendar.readonly",
  "refresh_token": "1//xEoDL4iW3cxlI7yDbSRFYNG01kVKM2C-259HOF2aQbI"
}
```

## Call Google APIs

Use the access token to call Google APIs by completing the following steps:

1. If you need to apply an access token to a new `Google\Client` object — for example, if you stored the access token in a user session — use the `setAccessToken` method:
	```
	$client->setAccessToken($access_token);
	```
2. Build a service object for the API that you want to call. You build a service object by providing an authorized `Google\Client` object to the constructor for the API you want to call. For example, to call the Drive API:
	```
	$drive = new Google\Service\Drive($client);
	```
3. Make requests to the API service using the [interface provided by the service object](https://github.com/googleapis/google-api-php-client/blob/master/docs/start.md). For example, to list the files in the authenticated user's Google Drive:
	```
	$files = $drive->files->listFiles(array());
	```

After obtaining an access token, your application can use that token to authorize API requests on behalf of a given user account or service account. Use the user-specific authorization credentials to build a service object for the API that you want to call, and then use that object to make authorized API requests.

1. Build a service object for the API that you want to call. You build a service object by calling the `googleapiclient.discovery` library's `build` method with the name and version of the API and the user credentials: For example, to call version 3 of the Drive API:
	```
	from googleapiclient.discovery import build
	drive = build('drive', 'v2', credentials=credentials)
	```
2. Make requests to the API service using the [interface provided by the service object](https://github.com/googleapis/google-api-python-client/blob/master/docs/start.md#building-and-calling-a-service). For example, to list the files in the authenticated user's Google Drive:
	```
	files = drive.files().list().execute()
	```

After obtaining an access token, your application can use that token to make API requests on behalf of a given user account or service account. Use the user-specific authorization credentials to build a service object for the API that you want to call, and then use that object to make authorized API requests.

1. Build a service object for the API that you want to call. For example, to call version 3 of the Drive API:
	```
	drive = Google::Apis::DriveV3::DriveService.new
	```
2. Set the credentials on the service:
	```
	drive.authorization = credentials
	```
3. Make requests to the API service using the [interface provided by the service object](https://github.com/googleapis/google-api-ruby-client). For example, to list the files in the authenticated user's Google Drive:
	```
	files = drive.list_files
	```

Alternately, authorization can be provided on a per-method basis by supplying the `options` parameter to a method:

```
files = drive.list_files(options: { authorization: credentials })
```

After obtaining an access token and setting it to the `OAuth2` object, use the object to call Google APIs. Your application can use that token to authorize API requests on behalf of a given user account or service account. Build a service object for the API that you want to call. For example, the following code uses the Google Drive API to list filenames in the user's Drive.

```
const { google } = require('googleapis');

// Example of using Google Drive API to list filenames in user's Drive.
const drive = google.drive('v3');
drive.files.list({
  auth: oauth2Client,
  pageSize: 10,
  fields: 'nextPageToken, files(id, name)',
}, (err1, res1) => {
  if (err1) return console.log('The API returned an error: ' + err1);
  const files = res1.data.files;
  if (files.length) {
    console.log('Files:');
    files.map((file) => {
      console.log(\`${file.name} (${file.id})\`);
    });
  } else {
    console.log('No files found.');
  }
});
```

After your application obtains an access token, you can use the token to make calls to a Google API on behalf of a given user account if the scope(s) of access required by the API have been granted. To do this, include the access token in a request to the API by including either an `access_token` query parameter or an `Authorization` HTTP header `Bearer` value. When possible, the HTTP header is preferable, because query strings tend to be visible in server logs. In most cases you can use a client library to set up your calls to Google APIs (for example, when [calling the Drive Files API](https://developers.google.com/drive/api/v2/reference#Files)).

You can try out all the Google APIs and view their scopes at the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).

#### HTTP GET examples

A call to the [`drive.files`](https://developers.google.com/drive/v2/reference/files/list) endpoint (the Drive Files API) using the `Authorization: Bearer` HTTP header might look like the following. Note that you need to specify your own access token:

```
GET /drive/v2/files HTTP/1.1
Host: www.googleapis.com
Authorization: Bearer access_token
```

Here is a call to the same API for the authenticated user using the `access_token` query string parameter:

```
GET https://www.googleapis.com/drive/v2/files?access_token=access_token
```

#### curl examples

You can test these commands with the `curl` command-line application. Here's an example that uses the HTTP header option (preferred):

```
curl -H "Authorization: Bearer access_token" https://www.googleapis.com/drive/v2/files
```

Or, alternatively, the query string parameter option:

```
curl https://www.googleapis.com/drive/v2/files?access_token=access_token
```

## Complete example

The following example prints a JSON-formatted list of files in a user's Google Drive after the user authenticates and gives consent for the application to access the user's Drive metadata.

To run this example:

1. In the API Console, add the URL of the local machine to the list of redirect URLs. For example, add `http://localhost:8080`.
2. Create a new directory and change to it. For example:
	```
	mkdir ~/php-oauth2-example
	cd ~/php-oauth2-example
	```
3. Install the [Google API Client Library for PHP](https://github.com/googleapis/google-api-php-client) using [Composer](https://getcomposer.org/):
	```
	composer require google/apiclient:^2.15.0
	```
4. Create the files `index.php` and `oauth2callback.php` with the following content.
5. Run the example with the PHP's built-in test web server:
	```
	php -S localhost:8080 ~/php-oauth2-example
	```

#### index.php

```
<?php
require_once __DIR__.'/vendor/autoload.php';

session_start();

$client = new Google\Client();
$client->setAuthConfig('client_secret.json');

// User granted permission as an access token is in the session.
if (isset($_SESSION['access_token']) && $_SESSION['access_token'])
{
  $client->setAccessToken($_SESSION['access_token']);
  
  // Check if user granted Drive permission
  if ($_SESSION['granted_scopes_dict']['Drive']) {
    echo "Drive feature is enabled.";
    echo "</br>";
    $drive = new Drive($client);
    $files = array();
    $response = $drive->files->listFiles(array());
    foreach ($response->files as $file) {
        echo "File: " . $file->name . " (" . $file->id . ")";
        echo "</br>";
    }
  } else {
    echo "Drive feature is NOT enabled.";
    echo "</br>";
  }

   // Check if user granted Calendar permission
  if ($_SESSION['granted_scopes_dict']['Calendar']) {
    echo "Calendar feature is enabled.";
    echo "</br>";
  } else {
    echo "Calendar feature is NOT enabled.";
    echo "</br>";
  }
}
else
{
  // Redirect users to outh2call.php which redirects users to Google OAuth 2.0
  $redirect_uri = 'http://' . $_SERVER['HTTP_HOST'] . '/oauth2callback.php';
  header('Location: ' . filter_var($redirect_uri, FILTER_SANITIZE_URL));
}
?>
```

#### oauth2callback.php

```
<?php
require_once __DIR__.'/vendor/autoload.php';

session_start();

$client = new Google\Client();

// Required, call the setAuthConfig function to load authorization credentials from
// client_secret.json file.
$client->setAuthConfigFile('client_secret.json');
$client->setRedirectUri('http://' . $_SERVER['HTTP_HOST']. $_SERVER['PHP_SELF']);

// Required, to set the scope value, call the addScope function.
$client->addScope([Google\Service\Drive::DRIVE_METADATA_READONLY, Google\Service\Calendar::CALENDAR_READONLY]);

// Enable incremental authorization. Recommended as a best practice.
$client->setIncludeGrantedScopes(true);

// Recommended, offline access will give you both an access and refresh token so that
// your app can refresh the access token without user interaction.
$client->setAccessType("offline");

// Generate a URL for authorization as it doesn't contain code and error
if (!isset($_GET['code']) && !isset($_GET['error']))
{
  // Generate and set state value
  $state = bin2hex(random_bytes(16));
  $client->setState($state);
  $_SESSION['state'] = $state;

  // Generate a url that asks permissions.
  $auth_url = $client->createAuthUrl();
  header('Location: ' . filter_var($auth_url, FILTER_SANITIZE_URL));
}

// User authorized the request and authorization code is returned to exchange access and
// refresh tokens.
if (isset($_GET['code']))
{
  // Check the state value
  if (!isset($_GET['state']) || $_GET['state'] !== $_SESSION['state']) {
    die('State mismatch. Possible CSRF attack.');
  }

  // Get access and refresh tokens (if access_type is offline)
  $token = $client->fetchAccessTokenWithAuthCode($_GET['code']);

  /** Save access and refresh token to the session variables.
    * ACTION ITEM: In a production app, you likely want to save the
    *              refresh token in a secure persistent storage instead. */
  $_SESSION['access_token'] = $token;
  $_SESSION['refresh_token'] = $client->getRefreshToken();
  
  // Space-separated string of granted scopes if it exists, otherwise null.
  $granted_scopes = $client->getOAuth2Service()->getGrantedScope();

  // Determine which scopes user granted and build a dictionary
  $granted_scopes_dict = [
    'Drive' => str_contains($granted_scopes, Google\Service\Drive::DRIVE_METADATA_READONLY),
    'Calendar' => str_contains($granted_scopes, Google\Service\Calendar::CALENDAR_READONLY)
  ];
  $_SESSION['granted_scopes_dict'] = $granted_scopes_dict;
  
  $redirect_uri = 'http://' . $_SERVER['HTTP_HOST'] . '/';
  header('Location: ' . filter_var($redirect_uri, FILTER_SANITIZE_URL));
}

// An error response e.g. error=access_denied
if (isset($_GET['error']))
{
  echo "Error: ". $_GET['error'];
}
?>
```

This example uses the [Flask](https://palletsprojects.com/p/flask/) framework. It runs a web application at `http://localhost:8080` that lets you test the OAuth 2.0 flow. If you go to that URL, you should see five links:

- **Call Drive API:** This link points to a page that tries to execute a sample API request if users granted the permission. If necessary, it starts the authorization flow. If successful, the page displays the API response.
- **Mock page to call Calendar API:** This link points to a maockpage that tries to execute a sample Calendar API request if users granted the permission. If necessary, it starts the authorization flow. If successful, the page displays the API response.
- **Test the auth flow directly:** This link points to a page that tries to send the user through the [authorization flow](#redirecting). The app requests permission to submit authorized API requests on the user's behalf.
- **Revoke current credentials:** This link points to a page that [revokes](#tokenrevoke) permissions that the user has already granted to the application.
- **Clear Flask session credentials:** This link clears authorization credentials that are stored in the Flask session. This lets you see what would happen if a user who had already granted permission to your app tried to execute an API request in a new session. It also lets you see the API response your app would get if a user had revoked permissions granted to your app, and your app still tried to authorize a request with a revoked access token.

```
# -*- coding: utf-8 -*-

import os
import flask
import json
import requests

import google.oauth2.credentials
import google_auth_oauthlib.flow
import googleapiclient.discovery

# This variable specifies the name of a file that contains the OAuth 2.0
# information for this application, including its client_id and client_secret.
CLIENT_SECRETS_FILE = "client_secret.json"

# The OAuth 2.0 access scope allows for access to the
# authenticated user's account and requires requests to use an SSL connection.
SCOPES = ['https://www.googleapis.com/auth/drive.metadata.readonly',
          'https://www.googleapis.com/auth/calendar.readonly']
API_SERVICE_NAME = 'drive'
API_VERSION = 'v2'

app = flask.Flask(__name__)
# Note: A secret key is included in the sample so that it works.
# If you use this code in your application, replace this with a truly secret
# key. See https://flask.palletsprojects.com/quickstart/#sessions.
app.secret_key = 'REPLACE ME - this value is here as a placeholder.'

@app.route('/')
def index():
  return print_index_table()

@app.route('/drive')
def drive_api_request():
  if 'credentials' not in flask.session:
    return flask.redirect('authorize')

  features = flask.session['features']

  if features['drive']:
    # Load client secrets from the server-side file.
    with open(CLIENT_SECRETS_FILE, 'r') as f:
        client_config = json.load(f)['web']

    # Load user-specific credentials from browser session storage.
    session_credentials = flask.session['credentials']

    # Reconstruct the credentials object.
    credentials = google.oauth2.credentials.Credentials(
        refresh_token=session_credentials.get('refresh_token'),
        scopes=session_credentials.get('granted_scopes'),
        token=session_credentials.get('token'),
        client_id=client_config.get('client_id'),
        client_secret=client_config.get('client_secret'),
        token_uri=client_config.get('token_uri'))

    drive = googleapiclient.discovery.build(
        API_SERVICE_NAME, API_VERSION, credentials=credentials)

    files = drive.files().list().execute()

    # Save credentials back to session in case access token was refreshed.
    flask.session['credentials'] = credentials_to_dict(credentials)

    return flask.jsonify(**files)
  else:
    # User didn't authorize read-only Drive activity permission.
    return '<p>Drive feature is not enabled.</p>'

@app.route('/calendar')
def calendar_api_request():
  if 'credentials' not in flask.session:
    return flask.redirect('authorize')

  features = flask.session['features']

  if features['calendar']:
    # User authorized Calendar read permission.
    # Calling the APIs, etc.
    return ('<p>User granted the Google Calendar read permission. '+
            'This sample code does not include code to call Calendar</p>')
  else:
    # User didn't authorize Calendar read permission.
    # Update UX and application accordingly
    return '<p>Calendar feature is not enabled.</p>'

@app.route('/authorize')
def authorize():
  # Create flow instance to manage the OAuth 2.0 Authorization Grant Flow steps.
  flow = google_auth_oauthlib.flow.Flow.from_client_secrets_file(
      CLIENT_SECRETS_FILE, scopes=SCOPES)

  # The URI created here must exactly match one of the authorized redirect URIs
  # for the OAuth 2.0 client, which you configured in the API Console. If this
  # value doesn't match an authorized URI, you will get a 'redirect_uri_mismatch'
  # error.
  flow.redirect_uri = flask.url_for('oauth2callback', _external=True)

  authorization_url, state = flow.authorization_url(
      # Enable offline access so that you can refresh an access token without
      # re-prompting the user for permission. Recommended for web server apps.
      access_type='offline',
      # Enable incremental authorization. Recommended as a best practice.
      include_granted_scopes='true')

  # Store the state so the callback can verify the auth server response.
  flask.session['state'] = state

  return flask.redirect(authorization_url)

@app.route('/oauth2callback')
def oauth2callback():
  # Specify the state when creating the flow in the callback so that it can
  # verified in the authorization server response.
  state = flask.session['state']

  flow = google_auth_oauthlib.flow.Flow.from_client_secrets_file(
      CLIENT_SECRETS_FILE, scopes=SCOPES, state=state)
  flow.redirect_uri = flask.url_for('oauth2callback', _external=True)

  # Use the authorization server's response to fetch the OAuth 2.0 tokens.
  authorization_response = flask.request.url
  flow.fetch_token(authorization_response=authorization_response)

  # Store credentials in the session.
  # ACTION ITEM: In a production app, you likely want to save these
  #              credentials in a persistent database instead.
  credentials = flow.credentials
  
  credentials = credentials_to_dict(credentials)
  flask.session['credentials'] = credentials

  # Check which scopes user granted
  features = check_granted_scopes(credentials)
  flask.session['features'] = features
  return flask.redirect('/')
  
@app.route('/revoke')
def revoke():
  if 'credentials' not in flask.session:
    return ('You need to <a href="/authorize">authorize</a> before ' +
            'testing the code to revoke credentials.')

  # Load client secrets from the server-side file.
  with open(CLIENT_SECRETS_FILE, 'r') as f:
      client_config = json.load(f)['web']

  # Load user-specific credentials from the session.
  session_credentials = flask.session['credentials']

  # Reconstruct the credentials object.
  credentials = google.oauth2.credentials.Credentials(
      refresh_token=session_credentials.get('refresh_token'),
      scopes=session_credentials.get('granted_scopes'),
      token=session_credentials.get('token'),
      client_id=client_config.get('client_id'),
      client_secret=client_config.get('client_secret'),
      token_uri=client_config.get('token_uri'))

  revoke = requests.post('https://oauth2.googleapis.com/revoke',
      params={'token': credentials.token},
      headers = {'content-type': 'application/x-www-form-urlencoded'})

  status_code = getattr(revoke, 'status_code')
  if status_code == 200:
    # Clear the user's session credentials after successful revocation
    if 'credentials' in flask.session:
        del flask.session['credentials']
        del flask.session['features']
    return('Credentials successfully revoked.' + print_index_table())
  else:
    return('An error occurred.' + print_index_table())

@app.route('/clear')
def clear_credentials():
  if 'credentials' in flask.session:
    del flask.session['credentials']
  return ('Credentials have been cleared.<br><br>' +
          print_index_table())

def credentials_to_dict(credentials):
  return {'token': credentials.token,
          'refresh_token': credentials.refresh_token,
          'granted_scopes': credentials.granted_scopes}

def check_granted_scopes(credentials):
  features = {}
  if 'https://www.googleapis.com/auth/drive.metadata.readonly' in credentials['granted_scopes']:
    features['drive'] = True
  else:
    features['drive'] = False

  if 'https://www.googleapis.com/auth/calendar.readonly' in credentials['granted_scopes']:
    features['calendar'] = True
  else:
    features['calendar'] = False

  return features

def print_index_table():
  return ('<table>' + 
          '<tr><td><a href="/authorize">Test the auth flow directly</a></td>' +
          '<td>Go directly to the authorization flow. If there are stored ' +
          '    credentials, you still might not be prompted to reauthorize ' +
          '    the application.</td></tr>' +
          '<tr><td><a href="/drive">Call Drive API directly</a></td>' +
          '<td> Use stored credentials to call the API, you still might not be prompted to reauthorize ' +
          '    the application.</td></tr>' +
          '<tr><td><a href="/calendar">Call Calendar API directly</a></td>' +
          '<td> Use stored credentials to call the API, you still might not be prompted to reauthorize ' +
          '    the application.</td></tr>' + 
          '<tr><td><a href="/revoke">Revoke current credentials</a></td>' +
          '<td>Revoke the access token associated with the current user ' +
          '    session. After revoking credentials, if you go to the test ' +
          '    page, you should see an <code>invalid_grant</code> error.' +
          '</td></tr>' +
          '<tr><td><a href="/clear">Clear Flask session credentials</a></td>' +
          '<td>Clear the access token currently stored in the user session. ' +
          '    After clearing the token, if you <a href="/authorize">authorize</a> ' +
          '    again, you should go back to the auth flow.' +
          '</td></tr></table>')

if __name__ == '__main__':
  # When running locally, disable OAuthlib's HTTPs verification.
  # ACTION ITEM for developers:
  #     When running in production *do not* leave this option enabled.
  os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

  # This disables the requested scopes and granted scopes check.
  # If users only grant partial request, the warning would not be thrown.
  os.environ['OAUTHLIB_RELAX_TOKEN_SCOPE'] = '1'

  # Specify a hostname and port that are set as a valid redirect URI
  # for your API project in the Google API Console.
  app.run('localhost', 8080, debug=True)
```

This example uses the [Sinatra](http://www.sinatrarb.com/) framework.

```
require 'googleauth'
require 'googleauth/web_user_authorizer'
require 'googleauth/stores/redis_token_store'

require 'google/apis/drive_v3'
require 'google/apis/calendar_v3'

require 'sinatra'

configure do
  enable :sessions

  # Required, call the from_file method to retrieve the client ID from a
  # client_secret.json file.
  set :client_id, Google::Auth::ClientId.from_file('/path/to/client_secret.json')

  # Required, scope value
  # Access scopes for two non-Sign-In scopes: Read-only Drive activity and Google Calendar.
  scope = ['Google::Apis::DriveV3::AUTH_DRIVE_METADATA_READONLY',
           'Google::Apis::CalendarV3::AUTH_CALENDAR_READONLY']

  # Required, Authorizers require a storage instance to manage long term persistence of
  # access and refresh tokens.
  set :token_store, Google::Auth::Stores::RedisTokenStore.new(redis: Redis.new)

  # Required, indicate where the API server will redirect the user after the user completes
  # the authorization flow. The redirect URI is required. The value must exactly
  # match one of the authorized redirect URIs for the OAuth 2.0 client, which you
  # configured in the API Console. If this value doesn't match an authorized URI,
  # you will get a 'redirect_uri_mismatch' error.
  set :callback_uri, '/oauth2callback'

  # To use OAuth2 authentication, we need access to a CLIENT_ID, CLIENT_SECRET, AND REDIRECT_URI
  # from the client_secret.json file. To get these credentials for your application, visit
  # https://console.cloud.google.com/apis/credentials.
  set :authorizer, Google::Auth::WebUserAuthorizer.new(settings.client_id, settings.scope,
                          settings.token_store, callback_uri: settings.callback_uri)
end

get '/' do
  # NOTE: Assumes the user is already authenticated to the app
  user_id = request.session['user_id']

  # Fetch stored credentials for the user from the given request session.
  # nil if none present
  credentials = settings.authorizer.get_credentials(user_id, request)

  if credentials.nil?
    # Generate a url that asks the user to authorize requested scope(s).
    # Then, redirect user to the url.
    redirect settings.authorizer.get_authorization_url(request: request)
  end
  
  # User authorized the request. Now, check which scopes were granted.
  if credentials.scope.include?(Google::Apis::DriveV3::AUTH_DRIVE_METADATA_READONLY)
    # User authorized read-only Drive activity permission.
    # Example of using Google Drive API to list filenames in user's Drive.
    drive = Google::Apis::DriveV3::DriveService.new
    files = drive.list_files(options: { authorization: credentials })
    "<pre>#{JSON.pretty_generate(files.to_h)}</pre>"
  else
    # User didn't authorize read-only Drive activity permission.
    # Update UX and application accordingly
  end

  # Check if user authorized Calendar read permission.
  if credentials.scope.include?(Google::Apis::CalendarV3::AUTH_CALENDAR_READONLY)
    # User authorized Calendar read permission.
    # Calling the APIs, etc.
  else
    # User didn't authorize Calendar read permission.
    # Update UX and application accordingly
  end
end

# Receive the callback from Google's OAuth 2.0 server.
get '/oauth2callback' do
  # Handle the result of the oauth callback. Defers the exchange of the code by
  # temporarily stashing the results in the user's session.
  target_url = Google::Auth::WebUserAuthorizer.handle_auth_callback_deferred(request)
  redirect target_url
end
```

To run this example:

1. In the API Console, add the URL of the local machine to the list of redirect URLs. For example, add `http://localhost`.
2. Make sure you have maintenance LTS, active LTS, or current release of Node.js installed.
3. Create a new directory and change to it. For example:
	```
	mkdir ~/nodejs-oauth2-example
	cd ~/nodejs-oauth2-example
	```
4. Install the [Google API Client Library](https://github.com/googleapis/google-api-nodejs-client) for Node.js using [npm](https://www.npmjs.com/):
	```
	npm install googleapis
	```
5. Create the files `main.js` with the following content.
6. Run the example:
	```
	node .\main.js
	```

#### main.js

```
const http = require('http');
const https = require('https');
const url = require('url');
const { google } = require('googleapis');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');

/**
 * To use OAuth2 authentication, we need access to a CLIENT_ID, CLIENT_SECRET, AND REDIRECT_URI.
 * To get these credentials for your application, visit
 * https://console.cloud.google.com/apis/credentials.
 */
const oauth2Client = new google.auth.OAuth2(
  YOUR_CLIENT_ID,
  YOUR_CLIENT_SECRET,
  YOUR_REDIRECT_URL
);

// Access scopes for two non-Sign-In scopes: Read-only Drive activity and Google Calendar.
const scopes = [
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/calendar.readonly'
];

/* Global variable that stores user credential in this code example.
 * ACTION ITEM for developers:
 *   Store user's refresh token in your data store if
 *   incorporating this code into your real app.
 *   For more information on handling refresh tokens,
 *   see https://github.com/googleapis/google-api-nodejs-client#handling-refresh-tokens
 */
let userCredential = null;

async function main() {
  const app = express();

  app.use(session({
    secret: 'your_secure_secret_key', // Replace with a strong secret
    resave: false,
    saveUninitialized: false,
  }));

  // Example on redirecting user to Google's OAuth 2.0 server.
  app.get('/', async (req, res) => {
    // Generate a secure random state value.
    const state = crypto.randomBytes(32).toString('hex');
    // Store state in the session
    req.session.state = state;

    // Generate a url that asks permissions for the Drive activity and Google Calendar scope
    const authorizationUrl = oauth2Client.generateAuthUrl({
      // 'online' (default) or 'offline' (gets refresh_token)
      access_type: 'offline',
      /** Pass in the scopes array defined above.
        * Alternatively, if only one scope is needed, you can pass a scope URL as a string */
      scope: scopes,
      // Enable incremental authorization. Recommended as a best practice.
      include_granted_scopes: true,
      // Include the state parameter to reduce the risk of CSRF attacks.
      state: state
    });

    res.redirect(authorizationUrl);
  });

  // Receive the callback from Google's OAuth 2.0 server.
  app.get('/oauth2callback', async (req, res) => {
    // Handle the OAuth 2.0 server response
    let q = url.parse(req.url, true).query;

    if (q.error) { // An error response e.g. error=access_denied
      console.log('Error:' + q.error);
    } else if (q.state !== req.session.state) { //check state value
      console.log('State mismatch. Possible CSRF attack');
      res.end('State mismatch. Possible CSRF attack');
    } else { // Get access and refresh tokens (if access_type is offline)
      let { tokens } = await oauth2Client.getToken(q.code);
      oauth2Client.setCredentials(tokens);

      /** Save credential to the global variable in case access token was refreshed.
        * ACTION ITEM: In a production app, you likely want to save the refresh token
        *              in a secure persistent database instead. */
      userCredential = tokens;
      
      // User authorized the request. Now, check which scopes were granted.
      if (tokens.scope.includes('https://www.googleapis.com/auth/drive.metadata.readonly'))
      {
        // User authorized read-only Drive activity permission.
        // Example of using Google Drive API to list filenames in user's Drive.
        const drive = google.drive('v3');
        drive.files.list({
          auth: oauth2Client,
          pageSize: 10,
          fields: 'nextPageToken, files(id, name)',
        }, (err1, res1) => {
          if (err1) return console.log('The API returned an error: ' + err1);
          const files = res1.data.files;
          if (files.length) {
            console.log('Files:');
            files.map((file) => {
              console.log(\`${file.name} (${file.id})\`);
            });
          } else {
            console.log('No files found.');
          }
        });
      }
      else
      {
        // User didn't authorize read-only Drive activity permission.
        // Update UX and application accordingly
      }

      // Check if user authorized Calendar read permission.
      if (tokens.scope.includes('https://www.googleapis.com/auth/calendar.readonly'))
      {
        // User authorized Calendar read permission.
        // Calling the APIs, etc.
      }
      else
      {
        // User didn't authorize Calendar read permission.
        // Update UX and application accordingly
      }
    }
  });

  // Example on revoking a token
  app.get('/revoke', async (req, res) => {
    // Build the string for the POST request
    let postData = "token=" + userCredential.access_token;

    // Options for POST request to Google's OAuth 2.0 server to revoke a token
    let postOptions = {
      host: 'oauth2.googleapis.com',
      port: '443',
      path: '/revoke',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    // Set up the request
    const postReq = https.request(postOptions, function (res) {
      res.setEncoding('utf8');
      res.on('data', d => {
        console.log('Response: ' + d);
      });
    });

    postReq.on('error', error => {
      console.log(error)
    });

    // Post the request with data
    postReq.write(postData);
    postReq.end();
  });

  const server = http.createServer(app);
  server.listen(8080);
}
main().catch(console.error);
```

This Python example uses the [Flask](https://palletsprojects.com/p/flask/) framework and the [Requests](https://requests.readthedocs.io/) library to demonstrate the OAuth 2.0 web flow. We recommend using the Google API Client Library for Python for this flow. (The example in the Python tab does use the client library.)

```
import json
import flask
import requests

app = flask.Flask(__name__)

# To get these credentials (CLIENT_ID CLIENT_SECRET) and for your application, visit
# https://console.cloud.google.com/apis/credentials.
CLIENT_ID = '123456789.apps.googleusercontent.com'
CLIENT_SECRET = 'abc123'  # Read from a file or environmental variable in a real app

# Access scopes for two non-Sign-In scopes: Read-only Drive activity and Google Calendar.
SCOPE = 'https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/calendar.readonly'

# Indicate where the API server will redirect the user after the user completes
# the authorization flow. The redirect URI is required. The value must exactly
# match one of the authorized redirect URIs for the OAuth 2.0 client, which you
# configured in the API Console. If this value doesn't match an authorized URI,
# you will get a 'redirect_uri_mismatch' error.
REDIRECT_URI = 'http://example.com/oauth2callback'

@app.route('/')
def index():
  if 'credentials' not in flask.session:
    return flask.redirect(flask.url_for('oauth2callback'))

  credentials = json.loads(flask.session['credentials'])

  if credentials['expires_in'] <= 0:
    return flask.redirect(flask.url_for('oauth2callback'))
  else: 
    # User authorized the request. Now, check which scopes were granted.
    if 'https://www.googleapis.com/auth/drive.metadata.readonly' in credentials['scope']:
      # User authorized read-only Drive activity permission.
      # Example of using Google Drive API to list filenames in user's Drive.
      headers = {'Authorization': 'Bearer {}'.format(credentials['access_token'])}
      req_uri = 'https://www.googleapis.com/drive/v2/files'
      r = requests.get(req_uri, headers=headers).text
    else:
      # User didn't authorize read-only Drive activity permission.
      # Update UX and application accordingly
      r = 'User did not authorize Drive permission.'

    # Check if user authorized Calendar read permission.
    if 'https://www.googleapis.com/auth/calendar.readonly' in credentials['scope']:
      # User authorized Calendar read permission.
      # Calling the APIs, etc.
      r += 'User authorized Calendar permission.'
    else:
      # User didn't authorize Calendar read permission.
      # Update UX and application accordingly
      r += 'User did not authorize Calendar permission.'

  return r

@app.route('/oauth2callback')
def oauth2callback():
  if 'code' not in flask.request.args:
    state = str(uuid.uuid4())
    flask.session['state'] = state
    # Generate a url that asks permissions for the Drive activity
    # and Google Calendar scope. Then, redirect user to the url.
    auth_uri = ('https://accounts.google.com/o/oauth2/v2/auth?response_type=code'
                '&client_id={}&redirect_uri={}&scope={}&state={}').format(CLIENT_ID, REDIRECT_URI,
                                                                          SCOPE, state)
    return flask.redirect(auth_uri)
  else:
    if 'state' not in flask.request.args or flask.request.args['state'] != flask.session['state']:
      return 'State mismatch. Possible CSRF attack.', 400

    auth_code = flask.request.args.get('code')
    data = {'code': auth_code,
            'client_id': CLIENT_ID,
            'client_secret': CLIENT_SECRET,
            'redirect_uri': REDIRECT_URI,
            'grant_type': 'authorization_code'}

    # Exchange authorization code for access and refresh tokens (if access_type is offline)
    r = requests.post('https://oauth2.googleapis.com/token', data=data)
    flask.session['credentials'] = r.text
    return flask.redirect(flask.url_for('index'))

if __name__ == '__main__':
  import uuid
  app.secret_key = str(uuid.uuid4())
  app.debug = False
  app.run()
```

## Redirect URI validation rules

Google applies the following validation rules to redirect URIs in order to help developers keep their applications secure. Your redirect URIs must adhere to these rules. See [RFC 3986 section 3](https://tools.ietf.org/html/rfc3986#section-3) for the definition of domain, host, path, query, scheme and userinfo, mentioned below.

<table><thead><tr><th colspan="2">Validation rules</th></tr></thead><tbody><tr><td><a href="https://tools.ietf.org/html/rfc3986#section-3.1">Scheme</a></td><td><p>Redirect URIs must use the HTTPS scheme, not plain HTTP. Localhost URIs (including localhost IP address URIs) are exempt from this rule.</p></td></tr><tr><td><a href="https://tools.ietf.org/html/rfc3986#section-3.2.2">Host</a></td><td><p>Hosts cannot be raw IP addresses. Localhost IP addresses are exempted from this rule.</p></td></tr><tr><td><a href="https://tools.ietf.org/html/rfc1034">Domain</a></td><td><li>Host TLDs (<a href="https://tools.ietf.org/id/draft-liman-tld-names-00.html">Top Level Domains</a>) must belong to the <a href="https://publicsuffix.org/list/">public suffix list</a>.</li><li>Host domains cannot be <code>“googleusercontent.com”</code>.</li><li>Redirect URIs cannot contain URL shortener domains (e.g. <code>goo.gl</code>) unless the app owns the domain. Furthermore, if an app that owns a shortener domain chooses to redirect to that domain, that redirect URI must either contain <code>“/google-callback/”</code> in its path or end with <code>“/google-callback”</code>.</li></td></tr><tr><td><a href="https://tools.ietf.org/html/rfc3986#section-3.2.1">Userinfo</a></td><td><p>Redirect URIs cannot contain the userinfo subcomponent.</p></td></tr><tr><td><a href="https://tools.ietf.org/html/rfc3986#section-3.3">Path</a></td><td><p>Redirect URIs cannot contain a path traversal (also called directory backtracking), which is represented by an <code>“/..”</code> or <code>“\..”</code> or their URL encoding.</p></td></tr><tr><td><a href="https://tools.ietf.org/html/rfc3986#section-3.4">Query</a></td><td><p>Redirect URIs cannot contain <a href="https://tools.ietf.org/html/rfc6749#section-10.15">open redirects</a>.</p></td></tr><tr><td><a href="https://tools.ietf.org/html/rfc3986#section-3.5">Fragment</a></td><td><p>Redirect URIs cannot contain the fragment component.</p></td></tr><tr><td>Characters</td><td>Redirect URIs cannot contain certain characters including:<ul><li>Wildcard characters (<code>'*'</code>)</li><li>Non-printable ASCII characters</li><li>Invalid percent encodings (any percent encoding that does not follow URL-encoding form of a percent sign followed by two hexadecimal digits)</li><li>Null characters (an encoded NULL character, e.g., <code>%00</code>, <code>%C0%80</code>)</li></ul></td></tr></tbody></table>

## Incremental authorization

In the OAuth 2.0 protocol, your app requests authorization to access resources, which are identified by scopes. It is considered a best user-experience practice to request authorization for resources at the time you need them. To enable that practice, Google's authorization server supports incremental authorization. This feature lets you request scopes as they are needed and, if the user grants permission for the new scope, returns an authorization code that may be exchanged for a token containing all scopes the user has granted the project.

For example, an app that lets people sample music tracks and create mixes might need very few resources at sign-in time, perhaps nothing more than the name of the person signing in. However, saving a completed mix would require access to their Google Drive. Most people would find it natural if they only were asked for access to their Google Drive at the time the app actually needed it.

In this case, at sign-in time the app might request the `openid` and `profile` scopes to perform basic sign-in, and then later request the `https://www.googleapis.com/auth/drive.file` scope at the time of the first request to save a mix.

To implement incremental authorization, you complete the normal flow for requesting an access token but make sure that the authorization request includes previously granted scopes. This approach allows your app to avoid having to manage multiple access tokens.

The following rules apply to an access token obtained from an incremental authorization:

- The token can be used to access resources corresponding to any of the scopes rolled into the new, combined authorization.
- When you use the refresh token for the combined authorization to obtain an access token, the access token represents the combined authorization and can be used for any of the `scope` values included in the response.
- The combined authorization includes all scopes that the user granted to the API project even if the grants were requested from different clients. For example, if a user granted access to one scope using an application's desktop client and then granted another scope to the same application via a mobile client, the combined authorization would include both scopes.
- If you revoke a token that represents a combined authorization, access to all of that authorization's scopes on behalf of the associated user are revoked simultaneously.

The language-specific code samples in [Step 1: Set authorization parameters](#creatingclient) and the sample HTTP/REST redirect URL in [Step 2: Redirect to Google's OAuth 2.0 server](#redirecting) all use incremental authorization. The code samples below also show the code that you need to add to use incremental authorization.

```
$client->setIncludeGrantedScopes(true);
```

In Python, set the `include_granted_scopes` keyword argument to `true` to ensure that an authorization request includes previously granted scopes. It is very possible that `include_granted_scopes` will not be the *only* keyword argument that you set, as shown in the example below.

```
authorization_url, state = flow.authorization_url(
    # Enable offline access so that you can refresh an access token without
    # re-prompting the user for permission. Recommended for web server apps.
    access_type='offline',
    # Enable incremental authorization. Recommended as a best practice.
    include_granted_scopes='true')
```

```
auth_client.update!(
  :additional_parameters => {"include_granted_scopes" => "true"}
)
```

```
const authorizationUrl = oauth2Client.generateAuthUrl({
  // 'online' (default) or 'offline' (gets refresh_token)
  access_type: 'offline',
  /** Pass in the scopes array defined above.
    * Alternatively, if only one scope is needed, you can pass a scope URL as a string */
  scope: scopes,
  // Enable incremental authorization. Recommended as a best practice.
  include_granted_scopes: true
});
```

```
GET https://accounts.google.com/o/oauth2/v2/auth?
  client_id=your_client_id&
  response_type=code&
  state=state_parameter_passthrough_value&
  scope=https%3A//www.googleapis.com/auth/drive.metadata.readonly%20https%3A//www.googleapis.com/auth/calendar.readonly&
  redirect_uri=https%3A//developers.google.com/oauthplayground&
  prompt=consent&
  include_granted_scopes=true
```

## Refreshing an access token (offline access)

Access tokens periodically expire and become invalid credentials for a related API request. You can refresh an access token without prompting the user for permission (including when the user is not present) if you requested offline access to the scopes associated with the token.

- If you use a Google API Client Library, the [client object](#creatingclient) refreshes the access token as needed as long as you configure that object for offline access.
- If you are not using a client library, you need to set the `access_type` HTTP query parameter to `offline` when [redirecting the user to Google's OAuth 2.0 server](#redirecting). In that case, Google's authorization server returns a refresh token when you [exchange an authorization code](#exchange-authorization-code) for an access token. Then, if the access token expires (or at any other time), you can use a refresh token to obtain a new access token.

Requesting offline access is a requirement for any application that needs to access a Google API when the user is not present. For example, an app that performs backup services or executes actions at predetermined times needs to be able to refresh its access token when the user is not present. The default style of access is called `online`.

Server-side web applications, installed applications, and devices all obtain refresh tokens during the authorization process. Refresh tokens are not typically used in client-side (JavaScript) web applications.

If your application needs offline access to a Google API, set the API client's access type to `offline`:

```
$client->setAccessType("offline");
```

After a user grants offline access to the requested scopes, you can continue to use the API client to access Google APIs on the user's behalf when the user is offline. The client object will refresh the access token as needed.

In Python, set the `access_type` keyword argument to `offline` to ensure that you will be able to refresh the access token without having to re-prompt the user for permission. It is very possible that `access_type` will not be the *only* keyword argument that you set, as shown in the example below.

```
authorization_url, state = flow.authorization_url(
    # Enable offline access so that you can refresh an access token without
    # re-prompting the user for permission. Recommended for web server apps.
    access_type='offline',
    # Enable incremental authorization. Recommended as a best practice.
    include_granted_scopes='true')
```

After a user grants offline access to the requested scopes, you can continue to use the API client to access Google APIs on the user's behalf when the user is offline. The client object will refresh the access token as needed.

If your application needs offline access to a Google API, set the API client's access type to `offline`:

```
auth_client.update!(
  :additional_parameters => {"access_type" => "offline"}
)
```

After a user grants offline access to the requested scopes, you can continue to use the API client to access Google APIs on the user's behalf when the user is offline. The client object will refresh the access token as needed.

If your application needs offline access to a Google API, set the API client's access type to `offline`:

```
const authorizationUrl = oauth2Client.generateAuthUrl({
  // 'online' (default) or 'offline' (gets refresh_token)
  access_type: 'offline',
  /** Pass in the scopes array defined above.
    * Alternatively, if only one scope is needed, you can pass a scope URL as a string */
  scope: scopes,
  // Enable incremental authorization. Recommended as a best practice.
  include_granted_scopes: true
});
```

After a user grants offline access to the requested scopes, you can continue to use the API client to access Google APIs on the user's behalf when the user is offline. The client object will refresh the access token as needed.

Access tokens expire. This library will automatically use a refresh token to obtain a new access token if it is about to expire. An easy way to make sure you always store the most recent tokens is to use the tokens event:

```
oauth2Client.on('tokens', (tokens) => {
  if (tokens.refresh_token) {
    // store the refresh_token in your secure persistent database
    console.log(tokens.refresh_token);
  }
  console.log(tokens.access_token);
});
```

This tokens event only occurs in the first authorization, and you need to have set your `access_type` to `offline` when calling the `generateAuthUrl` method to receive the refresh token. If you have already given your app the requisiste permissions without setting the appropriate constraints for receiving a refresh token, you will need to re-authorize the application to receive a fresh refresh token.

To set the `refresh_token` at a later time, you can use the `setCredentials` method:

```
oauth2Client.setCredentials({
  refresh_token: \`STORED_REFRESH_TOKEN\`
});
```

Once the client has a refresh token, access tokens will be acquired and refreshed automatically in the next call to the API.

To refresh an access token, your application sends an HTTPS `POST` request to Google's authorization server (`https://oauth2.googleapis.com/token`) that includes the following parameters:

<table><thead><tr><th colspan="2">Fields</th></tr></thead><tbody><tr><td><code>client_id</code></td><td>The client ID obtained from the <a href="https://console.developers.google.com/">API Console</a>.</td></tr><tr><td><code>client_secret</code></td><td><strong>Optional</strong><p>The client secret obtained from the <a href="https://console.developers.google.com/">API Console</a>.</p></td></tr><tr><td><code>grant_type</code></td><td>As <a href="https://tools.ietf.org/html/rfc6749#section-6">defined in the OAuth 2.0 specification</a>, this field's value must be set to <code>refresh_token</code>.</td></tr><tr><td><code>refresh_token</code></td><td>The refresh token returned from the authorization code exchange.</td></tr></tbody></table>

The following snippet shows a sample request:

```
POST /token HTTP/1.1
Host: oauth2.googleapis.com
Content-Type: application/x-www-form-urlencoded

client_id=your_client_id&
refresh_token=refresh_token&
grant_type=refresh_token
```

As long as the user has not revoked the access granted to the application, the token server returns a JSON object that contains a new access token. The following snippet shows a sample response:

```
{
  "access_token": "1/fFAGRNJru1FTz70BzhT3Zg",
  "expires_in": 3920,
  "scope": "https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/calendar.readonly",
  "token_type": "Bearer"
}
```

Note that there are limits on the number of refresh tokens that will be issued; one limit per client/user combination, and another per user across all clients. You should save refresh tokens in long-term storage and continue to use them as long as they remain valid. If your application requests too many refresh tokens, it may run into these limits, in which case older refresh tokens will stop working.

## Token revocation

In some cases a user may wish to revoke access given to an application. A user can revoke access by visiting [Account Settings](https://myaccount.google.com/permissions). See the [Remove site or app access section of the Third-party sites & apps with access to your account](https://support.google.com/accounts/answer/3466521#remove-access) support document for more information.

It is also possible for an application to programmatically revoke the access given to it. Programmatic revocation is important in instances where a user unsubscribes, removes an application, or the API resources required by an app have significantly changed. In other words, part of the removal process can include an API request to ensure the permissions previously granted to the application are removed.

To programmatically revoke a token, call `revokeToken()`:

```
$client->revokeToken();
```

To programmatically revoke a token, make a request to `https://oauth2.googleapis.com/revoke` that includes the token as a parameter and sets the `Content-Type` header:

```
requests.post('https://oauth2.googleapis.com/revoke',
    params={'token': credentials.token},
    headers = {'content-type': 'application/x-www-form-urlencoded'})
```

To programmatically revoke a token, make an HTTP request to the `oauth2.revoke` endpoint:

```
uri = URI('https://oauth2.googleapis.com/revoke')
response = Net::HTTP.post_form(uri, 'token' => auth_client.access_token)
```

The token can be an access token or a refresh token. If the token is an access token and it has a corresponding refresh token, the refresh token will also be revoked.

If the revocation is successfully processed, then the status code of the response is `200`. For error conditions, a status code `400` is returned along with an error code.

To programmatically revoke a token, make an HTTPS POST request to `/revoke` endpoint:

```
const https = require('https');

// Build the string for the POST request
let postData = "token=" + userCredential.access_token;

// Options for POST request to Google's OAuth 2.0 server to revoke a token
let postOptions = {
  host: 'oauth2.googleapis.com',
  port: '443',
  path: '/revoke',
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(postData)
  }
};

// Set up the request
const postReq = https.request(postOptions, function (res) {
  res.setEncoding('utf8');
  res.on('data', d => {
    console.log('Response: ' + d);
  });
});

postReq.on('error', error => {
  console.log(error)
});

// Post the request with data
postReq.write(postData);
postReq.end();
```

The token parameter can be an access token or a refresh token. If the token is an access token and it has a corresponding refresh token, the refresh token will also be revoked.

If the revocation is successfully processed, then the status code of the response is `200`. For error conditions, a status code `400` is returned along with an error code.

To programmatically revoke a token, your application makes a request to `https://oauth2.googleapis.com/revoke` and includes the token as a parameter:

```
curl -d -X -POST --header "Content-type:application/x-www-form-urlencoded" \
        https://oauth2.googleapis.com/revoke?token={token}
```

The token can be an access token or a refresh token. If the token is an access token and it has a corresponding refresh token, the refresh token will also be revoked.

If the revocation is successfully processed, then the HTTP status code of the response is `200`. For error conditions, an HTTP status code `400` is returned along with an error code.

## Time-based access

Time-based access allows a user to grant your app access to their data for a limited duration to complete an action. Time-based access is available in select Google products during the consent flow, giving users the option to grant access for a limited period of time. An example is the [Data Portability API](https://developers.google.com/data-portability) which enables a one-time transfer of data.

When a user grants your application time-based access, the refresh token will expire after the specified duration. Note that refresh tokens may be invalidated earlier under specific circumstances; see [these cases](https://developers.google.com/identity/protocols/oauth2#expiration) for details. The `refresh_token_expires_in` field returned in the [authorization code exchange](https://developers.google.com/identity/protocols/oauth2/web-server#httprest_3) response represents the time remaining until the refresh token expires in such cases.

## Implementing Cross-Account Protection

An additional step you should take to protect your users' accounts is implementing Cross-Account Protection by utilizing Google's Cross-Account Protection Service. This service lets you subscribe to security event notifications which provide information to your application about major changes to the user account. You can then use the information to take action depending on how you decide to respond to events.

Some examples of the event types sent to your app by Google's Cross-Account Protection Service are:

- `https://schemas.openid.net/secevent/risc/event-type/sessions-revoked`
- `https://schemas.openid.net/secevent/oauth/event-type/token-revoked`
- `https://schemas.openid.net/secevent/risc/event-type/account-disabled`

See the [Protect user accounts with Cross-Account Protection page](https://developers.google.com/identity/protocols/risc) for more information on how to implement Cross Account Protection and for the full list of available events.