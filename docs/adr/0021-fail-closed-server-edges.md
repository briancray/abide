# ADR-0021: Fail closed at the server edges — machine-surface exposure and out-of-request cache reads

**Status:** accepted (2026-07-08). Not yet implemented. Applies the same
"fail-closed, high-visibility" instinct as
[ADR-0019](0019-async-computeds-and-rpc-auto-reads.md) /
[ADR-0020](0020-cache-policy-on-the-endpoint.md) to two server edges surfaced by
an architecture sweep.

## Context

Two edges break the aesthetic the rest of the framework holds (the cross-origin
gate treats an unparseable Origin as cross-origin; `parseArgs` turns a malformed
body into a 400; sockets default `allowClientPublish: false`):

1. **Machine-surface exposure is keyed off an unrelated sniff.** The *presence*
   of an `inputSchema` silently flips an endpoint onto the CLI and MCP surfaces —
   `defineRpc.ts:93-97` (`cli: hasSchema`, `mcp: hasSchema && isReadOnlyMethod`)
   and `defineSocket.ts:47` (`mcp/cli: hasSchema`). Adding *validation* — a
   hardening act — *widens* the machine-reachable surface, and there is no
   greppable `clients: { mcp: true }` at the declaration to audit. The only
   backstop for an unauthenticated `/__abide/mcp` with exposed declarations is a
   `warn` (`warnUnguardedMcp.ts:15-33`), whose own comment says "an
   unauthenticated machine surface should never boot silently" — but a log line
   *is* silent in practice.
2. **A cache read outside a request scope falls back to the process-global
   store** — `serverEntry.ts:77`, `requestContext.getStore()?.cache ??
   sharedCacheStore`. Pattern-matches as fail-open (fallback, not refusal), which
   is why a future sweep will re-flag it; this ADR records why it is *not*.

## Decision

### A — read-only surfaces auto-expose; writes and publishes opt in

The line is safety, not schema: **an idempotent read is safe to auto-expose to
machines; anything that can mutate must be a deliberate declaration.**

- **rpc:** a GET (read-only, `isReadOnlyMethod`) with a schema keeps auto-exposing
  to MCP + CLI (unchanged — this is the DX worth keeping). A **write**
  (POST/PUT/PATCH/DELETE) no longer auto-exposes: `cli: hasSchema` becomes
  `cli: hasSchema && isReadOnlyMethod`, and reaching a write over MCP/CLI requires
  an explicit `clients: { cli: true }` / `{ mcp: true }` (merged through
  `resolveClientFlags`). Schema is a *precondition* for exposure, never the
  *trigger*.
- **socket:** the same split by surface — the **tail** is a read, so a schema'd
  socket keeps auto-exposing its tail; exposing a **publish-capable** socket
  (`allowClientPublish`) to machines becomes opt-in.
- **MCP auth — refuse, don't warn.** When `/__abide/mcp` is mounted with exposed
  declarations and no `app.handle` auth middleware, **refuse to serve** rather
  than log a warning, unless the app explicitly acknowledges an authless surface
  (`app.mcp({ public: true })`). The warning survives only for the acknowledged
  `public: true` path. (`warnUnguardedMcp` becomes `guardUnauthedMcp` — the boot
  check that throws/refuses instead of warning.)

Net: exposure is greppable at the declaration, hardening never widens surface,
and an unauthenticated machine surface can't boot by accident.

### B — keep the out-of-request shared-store fallback (recorded, not fixed)

The fallback at `serverEntry.ts:77` is **intentional and safe**; throwing would
break a legitimate pattern (a cron/worker/startup task reading a cacheable rpc).
It is kept, and the reasoning is recorded here so future sweeps stop re-flagging
it as fail-open:

- The fallback fires **only when there is no request in the async context**
  (`requestContext.getStore()` is undefined — cron, worker, module top-level).
  AsyncLocalStorage propagates the request store across awaits/timers, so a
  fire-and-forget task spawned *inside* a request still resolves to the request
  store; the fallback is genuinely request-less code.
- **No request → no user → no per-user data to leak.** The cross-user hazard that
  makes `shared` an explicit opt-in (ADR-0020) exists only *within* a request,
  where the resolver returns the per-request store, never the shared one.
- **Retention still requires explicit `ttl`.** A server read defaults `ttl: 0`
  (ADR-0020), so an out-of-request read *coalesces* in the shared store but does
  not *persist* unless the author asks — the cron only caches across runs when it
  says so. The ttl:0-in-shared edge is already special-cased
  (`cache.ts:537-541`).
- **The `cookies()` / `request()` analogy (which throw out of scope) does not
  apply.** Those throw because they have *no sensible out-of-request value*; a
  cache does — the process store — with a real use (the cron).

**One visibility touch:** emit a **dev-only, one-time log** the first time an
out-of-request read lands in the shared store — so it is *documented* behavior,
not *invisible* behavior. Silent in production, greppable in dev. No behavioral
change beyond the log.

## Consequences

- **Breaking (loud, compile-/boot-time):** writes and publish-capable sockets that
  relied on schema-auto-exposure to CLI/MCP now need an explicit `clients: { … }`.
  The change surfaces as those endpoints simply not appearing on the machine
  surface (and, for MCP-without-auth, a boot refusal) — not a silent behavior
  drift. Reads (GETs, socket tails) are unaffected.
- **Migration:** measure current write-endpoints relying on auto-CLI-exposure
  across examples/scaffold/kitchen-sink and add the explicit flag; regenerate the
  surface docs (`readmeSurfaces.ts`, AGENTS.md). Read endpoints need no change.
- **B is a no-op behaviorally** (plus one dev log); its value is the recorded
  reasoning — a "we deliberately did not fail-close this" entry that a future
  architecture review must not re-litigate.
- **`warnUnguardedMcp` → `guardUnauthedMcp`:** the boot path gains a refusal;
  `app.mcp({ public: true })` becomes the explicit escape hatch.

## Open questions

- **`public: true` granularity:** a whole-surface `app.mcp({ public: true })`, or
  per-declaration `clients: { mcp: 'public' }`? Leaning whole-surface — an
  authless MCP endpoint is one deliberate posture, not per-tool.
- **CLI auth parity:** this ADR hardens the MCP mount; does the CLI machine
  surface warrant the same refuse-without-auth treatment, or is CLI access
  already gated by process/shell trust? (Leaning: CLI is local-process trust, no
  gate needed — but confirm.)
