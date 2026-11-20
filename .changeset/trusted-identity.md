---
"@abide/abide": minor
---

`trustedIdentity({ header, proxies, claims })` signs in the caller a single sign-on proxy in front of the app names in a header — believed only on a request whose peer, as `request.ip` answers it, is one of `proxies` — for that request alone, with no cookie sealed, so `signedIn` and `requireRole` admit them as any caller (RULEBOOK 54.35-54.37)
