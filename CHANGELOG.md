# abide

## 0.31.0

### Minor Changes

- [`ea69bad`](https://github.com/briancray/abide/commit/ea69bad96d516dc6884d8a8c014b47c4864ebbe6) - linked() reactive cell, writable derived, state write-transform ([`82301ea`](https://github.com/briancray/abide/commit/82301eabcda0866eec471f95048f74079ea93ab7))

- [`ea69bad`](https://github.com/briancray/abide/commit/ea69bad96d516dc6884d8a8c014b47c4864ebbe6) - sharper template type-checking in the shadow ([`f280619`](https://github.com/briancray/abide/commit/f280619778c23200a0f11cf8e6344edf2ea39884))

- [`ea69bad`](https://github.com/briancray/abide/commit/ea69bad96d516dc6884d8a8c014b47c4864ebbe6) - pass component on\*/bind/attach attributes through as props ([`f9a9202`](https://github.com/briancray/abide/commit/f9a9202d8555d7246fcc4338e833551f54ee8968))

### Patch Changes

- [`ea69bad`](https://github.com/briancray/abide/commit/ea69bad96d516dc6884d8a8c014b47c4864ebbe6) - extract messageFromError, contentTypeOf, discardBoundary helpers ([`1bfb721`](https://github.com/briancray/abide/commit/1bfb721a8a8d3c8907bc9d4d0c6d97ddc265ed1e))

- [`ea69bad`](https://github.com/briancray/abide/commit/ea69bad96d516dc6884d8a8c014b47c4864ebbe6) - resolve the chained route on the page proxy ([`ed518c1`](https://github.com/briancray/abide/commit/ed518c1e8232c04496fe3fd04783f750164bc378))

- [`ea69bad`](https://github.com/briancray/abide/commit/ea69bad96d516dc6884d8a8c014b47c4864ebbe6) - share one component analysis across client and SSR back-ends ([`f330664`](https://github.com/briancray/abide/commit/f33066441625c08077b1b413603204ec2afe59eb))

- [`ea69bad`](https://github.com/briancray/abide/commit/ea69bad96d516dc6884d8a8c014b47c4864ebbe6) - format .abide <script> bodies via Biome ([`f4fc64e`](https://github.com/briancray/abide/commit/f4fc64ecb838a449dfb669af5fcaf40bcf7fa8ca))

## 0.30.0

### Minor Changes

- [`311f3e7`](https://github.com/briancray/abide/commit/311f3e76732eb2b98d2739f2f7eff0fbbb667645) - cross-fade navigations via the View Transition API ([`d3ea6c0`](https://github.com/briancray/abide/commit/d3ea6c001c47748dd2be3ae47dfc3624ae7c65ee))

### Patch Changes

- [`311f3e7`](https://github.com/briancray/abide/commit/311f3e76732eb2b98d2739f2f7eff0fbbb667645) - surface attach= binding and named-template snippets in .abide grammar ([`51a37ee`](https://github.com/briancray/abide/commit/51a37ee0b0cef708d0571de272ace3584d45a8c0))

- [`311f3e7`](https://github.com/briancray/abide/commit/311f3e76732eb2b98d2739f2f7eff0fbbb667645) - hoist component-local types above \_\_Props so prop annotations resolve ([`8d674c5`](https://github.com/briancray/abide/commit/8d674c543be53ae5775124f392ee44fd8731204f))

## 0.29.0

### Minor Changes

- [`2d2c141`](https://github.com/briancray/abide/commit/2d2c141a59d3643f997ef4bb16773d29e4149c95) - add 'abide init-agent' command ([`b5e9158`](https://github.com/briancray/abide/commit/b5e915862a74febffb8df28c68f444a73bd371da))

### Patch Changes

- [`2d2c141`](https://github.com/briancray/abide/commit/2d2c141a59d3643f997ef4bb16773d29e4149c95) - add AGENTS.md complete public-surface map for agents ([`b0539ec`](https://github.com/briancray/abide/commit/b0539ec69c880106dc1b0cb8573203e7113964ed))

## 0.28.0

### Minor Changes

- [`6379ac1`](https://github.com/briancray/abide/commit/6379ac1d4551d1d87183907ccb56a0f7a7b3ba8a) - client-side navigate ([`151a932`](https://github.com/briancray/abide/commit/151a932f4b5f5d4fa5409487ca0707f1929ae255))

- shadow type-check + import resolution; fix entity escaping & cell method calls ([`422a975`](https://github.com/briancray/abide/commit/422a97575a6efc8c00861b2d600bb07f043cd8e9))

- [`6379ac1`](https://github.com/briancray/abide/commit/6379ac1d4551d1d87183907ccb56a0f7a7b3ba8a) - bound RPC calls with timeout, offline detection, and reachability ([`4b8c932`](https://github.com/briancray/abide/commit/4b8c9321edbd6ca9a4dc1185fbf2e30b8623c122))

- component hot-module reload ([`e42e638`](https://github.com/briancray/abide/commit/e42e6381e3639b0093b97cb730abd93c53cb2e6c))

- attach directive and effect/attachment teardowns ([`e65be44`](https://github.com/briancray/abide/commit/e65be442847f5f96ccb659fb18cf7edb29080324))

- [`0cf889b`](https://github.com/briancray/abide/commit/0cf889b859b9169be2abd35c2624ff762bd08e91) - Add `@abide/inspector` — an opt-in inspector activated by `ABIDE_ENABLE_INSPECTOR=true`. Install it (`bun add -d @abide/inspector`) and the flag mounts a UI at `/__abide/inspector`.

  Three tabs over one event stream:

  - **Logs** (default) — a live tail of request traffic, app/diagnostic channels, cache tallies, and published socket frames, with filters by channel, trace id, and free text. Click a trace id to pivot the feed to that trace.
  - **Traces** — records grouped by trace id. Because abide propagates W3C trace context (a page session is one trace — the SSR render plus every RPC its interactions fire), a trace holds many requests; the tab splits each trace into nested per-request lanes (each on its own time axis, children indented under the request they descend from) with a span waterfall per request. Records now carry `requestSpan` / `parentSpan` (from the request's `TraceContext`) so this split is possible.
  - **Cache** — the persistent (`global: true`) cache store: each entry's key, lifecycle state (settled / in-flight / refreshing), kind, ttl, time-to-expiry, scope tags, invalidate policy, and a value preview. Refreshes on open and on demand. (Request-scoped caches are ephemeral, so they surface as per-request tallies in Logs/Traces instead.)
  - **Surface** — the static machine catalog: RPC verbs (with their declared `timeout` / `maxBodySize` / `crossOrigin` / `files` options as columns, and input/output JSON Schemas on expand) and sockets.

  The framework now self-instruments the request lifecycle with `log.trace` spans on DEBUG-gated diagnostic channels — `abide:render` (SSR render), `abide:view` (view/module resolution), `abide:rpc` (verb dispatch + validation; reveals in-process RPC→RPC calls as nested spans in the same trace), `abide:cache` (producer run on a miss + coalesced wait), `abide:mcp` (tool dispatch), and `abide:sockets` (REST tail/publish). They're zero-cost when their channel is off and fill the Traces waterfall when enabled (`DEBUG=abide:*`). The verb registry now records `timeout` / `maxBodySize` / `crossOrigin` so introspection can report them.

  Core stays clean: a guarded, non-literal dynamic import keeps the package out of the compiled binary, and core injects an `InspectorContext` so the package imports no abide internals. Two passive observation seams feed the inspector — the existing log tap plus a new socket-frame tap in `defineSocket`'s `publish()` — both no-ops when no inspector is mounted. The inspector is privileged operator tooling: it answers ahead of `app.handle` and warns loudly on mount, so enable it only in trusted/dev environments.

### Patch Changes

- [`6379ac1`](https://github.com/briancray/abide/commit/6379ac1d4551d1d87183907ccb56a0f7a7b3ba8a) - replace test client with createTestApp harness ([`02b846b`](https://github.com/briancray/abide/commit/02b846b11c0179f610644935c9137d2dbd288e18))

- remove dead code surfaced by sweep ([`038b78c`](https://github.com/briancray/abide/commit/038b78cfad1154c7e79c7f1bb5cd823012e5671f))

- rename project belte → abide ([`3ed697b`](https://github.com/briancray/abide/commit/3ed697bd3c804bdd79642d9edb5d3f3045ecdb53))

- clear biome errors blocking the release gate ([`456962a`](https://github.com/briancray/abide/commit/456962ab4aa33bf854e33b7d2bdb1c961b8b7095))

- swap zstd asset compression for gzip ([`51f3cfd`](https://github.com/briancray/abide/commit/51f3cfd126c3b5694564db91b9197627d5b84d4d))

- robust flag/help parsing and SIGINT listener cleanup ([`61a29e3`](https://github.com/briancray/abide/commit/61a29e39c0e58d2590b77785639fcc4b8bb86552))

- finish @abide/abide rename in template + smoke CI ([`678635b`](https://github.com/briancray/abide/commit/678635b19ea51b9351864a31cb726e62b829211d))

- compile correctness — escaping, void tags, scoped css, runtime imports ([`7f549a4`](https://github.com/briancray/abide/commit/7f549a4661ab2f16f9a44bdb4a78fc5d8b78ae50))

- linked-list reactivity graph + scope teardown ([`80ba57a`](https://github.com/briancray/abide/commit/80ba57a7f1ebd611a230b4d7f997d9e4f9afce66))

- harden compile-time HTML/CSS handling ([`a65b678`](https://github.com/briancray/abide/commit/a65b6788a4dcfb0894994d1f8a76629cfcb29602))

- static-template cloning + child-mount primitive ([`a8cb9c7`](https://github.com/briancray/abide/commit/a8cb9c70429d35512a2f5560ac6336ee6ec2e94b))

- re-fire coalesced invalidations and harden hydration/iteration ([`cdf7887`](https://github.com/briancray/abide/commit/cdf7887422892cb58a9074c940add8c413b48aaa))

- harden request handling against edge inputs ([`cf2db7c`](https://github.com/briancray/abide/commit/cf2db7ce6d565a6b4be8d63a4d3cfee24c630c92))

- [`cdd8a58`](https://github.com/briancray/abide/commit/cdd8a587d55db05da5bb2d0b0e694f7bf532db8d) - tag InspectorContext export for the @readme gate ([`d2157de`](https://github.com/briancray/abide/commit/d2157de56f00c9aed99cd7b4d4d267c6f296f167))

- inject shell assets case-insensitively, append when tag absent ([`de61b55`](https://github.com/briancray/abide/commit/de61b55e569926233357620e853fe665a0e09e4c))

- drop dead stream-resume subsystem; fix layout + README-symlink docs ([`e39debb`](https://github.com/briancray/abide/commit/e39debb1952169067d3b5c7a66208049a99d23a7))

- remove Svelte references across code, docs, and tooling ([`e77872a`](https://github.com/briancray/abide/commit/e77872ae3c1f799b5defba9b051ec35a3c6f5a88))

- [`9d71d45`](https://github.com/briancray/abide/commit/9d71d45186153eec2b7be094f2e3a9ceae952212) - Fix an infinite loop when a `derived` over a `createSubscriber`-backed resource (e.g. `tail()` of a socket) is read by an effect. `trigger` walked the live observer `Set` while the flush it fired synchronously recomputed the derived, whose `runNode` deletes-then-re-adds itself to that same set — re-yielding it to the in-progress `for…of` forever. Invalidation now snapshots each observer set and the queued effects flush once at the outermost trigger, never mid-propagation.

## 0.27.0

### Minor Changes

- [`f93e490`](https://github.com/briancray/abide/commit/f93e4902a87766978b9ea90d10705ef7bd4ebb2b) - cache.on context.patch for server-pushed deltas ([`70acb1d`](https://github.com/briancray/abide/commit/70acb1d2ff73980d97a2bddeb28e5ee184a3781b))

## 0.26.1

### Patch Changes

- [#73](https://github.com/briancray/abide/pull/73) [`9397ef5`](https://github.com/briancray/abide/commit/9397ef515b5f9f7a8f42532463368ebd8195aa10) Thanks [@briancray](https://github.com/briancray)! - remaining `noUncheckedIndexedAccess` errors in shipped source (parsePromptMarkdown, logExposedSurfaces, createPageRenderer, createMcpResourceServer) — and CI now type-checks the shipped surface under the scaffolded consumer tsconfig plus that flag, so this class of strict-consumer breakage fails CI instead of an app's `bun check`

- [#73](https://github.com/briancray/abide/pull/73) [`9397ef5`](https://github.com/briancray/abide/commit/9397ef515b5f9f7a8f42532463368ebd8195aa10) Thanks [@briancray](https://github.com/briancray)! - fix(abide): parseTraceparent type-checks under `noUncheckedIndexedAccess` — abide ships raw TS, so the destructured regex groups read as possibly undefined in strict consumer tsconfigs and failed the app-side check

## 0.26.0

### Minor Changes

- [`863b74f`](https://github.com/briancray/abide/commit/863b74f3a2ea117993bf407d6aa23f8fc62793ee) - cache read stats with abide:cache diagnostics channel ([`1f46eb1`](https://github.com/briancray/abide/commit/1f46eb16dafcb1f8d165ce9d30a7f5bfb3a47885))

- [`863b74f`](https://github.com/briancray/abide/commit/863b74f3a2ea117993bf407d6aa23f8fc62793ee) - per-verb maxBodySize cap on received body bytes ([`bf7086b`](https://github.com/briancray/abide/commit/bf7086be583129e1cd0abf10c97ff1379f496074))

- [`863b74f`](https://github.com/briancray/abide/commit/863b74f3a2ea117993bf407d6aa23f8fc62793ee) - unified log with trace context and DEBUG-gated channels ([`ddf6146`](https://github.com/briancray/abide/commit/ddf61460893fbdc26f04b9f7050db45c3aa71efa))

- [`863b74f`](https://github.com/briancray/abide/commit/863b74f3a2ea117993bf407d6aa23f8fc62793ee) - /\_\_abide/health endpoint, app health hook, and online() probe ([`f933e16`](https://github.com/briancray/abide/commit/f933e16856fdd9b35f8dd99a12791b5d557025a2))

## 0.25.2

### Patch Changes

- [`f9cd269`](https://github.com/briancray/abide/commit/f9cd269b44b065702275422ac710019117f69a2c) - fix(abide): `json(undefined)` returns 204 No Content instead of throwing

  `Response.json(undefined)` throws TypeError because JSON has no encoding for
  `undefined`, so any handler returning `json(undefined)` — e.g. a
  `Shape | undefined` route signalling "not found" — 500ed instead of degrading.
  `json()` now emits 204 No Content for `undefined`, which `decodeResponse`
  already maps back to `undefined` on both the fetch and in-process paths, so
  the `Shape | undefined` RPC contract round-trips the wire. The helper owns
  the 204; it wins over any `init.status`.

## 0.25.1

### Patch Changes

- [`ee6c2a3`](https://github.com/briancray/abide/commit/ee6c2a3e2f7506a77540ff12bc4c45d0f84dc083) - sync examples and scaffold template to the restructured README ([`5ec6cf7`](https://github.com/briancray/abide/commit/5ec6cf7ad2b99f12904605d34a1fafb05a1196ab))

- [`ee6c2a3`](https://github.com/briancray/abide/commit/ee6c2a3e2f7506a77540ff12bc4c45d0f84dc083) - dedupe framework paths, helpers, and boot/request hot paths ([`6d4b0f8`](https://github.com/briancray/abide/commit/6d4b0f8ace9ec66445fdd68e033475cfb1742e4c))

- [`7389826`](https://github.com/briancray/abide/commit/7389826331434b252c6fd1ac9b9809a376fb563f) - cache: a policy refetch that hits a 404 now evicts the entry instead of retaining it — the resource is gone, so keeping the stale value made the entry immortal (every later invalidation re-fired the dead fetch). Transient failures (network errors, 5xx) still keep the stale value; a non-2xx Response from a remote refetch is no longer swapped in as fresh data.

## 0.25.0

### Minor Changes

- [`b0fd235`](https://github.com/briancray/abide/commit/b0fd2353a98008ae306b1cc1b8f112cdbda420a2) - cache.on event-driven invalidation and per-call selectors ([`fe7e0e6`](https://github.com/briancray/abide/commit/fe7e0e6ff45875e59e044280379d119a635a6193))

### Patch Changes

- [`b0fd235`](https://github.com/briancray/abide/commit/b0fd2353a98008ae306b1cc1b8f112cdbda420a2) - scope probe lifecycle channels and trip runaway invalidate loops ([`7aad405`](https://github.com/briancray/abide/commit/7aad4050edaccf2c95f479fa64ec16b00c2141d7))

## 0.24.3

### Patch Changes

- [`cc26576`](https://github.com/briancray/abide/commit/cc265765b468a4534f3b33e02ec52b9d9b197f13) - `abide dev` no longer reloads the browser after server-only edits. Each dev worker announces a fingerprint of the browser-visible surface (client build contents, public/ stamps, shell) as the first event on the live-reload channel; the page reloads on reconnect only when the fingerprint changed, so editing rpc/socket/server code keeps the page — and all of its UI state — alive while the new server behavior applies on the next request.

- [`40b5273`](https://github.com/briancray/abide/commit/40b52732f1162ddc6b5796457a2942b78334fb4a) - `abide dev` restarts are now zero-downtime: the replacement worker boots alongside the incumbent (both bind the dev port via `reusePort`) and the old worker is retired only once the new one reports ready, so requests never hit a dead port mid-rebuild. A worker that crashes while active is respawned automatically (bounded, so a crash-on-boot loop gives up until the next save), and a replacement that dies or hangs booting is discarded while the last-good server keeps serving.

- [`b4ab65c`](https://github.com/briancray/abide/commit/b4ab65cb5520a9cfd0b9537e2bd85c0cbe6be1d6) - Hidden tabs release their long-lived connections instead of holding them open. The dev live-reload EventSource and the multiplexed sockets WebSocket both close on `visibilitychange: hidden` and reconnect on visible, riding the existing drop paths: the reload client re-captures the worker fingerprint on reconnect (a rebuild while the tab slept still reloads it), and socket consumers resync through the typed disconnect — their fresh sub frames queue while hidden and flush when the tab returns. Backgrounded tabs no longer accumulate idle connections the browser throttles or the server counts against per-host limits.

## 0.24.2

### Patch Changes

- [`021f6f0`](https://github.com/briancray/abide/commit/021f6f0f17108ad8703613d75209087936af359f) - adopt Map.getOrInsertComputed in server-side caches ([`03c342f`](https://github.com/briancray/abide/commit/03c342fd3db5dceaf4de35f1b13f1587384b7482))

- [`021f6f0`](https://github.com/briancray/abide/commit/021f6f0f17108ad8703613d75209087936af359f) - snapshot entry method narrows through ReplayableMethod ([`500af03`](https://github.com/briancray/abide/commit/500af03fd525d4528c59e636e301570cdaf219f8))

- [`021f6f0`](https://github.com/briancray/abide/commit/021f6f0f17108ad8703613d75209087936af359f) - no-input rpc verbs no longer require an explicit undefined argument ([`b57c6b0`](https://github.com/briancray/abide/commit/b57c6b0cab45f40c8adfe943c0c357a0854aa2e7))

- [`dc8cf0f`](https://github.com/briancray/abide/commit/dc8cf0fce2f59c0e7c9d3169f8faa3bf282932a3) - fix(url): keep `[name]` params declared before a `[...rest]` catch-all in `PathParams` — the catch-all branch swallowed its head, so `url('/media/[id]/[...rest]', { id, rest })` rejected `id`

- [`da7544a`](https://github.com/briancray/abide/commit/da7544a21e8b076f6c756d9648baa181167e6b3e) - fix: type-check cleanly under strict consumer flags — abide ships raw TS, so app-side tsconfig flags type-check it. Bind layout/error loaders before invoking (`noUncheckedIndexedAccess`), pin asset/tarball bytes to `Uint8Array<ArrayBuffer>` so they satisfy `BodyInit`, cast the FFI window handle to `Pointer`, and add `erasableSyntaxOnly` to the shipped `tsconfig.app.json`

## 0.24.1

### Patch Changes

- [`529597c`](https://github.com/briancray/abide/commit/529597c974f36f1767bcc597c623041e8bb4a742) - page.url is browser-space on both sides under a mount base ([`455e3ca`](https://github.com/briancray/abide/commit/455e3ca4498274ab98e7dfa14d7752c0b4453109))

- [`529597c`](https://github.com/briancray/abide/commit/529597c974f36f1767bcc597c623041e8bb4a742) - url() accepts undefined query values ([`abb739e`](https://github.com/briancray/abide/commit/abb739e5086f46c8e8870f83ee8eee9a706ce513))

## 0.24.0

### Minor Changes

- [`429dea8`](https://github.com/briancray/abide/commit/429dea81761cd4da6e2cd316a2ee78e8a60ae71e) - scaffold installs deps and starts the dev server ([`986cd72`](https://github.com/briancray/abide/commit/986cd725b82cf49d3dadaa52be00f8a222af638e))

- [`429dea8`](https://github.com/briancray/abide/commit/429dea81761cd4da6e2cd316a2ee78e8a60ae71e) - same-origin CSRF gate + symbol-branded remotes ([`b5570ba`](https://github.com/briancray/abide/commit/b5570ba9a1e5e852d7b791df4a3e177eb82b78a9))

- [`429dea8`](https://github.com/briancray/abide/commit/429dea81761cd4da6e2cd316a2ee78e8a60ae71e) - typed url() helper + APP_URL subpath mount ([`e5bdb57`](https://github.com/briancray/abide/commit/e5bdb57437d0b69cb46013d24ae1bef416b531bd))

- [`429dea8`](https://github.com/briancray/abide/commit/429dea81761cd4da6e2cd316a2ee78e8a60ae71e) - client-side page error boundary ([`f70d885`](https://github.com/briancray/abide/commit/f70d8852568f41b8377a9cc99ff0251aecfc2e5b))

## 0.23.1

### Patch Changes

- [`d8fe8fc`](https://github.com/briancray/abide/commit/d8fe8fcae7863407d7b55774e19762715d311450) - **Fixed**

  - The lifecycle channel defers its notify to a microtask, coalescing marks within a tick. With a live `pending()`/`refreshing()` probe armed, a cold cache read inside a `$derived` — the documented `$derived(await cache(fn)())` idiom — registered its entry mid-derived and wrote the subscriber's version source synchronously, throwing `state_unsafe_mutation` and killing the flush (seen as an unhandled rejection plus a follow-on `active_reaction` TypeError, with UI updates in that batch silently dropped). Probes scan the registry at re-derive time, so the deferred ping reads state that is already current.

## 0.23.0

### Minor Changes

- [`13f841c`](https://github.com/briancray/abide/commit/13f841c4f3ec92727414715c1bb5eeabc12b60a7) - **Breaking**

  - `bundled()` moved to the bundle namespace alongside `onMenu`: `import { bundled } from '@abide/abide/bundle/bundled'` (was `abide/shared/bundled`).

- [`bbc82a1`](https://github.com/briancray/abide/commit/bbc82a12c948acbb2f82fe1dfc46165678fafb04) - Registries act, probes report: standalone `pending`/`refreshing` spanning cache and streams, the `ttl: 0` mutation idiom made sound, and tail reconnect-with-retained-value.

  **Breaking**

  - `cache.pending` / `cache.refreshing` moved to their own modules: `import { pending } from '@abide/abide/shared/pending'`, `import { refreshing } from '@abide/abide/shared/refreshing'`. `cache.invalidate` stays on `cache`.
  - SSR snapshots ship GET entries only (`REPLAYABLE_METHODS`): DELETE is idempotent but still a write and no longer replays from hydration.
  - `cache()` now throws at wrap time on invalid policy combinations: `invalidate` policy on a non-GET remote, policy with `ttl: 0`, or `throttle` and `debounce` together.

  **Fixed**

  - Invalidate policies attach on read to entries that lack one (like scope tags), so a snapshot-hydrated entry revalidates stale-in-place from its first invalidate instead of hard-dropping to a pending flash, and a policy-less first read no longer permanently wins.
  - Hydrated snapshot entries adopt the first reading call site's `ttl` (the snapshot ships no wrap options): omitted keeps the entry as before, `ttl > 0` starts the expiry clock at that read, and `ttl: 0` serves the hydration pass only, evicting a macrotask later — previously any ttl was ignored, so a `ttl: 0` key warm-hit forever and never refetched.
  - Eviction clears armed policy timers — a TTL-expired or rejected key can no longer ghost-refetch.

  **Added**

  - `pending(x)` / `refreshing(x)` probe both registries: cache selectors (bare / fn / `{ scope }`) plus Subscribables — `pending(chat)` is "awaiting first frame", `refreshing(chat)` is "reconnecting with last value retained" (never merely open). Bare forms span registries. Probes report, never act: they open no fetch and no stream.
  - `tail()` (né `subscribe()` — renamed in this release) self-heals transport loss: on the typed `SocketDisconnectedError` it keeps its value, flags `refreshing`, and reopens under the channel's backoff (retained-tail replay converges the value — correct for a latest-wins/window consumer). Server `err` frames stay terminal; raw `for await` consumers keep the explicit-disconnect contract.
  - `cache()` warns once per call site when handed an anonymous producer (fresh identity per call — it can never coalesce and probes can never match it).

- [`c77fc89`](https://github.com/briancray/abide/commit/c77fc89a12f07b9356b5ad68cd4a92f4764e52b8) - Replay is demarcated on the wire: a sub's seed now arrives as one per-sub `{ type: 'replay', sub, messages }` frame (sent even when empty) instead of socket-keyed `msg` frames.

  - `tail()` windows commit their seed atomically at the boundary — no more shrink-regrow rebuild on reconnect or first paint — and an **empty** replay keeps the held window across a gap (nothing replayed = nothing to duplicate; live frames append). Previously the first post-gap frame wiped the window even on non-retaining sockets.
  - Per-sub addressing fixes cross-sub replay leakage: two subs on the same socket no longer receive each other's replay.
  - `Subscribable.tail(count, hooks?)` gains optional `TailHooks`: retaining sources must signal `hooks.replayed` in-band once the seed is delivered (sockets do; a source that ends without signalling commits at `done`).
  - Internal: `createPushIterator` gains `control(run)` — in-band signal slots, strictly ordered against pushed values, invisible to consumers. Raw `for await` iteration is unchanged.

- [`c77fc89`](https://github.com/briancray/abide/commit/c77fc89a12f07b9356b5ad68cd4a92f4764e52b8) - `subscribe()` is now `tail()`, and "history" is dead: one word for reading the retained end of a stream at every altitude — declaration (`socket<T>({ tail: n })`), raw iteration (`chat.tail(count)`), and the reactive consumer (`tail(x)` / `tail(x, { last: n })`).

  **Breaking**

  - `import { subscribe } from '@abide/abide/browser/subscribe'` → `import { tail } from '@abide/abide/browser/tail'`; `subscribe.status`/`subscribe.error` → `tail.status`/`tail.error` (both accept the same `{ last }` options to address a window entry).
  - Socket declaration option `history` → `tail` (`socket<T>({ tail: 100 })`). Retention is opt-in: an undeclared socket is a pure live pipe and storage is the consumer's concern.
  - Bare socket iteration (`for await (const m of chat)`) is now live-only — replay is exclusively `.tail`'s job. `chat.tail()` no-arg replays the whole retained tail (the old bare behavior); `chat.tail(n)` the last n. The ws wire is unchanged; only the local defaults flipped.
  - The reactive bare form seeds a socket via `tail(1)` instead of full replay — retained frames no longer churn through `latest` on open.

  **Added**

  - `tail(x, { last: n })` → `T[]`: a live rolling window of the last ≤n frames, however they arrived ([] while pending and on SSR, never undefined). Retaining sockets seed it by replaying up to `last` (clamped to the declared `tail`); rpc streams and undeclared sockets fill it from live frames. The bare form and each window size are independent subscriptions (`last` is registry-keyed). On reconnect the replay replaces the window, so a gap can't duplicate frames.
  - `Subscribable.tail(count)` is the optional retention capability: sources that keep recent frames implement it (sockets do verbatim) and the consumer bounds replay to what the reader keeps — no consumer special-casing per source type.

  **Fixed**

  - An untracked `tail.status()`/`tail.error()` read (outside `$derived`/`$effect`) no longer leaks a permanently-pending registry entry that held the bare `pending()` probe true forever.

## 0.22.0

### Minor Changes

- [`80786f1`](https://github.com/briancray/abide/commit/80786f13d2fcaaa1bdb6f1913959010fd1de66a6) - agent test surface — test/createScriptedSurface + test/assertAgentFrameConformance ([`f7dae05`](https://github.com/briancray/abide/commit/f7dae05336d126d7957876180865afb57d6daeea))

### Patch Changes

- [`80786f1`](https://github.com/briancray/abide/commit/80786f13d2fcaaa1bdb6f1913959010fd1de66a6) - domain-language CONTEXT.md, first ADRs, forwardHeaders in app hooks comment ([`1512a33`](https://github.com/briancray/abide/commit/1512a33a10cdccd338411d7a7f3d230dd3779c8a))

- [`80786f1`](https://github.com/briancray/abide/commit/80786f13d2fcaaa1bdb6f1913959010fd1de66a6) - extract view resolver, page renderer, and app asset server from createServer ([`effd6fa`](https://github.com/briancray/abide/commit/effd6fa1f8316347e14e15a1fa5569c2ef4e8b34))

- [`80786f1`](https://github.com/briancray/abide/commit/80786f13d2fcaaa1bdb6f1913959010fd1de66a6) - biome whitespaceSensitivity css + repair collapsed inline spacing ([`f3ac186`](https://github.com/briancray/abide/commit/f3ac1866e1adb66336ad4641f2223aeb724b82b9))

## 0.21.0

### Minor Changes

- [`0a5c25c`](https://github.com/briancray/abide/commit/0a5c25c39c9894f6504f804c1c69e44f997eca6d) - Add `page.navigating` — a boolean on `abide/browser/page` that is true while a pathname-changing SPA navigation resolves its view, and false otherwise (always false during SSR). Read it inside a `$derived`/`$effect` to drive loading indicators.

## 0.20.1

### Patch Changes

- [`b24f689`](https://github.com/briancray/abide/commit/b24f689f06d32c47a0636f5e834758401b8933a7) - degrade un-serializable schemas to opaque instead of throwing ([`9477216`](https://github.com/briancray/abide/commit/94772166c5c1d435bfcd013c8c2bcf75e699bb51))

## 0.20.0

### Minor Changes

- [`9cbca7d`](https://github.com/briancray/abide/commit/9cbca7d28c258d4574ac450811628f107e502711) - Bundle apps auto-start the local assistant. When a bundled abide app connects (embedded or remote) and the app ships `@abide/claude-code` (its UI uses `browser/assistant`) with `claude` on PATH, the bundle launcher runs the loopback bridge for you and hands the page its port+token via the URL fragment — no copy-paste command. The bridge is loopback-only and dies with the connection. abide takes **no dependency** on `@abide/claude-code`: it's a guarded optional import that no-ops (and compiles fine) when the app doesn't ship it.

  `assistant()` gains a `status` — `'ready' | 'starting' | 'manual' | 'unavailable'` — so the same UI works in a browser (`manual` → show `command`) and a bundle (`starting`/`ready` auto-managed, or `unavailable` when `claude` isn't installed → show an install hint). `command` is now `string | undefined` (undefined whenever a host manages the bridge).

## 0.19.4

### Patch Changes

- [`946b6c4`](https://github.com/briancray/abide/commit/946b6c44b09ca30f28f4ab38d43ad5f9db452c2a) - clear lint findings in abide helpers and examples ([`55583cc`](https://github.com/briancray/abide/commit/55583ccd3cfa96e98ec94d0bb87210eaf3c047de))

- [`946b6c4`](https://github.com/briancray/abide/commit/946b6c44b09ca30f28f4ab38d43ad5f9db452c2a) - repair stale package references and sync to current API ([`f33a7b2`](https://github.com/briancray/abide/commit/f33a7b29aa14965790e53bdc3d34082972278abc))

## 0.19.3

### Patch Changes

- [`ae17e17`](https://github.com/briancray/abide/commit/ae17e17cac4a52a7506e411a572857cdf6f2d5d1) - type the warm sync return as Promise<Return> | Return ([`a00afa7`](https://github.com/briancray/abide/commit/a00afa7955fef3755f91b8a4da935916701c070a))

## 0.19.2

### Patch Changes

- [`e772716`](https://github.com/briancray/abide/commit/e772716a190f826f0041b8358271604ad5a230a5) - single prompt renderer and lazy-built agent surface ([`224d348`](https://github.com/briancray/abide/commit/224d34852a63122bb53ba85a5f37af729cc987a7))

- [`e772716`](https://github.com/briancray/abide/commit/e772716a190f826f0041b8358271604ad5a230a5) - surface abnormal engine stops and bound the tool loops ([`d2c3215`](https://github.com/briancray/abide/commit/d2c3215bb50ba41b2407eb8878e426a164927d9d))

- [`e772716`](https://github.com/briancray/abide/commit/e772716a190f826f0041b8358271604ad5a230a5) - populate the page proxy on error and 404 renders ([`e680ae6`](https://github.com/briancray/abide/commit/e680ae6b12c773f1516fe0ab128be9a208d855f0))

## 0.19.1

### Patch Changes

- [`c392c5a`](https://github.com/briancray/abide/commit/c392c5abf08a070617e7bfa1094cc38a20cba002) - read the page store during SSR via a request-scoped resolver ([`85f4c7a`](https://github.com/briancray/abide/commit/85f4c7a486191847772553cd62b34315a15a6438))

## 0.18.0

### Minor Changes

- [`e21b424`](https://github.com/briancray/abide/commit/e21b424e775e893a6d2655045223743c655e366d) - add a same-origin manual rebuild trigger to dev: `POST /__abide/reload` (sibling of the `/__abide/dev` live-reload channel) signals the orchestrator over IPC to rebuild + restart on command. Pair it with `ABIDE_DEV_NO_WATCH=1 abide dev`, which skips the src/ file watcher so a long-lived in-process job (e.g. an agent editing the app's own source) isn't torn down by a save. Default `abide dev` is unchanged; the trigger adds no extra port.

### Patch Changes

- [`b1e00c8`](https://github.com/briancray/abide/commit/b1e00c89e9d18fefaa84aff43fcf08fd5ee703bb) - rename constants to UPPERCASE_SNAKE_CASE ([`d1cc5d2`](https://github.com/briancray/abide/commit/d1cc5d2b09f4344167cfd09d698aef3fb49382c3))

## 0.17.1

### Patch Changes

- [`e643a7e`](https://github.com/briancray/abide/commit/e643a7e74850e4d17435a868f6b71f20b37d7612) - isolate dev builds to staging dirs and reap the server child on exit ([`0f4d97e`](https://github.com/briancray/abide/commit/0f4d97e3194d6dff652a434ab78c8bb651cdefe4))

## 0.17.0

### Minor Changes

- [`41625d6`](https://github.com/briancray/abide/commit/41625d6be7b2e86030a9811039317b8396c1e702) - report post-invalidate reloads via cache.refreshing ([`0008664`](https://github.com/briancray/abide/commit/00086640bc957f6fb65fb5bd00a06d622dc96996))

### Patch Changes

- [`41625d6`](https://github.com/briancray/abide/commit/41625d6be7b2e86030a9811039317b8396c1e702) - sync examples and template with 0.16 (bundled, DEBUG=abide) ([`590152d`](https://github.com/briancray/abide/commit/590152d71cd2cba77d9f39970c6590cc8285b2e6))

## 0.16.0

### Minor Changes

- [`38bdca6`](https://github.com/briancray/abide/commit/38bdca60b6a05496f16b87a89660c0e4742b894c) - add bundled() to detect the desktop bundle ([`3cdca36`](https://github.com/briancray/abide/commit/3cdca36d5d31b6ffc3eaf88adc296ee5f285eb83))

### Patch Changes

- [`38bdca6`](https://github.com/briancray/abide/commit/38bdca60b6a05496f16b87a89660c0e4742b894c) - extract clientBuildPlugins for the page and connect-screen builds ([`0974367`](https://github.com/briancray/abide/commit/0974367947b4619780b8d60f959c9067974f437b))

- [`38bdca6`](https://github.com/briancray/abide/commit/38bdca60b6a05496f16b87a89660c0e4742b894c) - share a defaultPort across server, dev, and embedded launcher ([`27f91e5`](https://github.com/briancray/abide/commit/27f91e512963b0a82d39f66c20778ee9191c9f07))

- [`38bdca6`](https://github.com/briancray/abide/commit/38bdca60b6a05496f16b87a89660c0e4742b894c) - extract importNamesToStrip for the server-stub strip ([`2b28922`](https://github.com/briancray/abide/commit/2b28922576202daee109170774e2b763de786b7e))

- [`38bdca6`](https://github.com/briancray/abide/commit/38bdca60b6a05496f16b87a89660c0e4742b894c) - render the boot surface map as aligned page/socket/rpc tables ([`2b336af`](https://github.com/briancray/abide/commit/2b336af13c8b2a375d4e2d9e6bebfcdce8ab2c9d))

- [`38bdca6`](https://github.com/briancray/abide/commit/38bdca60b6a05496f16b87a89660c0e4742b894c) - resolve the SPA target view before writing history ([`5685e05`](https://github.com/briancray/abide/commit/5685e051eedda4267ced59c12d92441285d48d41))

- [`38bdca6`](https://github.com/briancray/abide/commit/38bdca60b6a05496f16b87a89660c0e4742b894c) - avoid per-call array allocation in forwardHeaders ([`acc859b`](https://github.com/briancray/abide/commit/acc859b7f213a1349e1fefd106ff146aa1dd0a24))

## 0.15.0

### Minor Changes

- [`c9d0d8b`](https://github.com/briancray/abide/commit/c9d0d8bb3102c5baabf680cef310963626558658) - dev orchestrator with browser live-reload ([`5d2b392`](https://github.com/briancray/abide/commit/5d2b392a41a659bf3b198a29930dde4caf4f44d0))

## 0.14.0

### Minor Changes

- [`559772c`](https://github.com/briancray/abide/commit/559772cdee4f496629a3e2cb5c38a1f4206703d9) - configurable SSR/MCP header forwarding and a boot-time surface map ([`6f03a53`](https://github.com/briancray/abide/commit/6f03a5367cd3d16a7f51910a992cf081fb6e0b02))

- [`559772c`](https://github.com/briancray/abide/commit/559772cdee4f496629a3e2cb5c38a1f4206703d9) - add cache.refreshing() reactive revalidation probe ([`8ab8666`](https://github.com/briancray/abide/commit/8ab866670888970c728aa68c4d20999e19d46756))

### Patch Changes

- [`559772c`](https://github.com/briancray/abide/commit/559772cdee4f496629a3e2cb5c38a1f4206703d9) - prevent cache-key collisions for Date/Map/Set/bigint args ([`3910cbf`](https://github.com/briancray/abide/commit/3910cbf3d3a3e7204df91a8a55284b00a5c052a0))

## 0.13.2

### Patch Changes

- [`0dfb38f`](https://github.com/briancray/abide/commit/0dfb38f16ab42d9d25806a9fad8fdfd6846b708f) - wire bun test preload and complete abide command scripts in scaffold + examples ([`6bd497a`](https://github.com/briancray/abide/commit/6bd497a065190f0afdd4445848e7322a8b120d50))

## 0.13.1

### Patch Changes

- [`bfbc36c`](https://github.com/briancray/abide/commit/bfbc36c940ace6422c873693258d5c409d6406e9) - Publish an up-to-date README and include `CHANGELOG.md` in the package tarball. The npm copy of the README had drifted from the maintained source; the changelog is now shipped alongside it.

## 0.13.0

### Minor Changes

- [`e052e54`](https://github.com/briancray/abide/commit/e052e5457bec12774b56e095c7ede98c6eb5a945) - add 'abide run' to execute scripts under the abide preload ([`fc77a20`](https://github.com/briancray/abide/commit/fc77a20ec535223cfe56c5f134d812449558047f))

### Patch Changes

- [`e052e54`](https://github.com/briancray/abide/commit/e052e5457bec12774b56e095c7ede98c6eb5a945) - resolve server() in-process so handler idioms don't throw in tests ([`03cc3c1`](https://github.com/briancray/abide/commit/03cc3c1a6fb0ebc3b42156b450952dfc5336819e))

## 0.12.0

### Minor Changes

- [#40](https://github.com/briancray/abide/pull/40) [`26ba6fe`](https://github.com/briancray/abide/commit/26ba6fe710002f84b99947f7b198fa3b3f235d53) Thanks [@briancray](https://github.com/briancray)! - Namespace the CLI's baked env under `ABIDE_` and add data-dir controls.

  **Breaking:** `APP_URL` → `ABIDE_APP_URL` and `APP_TOKEN` → `ABIDE_APP_TOKEN`. These are the values baked into a downloaded CLI's `.env` (the hosted server URL, derived from the request origin, plus the bearer token when the download was authenticated) and read by the thin client to resolve its connection target. `ABIDE_APP_URL` is now public, documented surface — app code can read it to refer to the app's hosted location. Existing baked binaries and any shell `APP_URL`/`APP_TOKEN` overrides must switch to the prefixed names.

  **Added:** `abide/server/appDataDir` — a zero-arg accessor returning the running bundle's per-user data dir, keyed to the same program name abide uses for the user's `.env`/`last-connection.json`, so an app's DB/cache lands beside abide's own config rather than a drifted sibling directory.

  **Added:** `ABIDE_DATA_DIR` — overrides the data dir on every platform, used as-is. A cross-platform `XDG_DATA_HOME` (which the helper otherwise honours on Linux only), letting dev point at a throwaway dir without touching app code. Must come from a layer above the data-dir `.env` (shell, CWD `.env`, or binary-dir `.env`), since it decides where that file lives.

- [#40](https://github.com/briancray/abide/pull/40) [`310eceb`](https://github.com/briancray/abide/commit/310ecebebd018df62155d18ac01a376f5a0f42ba) Thanks [@briancray](https://github.com/briancray)! - Remove the `key` option from `cache()`.

  **Breaking:** `cache(fn, { key })` and the `{ key }` selector form of `cache.invalidate` / `cache.pending` are gone. Cache keys are always auto-derived — method+url+args for a remote function, producer-reference+args for a plain producer. To share an entry across calls, hoist the producer to a stable reference (an inline arrow gets a fresh identity every call and never dedupes). To target a set of unrelated calls with one `cache.invalidate`, tag them with a `scope`; a unique tag (e.g. a uuid) gives a set of calls their own private invalidation group.

## 0.11.1

### Patch Changes

- [#38](https://github.com/briancray/abide/pull/38) [`cb22ce9`](https://github.com/briancray/abide/commit/cb22ce91b83b755e480f2ff0abdb8a246f5e7ff9) Thanks [@briancray](https://github.com/briancray)! - Restore `abide/shared/log` as a public export. The 0.11 switch from `./shared/*` globs to an explicit allowlist dropped this isomorphic utility along with the genuinely-internal machinery: `log` is the framework's `[abide]` logger (browser + server, color-aware, with `log.debug(scope, message)` gated by `DEBUG`), documented public surface rather than an internal, so it is listed again. The `isDebugEnabled` matcher stays internal — `log.debug` already gates on it, so consumers reach for `log.debug`/`console.debug`, never the matcher directly.

## 0.11.0

### Minor Changes

- [`a1d1d56`](https://github.com/briancray/abide/commit/a1d1d56efe4887bebb74dd6707cf7cb38d8b4771) - `cache` and `HttpError` move from the `browser`/`server` namespaces to `shared`, which now denotes the isomorphic surface — names that are the same callable with the same behaviour on both sides. `cache()` runs in SSR and MCP request scope just as it does on the client, so importing it as a "browser" module misrepresented it; its client-only streaming/hydration helpers stay in `browser/` and its server-only snapshot helpers stay in `server/runtime/`. Update imports: `abide/browser/cache` → `abide/shared/cache`, and `abide/browser/HttpError` (or `abide/server/HttpError`) → `abide/shared/HttpError`.

  The package `exports` map is now an explicit allowlist of the public API instead of per-directory `*` globs, so internal modules (machinery under `shared/`, runtime/registry internals under `server/`, launcher internals under `bundle/`, and all `types/` subtrees) are no longer reachable via the package specifier. Only documented names — the verb/response/context helpers, `cache`, `HttpError`, `page`/`navigate`/`subscribe`, the `bundle` window config, the test client, and the build/plugin entries — resolve. Importing an unlisted internal path now fails; use the public name instead.

- [`a1d1d56`](https://github.com/briancray/abide/commit/a1d1d56efe4887bebb74dd6707cf7cb38d8b4771) - `cache()` now memoises plain producers, not just rpc verb helpers — pass any `() => Promise<T>` to dedupe and retain external calls (e.g. a third-party `fetch` the server makes). Producers key on the function's reference plus args (so hoist the function, or pass an explicit `key`; an inline arrow is a fresh reference every call and never dedupes), and the value promise is stored as-is — no Response decode and no SSR snapshot. A new `global: true` option puts the entry in a process-level store instead of the request-scoped one, so a value computed in one request is reused by later ones; omit it to keep per-request data from leaking across requests, and note it is a no-op on the client (one tab store). `cache.invalidate` / `cache.pending` accept a producer reference and span both stores.

- [`a1d1d56`](https://github.com/briancray/abide/commit/a1d1d56efe4887bebb74dd6707cf7cb38d8b4771) - `cache()` gains an `invalidate` option — `{ throttle: ms }` or `{ debounce: ms }` — that controls how a `cache.invalidate` hit on the key is applied, coalescing invalidation-driven refetches so a burst of invalidations (e.g. a socket spraying updates) no longer fires a burst of underlying calls. `throttle` refetches on the leading edge then at most once per N ms while invalidations keep arriving; `debounce` refetches only after N ms of quiet. Both keep serving the existing (stale) value until the refetch resolves — stale-while-revalidate — and affect only the refetch-after-invalidate, leaving the first fetch and arg-change fetches immediate. Set at most one. Input-debounce (search-as-you-type, where the args change every keystroke) is deliberately not this — debounce the reactive value feeding the args instead.

- [`a1d1d56`](https://github.com/briancray/abide/commit/a1d1d56efe4887bebb74dd6707cf7cb38d8b4771) - Add an `error.svelte` page convention. Drop `error.svelte` anywhere under `src/browser/pages/` and it renders on the server for an unknown route (404) or a throw during a page render, inside the nearest layout, receiving `{ status, message, stack }` props. The props are never serialized to the client, so the message and stack reach the browser only where the template renders them — a bare `error.svelte` leaks nothing while a dev page can show the stack. Resolution is nearest-only by directory prefix, mirroring layouts — `pages/admin/error.svelte` covers `/admin/*`, `pages/error.svelte` covers the rest. For page renders `error.svelte` takes precedence over the `app.handleError` hook, which remains the fallback when no `error.svelte` covers the path (and for rpc throws). The error document is static — the client skips hydration — and a failed SPA navigation hard-navigates so it lands on the server-rendered error page.

- [`a1d1d56`](https://github.com/briancray/abide/commit/a1d1d56efe4887bebb74dd6707cf7cb38d8b4771) - Run in-process rpc dispatch inside the request scope for the MCP tool dispatcher and the in-process CLI client. Previously both invoked handlers without a per-request scope, so `cache()` silently shared one process-wide store across calls (leaking state between unrelated tool/CLI invocations) and `cookies()`/`request()` threw. Both now cross the same `runWithRequestScope` seam the HTTP router uses, giving per-call cache isolation and resolving the scope-bound helpers.

  Behavior change for MCP: a tool handler that throws is now caught by the scope and returned as a tool result with `isError: true` (framed from the 500 response), instead of surfacing as a JSON-RPC `-32603` error on the envelope. The JSON-RPC call itself succeeds; the failure is reported at the tool-result level, which is the correct MCP shape.

- [`a1d1d56`](https://github.com/briancray/abide/commit/a1d1d56efe4887bebb74dd6707cf7cb38d8b4771) - Project JSON Schema from a schema's own `toJSONSchema()` everywhere it's needed (OpenAPI, MCP tools, CLI flags, the bundle setup form). Drop the `inputJsonSchema` / `outputJsonSchema` / `filesJsonSchema` verb opts and the socket `jsonSchema` opt — a schema whose library doesn't expose a method wraps once with the new `abide/shared/withJsonSchema` helper. Multipart file parts are now advertised generically as binary in OpenAPI rather than named per field.

  Add `src/server/config.ts` as the home for typed env: `export const config = env(schema)`, imported as `$server/config` and eager-imported at boot so validation fails fast. The file is optional and scaffolded — when absent you read `Bun.env` directly.

  The bundle's first-run setup form is now derived from that same env schema by default, so one declaration drives boot validation and the form. `BundleWindow.config` still works but now _replaces_ the derived schema (for a form that should differ from the env schema) rather than being the only source.

- [`a1d1d56`](https://github.com/briancray/abide/commit/a1d1d56efe4887bebb74dd6707cf7cb38d8b4771) - Add two server primitives. `abide/server/env` validates the process environment against a Standard Schema at module load, returning typed config and failing the boot with every issue listed when a variable is missing or malformed. `abide/server/cookies` exposes the request's cookie jar — Bun's native `CookieMap` parsed from the inbound `Cookie` header, with `set`/`delete` writes flushed to `Set-Cookie` on the outgoing response when the handler returns. `cookies` resolves from the request scope like `request()`, materialized lazily so a request that never touches them parses and emits nothing; `env` reads `Bun.env` once at module load, independent of any request.

- [`a1d1d56`](https://github.com/briancray/abide/commit/a1d1d56efe4887bebb74dd6707cf7cb38d8b4771) - Add `abide/test/createTestClient` — an in-process client for testing rpc handlers without a running server. It discovers verbs from the registry (populated by `defineVerb`) and routes through the same synthesize-and-fetch the CLI and MCP surfaces use, but runs each call inside the request scope so request-scoped helpers behave exactly as under a live HTTP request: a fresh per-request `cache()`, the cookie jar with `Set-Cookie` flush, `request()`/`server()` resolution, and `app.handleError` (or the 500 fallback) on a throw. Accepts `headers` to pre-populate inbound auth/cookies and `app` for custom error handling. Pairs with `abide/test/clearVerbRegistry` to isolate suites that define verbs inline. `dispatchVerbInProcess` gains an opt-in `requestScope` flag to back this; the CLI and MCP paths are unchanged.

## 0.10.0

### Minor Changes

- stream deferred cache resolutions from server to client ([`a608a8e`](https://github.com/briancray/abide/commit/a608a8e02cdfaa19114ce323a0e6c1aedd83c31a))

- [`6a511c4`](https://github.com/briancray/abide/commit/6a511c4961eb124fa9b21a595e0a11886ef10cda) - Stream deferred cache resolutions from the server to the client. Cache entries left pending when SSR flushes are now snapshotted on the server, their resolutions streamed over the response, and reinstalled on the client as streaming placeholders that settle as each resolution arrives. This keeps the SSR/stream split driven by `await` vs `{#await}` without blocking the initial HTML on slow cache reads.

## 0.9.1

### Patch Changes

- [#33](https://github.com/briancray/abide/pull/33) [`e8c6d74`](https://github.com/briancray/abide/commit/e8c6d74be8c4033c58fb4b23fd1861a68df640ca) Thanks [@briancray](https://github.com/briancray)! - Root-absolute `url()` references in bundled stylesheets (e.g. `url(/fonts/x.woff2)`) are now marked external instead of being resolved against the project root at build time. Those paths are served from `public/` at the site root at runtime, so Bun's CSS bundler previously failed the whole build trying to find them on disk. The literal `/…` path now survives into the emitted CSS, where the public asset server serves it. Relative `url()`s still resolve and bundle as before.

## 0.9.0

### Minor Changes

- [#31](https://github.com/briancray/abide/pull/31) [`7f43099`](https://github.com/briancray/abide/commit/7f43099e6d9bab1d3de50b37ce241c4b3e171849) Thanks [@briancray](https://github.com/briancray)! - The standalone CLI (`abide cli`) now ships the compiled server beside it and gains an interactive session. `<app> /connect <url>` connects to a remote server, `<app> /start` boots a local instance, `<app> /disconnect` forgets the saved connection, and `<app>` alone resumes it — each opening a prompt where bare words run RPC commands and `/connect` / `/start` / `/disconnect` / `/help` / `/exit` manage the connection. One-shot dispatch (`<app> <command> --flags`) is unchanged for scripting. The connection is remembered in the per-user data dir; with none saved the CLI uses the baked `APP_URL`. The download tarball now bundles the server binary so `/start` works out of the box.

- [#31](https://github.com/briancray/abide/pull/31) [`9f4500a`](https://github.com/briancray/abide/commit/9f4500a953579534088396c11da14538b56edb65) Thanks [@briancray](https://github.com/briancray)! - `abide bundle` now reads the shipped default-config file from `bundle.env` instead of `.env.bundle`. The old name masqueraded as a member of Bun's `.env.*` autoload family, implying `bun dev`/`bun start` would load it (they never did) and that it should be gitignored like `.env` (it should be committed — it's ship-safe defaults, and a compiled bundle is extractable anyway). The new name reflects what the file is: a build input, not a runtime env overlay. Rename your project's `.env.bundle` to `bundle.env`.

### Patch Changes

- [#31](https://github.com/briancray/abide/pull/31) [`a03d4ac`](https://github.com/briancray/abide/commit/a03d4acfbc6e2d596a9d7e9481fb91e437378ca7) Thanks [@briancray](https://github.com/briancray)! - `abide dev` and `abide start` no longer load the bundle's config layers (the per-user data-dir `.env` and the shipped binary-dir `bundle.env`). Those layers exist for the compiled standalone app — a bundle launched via `open` has cwd `/` and gets its config there — but the server entry loaded them unconditionally, so dev/start would also inherit them. A `PORT` saved in the data-dir `.env` (written by a bundle's connect screen) then defeated dev's auto port-scan, binding that exact port and throwing `EADDRINUSE` instead of moving on. Dev/start now keep to their project-local CWD `.env` alone; the data-dir/binary-dir layers load only when running as a `bun build --compile` standalone binary.

## 0.8.1

### Patch Changes

- [#29](https://github.com/briancray/abide/pull/29) [`f85ee72`](https://github.com/briancray/abide/commit/f85ee722cd2b659aad7d8f250ae595b0b2ccdcae) Thanks [@briancray](https://github.com/briancray)! - With no `PORT` set, the server now scans upward from 3000 at bind time, binding the listener that wins the port instead of probing a throwaway server and releasing it first. This closes the gap where the chosen port could be stolen between probe and bind, which crashed boot on `EADDRINUSE` rather than stepping to the next port. A configured `PORT` still binds that exact port and surfaces a collision loudly.

## 0.8.0

### Minor Changes

- keep streams alive past Bun's idle timeout ([`9339175`](https://github.com/briancray/abide/commit/9339175a4b73d336704bbd8ff61ecf88f8582cfa))

- [#27](https://github.com/briancray/abide/pull/27) [`78305d1`](https://github.com/briancray/abide/commit/78305d18392cd916e39475a37eaafc486d3cdabf) Thanks [@briancray](https://github.com/briancray)! - Streaming responses (sse / jsonl / socket SSE tail) now opt out of Bun's per-connection idle timeout, so a stream that stays quiet between frames is no longer closed mid-flight. A new `idleTimeout` option (and `ABIDE_IDLE_TIMEOUT` env, 0–255 seconds, default 10) sets the floor for ordinary unary handlers that legitimately compute longer than Bun's 10s default.

### Patch Changes

- dedup env-int parsing and route-dispatch 405s ([`617cc3c`](https://github.com/briancray/abide/commit/617cc3c0c5a763cd8d5e8c4bb0e74ee852500a94))

- extract route dispatch into a testable createRouteDispatcher ([`a684227`](https://github.com/briancray/abide/commit/a6842275a3fa444162571c6fccfcbadd13b712a5))

- extract request-scope runner into a testable seam ([`ce6f65c`](https://github.com/briancray/abide/commit/ce6f65c6cde3f070d4d55574979d21b362765aee))

## 0.7.0

### Minor Changes

- [#23](https://github.com/briancray/abide/pull/23) [`46f62ef`](https://github.com/briancray/abide/commit/46f62efebcdd9415b97435f17a70c91a0319a402) Thanks [@briancray](https://github.com/briancray)! - `cache()`'s `scope` option now accepts an array of tags, not just a single tag, so a call can join multiple invalidation groups (`scope: ['media', 'sources']`). `cache.invalidate({ scope })` drops every entry sharing any of the requested tags, and a re-read merges new tags into an entry rather than replacing them.
  </content>
  </invoke>

## 0.6.0

### Minor Changes

- [#21](https://github.com/briancray/abide/pull/21) [`5fbf023`](https://github.com/briancray/abide/commit/5fbf023c7de46457ae652c1738613ee2ceaf7dd7) Thanks [@briancray](https://github.com/briancray)! - `cache()` gains a `scope` option, and `cache.invalidate({ scope })` drops every entry sharing that tag in one call. `cache.invalidate` now takes `() | (fn) | ({ key?, scope? })`.

- [#21](https://github.com/briancray/abide/pull/21) [`56cd195`](https://github.com/briancray/abide/commit/56cd1950cf39e13dd06c90309efd35296c6c7e81) Thanks [@briancray](https://github.com/briancray)! - Breaking: `abide/cli/*` is no longer a public export — `createClient` is now internal. Nothing in the documented API referenced it.

- [#21](https://github.com/briancray/abide/pull/21) [`6776396`](https://github.com/briancray/abide/commit/67763968b13dd88173aeaf42242df6239fdc713b) Thanks [@briancray](https://github.com/briancray)! - When `PORT` is unset, the server now binds the first open port at or above 3000 instead of hardcoding 3000, so a second app boots without colliding. An explicit `PORT` is still honored as-is.

## 0.5.3

### Patch Changes

- extract shared build helpers and centralize bundle layout ([`64d71de`](https://github.com/briancray/abide/commit/64d71de9d4b28130775545f1047fa985545b3aaa))

- [#18](https://github.com/briancray/abide/pull/18) [`90a1713`](https://github.com/briancray/abide/commit/90a17136f53bab6f860c486e415547364fd54ca5) Thanks [@briancray](https://github.com/briancray)! - Extract repeated build-time logic into single-purpose shared helpers and collapse the per-virtual manifest codegen. `manifestModule` builds the `abide:rpc`/`sockets`/`prompts`/`pages`/`layouts` virtual modules from one path; `bundleLayout` derives `libDir`/`resourcesDir`/`envPath` from `binDir` (replacing the narrower `shippedEnvPath`) so the build writer and boot readers agree; `readPackageJson`, `exeSuffix`, `browserClientFlags`, and `memoizeByKey` deduplicate the package.json reader, the windows `.exe` suffix, the browser proxies, and the server route loaders. No public API change; behaviour preserved.

## 0.5.2

### Patch Changes

- [#15](https://github.com/briancray/abide/pull/15) [`7e3c96c`](https://github.com/briancray/abide/commit/7e3c96cd969e3f59c4be0e773478e56d21688874) Thanks [@briancray](https://github.com/briancray)! - Ship the bundle's `.env` under `Contents/Resources/` in a macOS `.app` instead of `Contents/MacOS/`. `codesign` seals `Contents/MacOS/` as code, so a data file there couldn't survive signing and reloading; `Resources` is sealed as a resource. A new `shippedEnvPath` helper centralizes the layout so the build writer and both boot readers agree on the path. The flat (non-macOS) layout is unchanged.

## 0.5.1

### Patch Changes

- [#12](https://github.com/briancray/abide/pull/12) [`47ecf72`](https://github.com/briancray/abide/commit/47ecf72c0a112461eacc9e1cd406e743c95423c5) Thanks [@briancray](https://github.com/briancray)! - A bundle's embedded server now honors a configured `PORT` instead of always picking a random free port. The launcher resolves `PORT` from the same env stack the server uses (shell, then the data-dir `.env` the config form writes, then the shipped binary-dir `.env`) and binds it as-is; with none set it falls back to a free port as before. This lets you start the embedded server at a fixed, known address on one machine and reliably connect to it from another via the connect screen.

## 0.5.0

### Minor Changes

- [#10](https://github.com/briancray/abide/pull/10) [`6ceb71b`](https://github.com/briancray/abide/commit/6ceb71b28e3b1a4c9726483d2c7dd3f40be3be59) Thanks [@briancray](https://github.com/briancray)! - Bundles now resolve config from a cwd-independent source instead of relying on Bun's cwd-based `.env` autoload (which a launched `.app`, whose cwd is `/`, silently misses). Config flows entirely through `process.env`, so app code keeps reading `Bun.env.*` and never learns where a value came from.

  - The compiled server loads two `.env` layers into `process.env` at boot, before anything reads it: the per-user data dir first (user config), then the binary dir (shipped default). Both back-fill only what a shell export or Bun's CWD `.env` didn't already set, so the precedence is `shell > CWD .env > data-dir .env > binary-dir .env > code default`.
  - Add `abide/shared/appDataDir` — the platform-standard per-user data directory keyed by program name, where the data-dir `.env` lives.
  - `abide bundle` ships an optional project `.env.bundle` as the binary-dir `.env` (the shipped default layer). Skipped when absent; use a dedicated file, never the working `.env`, since a compiled bundle is extractable.
  - Start now races server readiness against the child's exit, so a misconfigured bundle reports the crash immediately instead of stalling for the full readiness timeout.
  - A bundle resolves its last connection before the window opens: the launcher records the choice (embedded, or a remote URL) in the data dir, and on relaunch boots/probes it first, opening the window straight at the live server — so the connect screen never flashes. A boot that fails or exceeds a short ceiling, an unconfigured embedded resume, a dead saved server, or no saved choice falls back to opening the connect screen.
  - A bundle can declare `config` on its `BundleWindow` as a Standard Schema (the same kind abide accepts for RPC/MCP). Its JSON Schema drives a first-run settings modal on the connect screen — `title` → label, `description` → hint, `format: 'password'` → masked input, `default` → prefill — and answers persist to the data-dir `.env`. An explicit Start (button or File-menu click) always opens the modal prefilled with the last-used values, so re-running Start after a disconnect is how you reconfigure; an auto-start on relaunch never opens the modal — it boots a fully-configured app, or stays on the connect screen when a required key is still unset. Apps with no schema always boot straight through.

### Patch Changes

- harden PORT parsing and make shutdown signal-safe ([`9cca848`](https://github.com/briancray/abide/commit/9cca848b08a786b6abfe7920d4775a1f76c11fe6))

## 0.4.0

### Minor Changes

- [`a432d00`](https://github.com/briancray/abide/commit/a432d00d3c58dea7f4968307e9c82590ff07ef8a) - `abide bundle` now ad-hoc code-signs the assembled macOS `.app` so it launches on other Macs instead of being silently killed by Gatekeeper. A quarantined copy may still need `xattr -cr` once; full distribution still requires a Developer ID signature and notarization.

- [`a432d00`](https://github.com/briancray/abide/commit/a432d00d3c58dea7f4968307e9c82590ff07ef8a) - The native webview inspector in a bundle is now gated behind `ABIDE_INSPECT`, so release bundles ship without DevTools while debugging remains one env var away.

- [`a432d00`](https://github.com/briancray/abide/commit/a432d00d3c58dea7f4968307e9c82590ff07ef8a) - `cache()` now returns synchronously for keys already warm in the SSR hydration snapshot, so the first client read of server-rendered data skips the microtask round-trip.

- [`d0a733d`](https://github.com/briancray/abide/commit/d0a733dd238e634baa1dd9fdf0adf99114612893) - Add a name-filtered `onMenu(name, handler)` overload alongside the existing catch-all `onMenu((name) => …)` form, so a bundle menu item can bind one handler without switching on the emit name.

- [`a432d00`](https://github.com/briancray/abide/commit/a432d00d3c58dea7f4968307e9c82590ff07ef8a) - **Breaking:** verb helpers now take `inputSchema` (and optional `outputSchema`) instead of `schema`. `inputSchema` validates incoming args and feeds OpenAPI params / the MCP tool input; `outputSchema` describes the success body for the OpenAPI `200` response and MCP tool output. Client exposure (`browser` / `mcp` / `cli`) now defaults per-surface from the schema — read-only verbs auto-expose to MCP, mutating verbs opt in via `clients`. Migrate by renaming `{ schema }` to `{ inputSchema }`.

- [`a432d00`](https://github.com/briancray/abide/commit/a432d00d3c58dea7f4968307e9c82590ff07ef8a) - Sockets are now exposed to MCP and the CLI over an HTTP face: each schema-bearing socket contributes a `<name>-tail` read tool/command, plus `<name>-publish` when `clientPublish` is set.

### Patch Changes

- [`a432d00`](https://github.com/briancray/abide/commit/a432d00d3c58dea7f4968307e9c82590ff07ef8a) - Public asset paths are snapshotted on disk at boot rather than stat'd per request, and browser-only routes are logged at startup.

- [`a432d00`](https://github.com/briancray/abide/commit/a432d00d3c58dea7f4968307e9c82590ff07ef8a) - Scaffolded apps now ship a default `src/bundle/icon.png`, so `abide bundle` produces an icon'd macOS `.app` out of the box.

## 0.3.1

### Patch Changes

- [`63fe0b6`](https://github.com/briancray/abide/commit/63fe0b6cdec4d1073252a68c8185f86b74ebe48e) - Default bundle connect screen now follows the OS dark-mode setting. Added
  Tailwind `dark:` variants (driven by `prefers-color-scheme`) across the
  background, card, input, buttons, divider, and footer — all grayscale except the
  red error message. A project that ships its own `src/bundle/disconnected.svelte`
  is unaffected.

## 0.3.0

### Minor Changes

- [`3daa1cd`](https://github.com/briancray/abide/commit/3daa1cdf793ddca5efdce8027293003d177b4a48) - Bundle (macOS webview): support file downloads. The webview now installs a
  navigation + download delegate, so `<a download>`, blob:/data: links, and
  `Content-Disposition: attachment` responses save a real file to the user's
  Downloads folder and reveal it in Finder — previously the bare WKWebView set no
  navigation delegate and silently dropped them. No-op on macOS before 11.3.

## 0.2.2

### Patch Changes

- [`465928b`](https://github.com/briancray/abide/commit/465928b411b8f8aff582df87f9e2ba3782d8b275) - The generated route-types file (`src/.abide/routes.d.ts`) now augments the `Routes` interface on the module name the project imports abide under (canonical `abide` or an alias), matching the rpc/socket/prompt codegen. It previously hardcoded `abide/browser/page`, so `page.route` / `page.params` autocomplete only resolved when abide was installed under the `abide` alias.

## 0.2.1

### Patch Changes

- [`1d84fb8`](https://github.com/briancray/abide/commit/1d84fb8d64d8bb7b4d0eb3b1d24e0ea2f18b4c31) - RPC, socket, and prompt codegen now emit imports under the name abide is installed as in the consuming project — the canonical `abide` for a direct dependency, or the alias key for a package alias (`"abide": "npm:abide@..."`) — instead of a hardcoded `abide`. A plain `bun add abide` now builds with no alias required; the `abide` alias remains supported for the bare `abide/...` import surface.

## 0.2.0

### Minor Changes

- [`cf136c7`](https://github.com/briancray/abide/commit/cf136c7b763283570ef431b3aad269626bea7824) - Add a `abide bundle` desktop app and make the CLI a thin remote-only client.

  - `abide bundle` assembles a movable, self-contained desktop app (a `.app` on macOS, a flat dir elsewhere) that boots into a connect screen — start the embedded server or connect to a remote one by URL.
  - **Breaking:** the CLI binary is now always a thin remote client (talks to a running server over HTTP, `APP_URL` required). Dropped the `--thin`/full split and in-process fallback — use `abide bundle` for the embedded-backend case.
  - **Breaking:** MCP prompts are now markdown files (`src/mcp/prompts/**.md`) with YAML frontmatter, replacing the `.ts` prompt modules.
  - **Breaking:** handlers read the inbound request via `request()` and the live server via `server()` rather than `RequestStore` fields.
  - `json` / `jsonl` / `sse` / `error` / `redirect` accept a trailing `ResponseInit`.
  - Static-asset header caching is shared across asset servers, and zstd decompression moved to the async API.

## 0.1.0

### Minor Changes

- [`c863e56`](https://github.com/briancray/abide/commit/c863e563338fe704fc96a7054e27a35d271261fb) - Initial public release of abide — an isomorphic multimodal HTTP framework for Bun and Svelte. Declare a backend once and consume it over the web (SSR Svelte), the CLI, and MCP.
