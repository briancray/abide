# ADR-0026: Always-on client-side input validation

**Status:** accepted (2026-07-09; supersedes the 2026-07-08 opt-in draft). Builds on
[ADR-0022](0022-build-transforms-resolve-through-the-module-graph.md) D2, which put
the endpoint's live `schemas` object on the client `remoteProxy` stub, and reuses
[ADR-0020](0020-cache-policy-on-the-endpoint.md)'s endpoint-declared model. The draft
gated validation behind `clients: { validate: true }` on a fail-closed instinct; that was
a category error — client validation is **not** a security boundary (the server stays
authoritative), so a free, server-backstopped UX win should not default off. It is now **always on** whenever an
input schema is present, made safe by a fall-through rule so it can never break a call.

## Context

Input validation is **server-only** today. `defineRpc.ts` runs
`inputSchema['~standard'].validate(value)` against the parsed args and turns issues into a
422 (`validationError.ts`, `fieldErrorsFromIssues.ts`). The client `remoteProxy` serializes
and sends unvalidated — a malformed call always costs a round-trip to learn it was malformed.

ADR-0022 D2 changed the client transform to forward the endpoint's **live `opts`** to
`remoteProxy`, so `schemas` now rides to the client as a real evaluable value. The prerequisite
that made this impossible before (the import-less text-splice stub) is gone: the schema object,
including an imported validator, is genuinely present client-side.

So the wire is ready. The design question is not *whether* to expose a switch, but *what to
validate* and *how it fails*:

1. **What, exactly, to validate.** `parseArgs`'s `TODO(query-coercion)` (`parseArgs.ts:129`)
   means the server sees GET query params as *strings* (`'2'`, `'true'`); the client, before
   serialization, still holds the *typed* args. Validating the typed args client-side is both
   easier and more correct than mirroring the server's string-shaped view.
2. **How it fails when the validator can't run.** A schema may carry a non-portable refinement
   (an async/resource check that only resolves server-side). If the client *hard-failed* the
   call when such a validator throws, "add a schema" could silently break a working endpoint —
   a behavioral regression (not a security one). The fall-through rule (D2) removes it, which is
   what makes an opt-in unnecessary.

## Decision

### D1 — always on when an input schema is present; no opt-in

Client validation runs automatically whenever the endpoint declares `schemas.input` (which
already rides to the stub, ADR-0022 D2). There is **no** `clients: { validate }` flag. The
draft's opt-in was justified by a fail-closed instinct — but that instinct governs *security*
defaults (surface exposure, cross-user sharing), and client validation is not a security
boundary: the server's validate stays authoritative and unconditional. Defaulting a
free, server-backstopped UX improvement to off was a category error. The only real hazard of
on-by-default is a *behavioral regression* (a validator that can't run client-side breaking the
call), and D2's fall-through removes it. So: schema present ⇒ pre-flight on; schema absent ⇒
today's behavior (serialize and send), with nothing to configure.

### D2 — a returned failure blocks; a thrown validator falls through

When `schemas.input` is present, `remoteProxy` runs `schemas.input['~standard'].validate(args)`
**before** the fetch, on the typed args (pre-serialization). Two outcomes are distinguished:

- **Returned `{ issues }`** — a definitive "this input is invalid": throw an `HttpError` shaped
  **identically** to the server's 422 (via the isomorphic `fieldErrorsFromIssues`, so a caller's
  `error instanceof HttpError && error.kind === 'validation'` branch is the same whether the
  reject came from the client or the server), and make **no** fetch — the round-trip is saved.
- **A thrown/rejected validate** — the validator itself could not run here (a non-portable /
  async-resource refinement). This is *not* a verdict on the input: **fall through to the fetch**
  and let the authoritative server validate. So a schema can never break a call merely by failing
  to run client-side — the safety that makes always-on sound.

The client thus *blocks* only on an affirmative "invalid" verdict and *defers* on everything else.

### D3 — async validation is awaited

`StandardSchemaV1['~standard'].validate` may return a `Promise`. The bare call is already async,
so `remoteProxy` awaits the result before deciding to fetch or fall through.

## Consequences

- **Faster feedback, fewer round-trips** for malformed input, on every schema'd endpoint by
  default — the error shape is identical on both sides, so form-error handling written against
  the 422 works unchanged for the local reject.
- **Not a security boundary — stated loudly.** The client is untrusted; server validation
  (`defineRpc.ts`) stays authoritative and unconditional. Client validation is a UX optimization
  only. Code comments on `remoteProxy.ts`/`validationHttpError.ts` say so, so no one drops server
  validation "because the client checks."
- **Cannot break a call.** The fall-through rule means a non-portable validator degrades to
  today's behavior (round-trip, server decides) rather than failing client-side — the property
  that let the opt-in be removed.
- **Bundle cost is already paid** — the schema ships to the stub regardless (ADR-0022 D2); this
  only *uses* it. The one addition is the small validate/throw/fall-through path in `remoteProxy`.
- **Validates typed args, sidestepping the query-coercion gap** — the client checks values in
  their real types, avoiding the server's string-shaped GET view (`parseArgs` TODO).
- **`fieldErrorsFromIssues` moved to `shared/`** and a client-safe `validationHttpError` builder
  added, so the client throws the same error *data* without a `Response` builder reaching the
  browser bundle. `validationError` (server, returns a `Response`) is unchanged.

## Open questions

- **Output-schema validation on the client?** Almost certainly no — the response is
  server-shaped and the server owns output validation. Out of scope unless a use case appears.

## Resolved (were open in the draft)

- **The opt-in surface → removed.** No `clients: { validate }`; validation is on-by-schema. The
  fail-closed argument for an opt-in was a category error (client validation is not a security
  boundary), and the regression risk it protected against is handled by D2's fall-through.
- **Fail mode → fall-through.** A validator that throws defers to the server rather than failing
  the call, so on-by-default cannot regress a working endpoint.
