import { parseRoutePattern } from '#shared/routePattern.ts'

import type { AppRoute } from './appLayout.ts'

const URL_SOURCE = Bun.fileURLToPath(new URL('../shared/url', import.meta.url))

/**
 * 30.26 — each of `addresses` as a key of abide's `Routes`, and 23.9, 30.3 — a page route's params
 * narrowed where its matcher is an alternation of literals, which is the one matcher a type can say.
 */
export function routesDeclaration(
    addresses: readonly string[],
    routes: readonly AppRoute[],
): string {
    const narrowed = new Map<string, string>()
    for (const route of routes) {
        let members = ''
        for (const segment of parseRoutePattern(route.pattern)) {
            if (segment.kind !== 'required' && segment.kind !== 'optional')
                continue
            const literals = literalsOf(
                segment.matcher === undefined
                    ? undefined
                    : route.matchers[segment.matcher],
            )
            if (literals === undefined) continue
            members += ` ${JSON.stringify(segment.name)}${segment.kind === 'optional' ? '?' : ''}: ${literals};`
        }
        if (members !== '') narrowed.set(route.pattern, `{${members} }`)
    }
    let keys = ''
    for (const route of addresses)
        keys += `        ${JSON.stringify(route)}: ${narrowed.get(route) ?? 'true'}\n`
    return `export {}\ndeclare module ${JSON.stringify(URL_SOURCE)} {\n    interface Routes {\n${keys}    }\n}\n`
}

/** The union of the literals an anchored matcher source alternates between, or `undefined`. */
function literalsOf(source: string | undefined): string | undefined {
    const body = source?.match(/^\^\(\?!\\\.\\\.\?\$\)\(\?:(.*)\)\$$/)?.[1]
    if (body === undefined || !/^[\w~-]+(?:\|[\w~-]+)*$/.test(body))
        return undefined
    return body
        .split('|')
        .map((literal) => JSON.stringify(literal))
        .join(' | ')
}
