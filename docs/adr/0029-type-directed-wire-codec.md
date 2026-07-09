# ADR-0029: A type-directed wire codec for structured RPC values

**Status:** accepted (2026-07-09) — input path AND output/response path shipped; nested descent
and streaming-frame encoding deferred.
Generalizes
[ADR-0028](0028-type-directed-query-coercion.md) from scalar query coercion to the
whole RPC value path: the same warm server program (ADR-0025) that supplies a field's
`number`/`boolean` kind can supply its `Date`/`Set`/`Map`/`BigInt` kind, so structured
values round-trip the wire the way the doc/cache codec already round-trips them
in-process. Builds on the live client `schemas` (ADR-0022 D2) so the client half knows
the same typed shape. Discovery-first — the load-bearing question (below) must be spiked
before this ships.

## Context

Two facts sit in tension:

- **The doc/cache codec already serializes structured values.** The reactive-doc codec
  round-trips `Map` and `Set` (the recent `doc-set-map-mutation-patches` change made their
  *mutations* emit patches too), and the ref-json codec (`encodeRefJson`/`decodeRefJson`)
  restores cycles and shared refs JSON can't carry.
- **The RPC wire is still plain JSON.** `parseArgs` reads a JSON body with `JSON.parse` (or
  ref-json when the abide client flags it); a `Date` argument crosses as an ISO string, a `Set`
  as an array (or is lost), a `BigInt` as a string or throws. The handler then receives the wrong
  runtime type unless it hand-reconstructs — the same class of gap ADR-0028 just closed for
  scalars, one level up.

ADR-0028 established the mechanism for the scalar case: read a field's declared type from the
warm server program, stamp a per-field plan, apply it in `parseArgs`. The structured case is the
same shape with a richer codomain — `'date' | 'set' | 'map' | 'bigint'` instead of
`'number' | 'boolean'` — and a symmetric need on the **response** path (the handler returns a
`Date`; the client must revive it), which the scalar ADR didn't have (scalars only flow inbound).

## Decision (sketch — pending the spike)

### D1 — one type-directed codec plan per endpoint, both directions

Extend the ADR-0028 field classifier to a full `WireKind` and compute **two** plans per endpoint
from the warm server program: an **input** plan (from the `Args` type, applied in `parseArgs` on
receipt) and an **output** plan (from the handler's success-body type, applied in the client
proxy on the response). The input plan is stamped into the server `defineRpc` call (as ADR-0028
does); the output plan rides the client stub next to the live `schemas` (ADR-0022 D2), so the
client revives structured values with no runtime tagging.

### D2 — type-directed, not tag-directed

The distinguishing choice: values carry **no runtime type tag** on the wire. The codec knows a
field is a `Date` because the *type* said so, not because the value was wrapped in
`{ $type: 'date', … }`. This keeps the wire honest JSON (a non-abide client / OpenAPI SDK still
reads it), keeps payloads tag-free, and reuses the "resolve through the real type graph" instinct
(ADR-0022 D1). Ref-json stays the escape hatch for the genuinely un-typed structural cases
(cycles, shared refs) the type graph can't express as a field kind.

### D3 — fail-open and non-abide-client-safe, exactly as ADR-0028

No plan (no warm program, unresolvable type) ⇒ today's plain-JSON behavior. A field whose kind
the codec can't revive falls through as its JSON form rather than throwing. A non-abide caller
that sends an ISO string for a `Date` field is coerced by the input plan just like ADR-0028's
scalars, so the HTTP/OpenAPI contract still works.

## Consequences (anticipated)

- **`Date`/`Set`/`Map`/`BigInt` arguments and return values round-trip without ceremony** — the
  in-process structured-value story (doc/cache) finally extends to the wire, closing the last
  "typed everywhere except the network" seam.
- **The `parseArgs` `Date` open question from ADR-0028 is answered here**, not by a scalar hack.
- **Bundle cost is bounded** — the output plan is a small per-endpoint object on the client stub
  (schemas already ride there); the input plan is server-only.
- **Risk: type/runtime divergence.** If the declared type says `Date` but the value isn't
  revivable, the codec must degrade visibly, not silently hand the handler a wrong type — the
  dev-visibility bar the framework holds elsewhere.

## Implementation note (first increment)

**Spike result — classification is reliable for all four kinds.** A throwaway probe built the same
`ts.Program` shape as `createRpcServerProgram` over a fixture (`tests/support/fixtures/rpcServer/
src/server/rpc/wireCodec.ts`) whose `Args` and success body carry a `Date`, a `Set<string>`, a
`Map<string, number>`, a `bigint`, and a plain `string`. Through the checker, `Date`/`Set`/`Map`
resolve by `type.getSymbol()?.name` and `bigint` by `TypeFlags.BigInt`; the `string` field stays
unclassified. The success body resolved to `Body | undefined` and classified identically after
dropping the `undefined` member. No kind was dropped.

