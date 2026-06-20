---
"@abide/abide": patch
---

perf(ssr): preload the client entry in `<head>` so it downloads during a streamed render. The entry `<script type="module">` sits before `</body>`, which on a streaming page (top-level `{#await}`) arrives only after the whole stream — so the browser couldn't start fetching the bundle until the stream closed. `injectShellAssets` now also emits `<link rel="modulepreload" href="/_app/client.js">` in `<head>` (rebased + hashed like the other entry refs), overlapping the entry transfer with the streamed body. Execution still defers to parse-end (module script), so hydration ordering — including the trailing `__abideResolve(...)` cache seeds — is unchanged.
