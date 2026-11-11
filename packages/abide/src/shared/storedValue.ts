import { isRecord } from './isRecord.ts'
import { appName } from './log.ts'
import { runSchema, type Schema } from './Schema.ts'

/** The deadline a value written now with `ttl` runs out at, `null` where it never does (8.26). */
export function expiresAfter(ttl: number): number | null {
    return Number.isFinite(ttl) ? Date.now() + ttl : null
}

/**
 * The key a shipped store keeps `key` under: the app's name, then `key` (8.29).
 *
 * Read per call, as `log.named` reads it (28.12), so a store built before the app's identity
 * resolved still lands under it.
 */
export function storeKey(key: string): string {
    return `${appName()}:${key}`
}

/**
 * The value a shipped store read back, `undefined` where its `ttl` has passed.
 *
 * 8.27 — THE `schema` A RESTORE SKIPS (8.5) RUNS HERE, on what was read: a refusal throws, which
 * the value takes as a miss and warns about (8.15) — an entry an older build wrote is one an app
 * wants to hear about rather than serve.
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

/**
 * The text a store last wrote or read, and the value it stood for.
 *
 * 8.30 — A RE-READ OF UNCHANGED TEXT ANSWERS THE VALUE IT ANSWERED BEFORE. The default identity is
 * the reference (5.4), so a fresh `JSON.parse` of the same text would wake every reader with
 * nothing changed — and a `watch` that echoes the store's own write (a Redis keyspace event, a
 * cookie change) re-reads exactly that text.
 */
export class KeptText {
    text: string | undefined = undefined
    value: unknown = undefined
    expires: number | null = null

    /** The value `text` holds, `undefined` where there is none or its `ttl` has passed. */
    read(
        text: string | null | undefined,
        schema: Schema<unknown> | undefined,
        where: string,
    ): unknown {
        if (text === null || text === undefined) return undefined
        if (text !== this.text) {
            const kept: unknown = JSON.parse(text)
            const value = storedValue(kept, schema, where)
            this.text = text
            this.value = value
            this.expires =
                isRecord(kept) && typeof kept.expires === 'number'
                    ? kept.expires
                    : null
        }
        if (this.expires !== null && this.expires <= Date.now())
            return undefined
        return this.value
    }

    /** The text to keep `value` as, for `ttl` (8.28). */
    write(value: unknown, ttl: number): string {
        const expires = expiresAfter(ttl)
        const text = JSON.stringify({ value, expires })
        this.text = text
        this.value = value
        this.expires = expires
        return text
    }
}
