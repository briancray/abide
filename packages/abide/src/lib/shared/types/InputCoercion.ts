/*
The build-time coercion plan for a rpc's input args (ADR-0028): each numeric/boolean field of
the endpoint's wire `Args` type, keyed by field name. A GET/form request delivers every field
as a string (`?n=2` → `'2'`, `active=true` → `'true'`), so parseArgs uses this plan to turn a
string value into the typed value the input schema expects — before validation, on the exact
fields the author declared numeric/boolean. String and other-typed fields are never listed, so a
value that merely looks numeric (an id, a zip code, `'1.0'`) stays a string. The plan is derived
by the warm server program from the real type graph and stamped into the server `defineRpc`
call; a field is absent when its type is anything but a pure `number`/`boolean` (or an array /
optional thereof), so coercion is precise and fail-open — no plan ⇒ today's string-through
behavior.
*/
export type InputCoercion = Record<string, 'number' | 'boolean'>
