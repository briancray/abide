# ADR-0030: Handler-return-typed RPC surface generation

**Status:** accepted (2026-07-09). A third consumer of the warm server program from
[ADR-0025](0025-warm-server-graph-checker-for-build-transforms.md): the program already
resolves a handler's return type for streaming detection
(`handlerReturnsStream` → `TypedResponse<AsyncIterable<…>>`); this reuses that
resolution to derive the endpoint's **success-body type** for the generated surfaces
(`.d.ts`, OpenAPI 200, MCP `outputSchema`) instead of requiring an author-declared
`schemas.output`. Sibling to [ADR-0028](0028-type-directed-query-coercion.md) (input
side) — this is the output side of "the checker reads what the author already wrote."

**Implementation note (2026-07-09).** D1 shipped: `createRpcServerProgram` gains
`returnBodyForModule(modulePath)` returning a `ReturnBody` (`{ type, streaming }`) — the
handler's success body rendered as a TS type string, or the per-frame type with
`streaming: true` for a streaming endpoint. It reuses `handlerReturnsStream`'s
signature + `unwrapPromise` + `typeIsAsyncIterable` machinery, drops `TypedError`
(`__abideError`) branches, takes each success `TypedResponse` `__body` (stripping the
phantom-optional `undefined`), and fails open to `undefined` like every other query.
Unit tests in `rpcServerProgram.test.ts` cover a typed json() body, a streaming jsonl()
frame, and the unknown-path fail-open. **D2 is deferred** (see Open questions): the
generator wiring is a no-op until a TS-type→JSON-Schema projector exists — the query
lands first, the consumer follows, matching ADR-0025/0028's cadence.

## Context

The RPC surface generators recover type meaning unevenly:

- **`writeRpcDts` derives only the method** (via `detectRpcMethod`) — the emitted `.d.ts`
  carries the route/method but not the response body type.
- **OpenAPI/MCP output shape needs `schemas.output`.** `RpcHelper`'s `SuccessBody<R>` already
  computes the success body type *for client inference* (the caller's `Return`), but the
  OpenAPI 200 / MCP `outputSchema` projection only fires when the author *also* declares
  `schemas.output` — a redundant second declaration of a type the handler's return already
  states.

The warm server program already computes exactly the needed type: `handlerReturnsStream` unwraps
`Promise` and reads the handler's return type to test the streaming brand. The success-body type
is the same resolution one step further (`SuccessBody<Awaited<ReturnType<handler>>>` — strip the
`TypedError` branches, take the `TypedResponse<Body>` body). So the generators can read the body
type from the program rather than demand a hand-written `schemas.output`.

## Decision (sketch)

### D1 — `returnBodyForModule` on the warm server program

Add a query returning the endpoint's success-body **type** (and, where a streaming endpoint, its
frame type) — reusing `handlerReturnsStream`'s handler-signature + `unwrapPromise` machinery,
then projecting `SuccessBody` (drop error branches, take the `TypedResponse` body). Fail-open to
undefined like every other query.

### D2 — the generators consume it; `schemas.output` becomes an override, not a requirement (ACCEPTED)

