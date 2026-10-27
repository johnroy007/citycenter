# Login standard: deliberate exception for the hackathon

John's standard for every app with user accounts is: email + password sign-in, Sign in with Google, Sign in with Apple, forgot-password reset by email, forgot-username recovery, and two matching password boxes.

citycenter is being built in nine days for the Meta Global AI Developer Hackathon (Oct 26 to Nov 4, 2026). For that window it deliberately has **no user accounts**:

- Residents never sign in. Each application gets a reference code (for example `SC-2026-0104`), and the resident uses that code to come back to their packet.
- Town staff share one passcode (`STAFF_PASSCODE` in the server's environment). The server checks it and sets a signed, HttpOnly cookie. There is no username and nothing to reset.

Decision recorded 2026-10-27 (Claude Code, pending John's confirmation in chat). If citycenter continues after the hackathon, the full standard applies and this file becomes the to-do list:

- [ ] Supabase Auth: email + password
- [ ] Sign in with Google
- [ ] Sign in with Apple
- [ ] Forgot password (reset by email)
- [ ] Forgot username/email recovery
- [ ] Two matching password boxes on create/change
- [ ] Row-level security on every table once real accounts exist
