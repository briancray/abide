import type { WireKind } from './WireKind.ts'

/*
The build-time wire codec plan for a rpc's success RESPONSE body, keyed by top-level field name
(ADR-0029 output path — the response-side sibling of `InputCoercion`). The server serializes a
handler's structured return through a value-directed replacer (`wireJsonReplacer`), so a `Set`
crosses as a JSON array, a `Map` as an `[K,V]` entries array, and a `bigint` as a digit string —
honest JSON a non-abide client still reads. But a wire array is ambiguous (a real `T[]` vs an
encoded `Set<T>`), so an abide client needs the DECLARED kind to revive: this plan carries only the
structured kinds (`date`/`bigint`/`set`/`map`) the client proxy revives from a decoded response body.
It is resolved by the warm server program from the handler's success-body type and baked onto the
CLIENT `remoteProxy` stub (next to the live `schemas`, ADR-0022 D2). A field absent from the plan (a
genuine array, a scalar, a `number`/`boolean` JSON already carries) is left untouched. Fail-open —
no plan / an unrevivable value keeps the honest-JSON form, never a throw. Top-level fields only in
this increment; a structured value nested inside another value is not descended into.
*/
export type OutputWirePlan = Record<string, WireKind>
