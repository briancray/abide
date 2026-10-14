// 16.9, 16.66 — A HANDLER'S ROUTE, COMPILED ONCE: what takes a call's route parameters out of its
// args and into the path, keeping the rest for the query or the body. Built once per address by
// what holds the handler — an `Rpc`, a browser's `wire` — and read by every call through it: the
// request a call is (`rpcRequest`), the in-process call's early refusal, and `abide call`.

import { filledSegments } from './filledPath.ts'
import { validationError } from './refuse.ts'
import { parseRoutePattern, type Segment } from './routePattern.ts'

/** 15.8 — a parameter no address carries, refused as args a gate refused. */
function pathRefusal(name: string, message: string): unknown {
    return validationError<Record<string, unknown>>({ [name]: [message] })
}

/** A handler's address, parsed once: its segments and the names its parameters take. */
export class HandlerRoute {
    readonly address: string
    /** The parsed route, or `undefined` where it has no parameters and the path is the address. */
    readonly segments: Segment[] | undefined
    readonly names: Set<string>

    constructor(address: string) {
        this.address = address
        this.names = new Set()
        if (!address.includes('[')) {
            this.segments = undefined
            return
        }
        this.segments = parseRoutePattern(address)
        for (const segment of this.segments)
            if (segment.kind !== 'static') this.names.add(segment.name)
    }

    /**
     * The path with each parameter `params` names written in.
     *
     * 30.3, 30.19 — one no address carries is thrown: by default as args a gate refused, so every
     * caller answers it as the wire answers a 422.
     */
    path(
        params: Record<string, unknown> | undefined,
        refused: (name: string, message: string) => unknown = pathRefusal,
    ): string {
        return this.segments === undefined
            ? this.address
            : filledSegments(this.segments, params ?? {}, this.address, refused)
    }

    /**
     * `args` split: the path, and the members no parameter took — `undefined` where none is left —
     * so the query or body never carries a parameter twice (16.66).
     */
    split(args: Record<string, unknown> | undefined): {
        path: string
        rest: Record<string, unknown> | undefined
    } {
        if (this.segments === undefined)
            return { path: this.address, rest: args }
        const path = this.path(args)
        let rest: Record<string, unknown> | undefined
        for (const name in args) {
            if (this.names.has(name)) continue
            rest ??= {}
            rest[name] = args[name]
        }
        return { path, rest }
    }
}
