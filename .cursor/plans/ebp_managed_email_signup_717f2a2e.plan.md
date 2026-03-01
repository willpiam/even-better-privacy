---
name: EBP Managed Email Signup
overview: "Add managed EBP email accounts backed by a self-hosted Postfix + Dovecot Docker setup. Code changes are small: a signup API endpoint, a provisioning helper in the DB layer, an EBP Mail mode toggle in the GUI (mirroring Gmail mode), and a signup form."
todos:
  - id: mail-infra
    content: Create mail-server/ dir with docker-compose, Postfix, and Dovecot configs
    status: pending
  - id: db-mailboxes
    content: Add mailboxes table + helper functions in server/db.ts
    status: pending
  - id: server-signup-api
    content: Add signup and check-username endpoints in server/main.ts
    status: pending
    dependencies:
      - db-mailboxes
  - id: gui-ebp-mail-mode
    content: Add EBP Mail mode toggle in gui/index.html and gui/app.js (mirror Gmail mode)
    status: pending
  - id: gui-signup-form
    content: Add signup form + handler in gui/index.html and gui/app.js
    status: pending
    dependencies:
      - server-signup-api
      - gui-ebp-mail-mode
---

# Plan: EBP Managed Email

## What This Is

Users can sign up for `username@<your-ebp-domain>` email addresses through the EBP GUI. Behind the scenes, Postfix and Dovecot run in Docker containers alongside the existing key server, authenticating against the same PostgreSQL database. The user enters a username and password, the mailbox gets provisioned, and their mail account auto-configures. They never think about IMAP hosts or SMTP ports.

If they want to use Thunderbird or any other client, the connection details are visible in the account settings -- they are just hidden by default in "EBP Mail mode", exactly like Gmail mode hides Gmail's details today.

## What Does Not Require Code Changes

**The entire IMAP/SMTP email pipeline.** The existing local backend already connects to any IMAP/SMTP server via the `buildImapClient` / `nodemailer.createTransport` code in [`gui/local-backend/main.ts`](gui/local-backend/main.ts). Postfix and Dovecot are standard mail servers; the local backend talks to them the same way it talks to Gmail or Proton Bridge. No transport-layer code changes.

## Infrastructure: Postfix + Dovecot in Docker

All self-hosted. No SaaS. One `docker-compose.yml` that brings up three containers: PostgreSQL, Postfix, and Dovecot. The existing key server container can sit alongside or inside the same compose file.

Create a `mail-server/` directory at the project root:

```
mail-server/
  docker-compose.yml      # postgres + postfix + dovecot
  dovecot/
    dovecot.conf           # main config
    dovecot-sql.conf       # SQL auth queries against mailboxes table
  postfix/
    main.cf                # virtual_mailbox_domains, virtual_transport = lmtp
    virtual_mailbox_maps.cf # SQL lookup for delivery
    sasl_passwd.cf          # SASL auth via Dovecot
```

- **Dovecot** authenticates users by querying `SELECT username, password_hash FROM mailboxes WHERE username = ? AND domain = ? AND active = true` against PostgreSQL. Serves IMAP on port 993 (TLS) and LMTP for local delivery from Postfix.
- **Postfix** accepts inbound mail for the configured domain, delivers via LMTP to Dovecot. Provides SMTP submission on port 465 (implicit TLS) with SASL authentication delegated to Dovecot.
- Password hashes use Dovecot's native `{BLF-CRYPT}` (bcrypt) format so Dovecot handles verification directly from the DB column.

## Code Changes (Small, 4 Touches)

### 1. Database: `mailboxes` table in [`server/db.ts`](server/db.ts)

Add the table to both the SQLite and PostgreSQL schema init blocks (same pattern as the existing `identities`, `details`, `revocations` tables):

```sql
CREATE TABLE IF NOT EXISTS mailboxes (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  domain TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  identity_fingerprint TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at BIGINT NOT NULL,
  UNIQUE(username, domain),
  FOREIGN KEY(identity_fingerprint) REFERENCES identities(fingerprint)
);
```

Add helper functions: `insertMailbox`, `getMailboxByUsername`, `isUsernameAvailable`. These follow the exact same pattern as the existing `insertIdentity`, `getIdentity`, etc.

