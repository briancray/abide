# @abide/inspector

## 0.3.1

### Patch Changes

- [`2efd4ad`](https://github.com/briancray/abide/commit/2efd4ad1e572c46a0611d3d1d5cd1a02f80da629) - group trace children in one pass ([`f600f59`](https://github.com/briancray/abide/commit/f600f59e86c89e14f44672eb9c2335f99d532042))

## 0.3.0

### Minor Changes

- [`dfd9d9e`](https://github.com/briancray/abide/commit/dfd9d9e9149c16761c539f7b45358e9a969174d8) - render prompts, in-flight requests, and live client state ([`85cac33`](https://github.com/briancray/abide/commit/85cac336b7ac89b9b76b47fc6481f482eaf9b21b))

## 0.2.1

### Patch Changes

- [`82eea9a`](https://github.com/briancray/abide/commit/82eea9a121448f931a1ef78ce5be45288b207977) - fix: correct the abide peer dependency to `@abide/abide` (the framework package was renamed from `abide`, so the old name never resolved).

## 0.2.0

### Minor Changes

- [`0cf889b`](https://github.com/briancray/abide/commit/0cf889b859b9169be2abd35c2624ff762bd08e91) - Add `@abide/inspector` — an opt-in inspector activated by `ABIDE_ENABLE_INSPECTOR=true`. Install it (`bun add -d @abide/inspector`) and the flag mounts a UI at `/__abide/inspector`.

    Three tabs over one event stream:

    - **Logs** (default) — a live tail of request traffic, app/diagnostic channels, cache tallies, and published socket frames, with filters by channel, trace id, and free text. Click a trace id to pivot the feed to that trace.
    - **Traces** — records grouped by trace id. Because abide propagates W3C trace context (a page session is one trace — the SSR render plus every RPC its interactions fire), a trace holds many requests; the tab splits each trace into nested per-request lanes (each on its own time axis, children indented under the request they descend from) with a span waterfall per request. Records now carry `requestSpan` / `parentSpan` (from the request's `TraceContext`) so this split is possible.
    - **Cache** — the persistent (`global: true`) cache store: each entry's key, lifecycle state (settled / in-flight / refreshing), kind, ttl, time-to-expiry, scope tags, invalidate policy, and a value preview. Refreshes on open and on demand. (Request-scoped caches are ephemeral, so they surface as per-request tallies in Logs/Traces instead.)
    - **Surface** — the static machine catalog: RPC verbs (with their declared `timeout` / `maxBodySize` / `crossOrigin` / `files` options as columns, and input/output JSON Schemas on expand) and sockets.

    The framework now self-instruments the request lifecycle with `log.trace` spans on DEBUG-gated diagnostic channels — `abide:render` (SSR render), `abide:view` (view/module resolution), `abide:rpc` (verb dispatch + validation; reveals in-process RPC→RPC calls as nested spans in the same trace), `abide:cache` (producer run on a miss + coalesced wait), `abide:mcp` (tool dispatch), and `abide:sockets` (REST tail/publish). They're zero-cost when their channel is off and fill the Traces waterfall when enabled (`DEBUG=abide:*`). The verb registry now records `timeout` / `maxBodySize` / `crossOrigin` so introspection can report them.

    Core stays clean: a guarded, non-literal dynamic import keeps the package out of the compiled binary, and core injects an `InspectorContext` so the package imports no abide internals. Two passive observation seams feed the inspector — the existing log tap plus a new socket-frame tap in `defineSocket`'s `publish()` — both no-ops when no inspector is mounted. The inspector is privileged operator tooling: it answers ahead of `app.handle` and warns loudly on mount, so enable it only in trusted/dev environments.

### Patch Changes

- rename project belte → abide ([`3ed697b`](https://github.com/briancray/abide/commit/3ed697bd3c804bdd79642d9edb5d3f3045ecdb53))

- isolate SSE listeners and survive serialization/epoch edges ([`3f05656`](https://github.com/briancray/abide/commit/3f05656510a6d20dce877eda4cf0220fc8cbe535))
