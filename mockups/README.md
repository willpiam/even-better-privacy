# EBP interface exploration

A proposed desktop and mobile redesign in plain HTML, CSS, and JavaScript. No build step, framework, network requests, or app backend is required.

Open **index.html** in a browser for the prototype studio. If your browser restricts local iframes, serve this directory:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory mockups
```

Then visit http://127.0.0.1:8000/ . Open **app.html** directly for the responsive interface without the studio. `app.html?screen=contacts` (or `mail`, `chat`, `identities`, `tools`, `settings`) opens a particular screen.

## Review the design

- **Desktop / Mobile / Compare** switch the preview layout. Compare presents two independent, scrollable artboards.
- The screen selector navigates both artboards. Design notes explain the direction and available interactions.
- Mail: open a message, search, filter unread/starred/sent, star, archive, inspect security, reply, or compose a preview. Preview sends appear in Sent.
- Chat: open a conversation and send a simulated message. New chat opens the contact picker.
- Identities: switch Personal/Work, inspect details, and preview the creation/backup handoff.
- Contacts: search, add an unverified sample contact, inspect details, and start a conversation.
- Tools: preview encrypt/decrypt/sign/verify workflows with explicit simulated result states.
- Settings: change appearance and the sample notification preference. On mobile, open the profile circle, then **Workspace settings**.

The design replaces the dense utility-first navigation with familiar communication surfaces, consistent identity context, and security details available where they matter. Desktop uses a sidebar, message list, and reader. Mobile uses bottom navigation and a list-to-detail flow. Warm neutrals and muted green carry across both sizes; dark appearance is available in Settings.

## Scope

This is a reviewable design proposal, separate from `gui/` and `mobile/`. All messages, identities, keys, signatures, and verification states are fictional. Nothing is sent; no cryptography is performed. State is held in memory and resets on reload. Identity creation ends at a proposed key-backup handoff. File crypto, certificates, diagnostics, and full account onboarding are outside this exploration.

The implementation uses system fonts, inline SVG icons, labeled form controls, native modal dialogs, visible keyboard focus, and reduced-motion support. It has no external assets or runtime dependencies.
