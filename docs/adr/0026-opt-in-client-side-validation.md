# ADR-0026: Opt-in client-side input validation

**Status:** proposed (2026-07-08). Builds on
[ADR-0022](0022-build-transforms-resolve-through-the-module-graph.md) D2, which put
the endpoint's live `schemas` object on the client `remoteProxy` stub, and reuses
[ADR-0020](0020-cache-policy-on-the-endpoint.md)'s endpoint-declared model. Applies
the ADR-0019/0021 fail-closed instinct to the surface decision: client validation is
UX, never a trust boundary, so it is explicit and additive.

## Context

Input validation is **server-only** today. `defineRpc.ts:148-150` runs
`inputSchema['~standard'].validate(value)` against the parsed args and turns issues into a
422 (`validationError.ts`, `fieldErrorsFromIssues.ts`). The client `remoteProxy` serializes
and sends unvalidated — a malformed call always costs a round-trip to learn it was malformed.

ADR-0022 D2 changed the client transform to forward the endpoint's **live `opts`** to
`remoteProxy`, so `schemas` now rides to the client as a real evaluable value —
`remoteProxy.ts:45` types it (`schemas?: unknown`) and today **ignores** it. The prerequisite
that made this impossible before (the import-less text-splice stub) is gone: the schema
object, including an imported validator, is genuinely present client-side.

So the wire is ready. Two things are undecided:

1. **The opt-in surface.** Client validation must not be silently on-by-schema (that repeats
   the ADR-0021 anti-pattern where a hardening act — adding a schema — silently changed
   behavior). It needs an explicit, greppable declaration.
2. **What, exactly, to validate.** `parseArgs`'s `TODO(query-coercion)` (`parseArgs.ts:129`)
   means the server sees GET query params as *strings* (`'2'`, `'true'`); the client, before
   serialization, still holds the *typed* args. Validating the typed args client-side is both
   easier and more correct than mirroring the server's string-shaped view.

## Decision

### D1 — an explicit opt-in on the endpoint definition

Client validation is declared, not inferred. It rides the existing `clients` key (the
namespace that already governs client-surface concerns, ADR-0021), e.g.
`clients: { validate: true }` — greppable at the declaration, additive, and shipped to the
stub with the rest of the live `opts` (ADR-0022). Default **off**: the fail-closed default is
today's behavior (server validates, client sends). *(Surface shape is the primary open
question — see below.)*

### D2 — `remoteProxy` pre-flight validates the typed args, with the server's error shape

When the opt-in is set and `schemas.input` is present, `remoteProxy` runs
`schemas.input['~standard'].validate(args)` **before** the fetch, on the typed args
(pre-serialization). On failure it throws an `HttpError` shaped **identically** to the
server's 422 — reuse `fieldErrorsFromIssues` (isomorphic-safe) so a caller's
`error instanceof HttpError` branch is the same whether the rejection came from the client
pre-flight or the server. No fetch is made; the round-trip is saved.

### D3 — async validation is awaited

`StandardSchemaV1['~standard'].validate` may return a `Promise` (`StandardSchemaV1.ts`). The
bare call is already async, so `remoteProxy` awaits the result before deciding to fetch.

## Consequences

- **Faster feedback, fewer round-trips** for malformed input; the error shape is identical on
  both sides, so form-error handling written against the 422 works unchanged for the local
  reject.
- **Not a security boundary — stated loudly.** The client is untrusted; server validation
  (`defineRpc.ts:148`) stays authoritative and unconditional. Client validation is a UX
  optimization only. The ADR and docs must say this explicitly so no one drops server
  validation "because the client checks."
- **Bundle cost is already paid** — the schema ships to the stub regardless (ADR-0022 D2);
  this only *uses* it. The one addition is the small validate-and-throw path in `remoteProxy`.
- **Validates typed args, sidestepping the query-coercion gap** — the client checks values in
  their real types, avoiding the server's string-shaped GET view (`parseArgs` TODO); the two
  can diverge only for a schema that would coerce, which is the same case the server TODO
  already tracks.
- **Reuses `fieldErrorsFromIssues`** (must be import-safe on the client — confirm it carries
  no server-only imports; it is in `server/rpc/` today, so it likely needs to move to
  `shared/` or the isomorphic-safe subset extracted).

## Open questions

- **The opt-in surface (D1) — the primary decision.** `clients: { validate: true }`
  (whole-endpoint), vs. `schemas: { validate: 'client' }` (on the schema group), vs. a
  top-level `validateOnClient`. Leaning `clients: { validate: true }` — client validation is
  a client-surface posture, and `clients` is where such postures already live. Confirm before
  implementing; this is the public-API shape.
- **`fieldErrorsFromIssues` / `validationError` placement.** `validationError` returns a
  `Response` (server-only); only the *issue→field-errors* mapping is isomorphic. Decide the
  minimal isomorphic extraction so the client throws the same error *data* without dragging a
  `Response` builder into the browser bundle.
- **Output-schema validation on the client?** Almost certainly no — the response is
  server-shaped and the server owns output validation. Recorded as out of scope unless a use
  case appears.
- **Default-on when a schema is present?** Rejected by the fail-closed instinct (ADR-0021):
  adding a schema is a hardening act and must not silently change client behavior. Explicit
  opt-in only.