**Shipped.** A `ts.Type`→JSON-Schema projector (`jsonSchemaForType`) — the complement of
`jsonSchemaForSchema`, which projects a runtime validator — generates the OpenAPI 200 / MCP
`outputSchema` / inspector output shape from the handler's return type when no `schemas.output`
validator is declared. A `returnBodySchemaForModule` query on the warm server program resolves the
same success-body `ts.Type`(s) as `returnBodyForModule` and runs the projector. An explicit
`schemas.output` still **overrides** it (a runtime-validated narrowing the type can't express). So a
plainly-typed handler gets a typed output surface for free; an author who wants runtime output
validation still declares `schemas.output`. `.d.ts` return-body emission stays out of scope — the
spike confirmed the caller's `Return` already flows natively (below).

**Projector scope.** Covers what `json()`/`jsonl()` emit: string / string-literal `const` / literal
union `enum`; number / boolean / null; `bigint` → string (no JSON bigint — matches the ADR-0029 wire
representation); `Date` → `date-time`; object → `properties` + `required` (optional and
`undefined`-bearing properties excluded); index signature / `Record<string,V>` → `additionalProperties`;
`T[]` → `items`; tuple → `prefixItems` + `items: false`; union → `anyOf` with optionality-only
`undefined`/`null` members stripped. **Fails open** to permissive `{}` (omitted at the top level) for
`any`/`unknown`, generics it can't resolve, intersections, functions, branded/opaque types; a
**mandatory cycle guard** emits `{}` on a self-referential revisit. It never throws, so a projection
gap can't break a build.

## Consequences (anticipated)

- **Client stubs and generated surfaces carry the real response type** with no second
  declaration — the handler's return type is the single source, matching how `Return` already
  infers for the caller.
- **Streaming frame types surface** — `streamingForModule` already proves the program sees the
  `AsyncIterable<Frame>`; the frame type can reach the generated `.d.ts` / MCP schema.
- **`schemas.output` is demoted from "required for a typed output surface" to "runtime-validation
  opt-in"** — parallel to how ADR-0028 made coercion type-derived rather than schema-required.

## Resolved by the spike (2026-07-09)

- **Type → JSON-Schema projection quality → RESOLVED, projector built.** There was **no**
  TS-type→JSON-Schema step to reuse: the single projector, `jsonSchemaForSchema`, runs off a
  **runtime** Standard-Schema object (it probes `schema.toJsonSchema()`/`toJSONSchema()`) — it can't
  consume a `ts.Type`. D2 adds the missing `ts.Type`→JSON-Schema projector (`jsonSchemaForType`) at
  the fidelity above.
- **Where do the surfaces get their schema — build time or runtime? → RUNTIME registry, so the
  projected schema is BAKED at build time.** Every external surface (`buildOpenApiSpec`, `mcpTools`,
  `buildInspectorSurface`) renders off the live `rpcRegistry` — it reads `entry.outputSchema` and runs
  it through `jsonSchemaForSchema`. None of them runs inside the resolver-plugin build context, so
  none can reach the warm program to project on demand. The projected schema therefore has to be
  **baked at build time and stamped into the runtime `defineRpc` call**, exactly like ADR-0028's
  `coerce` plan: the resolver plugin calls `returnBodySchemaForModule` and `prepareRpcModule` stamps
  the result as an `outputJsonSchema` opt; `defineRpc` threads it onto a new
  `RpcRegistryEntry.outputJsonSchema` field; the three surfaces fall back to it when
  `entry.outputSchema` (the validator) is absent. Evidence: the surfaces import `rpcRegistry` and read
  `entry.outputSchema`; the `coerce` plan already follows this stamp-into-`defineRpc` path.
- **`.d.ts` emission vs. native resolution → external surfaces only.** Confirmed empirically:
  `writeRpcDts` emits only `RpcArgs<typeof import(...)>` (the args side), never the return body — the
  caller's `Return` flows through TS natively from the imported rpc module (ADR-0022 D2). So the
  return-body type is needed **only** for the external OpenAPI/MCP/CLI surfaces, not for client
  typing. This narrows the deferred consumer set to the JSON-Schema-projecting surfaces above.

## Open questions (deferred)

- **`.d.ts` return-body emission.** Still not emitted — the spike confirmed `writeRpcDts` emits only
  the args side (`RpcArgs<typeof import(...)>`) and the caller's `Return` flows natively from the
  imported rpc module (ADR-0022 D2), so client typing needs nothing here. Emitting the body type into
  the `.d.ts` for external (non-TS) consumers remains a possible extension.
- **Error-branch surfacing.** `InferredErrors` already types the client guard from the handler's
  `error.typed(...)` branches; whether the OpenAPI error responses should be generated from the same
  resolution — reusing `jsonSchemaForType` on the dropped `TypedError` branches — is a natural
  extension now that the projector exists.
- **Projector fidelity growth.** The projector fails open on generics, intersections, and branded
  types; widening coverage (e.g. resolved generic instantiations) is incremental and bounded only by
  what a surface can honestly claim.
