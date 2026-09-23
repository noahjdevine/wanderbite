# G14 lost authenticator — operator runbook

This is the only recovery path for an admin who cannot complete the authenticator challenge. The application has no production bypass: no environment flag, query parameter, or shared secret skips MFA.

Factor deletion is operator-side. The app does not delete verified factors and does not call `auth.admin.mfa.deleteFactor`.

## Before you delete a factor

1. Verify the admin's identity out of band. Use a live video or in-person check against a known admin, plus a second channel you already trust. A password, a reset email, or an authenticator code they cannot produce is not identity verification.
2. Write an `admin_audit_log` row before any factor deletion. Use the service role outside this app, after identity verification is recorded and before `deleteFactor`:
   - `actor_user_id`: the operator's user id
   - `action`: `auth.mfa_factor_delete`
   - `target_type`: `auth_factor`
   - `target_id`: the factor id
   - `metadata`: `{ "subject_user_id": "<user uuid>", "identity_verification": "recorded", "verified_factor": true }`
3. Only after that audit record exists, delete the factor with the Auth admin API:

```ts
await supabase.auth.admin.mfa.deleteFactor({
  userId: '<subject user uuid>',
  id: '<factor uuid>',
})
```

Do this from a trusted operator shell. Do not add an in-app button, env flag, or shared secret that performs this step.

## What deletion does to sessions

Deleting a verified factor logs the user out of all active sessions. Supabase documents that on `deleteFactor`: https://supabase.com/docs/reference/javascript/auth-admin-deletefactor

Tell the admin they will be signed out. They sign in again, then enroll a new authenticator at `/admin`. Enrollment still cannot open dashboard data until the new factor is verified and the session `currentLevel` is `aal2`.

## Do not

- Do not set an environment flag, query parameter, or shared secret to skip MFA in production.
- Do not delete a factor before identity verification and the audit record.
- Do not change hosted Auth settings from this local group.
