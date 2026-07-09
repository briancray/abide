# ADR-0028: Server-side type-directed query/form coercion

**Status:** accepted (2026-07-09; implemented same day). Closes the long-standing
`parseArgs` `TODO(query-coercion)` by consuming the warm server program from
[ADR-0025](0025-warm-server-graph-checker-for-build-transforms.md) — the checker the
server transform gained is exactly the "type structure to drive type-aware coercion"
the TODO said Standard Schema doesn't expose. Completes the server half of
[ADR-0026](0026-opt-in-client-side-validation.md): 0026 made the *client* validate
typed args pre-serialization; this makes the *server* see typed args on receipt.
Shares ADR-0025's fail-open / never-break-a-build instinct.

## Context

A GET (and a form-encoded body) delivers every field as a **string**: `?n=2` reaches the
input schema as `'2'`, `active=true` as `'true'`. A plain `z.object({ n: z.number() })` then
rejects the request — the value is a string where the schema wants a number — so a numeric
GET param silently 422s unless the author hand-writes a coercing schema.

`parseArgs.ts:129` (before this change) documented the deferral precisely and named the two
blockers:

> parseArgs has no access to the rpc's inputSchema (it lives in defineRpc), and Standard
> Schema exposes no type structure to drive type-aware coercion. Blind value-shape coercion
> is unsafe — it would corrupt legitimately string-typed fields whose value looks
> numeric/boolean (ids, zip codes, version strings like '1.0').

Both blockers are now gone:

- **The type structure exists.** ADR-0025 warmed a `ts.Program` over the server module graph
  in the resolver plugin. It already answers three type queries (streaming / method / outbox);
  the endpoint's argument shape is one more query against the same program.
- **The plan can reach `parseArgs`.** The server rewrite already stamps build-time scalars into
  the `defineRpc(…)` call (method, url, `streaming`). A coercion plan is another stamped opt.

The safety concern the TODO raised — don't corrupt a string field that *looks* numeric — is
answered structurally: coerce **only** the fields the type says are numeric/boolean, never by
sniffing the value.

## Decision

### D1 — the coercion source is the endpoint's wire `Args` type (`InferInput`)

The warm server program reads the exported RemoteFunction's **call signature first parameter** —
the wire `Args` type, which is `StandardSchemaV1.InferInput<InputSchema>` for a schema'd rpc and
the handler's annotated parameter for a schemaless one. Each field is classified:

- pure `number` (or a numeric-literal union, or `number[]`, or an optional `number | undefined`)
  → `'number'`
- pure `boolean` (same array/optional allowances) → `'boolean'`
- anything else — a `string`, a `number | string` union, an object, a `Date` → **omitted**
  (stays a string; the schema decides)

`InferInput` is the correct source, not `InferOutput` (the handler's validated param): a
**self-coercing** schema (`z.coerce.number()`) has a *loose* `InferInput` (`unknown`), so it is
left uncoerced and the schema does its own coercion — no double-coercion, no semantic conflict
(`z.coerce.boolean('false')` is `true`; a naive pre-coercion to `false` would fight it). A
non-coercing `z.number()` has `InferInput = number`, so its string GET value coerces. The
RemoteCallable parameter is always `Args | FormData` (the multipart escape hatch), so the
`FormData` member is dropped before enumerating; a body rpc whose only arg is FormData yields no
plan.

### D2 — the plan is stamped into the server `defineRpc` call, applied in `parseArgs`

The resolver plugin queries `inputCoercionForModule(path)` and threads the plan
(`Record<string, 'number' | 'boolean'>`, the new `InputCoercion` type) into `prepareRpcModule`,
which the **server** rewrite injects as a `coerce:` opt alongside `streaming` (spreading the
author's live opts). `defineRpc` reads `opts.coerce` and passes it to `parseArgs`, which — after
assembling the query/body bag — coerces each planned field's **string** value to its typed value.
The plan is server-only (parseArgs runs server-side); the client rewrite never carries it, so no
client bytes are added.

Coercion touches **only string values**, so a JSON body's already-typed values pass through
untouched (the merge keeps a body's real `number`), while query params and form-encoded body
fields — both stringly — coerce. A repeated key (`?tag=1&tag=2`) coerces per array element.

### D3 — a bad value stays a string; no warm program means no coercion (fail-open)

A value that doesn't parse cleanly — `id=abc`, an empty `id=` — is left as the **original
string**, so the schema surfaces an honest validation issue rather than the request silently
becoming `NaN`/`0`. And with no warm program (or an unresolvable Args type, or no numeric/boolean
field), **no plan is stamped** and every field stays a string exactly as today. Coercion is thus a
strict refinement: with types it makes numeric/boolean GETs validate; without them it is
byte-for-byte the old behavior.

## Consequences

- **A numeric/boolean GET validates without a hand-written coercing schema.** `GET(fn, { schemas:
  { input: z.object({ id: z.number() }) } })` accepts `?id=2`. The most common GET papercut is
  gone.
- **The TODO is closed by construction, not worked around.** Coercion is keyed on the declared
  field type, so a string field that looks numeric (`name=007`, a `'1.0'` version) is never in the
  plan and never corrupted — the exact hazard the TODO flagged.
- **Server + client now agree on typed args.** ADR-0026 validated typed args on the client;
  this makes the server receive typed args. The query-coercion gap 0026 sidestepped on the client
  is now closed on the server too.
- **Zero new runtime dependency, zero client cost.** Reuses the ADR-0025 program (one more query)
  and the existing server-rewrite stamping; the plan rides only the server bundle.
- **The warm server program earns its second consumer** — validating ADR-0025's "enables
  downstream … type-aware query coercion" note. The `createRpcServerProgram` query surface is now
  four (streaming / method / outbox / coercion) with one shared fail-open harness.

## Open questions

- **Coerce `Date` fields?** Out of scope here — a `Date` from a query string is a codec concern,
  not a scalar parse, and belongs with the broader type-directed wire-codec work (a future ADR).
  Today a `Date` field is omitted from the plan (stays a string; the schema decides).
- **Nested-object query coercion.** Only top-level fields are planned (query strings are flat).
  A bracketed/dotted nested-query convention is unaddressed and unneeded until a nested GET
  contract appears.
