import { cookies as requestCookies } from '../cookies.ts'
import type { Store } from '../reactive/index.ts'
import type { Schema } from '../Schema.ts'
import { KeptText, storeKey } from '../storedValue.ts'

/** What a browser keeps of one cookie, its name and its encoded value together. */
const COOKIE_BYTES = 4096

/** The longest `Max-Age` a browser honors, 400 days, which a `ttl` of forever is written as (8.38). */
const LONGEST_MAX_AGE = 400 * 24 * 60 * 60

/**
 * A `Store` kept in a cookie, read and written through `requestCookies()` on both sides (22.2).
 *
 * 8.37 — ON A SERVER IT IS THE REQUEST'S COOKIE, so a page renders the stored value rather than
 * the fallback; outside a request `requestCookies()` throws (22.8), which is 8.15's miss. A write once a
 * response's headers are out throws as well (22.10), and is 8.12's failed write.
 * 8.39 — a value whose cookie would pass `COOKIE_BYTES` throws on `set`, rather than being dropped
 * by the browser with nothing said.
 */
export function cookies<Stored>(
    name: string,
    options?: {
        path?: string
        domain?: string
        sameSite?: 'strict' | 'lax' | 'none'
        secure?: boolean
        schema?: Schema<Stored>
    },
): Store<Stored> {
    const schema = options?.schema as Schema<unknown> | undefined
    const kept = new KeptText()
    // A cookie name is a token, and an app's name may carry `@` and `/`.
    const cookieName = (): string => encodeURIComponent(storeKey(name))
    return {
        get: () => {
            const named = cookieName()
            // `held` rather than `get`: `watch` is how a change reaches the value, and a read here
            // must not subscribe the producer to the jar (22.4).
            const text = requestCookies().held.get(named)
            return kept.read(text, schema, `cookie ${named}`) as
                Stored | undefined
        },
        set: (value, retention) => {
            const named = cookieName()
            const text = kept.write(value, retention.ttl)
            const bytes = named.length + 1 + encodeURIComponent(text).length
            if (bytes > COOKIE_BYTES)
                throw new Error(
                    `cookie ${named} would be ${bytes} bytes, past the ${COOKIE_BYTES} a browser keeps. RULEBOOK 8.39.`,
                )
            requestCookies().set({
                name: named,
                value: text,
                path: options?.path ?? '/',
                ...(options?.domain === undefined
                    ? {}
                    : { domain: options.domain }),
                ...(options?.sameSite === undefined
                    ? {}
                    : { sameSite: options.sameSite }),
                ...(options?.secure === undefined
                    ? {}
                    : { secure: options.secure }),
                maxAge: Number.isFinite(retention.ttl)
                    ? Math.ceil(retention.ttl / 1000)
                    : LONGEST_MAX_AGE,
            })
        },
        // 8.40 — the browser's `cookieStore` reports a change, where it has one (22.6); a server, or
        // a browser without it, follows nothing (22.7).
        watch: (changed) => {
            const store = (globalThis as { cookieStore?: EventTarget })
                .cookieStore
            if (store === undefined) return () => {}
            // The jar first: it listens too, and must have taken the change in before `get` reads it.
            requestCookies()
            const listener = (event: Event): void => {
                const { changed: written = [], deleted = [] } =
                    event as unknown as {
                        changed?: { name: string }[]
                        deleted?: { name: string }[]
                    }
                const named = cookieName()
                for (const cookie of written)
                    if (cookie.name === named) return changed()
                for (const cookie of deleted)
                    if (cookie.name === named) return changed()
            }
            store.addEventListener('change', listener)
            return () => store.removeEventListener('change', listener)
        },
    }
}
