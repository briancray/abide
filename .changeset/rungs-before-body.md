---
"@abide/abide": patch
---

A no-argument mutation behind `middleware` no longer starts its body before its rungs run. Dropping the previous call's answer built the request's instance of the handler, which started the body ahead of every rung, so a refusing rung (`signedIn`) answered after the body had already run. Calling the same mutation twice in one request now writes twice behind rungs as well (RULEBOOK 16.7, 16.11, 16.16).
