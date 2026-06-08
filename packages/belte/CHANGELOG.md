# @belte/belte

## 0.19.1

### Patch Changes

- [`c392c5a`](https://github.com/briancray/belte/commit/c392c5abf08a070617e7bfa1094cc38a20cba002) - read the page store during SSR via a request-scoped resolver ([`85f4c7a`](https://github.com/briancray/belte/commit/85f4c7a486191847772553cd62b34315a15a6438))

## 0.18.0

### Minor Changes

- [`e21b424`](https://github.com/briancray/belte/commit/e21b424e775e893a6d2655045223743c655e366d) - add a same-origin manual rebuild trigger to dev: `POST /__belte/reload` (sibling of the `/__belte/dev` live-reload channel) signals the orchestrator over IPC to rebuild + restart on command. Pair it with `BELTE_DEV_NO_WATCH=1 belte dev`, which skips the src/ file watcher so a long-lived in-process job (e.g. an agent editing the app's own source) isn't torn down by a save. Default `belte dev` is unchanged; the trigger adds no extra port.

### Patch Changes

- [`b1e00c8`](https://github.com/briancray/belte/commit/b1e00c89e9d18fefaa84aff43fcf08fd5ee703bb) - rename constants to UPPERCASE_SNAKE_CASE ([`d1cc5d2`](https://github.com/briancray/belte/commit/d1cc5d2b09f4344167cfd09d698aef3fb49382c3))

## 0.17.1

### Patch Changes

- [`e643a7e`](https://github.com/briancray/belte/commit/e643a7e74850e4d17435a868f6b71f20b37d7612) - isolate dev builds to staging dirs and reap the server child on exit ([`0f4d97e`](https://github.com/briancray/belte/commit/0f4d97e3194d6dff652a434ab78c8bb651cdefe4))

## 0.17.0

### Minor Changes

- [`41625d6`](https://github.com/briancray/belte/commit/41625d6be7b2e86030a9811039317b8396c1e702) - report post-invalidate reloads via cache.refreshing ([`0008664`](https://github.com/briancray/belte/commit/00086640bc957f6fb65fb5bd00a06d622dc96996))

### Patch Changes

- [`41625d6`](https://github.com/briancray/belte/commit/41625d6be7b2e86030a9811039317b8396c1e702) - sync examples and template with 0.16 (bundled, DEBUG=belte) ([`590152d`](https://github.com/briancray/belte/commit/590152d71cd2cba77d9f39970c6590cc8285b2e6))

## 0.16.0

### Minor Changes

- [`38bdca6`](https://github.com/briancray/belte/commit/38bdca60b6a05496f16b87a89660c0e4742b894c) - add bundled() to detect the desktop bundle ([`3cdca36`](https://github.com/briancray/belte/commit/3cdca36d5d31b6ffc3eaf88adc296ee5f285eb83))

### Patch Changes

- [`38bdca6`](https://github.com/briancray/belte/commit/38bdca60b6a05496f16b87a89660c0e4742b894c) - extract clientBuildPlugins for the page and connect-screen builds ([`0974367`](https://github.com/briancray/belte/commit/0974367947b4619780b8d60f959c9067974f437b))

- [`38bdca6`](https://github.com/briancray/belte/commit/38bdca60b6a05496f16b87a89660c0e4742b894c) - share a defaultPort across server, dev, and embedded launcher ([`27f91e5`](https://github.com/briancray/belte/commit/27f91e512963b0a82d39f66c20778ee9191c9f07))

- [`38bdca6`](https://github.com/briancray/belte/commit/38bdca60b6a05496f16b87a89660c0e4742b894c) - extract importNamesToStrip for the server-stub strip ([`2b28922`](https://github.com/briancray/belte/commit/2b28922576202daee109170774e2b763de786b7e))

- [`38bdca6`](https://github.com/briancray/belte/commit/38bdca60b6a05496f16b87a89660c0e4742b894c) - render the boot surface map as aligned page/socket/rpc tables ([`2b336af`](https://github.com/briancray/belte/commit/2b336af13c8b2a375d4e2d9e6bebfcdce8ab2c9d))

- [`38bdca6`](https://github.com/briancray/belte/commit/38bdca60b6a05496f16b87a89660c0e4742b894c) - resolve the SPA target view before writing history ([`5685e05`](https://github.com/briancray/belte/commit/5685e051eedda4267ced59c12d92441285d48d41))

- [`38bdca6`](https://github.com/briancray/belte/commit/38bdca60b6a05496f16b87a89660c0e4742b894c) - avoid per-call array allocation in forwardHeaders ([`acc859b`](https://github.com/briancray/belte/commit/acc859b7f213a1349e1fefd106ff146aa1dd0a24))

## 0.15.0

### Minor Changes

- [`c9d0d8b`](https://github.com/briancray/belte/commit/c9d0d8bb3102c5baabf680cef310963626558658) - dev orchestrator with browser live-reload ([`5d2b392`](https://github.com/briancray/belte/commit/5d2b392a41a659bf3b198a29930dde4caf4f44d0))

## 0.14.0

### Minor Changes

- [`559772c`](https://github.com/briancray/belte/commit/559772cdee4f496629a3e2cb5c38a1f4206703d9) - configurable SSR/MCP header forwarding and a boot-time surface map ([`6f03a53`](https://github.com/briancray/belte/commit/6f03a5367cd3d16a7f51910a992cf081fb6e0b02))

- [`559772c`](https://github.com/briancray/belte/commit/559772cdee4f496629a3e2cb5c38a1f4206703d9) - add cache.refreshing() reactive revalidation probe ([`8ab8666`](https://github.com/briancray/belte/commit/8ab866670888970c728aa68c4d20999e19d46756))

### Patch Changes

- [`559772c`](https://github.com/briancray/belte/commit/559772cdee4f496629a3e2cb5c38a1f4206703d9) - prevent cache-key collisions for Date/Map/Set/bigint args ([`3910cbf`](https://github.com/briancray/belte/commit/3910cbf3d3a3e7204df91a8a55284b00a5c052a0))

## 0.13.2

### Patch Changes

- [`0dfb38f`](https://github.com/briancray/belte/commit/0dfb38f16ab42d9d25806a9fad8fdfd6846b708f) - wire bun test preload and complete belte command scripts in scaffold + examples ([`6bd497a`](https://github.com/briancray/belte/commit/6bd497a065190f0afdd4445848e7322a8b120d50))

## 0.13.1

### Patch Changes

- [`bfbc36c`](https://github.com/briancray/belte/commit/bfbc36c940ace6422c873693258d5c409d6406e9) - Publish an up-to-date README and include `CHANGELOG.md` in the package tarball. The npm copy of the README had drifted from the maintained source; the changelog is now shipped alongside it.

## 0.13.0

### Minor Changes

- [`e052e54`](https://github.com/briancray/belte/commit/e052e5457bec12774b56e095c7ede98c6eb5a945) - add 'belte run' to execute scripts under the belte preload ([`fc77a20`](https://github.com/briancray/belte/commit/fc77a20ec535223cfe56c5f134d812449558047f))

### Patch Changes

- [`e052e54`](https://github.com/briancray/belte/commit/e052e5457bec12774b56e095c7ede98c6eb5a945) - resolve server() in-process so handler idioms don't throw in tests ([`03cc3c1`](https://github.com/briancray/belte/commit/03cc3c1a6fb0ebc3b42156b450952dfc5336819e))

## 0.12.0

### Minor Changes

- [#40](https://github.com/briancray/belte/pull/40) [`26ba6fe`](https://github.com/briancray/belte/commit/26ba6fe710002f84b99947f7b198fa3b3f235d53) Thanks [@briancray](https://github.com/briancray)! - Namespace the CLI's baked env under `BELTE_` and add data-dir controls.

  **Breaking:** `APP_URL` → `BELTE_APP_URL` and `APP_TOKEN` → `BELTE_APP_TOKEN`. These are the values baked into a downloaded CLI's `.env` (the hosted server URL, derived from the request origin, plus the bearer token when the download was authenticated) and read by the thin client to resolve its connection target. `BELTE_APP_URL` is now public, documented surface — app code can read it to refer to the app's hosted location. Existing baked binaries and any shell `APP_URL`/`APP_TOKEN` overrides must switch to the prefixed names.

  **Added:** `belte/server/appDataDir` — a zero-arg accessor returning the running bundle's per-user data dir, keyed to the same program name belte uses for the user's `.env`/`last-connection.json`, so an app's DB/cache lands beside belte's own config rather than a drifted sibling directory.

  **Added:** `BELTE_DATA_DIR` — overrides the data dir on every platform, used as-is. A cross-platform `XDG_DATA_HOME` (which the helper otherwise honours on Linux only), letting dev point at a throwaway dir without touching app code. Must come from a layer above the data-dir `.env` (shell, CWD `.env`, or binary-dir `.env`), since it decides where that file lives.

- [#40](https://github.com/briancray/belte/pull/40) [`310eceb`](https://github.com/briancray/belte/commit/310ecebebd018df62155d18ac01a376f5a0f42ba) Thanks [@briancray](https://github.com/briancray)! - Remove the `key` option from `cache()`.

  **Breaking:** `cache(fn, { key })` and the `{ key }` selector form of `cache.invalidate` / `cache.pending` are gone. Cache keys are always auto-derived — method+url+args for a remote function, producer-reference+args for a plain producer. To share an entry across calls, hoist the producer to a stable reference (an inline arrow gets a fresh identity every call and never dedupes). To target a set of unrelated calls with one `cache.invalidate`, tag them with a `scope`; a unique tag (e.g. a uuid) gives a set of calls their own private invalidation group.

## 0.11.1

### Patch Changes

- [#38](https://github.com/briancray/belte/pull/38) [`cb22ce9`](https://github.com/briancray/belte/commit/cb22ce91b83b755e480f2ff0abdb8a246f5e7ff9) Thanks [@briancray](https://github.com/briancray)! - Restore `belte/shared/log` as a public export. The 0.11 switch from `./shared/*` globs to an explicit allowlist dropped this isomorphic utility along with the genuinely-internal machinery: `log` is the framework's `[belte]` logger (browser + server, color-aware, with `log.debug(scope, message)` gated by `DEBUG`), documented public surface rather than an internal, so it is listed again. The `isDebugEnabled` matcher stays internal — `log.debug` already gates on it, so consumers reach for `log.debug`/`console.debug`, never the matcher directly.

## 0.11.0

### Minor Changes

- [`a1d1d56`](https://github.com/briancray/belte/commit/a1d1d56efe4887bebb74dd6707cf7cb38d8b4771) - `cache` and `HttpError` move from the `browser`/`server` namespaces to `shared`, which now denotes the isomorphic surface — names that are the same callable with the same behaviour on both sides. `cache()` runs in SSR and MCP request scope just as it does on the client, so importing it as a "browser" module misrepresented it; its client-only streaming/hydration helpers stay in `browser/` and its server-only snapshot helpers stay in `server/runtime/`. Update imports: `belte/browser/cache` → `belte/shared/cache`, and `belte/browser/HttpError` (or `belte/server/HttpError`) → `belte/shared/HttpError`.

  The package `exports` map is now an explicit allowlist of the public API instead of per-directory `*` globs, so internal modules (machinery under `shared/`, runtime/registry internals under `server/`, launcher internals under `bundle/`, and all `types/` subtrees) are no longer reachable via the package specifier. Only documented names — the verb/response/context helpers, `cache`, `HttpError`, `page`/`navigate`/`subscribe`, the `bundle` window config, the test client, and the build/plugin entries — resolve. Importing an unlisted internal path now fails; use the public name instead.

- [`a1d1d56`](https://github.com/briancray/belte/commit/a1d1d56efe4887bebb74dd6707cf7cb38d8b4771) - `cache()` now memoises plain producers, not just rpc verb helpers — pass any `() => Promise<T>` to dedupe and retain external calls (e.g. a third-party `fetch` the server makes). Producers key on the function's reference plus args (so hoist the function, or pass an explicit `key`; an inline arrow is a fresh reference every call and never dedupes), and the value promise is stored as-is — no Response decode and no SSR snapshot. A new `global: true` option puts the entry in a process-level store instead of the request-scoped one, so a value computed in one request is reused by later ones; omit it to keep per-request data from leaking across requests, and note it is a no-op on the client (one tab store). `cache.invalidate` / `cache.pending` accept a producer reference and span both stores.

- [`a1d1d56`](https://github.com/briancray/belte/commit/a1d1d56efe4887bebb74dd6707cf7cb38d8b4771) - `cache()` gains an `invalidate` option — `{ throttle: ms }` or `{ debounce: ms }` — that controls how a `cache.invalidate` hit on the key is applied, coalescing invalidation-driven refetches so a burst of invalidations (e.g. a socket spraying updates) no longer fires a burst of underlying calls. `throttle` refetches on the leading edge then at most once per N ms while invalidations keep arriving; `debounce` refetches only after N ms of quiet. Both keep serving the existing (stale) value until the refetch resolves — stale-while-revalidate — and affect only the refetch-after-invalidate, leaving the first fetch and arg-change fetches immediate. Set at most one. Input-debounce (search-as-you-type, where the args change every keystroke) is deliberately not this — debounce the reactive value feeding the args instead.

- [`a1d1d56`](https://github.com/briancray/belte/commit/a1d1d56efe4887bebb74dd6707cf7cb38d8b4771) - Add an `error.svelte` page convention. Drop `error.svelte` anywhere under `src/browser/pages/` and it renders on the server for an unknown route (404) or a throw during a page render, inside the nearest layout, receiving `{ status, message, stack }` props. The props are never serialized to the client, so the message and stack reach the browser only where the template renders them — a bare `error.svelte` leaks nothing while a dev page can show the stack. Resolution is nearest-only by directory prefix, mirroring layouts — `pages/admin/error.svelte` covers `/admin/*`, `pages/error.svelte` covers the rest. For page renders `error.svelte` takes precedence over the `app.handleError` hook, which remains the fallback when no `error.svelte` covers the path (and for rpc throws). The error document is static — the client skips hydration — and a failed SPA navigation hard-navigates so it lands on the server-rendered error page.

- [`a1d1d56`](https://github.com/briancray/belte/commit/a1d1d56efe4887bebb74dd6707cf7cb38d8b4771) - Run in-process rpc dispatch inside the request scope for the MCP tool dispatcher and the in-process CLI client. Previously both invoked handlers without a per-request scope, so `cache()` silently shared one process-wide store across calls (leaking state between unrelated tool/CLI invocations) and `cookies()`/`request()` threw. Both now cross the same `runWithRequestScope` seam the HTTP router uses, giving per-call cache isolation and resolving the scope-bound helpers.

  Behavior change for MCP: a tool handler that throws is now caught by the scope and returned as a tool result with `isError: true` (framed from the 500 response), instead of surfacing as a JSON-RPC `-32603` error on the envelope. The JSON-RPC call itself succeeds; the failure is reported at the tool-result level, which is the correct MCP shape.

- [`a1d1d56`](https://github.com/briancray/belte/commit/a1d1d56efe4887bebb74dd6707cf7cb38d8b4771) - Project JSON Schema from a schema's own `toJSONSchema()` everywhere it's needed (OpenAPI, MCP tools, CLI flags, the bundle setup form). Drop the `inputJsonSchema` / `outputJsonSchema` / `filesJsonSchema` verb opts and the socket `jsonSchema` opt — a schema whose library doesn't expose a method wraps once with the new `belte/shared/withJsonSchema` helper. Multipart file parts are now advertised generically as binary in OpenAPI rather than named per field.

  Add `src/server/config.ts` as the home for typed env: `export const config = env(schema)`, imported as `$server/config` and eager-imported at boot so validation fails fast. The file is optional and scaffolded — when absent you read `Bun.env` directly.

  The bundle's first-run setup form is now derived from that same env schema by default, so one declaration drives boot validation and the form. `BundleWindow.config` still works but now _replaces_ the derived schema (for a form that should differ from the env schema) rather than being the only source.

- [`a1d1d56`](https://github.com/briancray/belte/commit/a1d1d56efe4887bebb74dd6707cf7cb38d8b4771) - Add two server primitives. `belte/server/env` validates the process environment against a Standard Schema at module load, returning typed config and failing the boot with every issue listed when a variable is missing or malformed. `belte/server/cookies` exposes the request's cookie jar — Bun's native `CookieMap` parsed from the inbound `Cookie` header, with `set`/`delete` writes flushed to `Set-Cookie` on the outgoing response when the handler returns. `cookies` resolves from the request scope like `request()`, materialized lazily so a request that never touches them parses and emits nothing; `env` reads `Bun.env` once at module load, independent of any request.

- [`a1d1d56`](https://github.com/briancray/belte/commit/a1d1d56efe4887bebb74dd6707cf7cb38d8b4771) - Add `belte/test/createTestClient` — an in-process client for testing rpc handlers without a running server. It discovers verbs from the registry (populated by `defineVerb`) and routes through the same synthesize-and-fetch the CLI and MCP surfaces use, but runs each call inside the request scope so request-scoped helpers behave exactly as under a live HTTP request: a fresh per-request `cache()`, the cookie jar with `Set-Cookie` flush, `request()`/`server()` resolution, and `app.handleError` (or the 500 fallback) on a throw. Accepts `headers` to pre-populate inbound auth/cookies and `app` for custom error handling. Pairs with `belte/test/clearVerbRegistry` to isolate suites that define verbs inline. `dispatchVerbInProcess` gains an opt-in `requestScope` flag to back this; the CLI and MCP paths are unchanged.

## 0.10.0

### Minor Changes

- stream deferred cache resolutions from server to client ([`a608a8e`](https://github.com/briancray/belte/commit/a608a8e02cdfaa19114ce323a0e6c1aedd83c31a))

- [`6a511c4`](https://github.com/briancray/belte/commit/6a511c4961eb124fa9b21a595e0a11886ef10cda) - Stream deferred cache resolutions from the server to the client. Cache entries left pending when SSR flushes are now snapshotted on the server, their resolutions streamed over the response, and reinstalled on the client as streaming placeholders that settle as each resolution arrives. This keeps the SSR/stream split driven by `await` vs `{#await}` without blocking the initial HTML on slow cache reads.

## 0.9.1

### Patch Changes

- [#33](https://github.com/briancray/belte/pull/33) [`e8c6d74`](https://github.com/briancray/belte/commit/e8c6d74be8c4033c58fb4b23fd1861a68df640ca) Thanks [@briancray](https://github.com/briancray)! - Root-absolute `url()` references in bundled stylesheets (e.g. `url(/fonts/x.woff2)`) are now marked external instead of being resolved against the project root at build time. Those paths are served from `public/` at the site root at runtime, so Bun's CSS bundler previously failed the whole build trying to find them on disk. The literal `/…` path now survives into the emitted CSS, where the public asset server serves it. Relative `url()`s still resolve and bundle as before.

## 0.9.0

### Minor Changes

- [#31](https://github.com/briancray/belte/pull/31) [`7f43099`](https://github.com/briancray/belte/commit/7f43099e6d9bab1d3de50b37ce241c4b3e171849) Thanks [@briancray](https://github.com/briancray)! - The standalone CLI (`belte cli`) now ships the compiled server beside it and gains an interactive session. `<app> /connect <url>` connects to a remote server, `<app> /start` boots a local instance, `<app> /disconnect` forgets the saved connection, and `<app>` alone resumes it — each opening a prompt where bare words run RPC commands and `/connect` / `/start` / `/disconnect` / `/help` / `/exit` manage the connection. One-shot dispatch (`<app> <command> --flags`) is unchanged for scripting. The connection is remembered in the per-user data dir; with none saved the CLI uses the baked `APP_URL`. The download tarball now bundles the server binary so `/start` works out of the box.

- [#31](https://github.com/briancray/belte/pull/31) [`9f4500a`](https://github.com/briancray/belte/commit/9f4500a953579534088396c11da14538b56edb65) Thanks [@briancray](https://github.com/briancray)! - `belte bundle` now reads the shipped default-config file from `bundle.env` instead of `.env.bundle`. The old name masqueraded as a member of Bun's `.env.*` autoload family, implying `bun dev`/`bun start` would load it (they never did) and that it should be gitignored like `.env` (it should be committed — it's ship-safe defaults, and a compiled bundle is extractable anyway). The new name reflects what the file is: a build input, not a runtime env overlay. Rename your project's `.env.bundle` to `bundle.env`.

### Patch Changes

- [#31](https://github.com/briancray/belte/pull/31) [`a03d4ac`](https://github.com/briancray/belte/commit/a03d4acfbc6e2d596a9d7e9481fb91e437378ca7) Thanks [@briancray](https://github.com/briancray)! - `belte dev` and `belte start` no longer load the bundle's config layers (the per-user data-dir `.env` and the shipped binary-dir `bundle.env`). Those layers exist for the compiled standalone app — a bundle launched via `open` has cwd `/` and gets its config there — but the server entry loaded them unconditionally, so dev/start would also inherit them. A `PORT` saved in the data-dir `.env` (written by a bundle's connect screen) then defeated dev's auto port-scan, binding that exact port and throwing `EADDRINUSE` instead of moving on. Dev/start now keep to their project-local CWD `.env` alone; the data-dir/binary-dir layers load only when running as a `bun build --compile` standalone binary.

## 0.8.1

### Patch Changes

- [#29](https://github.com/briancray/belte/pull/29) [`f85ee72`](https://github.com/briancray/belte/commit/f85ee722cd2b659aad7d8f250ae595b0b2ccdcae) Thanks [@briancray](https://github.com/briancray)! - With no `PORT` set, the server now scans upward from 3000 at bind time, binding the listener that wins the port instead of probing a throwaway server and releasing it first. This closes the gap where the chosen port could be stolen between probe and bind, which crashed boot on `EADDRINUSE` rather than stepping to the next port. A configured `PORT` still binds that exact port and surfaces a collision loudly.

## 0.8.0

### Minor Changes

- keep streams alive past Bun's idle timeout ([`9339175`](https://github.com/briancray/belte/commit/9339175a4b73d336704bbd8ff61ecf88f8582cfa))

- [#27](https://github.com/briancray/belte/pull/27) [`78305d1`](https://github.com/briancray/belte/commit/78305d18392cd916e39475a37eaafc486d3cdabf) Thanks [@briancray](https://github.com/briancray)! - Streaming responses (sse / jsonl / socket SSE tail) now opt out of Bun's per-connection idle timeout, so a stream that stays quiet between frames is no longer closed mid-flight. A new `idleTimeout` option (and `BELTE_IDLE_TIMEOUT` env, 0–255 seconds, default 10) sets the floor for ordinary unary handlers that legitimately compute longer than Bun's 10s default.

### Patch Changes

- dedup env-int parsing and route-dispatch 405s ([`617cc3c`](https://github.com/briancray/belte/commit/617cc3c0c5a763cd8d5e8c4bb0e74ee852500a94))

- extract route dispatch into a testable createRouteDispatcher ([`a684227`](https://github.com/briancray/belte/commit/a6842275a3fa444162571c6fccfcbadd13b712a5))

- extract request-scope runner into a testable seam ([`ce6f65c`](https://github.com/briancray/belte/commit/ce6f65c6cde3f070d4d55574979d21b362765aee))

## 0.7.0

### Minor Changes

- [#23](https://github.com/briancray/belte/pull/23) [`46f62ef`](https://github.com/briancray/belte/commit/46f62efebcdd9415b97435f17a70c91a0319a402) Thanks [@briancray](https://github.com/briancray)! - `cache()`'s `scope` option now accepts an array of tags, not just a single tag, so a call can join multiple invalidation groups (`scope: ['media', 'sources']`). `cache.invalidate({ scope })` drops every entry sharing any of the requested tags, and a re-read merges new tags into an entry rather than replacing them.
  </content>
  </invoke>

## 0.6.0

### Minor Changes

- [#21](https://github.com/briancray/belte/pull/21) [`5fbf023`](https://github.com/briancray/belte/commit/5fbf023c7de46457ae652c1738613ee2ceaf7dd7) Thanks [@briancray](https://github.com/briancray)! - `cache()` gains a `scope` option, and `cache.invalidate({ scope })` drops every entry sharing that tag in one call. `cache.invalidate` now takes `() | (fn) | ({ key?, scope? })`.

- [#21](https://github.com/briancray/belte/pull/21) [`56cd195`](https://github.com/briancray/belte/commit/56cd1950cf39e13dd06c90309efd35296c6c7e81) Thanks [@briancray](https://github.com/briancray)! - Breaking: `belte/cli/*` is no longer a public export — `createClient` is now internal. Nothing in the documented API referenced it.

- [#21](https://github.com/briancray/belte/pull/21) [`6776396`](https://github.com/briancray/belte/commit/67763968b13dd88173aeaf42242df6239fdc713b) Thanks [@briancray](https://github.com/briancray)! - When `PORT` is unset, the server now binds the first open port at or above 3000 instead of hardcoding 3000, so a second app boots without colliding. An explicit `PORT` is still honored as-is.

## 0.5.3

### Patch Changes

- extract shared build helpers and centralize bundle layout ([`64d71de`](https://github.com/briancray/belte/commit/64d71de9d4b28130775545f1047fa985545b3aaa))

- [#18](https://github.com/briancray/belte/pull/18) [`90a1713`](https://github.com/briancray/belte/commit/90a17136f53bab6f860c486e415547364fd54ca5) Thanks [@briancray](https://github.com/briancray)! - Extract repeated build-time logic into single-purpose shared helpers and collapse the per-virtual manifest codegen. `manifestModule` builds the `belte:rpc`/`sockets`/`prompts`/`pages`/`layouts` virtual modules from one path; `bundleLayout` derives `libDir`/`resourcesDir`/`envPath` from `binDir` (replacing the narrower `shippedEnvPath`) so the build writer and boot readers agree; `readPackageJson`, `exeSuffix`, `browserClientFlags`, and `memoizeByKey` deduplicate the package.json reader, the windows `.exe` suffix, the browser proxies, and the server route loaders. No public API change; behaviour preserved.

## 0.5.2

### Patch Changes

- [#15](https://github.com/briancray/belte/pull/15) [`7e3c96c`](https://github.com/briancray/belte/commit/7e3c96cd969e3f59c4be0e773478e56d21688874) Thanks [@briancray](https://github.com/briancray)! - Ship the bundle's `.env` under `Contents/Resources/` in a macOS `.app` instead of `Contents/MacOS/`. `codesign` seals `Contents/MacOS/` as code, so a data file there couldn't survive signing and reloading; `Resources` is sealed as a resource. A new `shippedEnvPath` helper centralizes the layout so the build writer and both boot readers agree on the path. The flat (non-macOS) layout is unchanged.

## 0.5.1

### Patch Changes

- [#12](https://github.com/briancray/belte/pull/12) [`47ecf72`](https://github.com/briancray/belte/commit/47ecf72c0a112461eacc9e1cd406e743c95423c5) Thanks [@briancray](https://github.com/briancray)! - A bundle's embedded server now honors a configured `PORT` instead of always picking a random free port. The launcher resolves `PORT` from the same env stack the server uses (shell, then the data-dir `.env` the config form writes, then the shipped binary-dir `.env`) and binds it as-is; with none set it falls back to a free port as before. This lets you start the embedded server at a fixed, known address on one machine and reliably connect to it from another via the connect screen.

## 0.5.0

### Minor Changes

- [#10](https://github.com/briancray/belte/pull/10) [`6ceb71b`](https://github.com/briancray/belte/commit/6ceb71b28e3b1a4c9726483d2c7dd3f40be3be59) Thanks [@briancray](https://github.com/briancray)! - Bundles now resolve config from a cwd-independent source instead of relying on Bun's cwd-based `.env` autoload (which a launched `.app`, whose cwd is `/`, silently misses). Config flows entirely through `process.env`, so app code keeps reading `Bun.env.*` and never learns where a value came from.

  - The compiled server loads two `.env` layers into `process.env` at boot, before anything reads it: the per-user data dir first (user config), then the binary dir (shipped default). Both back-fill only what a shell export or Bun's CWD `.env` didn't already set, so the precedence is `shell > CWD .env > data-dir .env > binary-dir .env > code default`.
  - Add `belte/shared/appDataDir` — the platform-standard per-user data directory keyed by program name, where the data-dir `.env` lives.
  - `belte bundle` ships an optional project `.env.bundle` as the binary-dir `.env` (the shipped default layer). Skipped when absent; use a dedicated file, never the working `.env`, since a compiled bundle is extractable.
  - Start now races server readiness against the child's exit, so a misconfigured bundle reports the crash immediately instead of stalling for the full readiness timeout.
  - A bundle resolves its last connection before the window opens: the launcher records the choice (embedded, or a remote URL) in the data dir, and on relaunch boots/probes it first, opening the window straight at the live server — so the connect screen never flashes. A boot that fails or exceeds a short ceiling, an unconfigured embedded resume, a dead saved server, or no saved choice falls back to opening the connect screen.
  - A bundle can declare `config` on its `BundleWindow` as a Standard Schema (the same kind belte accepts for RPC/MCP). Its JSON Schema drives a first-run settings modal on the connect screen — `title` → label, `description` → hint, `format: 'password'` → masked input, `default` → prefill — and answers persist to the data-dir `.env`. An explicit Start (button or File-menu click) always opens the modal prefilled with the last-used values, so re-running Start after a disconnect is how you reconfigure; an auto-start on relaunch never opens the modal — it boots a fully-configured app, or stays on the connect screen when a required key is still unset. Apps with no schema always boot straight through.

### Patch Changes

- harden PORT parsing and make shutdown signal-safe ([`9cca848`](https://github.com/briancray/belte/commit/9cca848b08a786b6abfe7920d4775a1f76c11fe6))

## 0.4.0

### Minor Changes

- [`a432d00`](https://github.com/briancray/belte/commit/a432d00d3c58dea7f4968307e9c82590ff07ef8a) - `belte bundle` now ad-hoc code-signs the assembled macOS `.app` so it launches on other Macs instead of being silently killed by Gatekeeper. A quarantined copy may still need `xattr -cr` once; full distribution still requires a Developer ID signature and notarization.

- [`a432d00`](https://github.com/briancray/belte/commit/a432d00d3c58dea7f4968307e9c82590ff07ef8a) - The native webview inspector in a bundle is now gated behind `BELTE_INSPECT`, so release bundles ship without DevTools while debugging remains one env var away.

- [`a432d00`](https://github.com/briancray/belte/commit/a432d00d3c58dea7f4968307e9c82590ff07ef8a) - `cache()` now returns synchronously for keys already warm in the SSR hydration snapshot, so the first client read of server-rendered data skips the microtask round-trip.

- [`d0a733d`](https://github.com/briancray/belte/commit/d0a733dd238e634baa1dd9fdf0adf99114612893) - Add a name-filtered `onMenu(name, handler)` overload alongside the existing catch-all `onMenu((name) => …)` form, so a bundle menu item can bind one handler without switching on the emit name.

- [`a432d00`](https://github.com/briancray/belte/commit/a432d00d3c58dea7f4968307e9c82590ff07ef8a) - **Breaking:** verb helpers now take `inputSchema` (and optional `outputSchema`) instead of `schema`. `inputSchema` validates incoming args and feeds OpenAPI params / the MCP tool input; `outputSchema` describes the success body for the OpenAPI `200` response and MCP tool output. Client exposure (`browser` / `mcp` / `cli`) now defaults per-surface from the schema — read-only verbs auto-expose to MCP, mutating verbs opt in via `clients`. Migrate by renaming `{ schema }` to `{ inputSchema }`.

- [`a432d00`](https://github.com/briancray/belte/commit/a432d00d3c58dea7f4968307e9c82590ff07ef8a) - Sockets are now exposed to MCP and the CLI over an HTTP face: each schema-bearing socket contributes a `<name>-tail` read tool/command, plus `<name>-publish` when `clientPublish` is set.

### Patch Changes

- [`a432d00`](https://github.com/briancray/belte/commit/a432d00d3c58dea7f4968307e9c82590ff07ef8a) - Public asset paths are snapshotted on disk at boot rather than stat'd per request, and browser-only routes are logged at startup.

- [`a432d00`](https://github.com/briancray/belte/commit/a432d00d3c58dea7f4968307e9c82590ff07ef8a) - Scaffolded apps now ship a default `src/bundle/icon.png`, so `belte bundle` produces an icon'd macOS `.app` out of the box.

## 0.3.1

### Patch Changes

- [`63fe0b6`](https://github.com/briancray/belte/commit/63fe0b6cdec4d1073252a68c8185f86b74ebe48e) - Default bundle connect screen now follows the OS dark-mode setting. Added
  Tailwind `dark:` variants (driven by `prefers-color-scheme`) across the
  background, card, input, buttons, divider, and footer — all grayscale except the
  red error message. A project that ships its own `src/bundle/disconnected.svelte`
  is unaffected.

## 0.3.0

### Minor Changes

- [`3daa1cd`](https://github.com/briancray/belte/commit/3daa1cdf793ddca5efdce8027293003d177b4a48) - Bundle (macOS webview): support file downloads. The webview now installs a
  navigation + download delegate, so `<a download>`, blob:/data: links, and
  `Content-Disposition: attachment` responses save a real file to the user's
  Downloads folder and reveal it in Finder — previously the bare WKWebView set no
  navigation delegate and silently dropped them. No-op on macOS before 11.3.

## 0.2.2

### Patch Changes

- [`465928b`](https://github.com/briancray/belte/commit/465928b411b8f8aff582df87f9e2ba3782d8b275) - The generated route-types file (`src/.belte/routes.d.ts`) now augments the `Routes` interface on the module name the project imports belte under (canonical `@belte/belte` or an alias), matching the rpc/socket/prompt codegen. It previously hardcoded `belte/browser/page`, so `page.route` / `page.params` autocomplete only resolved when belte was installed under the `belte` alias.

## 0.2.1

### Patch Changes

- [`1d84fb8`](https://github.com/briancray/belte/commit/1d84fb8d64d8bb7b4d0eb3b1d24e0ea2f18b4c31) - RPC, socket, and prompt codegen now emit imports under the name belte is installed as in the consuming project — the canonical `@belte/belte` for a direct dependency, or the alias key for a package alias (`"belte": "npm:@belte/belte@..."`) — instead of a hardcoded `belte`. A plain `bun add @belte/belte` now builds with no alias required; the `belte` alias remains supported for the bare `belte/...` import surface.

## 0.2.0

### Minor Changes

- [`cf136c7`](https://github.com/briancray/belte/commit/cf136c7b763283570ef431b3aad269626bea7824) - Add a `belte bundle` desktop app and make the CLI a thin remote-only client.

  - `belte bundle` assembles a movable, self-contained desktop app (a `.app` on macOS, a flat dir elsewhere) that boots into a connect screen — start the embedded server or connect to a remote one by URL.
  - **Breaking:** the CLI binary is now always a thin remote client (talks to a running server over HTTP, `APP_URL` required). Dropped the `--thin`/full split and in-process fallback — use `belte bundle` for the embedded-backend case.
  - **Breaking:** MCP prompts are now markdown files (`src/mcp/prompts/**.md`) with YAML frontmatter, replacing the `.ts` prompt modules.
  - **Breaking:** handlers read the inbound request via `request()` and the live server via `server()` rather than `RequestStore` fields.
  - `json` / `jsonl` / `sse` / `error` / `redirect` accept a trailing `ResponseInit`.
  - Static-asset header caching is shared across asset servers, and zstd decompression moved to the async API.

## 0.1.0

### Minor Changes

- [`c863e56`](https://github.com/briancray/belte/commit/c863e563338fe704fc96a7054e27a35d271261fb) - Initial public release of belte — an isomorphic multimodal HTTP framework for Bun and Svelte. Declare a backend once and consume it over the web (SSR Svelte), the CLI, and MCP.
