---
"@belte/belte": patch
---

`belte dev` no longer reloads the browser after server-only edits. Each dev worker announces a fingerprint of the browser-visible surface (client build contents, public/ stamps, shell) as the first event on the live-reload channel; the page reloads on reconnect only when the fingerprint changed, so editing rpc/socket/server code keeps the page — and all of its UI state — alive while the new server behavior applies on the next request.
