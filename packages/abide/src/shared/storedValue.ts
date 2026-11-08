import { isRecord } from './isRecord.ts'
import { runSchema, type Schema } from './Schema.ts'

/** The deadline a value written now with `ttl` runs out at, `null` where it never does (8.26). */
export function expiresAfter(ttl: number): number | null {
    return Number.isFinite(ttl) ? Date.now() + ttl : null
}

/**
 * The value a shipped store read back, `undefined` where its `ttl` has passed.
 *
 * 8.27 — THE `schema` A RESTORE SKIPS (8.5) RUNS HERE, on what was read: a refusal throws, which
 * the value takes as a miss and warns about (8.15) — an entry an older build wrote is one an app
 * wants to hear about rather than serve. Shared by `webStore` and the server's `sqliteStore`.
 */
export function storedValue(
    kept: unknown,
    schema: Schema<unknown> | undefined,
    where: string,
): unknown {
    if (!isRecord(kept) || !('value' in kept))
        throw new Error(`${where} holds something no abide store wrote.`)
    const expires = kept.expires
    if (typeof expires === 'number' && expires <= Date.now()) return undefined
    if (schema === undefined) return kept.value
    const checked = runSchema(schema, kept.value)
    if (checked.issues !== null)
        throw new Error(
            `${where} holds a value its schema refuses: ${JSON.stringify(checked.issues)}`,
        )
    return checked.value
}
