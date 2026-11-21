---
"@abide/abide": patch
---

An early call of a streaming `GET` whose handler writes a cookie or signs someone in or out through `cookies()` or `principal` is answered whole over http, as RULEBOOK 16.97 says. Before, the check read only the headers on the answer the handler built, so such a call was still handed to the socket mux and its rest parked under the caller as it was.
