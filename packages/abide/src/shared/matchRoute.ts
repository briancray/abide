import type { Segment } from './routePattern.ts'

// WHAT A PATTERN MATCHED, or `null`. The params are strings because that is what a URL carries;
// `ParamsOf<P>` accepts a number on the way OUT (30.3) and the address is built from it, but
// nothing on the way back in has a type to restore.
export type Params = Record<string, string | string[]>

// One pattern against one pathname. Walked rather than compiled to a regex: a route table is
// matched once per navigation, so the walk is never the cost, and a regex would have to encode
// three segment kinds in a grammar nobody reading the table can see.
export function matchRoute(
    segments: Segment[],
    pathname: string,
): Params | null {
    const parts: string[] = []
    for (const part of pathname.split('/'))
        if (part !== '') parts.push(decodeURIComponent(part))

    const params: Params = {}
    let at = 0
    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index] as Segment
        // 30.5 — A REST TAKES WHAT IS LEFT, including nothing, and it is last by construction.
        if (segment.kind === 'rest') {
            params[segment.name] = parts.slice(at)
            return params
        }
        const part = parts[at]
        if (part === undefined) {
            // 30.4 — leaving an optional out omits its segment, so a pattern may outrun the path.
            if (segment.kind === 'optional') continue
            return null
        }
        if (segment.kind === 'static') {
            if (part !== segment.name) return null
        } else params[segment.name] = part
        at += 1
    }
    return at === parts.length ? params : null
}
