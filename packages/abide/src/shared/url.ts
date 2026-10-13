// 30.1 — AN ADDRESS FROM A ROUTE LITERAL: the pattern a page is filed under, filled. The types read
// the literal the way `parseRoutePattern` reads it at run time, so a call that leaves a required
// segment out is a compile error naming it (30.2, 30.3) rather than an address with a hole in it.
//
// 16.10 — RESOLVED AGAINST THE MOUNT at the call, so the same build serves at the root and below it.

import { filledPath } from './filledPath.ts'
import { mounted } from './mount.ts'
import { queryText } from './queryText.ts'

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

/** The params a route literal takes, by segment kind. */
export type ParamsOf<P extends string> = {
    [K in RequiredNames<P>]: string | number
} & { [K in OptionalNames<P>]?: string | number } & {
    [K in RestNames<P>]?: string | number | (string | number)[]
}

/**
 * 30.26 — the route literals an app files its pages under, which `abide check` declares for the app
 * it checks. Where nothing declared them any literal is taken, so a plain `tsc` still compiles.
 */
// biome-ignore lint/suspicious/noEmptyInterface: filled by declaration merging, per app
export interface Routes {}

/** 30.26 — what `url` takes: one of the app's route literals, or any where none were declared. */
export type RouteLiteral = [keyof Routes] extends [never]
    ? string
    : Extract<keyof Routes, string>

/**
 * 23.9 — the params a page filed under `P` reads: what a URL carries, so text, and a rest always a
 * list — empty where it matched nothing.
 */
export type RouteParams<P extends string> = {
    [K in RequiredNames<P>]: string
} & { [K in OptionalNames<P>]?: string } & { [K in RestNames<P>]: string[] }

/**
 * An address from a route literal and its params, resolved against the mount, with an optional
 * query.
 */
export function url<P extends RouteLiteral>(
    pattern?: P,
    ...rest: HasParams<P> extends true
        ? [params: ParamsOf<P>, queryParams?: Query]
        : [params?: ParamsOf<P>, queryParams?: Query]
): string {
    const params = (rest[0] ?? {}) as Record<string, unknown>
    const query = rest[1]
    const address = mounted(
        filledPath(pattern ?? '/', params, `url('${pattern}')`),
    )
    // 30.6 — the query half, last, in the spelling `rpcRequest` writes.
    const search =
        query === undefined
            ? ''
            : query instanceof URLSearchParams
              ? query.toString()
              : queryText(query)
    return search === '' ? address : `${address}?${search}`
}
