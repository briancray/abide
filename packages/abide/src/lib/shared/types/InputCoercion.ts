import type { WireKind } from './WireKind.ts'

/*
The build-time wire codec plan for a rpc's input args, keyed by field name (ADR-0028 for the
scalar `number`/`boolean` kinds, generalized by ADR-0029 to the structured `date`/`bigint`/`set`/
`map` kinds). A GET/form request delivers every field as a string, and a non-abide JSON client
sends a `Date` as an ISO string / a `Set` as an array, so parseArgs uses this plan to revive each
declared field into the typed value the input schema expects — before validation, on the exact
fields the author declared. String and other-typed fields are never listed, so a value that merely
looks numeric (an id, a zip code, `'1.0'`) stays a string. The plan is derived by the warm server
program from the real type graph and stamped into the server `defineRpc` call; a field is absent
when its type is anything but a recognized WireKind (or an array / optional thereof), so the codec
is precise and fail-open — no plan ⇒ today's string-through behavior. The abide client's own
POST/PUT/PATCH body already round-trips these kinds via ref-json; the plan covers the query-string
and non-abide-client paths where ref-json isn't in play.
*/
export type InputCoercion = Record<string, WireKind>
