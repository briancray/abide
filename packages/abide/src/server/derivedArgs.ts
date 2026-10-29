import { DERIVED_ARGS } from '#shared/DERIVED_ARGS.ts'
import type { JsonValue } from '#shared/JsonValue.ts'
import type { Gated } from '#shared/reactive/argsContract.ts'
import type { HeldToAnnotation } from '#shared/rpc.ts'
import { validateJson } from '#shared/validateJson.ts'
import { argsDocumentOf } from './coerceArgs.ts'

/**
 * Holds `handler`'s args to `schema`, the one the build derived off its annotation, for every call
 * of it from now on: in process and over the wire (15.8, 19.9).
 *
 * What the module a handler is loaded through calls once its handler is built — a handler file's
 * face and a `<script server>`'s module — so the schema is there wherever the handler can be
 * called, whether or not an app mounted it. Not where its `args` gate publishes a document of its
 * own, which holds the args itself (19.7). Args that did not come are held as an empty record: a
 * schema is only derived where the handler's args are a required record, so a required member
 * missing is refused, not read off nothing.
 */
export function derivedArgs(
    handler: HeldToAnnotation & Gated<unknown>,
    schema: JsonValue,
): void {
    if (argsDocumentOf(handler) !== undefined) return
    handler[DERIVED_ARGS] = (args) => validateJson(schema, args ?? {})
}
