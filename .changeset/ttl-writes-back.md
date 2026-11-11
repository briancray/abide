---
'@abide/abide': minor
---

`ttl` on a value with no producer now writes it back to the value it was built with, `ttl` ms after a write, where it used to do nothing (6.2). `let copied = reactive(false, { ttl: 2_000 })` is a flag that resets itself with no `setTimeout`. A later write restarts the clock (6.11), a write of the opening value stops it (6.12), a refused write leaves it alone (6.13), and the timer never holds the process open (6.4) and stops with the setup or request that built the value (6.14). What is written back is a fresh copy of the opening value as it was built, so a `patch` never changes it (6.15), and an opening value `structuredClone` cannot copy whole — a function, a promise, a class instance — is refused at construction (6.16). A value with a body or a `store` keeps the expiry it had.