**What shipped (input path only).** The ADR-0028 field classifier was widened to a `WireKind`
codomain (`number | boolean | date | bigint | set | map`, `src/lib/shared/types/WireKind.ts`);
`InputCoercion` now maps field → `WireKind`. `createRpcServerProgram`'s classifier (`wireKind`)
adds the four structured kinds, and `parseArgs`'s applier (`reviveValue`/`reviveScalar`) revives a
top-level field from its plain-JSON wire form: ISO string → `Date`, numeric string → `bigint`,
JSON array → `Set`, JSON entries array / object → `Map`. Everything is fail-open — no plan, an
unrevivable value, or an already-typed value (the abide client's ref-json body) is left as-is,
never thrown. The plan is stamped into the server `defineRpc` `coerce` opt exactly as ADR-0028's;
no wire tag is added, so a plain-JSON / OpenAPI client still reads the contract.

**What was deferred (from the first increment):**

- **Nested/recursive descent.** Only top-level `Args` fields are classified/revived. A `Date`
  inside an array inside an object still needs a *path*-shaped plan; bounded out of this increment.

## Implementation note (second increment — the output/response codec)

The deferred output/response codec now ships, keeping D1–D3 exactly. The load-bearing insight from
the spike below: the response path is broken one step EARLIER than the input path — `json()`
serializes via `Response.json` → plain `JSON.stringify`, which destroys structured values *before*
they reach the wire (`Set`/`Map` → `{}`, `bigint` → a 500 throw, `Date` → ISO string, which
survives). So a client decoder would have nothing to revive; the fix is a server ENCODE step first,
then a type-directed client DECODE.

**Spike result — two plug points confirmed.**

- *Server serialization point:* `json()` (`src/lib/server/json.ts`) is the single point where a
  point-read body is stringified. A `JSON.stringify` REPLACER plugs in there and fixes bigint/Set/Map
  for every client without breaking existing response tests. Streaming (`jsonl()`/`sse()`) is a
  separate serialization path, left for a follow-up.
- *Client bake + decode point:* the output plan rides the `remoteProxy` opts exactly the way the
  live `schemas` do (ADR-0022 D2) — `prepareRpcModule.rewriteForClient` injects `outputWirePlan: {…}`
  into the emitted `__abideRemoteProxy__(…)` opts, `remoteProxy` forwards it to
  `createRemoteFunction`, and the decoded-read path (`callable`, after `cache.read`) applies revival.
  This is a NEW baking direction: the input `coerce` plan bakes into the server `defineRpc`; the
  output plan bakes into the CLIENT stub.

**What shipped.**

- **Server encode — value-directed, runs for ALL clients.** `wireJsonReplacer`
  (`src/lib/shared/wireJsonReplacer.ts`) rewrites `bigint` → its digit string, `Set<T>` → a JSON
  array of `T`, `Map<K,V>` → a JSON array of `[K,V]` entries; `Date` needs no branch (native
  `toJSON`). `json()` serializes with it, so a structured return crosses as honest JSON matching the
  projected schema — no runtime type tag (D2). The bigint-500 crash and the Set/Map data loss are
  fixed for every client, abide or not. Never throws.
- **Query — `outputWirePlanForModule`.** On `createRpcServerProgram`, resolves the handler's
  success-body type the same way `returnBodyForModule`/`walkSuccessBodies` do and projects each
  OBJECT body's fields to `{field: WireKind}` via the shared `wireKind` classifier, keeping only the
  structured kinds (`date`/`bigint`/`set`/`map`) — `number`/`boolean` already ride as their JSON
  type. Fail-open undefined.
- **Client bake + decode.** `OutputWirePlan` (`src/lib/shared/types/OutputWirePlan.ts`) is stamped
  onto the client stub; `reviveWireOutput` (`src/lib/shared/reviveWireOutput.ts`) revives the
  DECODED body's named top-level fields (array → `Set`/`Map`, digit string → `bigint`, ISO string →
  `Date`). A field absent from the plan (a genuine array) is untouched. Fail-open, top-level only.
- **Projector coherence.** `jsonSchemaForType` now projects `Set<T>` → `{type:'array',items:T}` and
  `Map<K,V>` → an array of `[K,V]` entry tuples, so the generated OpenAPI matches the actual bytes.

**What was deferred (from this increment):**

- **Nested/recursive descent (both directions).** The output plan, like the input plan, is a flat
  top-level field map — a `Set` inside an array inside an object still needs a *path*-shaped plan.
- **Streaming-frame encoding.** `jsonl()`/`sse()` frames are not run through the wire replacer, and
  a streaming body contributes no output plan; a structured value inside a streamed frame is
  unchanged. Follow-up.
- **Server-side in-process revival.** The output plan is baked onto the CLIENT only (D1). A server
  in-process read (SSR/cache) decodes its own `json()` response and now sees the honest-JSON form
  (an array/entries/string) rather than the pre-encode `{}` — data-preserving but not the original
  `Set`/`Map`. Full isomorphic revival on the server path is a follow-up.

## Open questions (remaining)

- **Nested/recursive structures.** A `Date` inside an array inside an object needs a *path*-shaped
  plan, not a flat field map. Decide whether to bound to top-level + one array level (as ADR-0028
  does) or invest in a recursive descent — the cost/coverage tradeoff is the crux.
- **Interaction with ref-json (output side).** The response codec keeps responses on tag-free honest
  JSON (D2); ref-json stays the escape hatch for the genuinely structural cases (cycles/shared refs)
  a flat field kind can't express. If a future increment routes a cyclic response through ref-json,
  the type-directed revival must stay a no-op on the already-typed ref-json value, exactly as the
  input side already does — without double-encoding.
