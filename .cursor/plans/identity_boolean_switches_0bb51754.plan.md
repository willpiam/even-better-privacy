---
name: Identity boolean switches
overview: Replace the two "true or false" TextInputs on the mobile identity detail page with labeled React Native Switches, matching the existing Settings / Mail account setup pattern.
todos: []
isProject: false
---

# Identity page boolean switches

## Scope

Only [`mobile/src/screens/IdentityDetailScreen.tsx`](mobile/src/screens/IdentityDetailScreen.tsx). Two booleans are currently collected as free-text:

- **Add Detail** — `detailPush` (`useState('false')`, compared with `=== 'true'`)
- **Revocation** — `revokePush` (same pattern; shared by Revoke Detail and Revoke Identity)

Other screens (`SignVerifyScreen`, `EncryptDecryptScreen`) have the same anti-pattern; leave those for a follow-up.

## Approach

Use React Native `Switch` with a labeled row — already established in [`SettingsScreen.tsx`](mobile/src/screens/SettingsScreen.tsx) and [`MailAccountSetupScreen.tsx`](mobile/src/screens/mail/MailAccountSetupScreen.tsx):

```tsx
<View style={styles.switchRow}>
  <Text style={styles.switchLabel}>Push to server</Text>
  <Switch value={detailPush} onValueChange={setDetailPush} />
</View>
```

## Changes in IdentityDetailScreen

1. Import `Switch` from `react-native`.
2. Change state to real booleans:
   - `const [detailPush, setDetailPush] = useState(false)`
   - `const [revokePush, setRevokePush] = useState(false)`
3. Pass booleans directly into service calls (`push: detailPush`, `push: revokePush`) instead of `=== 'true'`.
4. Replace both placeholder TextInputs with labeled switch rows (label: **Push to server**).
5. Add styles matching the existing pattern:

```tsx
switchRow: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 12,
},
switchLabel: {flex: 1, marginRight: 12, color: '#111'},
```

No new shared component — keep the change local and consistent with neighboring screens.