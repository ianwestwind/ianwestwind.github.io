# Firebase admin access (add project / permissions)

If you see **"Missing or insufficient permissions"** when adding a Design or Software project, check the following.

## 1. Deploy Firestore rules

After any change to `firestore.rules`, deploy:

```bash
firebase deploy --only firestore:rules
```

Until this is run, the latest rules are **not** active.

## 2. Your user document must exist and have `role: "admin"`

- Open [Firebase Console](https://console.firebase.google.com) → your project → **Firestore Database**.
- Find the **`users`** collection.
- Open (or create) the document whose **document ID is your user UID** (the same ID shown in Authentication → Users for your account).

Ensure the document has a field:

- **Name:** `role`
- **Type:** string
- **Value:** `admin` (or `Admin` — both are accepted)

If the document is missing, create it with at least:

- `role` (string) = `admin`
- `email` (string) = your email
- `displayName` (string) = optional

## 3. Confirm you’re signed in

You must be signed in when adding a project. If the session expired, sign out and sign in again, then try adding a project again.
