---
"@abide/abide": patch
---

`onLauncher` answering a known option as `undefined` — `{ vibrancy: dark ? 'sidebar' : undefined }` — keeps that option's default rather than refusing the launcher and leaving the native app unopened (59.1). A key that is not a launcher option is still refused.
