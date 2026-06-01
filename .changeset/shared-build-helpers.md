---
"@briancray/belte": patch
---

Extract repeated build-time logic into single-purpose shared helpers and collapse the per-virtual manifest codegen. `manifestModule` builds the `belte:rpc`/`sockets`/`prompts`/`pages`/`layouts` virtual modules from one path; `bundleLayout` derives `libDir`/`resourcesDir`/`envPath` from `binDir` (replacing the narrower `shippedEnvPath`) so the build writer and boot readers agree; `readPackageJson`, `exeSuffix`, `browserClientFlags`, and `memoizeByKey` deduplicate the package.json reader, the windows `.exe` suffix, the browser proxies, and the server route loaders. No public API change; behaviour preserved.
