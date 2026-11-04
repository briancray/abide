---
"@abide/abide": patch
---

the build on disk is one module, and booting from a compilation is one ordering ([`a3a5349`](https://github.com/briancray/abide/commit/a3a5349baa9c55c9a931f00d635a57743ddf1cdc))

An app with no `src/` — its root is its package — now keeps its default `.abide` build and its `bun test` build cache inside the package rather than in the directory above it, as RULEBOOK 38.27 has a build sit beside its app; an app with a `src/` is unchanged.
