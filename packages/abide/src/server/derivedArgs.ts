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
 * missing is refused, not read off nothing. The args are held as SENT (`asSent`): a call in process
 * passing a member `undefined` is the call the wire carries without it.
 */
export function derivedArgs(
    handler: HeldToAnnotation & Gated<unknown>,
    schema: JsonValue,
): void {
    if (argsDocumentOf(handler) !== undefined) return
    handler[DERIVED_ARGS] = (args) => validateJson(schema, asSent(args ?? {}))
}

/** The records `asSent` is inside of, so a cyclic value is walked once rather than forever. */
const WALKING: object[] = []

/**
 * `value` as the wire carries it, which drops a member left `undefined` (19.25): a URL omits it
 * (30.28) and JSON leaves it out, at any depth of a body. `value` itself wherever it holds none, so
 * the walk allocates nothing for the call that writes no `undefined` member.
 *
 * AN `undefined` IN A LIST IS KEPT. The two encodings part there — JSON writes `null`, a URL the
 * text `undefined` — so neither is the wire's, and the schema answers the value as given.
 */
export function asSent(value: unknown): unknown {
    if (value === null || typeof value !== 'object' || WALKING.includes(value))
        return value
    WALKING.push(value)
    try {
        return Array.isArray(value)
            ? listAsSent(value)
            : recordAsSent(value as Record<string, unknown>)
    } finally {
        WALKING.pop()
    }
}

function listAsSent(list: unknown[]): unknown[] {
    let sent: unknown[] | null = null
    for (let index = 0; index < list.length; index += 1) {
        const member = list[index]
        const held = asSent(member)
        if (sent === null && held !== member) sent = list.slice(0, index)
        sent?.push(held)
    }
    return sent ?? list
}

function recordAsSent(
    record: Record<string, unknown>,
): Record<string, unknown> {
    let sent: Record<string, unknown> | null = null
    for (const key in record) {
        if (!Object.hasOwn(record, key)) continue
        const member = record[key]
        const held = member === undefined ? undefined : asSent(member)
        if (sent === null && (member === undefined || held !== member))
            sent = membersBefore(record, key)
        if (sent !== null && held !== undefined) sent[key] = held
    }
    return sent ?? record
}

/**
 * A copy of `record`'s own members ahead of `key`, in their order.
 *
 * NO PROTOTYPE, so an own `__proto__` member JSON parsed stays a member the schema reads rather
 * than becoming the copy's prototype.
 */
function membersBefore(
    record: Record<string, unknown>,
    key: string,
): Record<string, unknown> {
    const copy: Record<string, unknown> = Object.create(null)
    for (const earlier in record) {
        if (earlier === key) break
        if (Object.hasOwn(record, earlier)) copy[earlier] = record[earlier]
    }
    return copy
}
