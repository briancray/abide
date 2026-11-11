// 30.41 — THE ADDRESS'S QUERY AS ONE VALUE, shaped and typed by the defaults it is asked with: read
// off `route.url`, and written by navigating to it.
//
// A PAIR (`pairReactive`) rather than a value of its own, so there is one source — the address — and
// nothing to keep in step with it: a back step, a link and a write all arrive through `route.url`.

import { CURRENT_ROUTER } from './CURRENT_ROUTER.ts'
import { navigate, noRouter } from './navigate.ts'
import { bareName, queryText } from './queryText.ts'
import { pairReactive } from './reactive/pairReactive.ts'
import type { Reactive } from './reactive/Reactive.ts'
import { structural } from './reactive/structural.ts'

/** What a query member's default can be: text, a number, a flag, or a list of text. */
export type QueryDefaults = Record<
    string,
    string | number | boolean | readonly string[]
>

/** 30.41 — the value `route.query` reads, each member widened from its default's literal. */
export type QueryOf<Defaults extends QueryDefaults> = {
    [Name in keyof Defaults]: Defaults[Name] extends string
        ? string
        : Defaults[Name] extends number
          ? number
          : Defaults[Name] extends boolean
            ? boolean
            : string[]
}

/**
 * The query of `address` — `route.url` — as a `Reactive` of the defaults' shape: each member read
 * off it, and a write navigating to the address that carries it.
 */
export function routeQuery<Defaults extends QueryDefaults>(
    address: Reactive<URL>,
    defaults: Defaults,
): Reactive<QueryOf<Defaults>, Partial<QueryOf<Defaults>>> {
    return pairReactive(
        {
            get: () => queryRead(address(), defaults),
            set: (value) =>
                queryWrite(
                    address.peek() as URL,
                    defaults,
                    value as Record<string, unknown>,
                ),
        },
        // 30.47 — a change to a member the defaults do not name, or to the path, is the same value.
        structural,
    ) as unknown as Reactive<QueryOf<Defaults>, Partial<QueryOf<Defaults>>>
}

/** 30.41, 30.42 — each member the defaults name, parsed by its default's type. */
function queryRead(
    address: URL,
    defaults: QueryDefaults,
): Record<string, unknown> {
    const read: Record<string, unknown> = {}
    const search = address.searchParams
    for (const name in defaults) {
        const fallback = defaults[name]
        if (Array.isArray(fallback)) {
            const values = search.getAll(name)
            // 30.28 — A NAME WITH NO `=` IS THE EMPTY LIST, and `URLSearchParams` reads it as `['']`.
            read[name] =
                values.length === 0
                    ? fallback
                    : values.length === 1 &&
                        values[0] === '' &&
                        `&${address.search.slice(1)}&`.includes(
                            `&${bareName(name)}&`,
                        )
                      ? []
                      : values
            continue
        }
        const text = search.get(name)
        read[name] = text === null ? fallback : parsed(text, fallback)
    }
    return read
}

/** 30.42 — a member's text as its default's type, or the default where the text is not one. */
function parsed(text: string, fallback: unknown): unknown {
    if (typeof fallback === 'number') {
        const number = text.trim() === '' ? Number.NaN : Number(text)
        return Number.isNaN(number) ? fallback : number
    }
    if (typeof fallback === 'boolean')
        return text === 'true' ? true : text === 'false' ? false : fallback
    return text
}

/**
 * 30.43, 30.44, 30.45, 30.46 — navigates once, in place, to the standing address with the members
 * the defaults name rewritten from `value`, and every other member left where it stands.
 */
function queryWrite(
    standing: URL,
    defaults: QueryDefaults,
    value: Record<string, unknown>,
): void {
    if (CURRENT_ROUTER.current === null) throw noRouter('A route.query write')
    const members: Record<string, unknown> = {}
    for (const name in defaults)
        members[name] = value[name] === undefined ? defaults[name] : value[name]
    const address = new URL(standing)
    let search = ''
    for (const member of address.search.slice(1).split('&')) {
        if (member === '') continue
        const name = new URLSearchParams(member).keys().next().value as string
        if (!Object.hasOwn(defaults, name)) search += `&${member}`
    }
    const own = queryText(members, defaults)
    if (own !== '') search += `&${own}`
    address.search = search.slice(1)
    void navigate(address, { replace: true, keepScroll: true })
}