### 2. Server API: signup endpoint in [`server/main.ts`](server/main.ts)

Two new routes:

- **`GET /api/v1/mail/check-username?username=alice`** -- returns `{ available: true/false }`. Simple DB lookup.
- **`POST /api/v1/mail/signup`** -- accepts `{ username, password, fingerprint? }`, validates the username (3-30 chars, alphanumeric + dots/hyphens, not reserved), hashes the password with bcrypt in Dovecot-compatible format, inserts into `mailboxes`, returns the full email and connection details:
```json
{
  "ok": true,
  "email": "alice@ebpmail.org",
  "imap": { "host": "mail.ebpmail.org", "port": 993, "secure": true },
  "smtp": { "host": "mail.ebpmail.org", "port": 465, "secure": true }
}
```


The host values come from new env vars `MAIL_DOMAIN` and `MAIL_HOST`. Rate-limited. Guarded by `MAIL_SIGNUP_ENABLED=true` (default off).

### 3. GUI: "EBP Mail mode" toggle in [`gui/index.html`](gui/index.html) + [`gui/app.js`](gui/app.js)

Mirror the existing Gmail mode pattern exactly. In `index.html`, add a checkbox next to the Gmail one:

```html
<label class="inline"><input id="mail-ebp-mode" type="checkbox" /> EBP Mail mode</label>
```

In `app.js`, add an `applyEbpMailModeUi()` function (modeled on `applyGmailModeUi()` at line 1749) that:

- Hides IMAP host/port, SMTP host/port, username, and the separate password pair fields
- Shows a single "Password" field (same password for IMAP and SMTP since it's one account)
- Auto-fills the host/port/TLS values from the server's configured `MAIL_HOST`
- Sets username = fromEmail

When the form submits and EBP mode is checked, the handler overrides the account config with the known EBP mail server values (same approach as lines 2094-2101 for Gmail mode).

### 4. GUI: Signup form in [`gui/index.html`](gui/index.html) + [`gui/app.js`](gui/app.js)

Add a small section above the account setup form:

```html
<section id="mail-signup-section">
  <h3>Sign Up for EBP Email</h3>
  <p class="small muted">Get a free email address. No external accounts or configuration needed.</p>
  <form id="mail-signup-form" class="stack">
    <div class="row">
      <input id="mail-signup-username" type="text" placeholder="desired-username" />
      <span class="muted">@ebpmail.org</span>
    </div>
    <div id="mail-signup-availability" class="small"></div>
    <label>Password
      <input id="mail-signup-password" type="password" />
    </label>
    <button type="submit">Create Email Account</button>
  </form>
</section>
```

The JS handler:

1. Calls `POST /api/v1/mail/signup` on the configured EBP key server.
2. On success, automatically creates a local mail account (calls the existing `POST /api/v1/mail/account` local backend endpoint) with EBP mode on, using the returned host/port values and the user's password.
3. The user is immediately ready to send/receive. Zero extra steps.

A debounced `input` listener on the username field calls `GET /api/v1/mail/check-username` for real-time availability feedback.

### Exporting Connection Details

The existing account setup form already shows all IMAP/SMTP fields. When EBP Mail mode is toggled off, those fields become visible again (read-only or editable). Users who want to plug their EBP email into Thunderbird, Apple Mail, etc. can see and copy the host, port, TLS setting, and username from there. No extra code needed -- the toggle hides/shows, same as Gmail mode.

## New Environment Variables

| Variable | Example | Purpose |

|---|---|---|

| `MAIL_DOMAIN` | `ebpmail.org` | Domain suffix for managed addresses |

| `MAIL_HOST` | `mail.ebpmail.org` | IMAP/SMTP hostname clients connect to |

| `MAIL_SIGNUP_ENABLED` | `true` | Gate for the signup endpoint |

## File Summary

| File | Change |

|---|---|

| `mail-server/` (new dir) | Docker Compose + Postfix/Dovecot configs |

| [`server/db.ts`](server/db.ts) | `mailboxes` table + 3 helper functions |

| [`server/main.ts`](server/main.ts) | 2 new route handlers (~80 lines) |

| [`gui/index.html`](gui/index.html) | EBP Mail checkbox + signup form HTML |

| [`gui/app.js`](gui/app.js) | `applyEbpMailModeUi()` + signup handler |