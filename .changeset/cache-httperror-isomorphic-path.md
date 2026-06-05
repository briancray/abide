---
"@briancray/belte": minor
---

`cache` and `HttpError` move from the `browser`/`server` namespaces to `shared`, which now denotes the isomorphic surface — names that are the same callable with the same behaviour on both sides. `cache()` runs in SSR and MCP request scope just as it does on the client, so importing it as a "browser" module misrepresented it; its client-only streaming/hydration helpers stay in `browser/` and its server-only snapshot helpers stay in `server/runtime/`. Update imports: `belte/browser/cache` → `belte/shared/cache`, and `belte/browser/HttpError` (or `belte/server/HttpError`) → `belte/shared/HttpError`.

The package `exports` map is now an explicit allowlist of the public API instead of per-directory `*` globs, so internal modules (machinery under `shared/`, runtime/registry internals under `server/`, launcher internals under `bundle/`, and all `types/` subtrees) are no longer reachable via the package specifier. Only documented names — the verb/response/context helpers, `cache`, `HttpError`, `page`/`navigate`/`subscribe`, the `bundle` window config, the test client, and the build/plugin entries — resolve. Importing an unlisted internal path now fails; use the public name instead.
