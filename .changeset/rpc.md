---
"@abide/abide": minor
---

`rpc` replaces `GET`, `POST`, `PUT`, `PATCH` and `DELETE`: one name, its verbs read off the value — a function is read by `GET`, a value is read by `GET` and changed by `PUT` and `PATCH` (the server's one value, a browser's `set` and `patch` sent to it) — or named by `methods` (16.111-16.116). A handler file is a server file: `<name>.server.ts` directly in an address directory answers its default `rpc` at its route and each named `rpc` below it, or wherever `address` says, and server code imports the same callable the browser does (16.2, 16.73, 16.74, 16.113). A `GET` whose args outgrow its URL is sent as `QUERY` (16.114). A `<script server>` exports the values its component calls in place of declaring private handlers (16.70, 34.17). `abide upgrade --from 0.144.0` moves an app over (38.231).
