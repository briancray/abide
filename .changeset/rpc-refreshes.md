---
'@abide/abide': minor
---

A mutation (`POST`, `PUT`, `PATCH`, `DELETE`) takes `refreshes`: the `tags` (or a function of the call's args returning them) that each run answering without a refusal refreshes on the server, reaching every tab following a value carrying one of them — `POST(write, { refreshes: ['stage:won'] })` in place of a `refresh({ tags })` after every call (16.89). It runs before the answer settles or is sent (16.90), at a streamed answer's close and not where the stream fails (16.91), and `GET` does not take it: a type error, and refused where a `GET` is declared with it (16.92).
