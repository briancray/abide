---
"@briancray/belte": minor
---

Stream deferred cache resolutions from the server to the client. Cache entries left pending when SSR flushes are now snapshotted on the server, their resolutions streamed over the response, and reinstalled on the client as streaming placeholders that settle as each resolution arrives. This keeps the SSR/stream split driven by `await` vs `{#await}` without blocking the initial HTML on slow cache reads.
