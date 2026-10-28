# Login standard: deliberate exception for the hackathon

John's standard for every app with user accounts is: email + password sign-in, Sign in with Google, Sign in with Apple, forgot-password reset by email, forgot-username recovery, and two matching password boxes.

citycenter is being built in nine days for the Meta Global AI Developer Hackathon (Oct 26 to Nov 4, 2026). For that window it deliberately has **no user accounts**:

- Residents never sign in. Each application gets a reference code (for example `SC-2026-0104`), and the resident uses that code to come back to their packet.
- Town staff share one passcode (`STAFF_PASSCODE` in the server's environment). The server checks it and sets a signed, HttpOnly cookie. There is no username and nothing to reset.

Decision recorded 2026-10-27 (Claude Code, pending John's confirmation in chat). If citycenter continues after the hackathon, the full standard applies and this file becomes the to-do list:

Update 2026-10-28: John asked for residents to be able to log back in and keep working. Resident accounts now exist, built with Node built-ins (no Supabase in this stack):

- [x] Email + password sign-in (`/api/resident/signup`, `/api/resident/login`; scrypt-hashed passwords; signed HttpOnly cookie, 30 days)
- [x] Two matching password boxes on sign-up
- [x] A resident's visits are listed under "My visits"; opening a visit by reference + key while signed in attaches it to the account
- [ ] Sign in with Google (needs a Google Cloud OAuth client; not set up during the hackathon)
- [ ] Sign in with Apple (needs an Apple Developer identifier; not set up)
- [ ] Forgot password by email (the app has no email sender yet)
- [ ] Forgot username/email recovery (same reason)
- [ ] Row-level security: every session is still readable with its reference + access key, by design for the demo; after the hackathon, sessions owned by an account should require that account
