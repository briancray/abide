---
"@abide/abide": minor
---

BREAKING: `rpc` over a `memo` or a plain value answers `GET` alone. Its writes — a value's `set` and `patch`, a memo's `set`, `patch` and `refresh` — are answered only where `methods` names their verbs: `rpc(board, { methods: ['GET', 'PATCH'] })` takes a browser's `patch`, and anything else is 405. A memo is a computation of the server's data and an exported value is usually configuration, so neither is writable by any caller unless it says so. A bare memo or value in a `<script server>` is read-only the same way; move one that is written to a server file beside the component and name its verbs there. An `rpc`'s type carries `set`, `patch`, `delete`, `run`, `push` and `append` only where it answers their verbs, so a write the server would refuse does not type-check (16.111, 16.112, 16.117).
