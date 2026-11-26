---
"@abide/abide": minor
---

A `<script server>` exports bare values: each is its component's private handler, at the verbs its value answers by — a function's `GET`, a value's `GET`, `PUT` and `PATCH`, a global memo's read, `set`, `patch` and `refresh` (16.70, 16.117). Importing `rpc` there is a compile error, and `rpc` over a value that is an `rpc` already is refused (16.119): anything taking options — `methods`, `address`, `middleware` — is a server file's `rpc`. `abide upgrade --from 0.144.0` exports an option-less `rpc` in a server block as its value, and notes each one that takes options (38.231).
