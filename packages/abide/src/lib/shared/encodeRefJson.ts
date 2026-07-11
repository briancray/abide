/*
Serialise an arbitrary value graph to a JSON string that survives cycles and shared
references — the gap JSON.stringify can't cross. Only mutable CONTAINERS (objects,
arrays, Maps, Sets) are hoisted into a flat `slots` array and referenced by index, so
a cycle becomes a back-reference instead of infinite recursion, and two paths to the
same container decode back to the same object. Primitives are encoded INLINE at their
position (not hoisted), so a primitive-heavy payload stays near plain-JSON size and
speed. Beyond plain objects/arrays it round-trips the types JSON drops or coerces:
undefined, bigint, NaN, ±Infinity, -0, Date, RegExp, Map and Set. Functions and
symbols can't be serialised and encode as undefined, matching JSON.stringify. Output
shape is `[rootValue, slots]`. Decode with decodeRefJson. Not streaming — the whole
graph is walked up front.
*/
import { REF_JSON_NUMBER_TOKENS, REF_JSON_TAGS } from './REF_JSON_TAGS.ts'
import { setOwnProperty } from './setOwnProperty.ts'

export function encodeRefJson(value: unknown): string {
    // Hoisted containers only; slots[i] is addressed by ['~r', i]. Primitives stay inline.
    const slots: unknown[] = []
    // Container identity → slot index: a revisited container emits a back-reference instead of recursing.
    const ids = new Map<object, number>()

    // Hoist a container to a slot (once) and return its index. Reserve the index BEFORE encoding
    // children so a cyclic child resolves back to this slot.
    function intern(container: object): number {
        const seen = ids.get(container)
        if (seen !== undefined) {
            return seen
        }
        const index = slots.length
        slots.push(0)
        ids.set(container, index)
        slots[index] = encodeContainer(container)
        return index
    }

    // Inline encoding of a value at its position: bare primitive, leaf-special tag, or a container reference.
    function encodeValue(input: unknown): unknown {
        if (input === null) {
            return null
        }
        const type = typeof input
        if (type === 'string' || type === 'boolean') {
            return input
        }
        if (type === 'number') {
            const numeric = input as number
            // -0, NaN, ±Infinity can't round-trip as bare JSON; tag them.
            if (!Number.isFinite(numeric) || Object.is(numeric, -0)) {
                return [REF_JSON_TAGS.NUMBER, numberToken(numeric)]
            }
            return numeric
        }
        if (type === 'bigint') {
            return [REF_JSON_TAGS.BIGINT, (input as bigint).toString()]
        }
        // undefined | function | symbol — not representable; fold to undefined as JSON drops them.
        if (type !== 'object') {
            return [REF_JSON_TAGS.UNDEFINED]
        }
        if (input instanceof Date) {
            return [REF_JSON_TAGS.DATE, input.getTime()]
        }
        if (input instanceof RegExp) {
            return [REF_JSON_TAGS.REGEXP, input.source, input.flags]
        }
        // Mutable container: hoist for identity and reference it — primitives above never reach here.
        return [REF_JSON_TAGS.REF, intern(input as object)]
    }

    // A hoisted container's slot: a tagged array (or plain object) whose nested values are encoded inline.
    function encodeContainer(container: object): unknown {
        if (Array.isArray(container)) {
            return [REF_JSON_TAGS.ARRAY, ...container.map(encodeValue)]
        }
        if (container instanceof Map) {
            return [
                REF_JSON_TAGS.MAP,
                Array.from(container, ([key, val]) => [encodeValue(key), encodeValue(val)]),
            ]
        }
        if (container instanceof Set) {
            return [REF_JSON_TAGS.SET, Array.from(container, encodeValue)]
        }
        const record = container as Record<string, unknown>
        // Own enumerable keys, built in one loop — ~2× cheaper than Object.fromEntries(keys.map(...))
        // (no intermediate pairs array / closures) on this per-object always-hot path.
        const encoded: Record<string, unknown> = {}
        for (const key of Object.keys(record)) {
            // setOwnProperty: an own `__proto__` key must reach the wire, not the accessor.
            setOwnProperty(encoded, key, encodeValue(record[key]))
        }
        return encoded
    }

    return JSON.stringify([encodeValue(value), slots])
}

// Stable token for the numbers JSON can't carry.
function numberToken(value: number): string {
    if (Object.is(value, -0)) {
        return REF_JSON_NUMBER_TOKENS.NEG_ZERO
    }
    if (Number.isNaN(value)) {
        return REF_JSON_NUMBER_TOKENS.NAN
    }
    return value > 0 ? REF_JSON_NUMBER_TOKENS.INFINITY : REF_JSON_NUMBER_TOKENS.NEG_INFINITY
}
