# ADR-0029: A type-directed wire codec for structured RPC values

**Status:** accepted (2026-07-09) — first increment shipped (input path; output deferred).
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

**What was deferred:**

- **The output/response codec.** The response path serializes with plain `Response.json`, which
  drops a `Set`/`Map` to `{}` and throws on a `bigint` — so an output codec needs a server-side
  ENCODE step (and a decision on its interaction with `json()`/ref-json) before a client-side
  output plan can revive anything. The abide client's own POST/PUT/PATCH body already round-trips
  all four kinds via ref-json, so the input plan's marginal value is the query-string and
  non-abide-client paths (ADR-0028's scope, one level up); the output direction is a follow-up.
- **Nested/recursive descent.** Only top-level `Args` fields are classified/revived. A `Date`
  inside an array inside an object still needs a *path*-shaped plan; bounded out of this increment.

## Open questions (remaining)

- **The output/response codec** — see "deferred" above: it hinges on a server-side response encode
  step. Is the output plan worth the client bytes for every endpoint, or opt-in per kind?
- **Nested/recursive structures.** A `Date` inside an array inside an object needs a *path*-shaped
  plan, not a flat field map. Decide whether to bound to top-level + one array level (as ADR-0028
  does) or invest in a recursive descent — the cost/coverage tradeoff is the crux.
- **Interaction with ref-json (output side).** On the input side the boundary is settled:
  type-directed revival is a no-op on already-typed ref-json values, and ref-json remains the
  escape hatch for structural cases (cycles/shared refs). The output side must draw the same line
  once the response encode step exists, without double-encoding.
