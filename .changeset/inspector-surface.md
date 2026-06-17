---
"@abide/inspector": minor
"@abide/abide": minor
---

Add `@abide/inspector` — an opt-in inspector activated by `ABIDE_ENABLE_INSPECTOR=true`. Install it (`bun add -d @abide/inspector`) and the flag mounts a UI at `/__abide/inspector`.

Three tabs over one event stream:

- **Logs** (default) — a live tail of request traffic, app/diagnostic channels, cache tallies, and published socket frames, with filters by channel, trace id, and free text. Click a trace id to pivot the feed to that trace.
- **Traces** — records grouped by trace id. Because abide propagates W3C trace context (a page session is one trace — the SSR render plus every RPC its interactions fire), a trace holds many requests; the tab splits each trace into nested per-request lanes (each on its own time axis, children indented under the request they descend from) with a span waterfall per request. Records now carry `requestSpan` / `parentSpan` (from the request's `TraceContext`) so this split is possible.
- **Cache** — the persistent (`global: true`) cache store: each entry's key, lifecycle state (settled / in-flight / refreshing), kind, ttl, time-to-expiry, scope tags, invalidate policy, and a value preview. Refreshes on open and on demand. (Request-scoped caches are ephemeral, so they surface as per-request tallies in Logs/Traces instead.)
- **Surface** — the static machine catalog: RPC verbs (with their declared `timeout` / `maxBodySize` / `crossOrigin` / `files` options as columns, and input/output JSON Schemas on expand) and sockets.

The framework now self-instruments the request lifecycle with `log.trace` spans on DEBUG-gated diagnostic channels — `abide:render` (SSR render), `abide:view` (view/module resolution), `abide:rpc` (verb dispatch + validation; reveals in-process RPC→RPC calls as nested spans in the same trace), `abide:cache` (producer run on a miss + coalesced wait), `abide:mcp` (tool dispatch), and `abide:sockets` (REST tail/publish). They're zero-cost when their channel is off and fill the Traces waterfall when enabled (`DEBUG=abide:*`). The verb registry now records `timeout` / `maxBodySize` / `crossOrigin` so introspection can report them.

Core stays clean: a guarded, non-literal dynamic import keeps the package out of the compiled binary, and core injects an `InspectorContext` so the package imports no abide internals. Two passive observation seams feed the inspector — the existing log tap plus a new socket-frame tap in `defineSocket`'s `publish()` — both no-ops when no inspector is mounted. The inspector is privileged operator tooling: it answers ahead of `app.handle` and warns loudly on mount, so enable it only in trusted/dev environments.
