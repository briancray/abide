---
"@abide/abide": minor
---

`form(handler)` hands back parts an app spreads onto a `<form>` and fields of its own. A submit reads the fields as a post carries them, checks them against the handler's args document before calling it — the same document the server holds the call to, so the browser's message is the server's — and shows what is wrong beside each field, from its own check or from the call's `ValidationError` alike. Focus goes to the first field with a message, an edit checks the form again, `submit` is disabled while the call is in flight, and a `POST`'s form posts to the handler with no script. The build now reads a handler's `args` written as `jsonSchema` over a literal as its args document, and a mutation's browser copy holds it (RULEBOOK 56.1-56.12, 19.28, 19.29, 19.13).
