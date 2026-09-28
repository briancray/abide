// 30.1 — AN ADDRESS FROM A ROUTE LITERAL: the pattern a page is filed under, filled. The types read
// the literal the way `parseRoutePattern` reads it at run time, so a call that leaves a required
// segment out is a compile error naming it (30.2, 30.3) rather than an address with a hole in it.
//
// 16.11 — RESOLVED AGAINST THE MOUNT at the call, so the same build serves at the root and below it.

import { mounted } from './mount.ts'
import { queryText } from './queryText.ts'
import { parseRoutePattern } from './routePattern.ts'

type Parts<P extends string> = P extends `${infer Head}/${infer Tail}`
    ? Head | Parts<Tail>
    : P

export type RequiredNames<P extends string> =
    Parts<P> extends infer Part
        ? Part extends `[${infer Name}]`
            ? Name extends `[${string}` | `...${string}`
                ? never
                : Name
            : never
        : never

export type OptionalNames<P extends string> =
    Parts<P> extends infer Part
        ? Part extends `[[${infer Name}]]`
            ? Name
            : never
        : never

export type RestNames<P extends string> =
    Parts<P> extends infer Part
        ? Part extends `[...${infer Name}]`
            ? Name
            : never
        : never

export type HasParams<P extends string> = [RequiredNames<P>] extends [never]
    ? false
    : true

export type HasSegments<P extends string> = [
    RequiredNames<P> | OptionalNames<P> | RestNames<P>,
] extends [never]
    ? false
    : true

export type Query = Record<string, unknown> | URLSearchParams

export type ParamsOf<P extends string> = {
    [K in RequiredNames<P>]: string | number
} & { [K in OptionalNames<P>]?: string | number } & {
    [K in RestNames<P>]?: string | number | (string | number)[]
}

export function url<P extends string>(
    pattern?: P,
    ...rest: HasParams<P> extends true
        ? [params: ParamsOf<P>, queryParams?: Query]
        : [params?: ParamsOf<P>, queryParams?: Query]
): string {
    const params = (rest[0] ?? {}) as Record<string, unknown>
    const query = rest[1]
    let address = ''
    for (const segment of parseRoutePattern(pattern ?? '/')) {
        if (segment.kind === 'static') {
            address += `/${segment.name}`
            continue
        }
        const value = params[segment.name]
        if (value === undefined || value === null || value === '') {
            // 30.4 — an optional left out omits its segment, and so does an empty rest (30.5).
            if (segment.kind !== 'required') continue
            throw new Error(
                `abide: url('${pattern}') was given no '${segment.name}', and the route requires it. RULEBOOK 30.3.`,
            )
        }
        if (segment.kind === 'rest' && Array.isArray(value)) {
            for (const each of value)
                address += `/${encodedSegment(pattern, segment.name, each)}`
            continue
        }
        address += `/${encodedSegment(pattern, segment.name, value)}`
    }
    if (address === '') address = '/'
    address = mounted(address)
    // 30.6 — the query half, last, in the spelling `rpcRequest` writes.
    const search =
        query === undefined
            ? ''
            : query instanceof URLSearchParams
              ? query.toString()
              : queryText(query)
    return search === '' ? address : `${address}?${search}`
}

// 30.19 — A VALUE OF `.` OR `..` HAS NO SPELLING AS A SEGMENT: the URL parser collapses it as a
// dot-segment, and `%2E` / `%2E%2E` with it, so the address would land on another route. Refused
// rather than written, as a missing required segment is (30.3).
function encodedSegment(
    pattern: string | undefined,
    name: string,
    value: unknown,
): string {
    const text = String(value)
    if (text === '.' || text === '..')
        throw new Error(
            `abide: url('${pattern}') was given '${text}' for '${name}', and no address carries it as a segment — the URL parser resolves it to another route. RULEBOOK 30.19.`,
        )
    return encodeURIComponent(text)
}
