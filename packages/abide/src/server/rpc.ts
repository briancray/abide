// `GET` and the four mutations: a handler given an address (16.2). This is the IN-PROCESS arm —
// what a server-side caller, a page rendering on the server and a test all reach. The wire arm is
// a generated wrapper the browser gets instead of this module (16.29), and it is not built yet.
//
// A HANDLER IS A `reactive` (16.1), so an `Rpc` is not a second kind of value: the call hands back
// the handler's own `Reactive` (16.3), and every probe, trigger and failure on it is the reactive
// core's — the `Rpc`'s own `busy`, `ready`, `refresh` and `invalidate` are the handler's, passed
// through. What this file adds is the normalising — a plain function becomes the `reactive` it
// would have been (16.6) — and the method.
//
// NOT HERE YET, each with the clause it waits on: the rungs and `ctx.args()` (16.12, 16.13), which
// want a request scope to hand a rung; `timeout` (16.23), which is the request's idle timeout;
// 16.8's publish into a value with no producer; and 16.7's `ttl` default on a `reactive` built
// BEFORE it reached a mutation, which is an option on a value that already exists.

import type { Failed } from '#shared/Failed.ts'
import { isFailed } from '#shared/Failed.ts'
import {
    type AdoptedFailures,
    type AdoptedProduced,
    isKeyed,
    isReactive,
    type Kept,
    type Keyed,
    type Reactive,
    type Refused,
    reactive,
} from '#shared/reactive/index.ts'

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type Rpc<Value, Args, Failures = never, Produced = Value> = ((
    ...args: undefined extends Args ? [args?: Args] : [args: Args]
) => Reactive<Value, Value, Failures, Produced>) & {
    method: Method
    description: string | undefined
    // 13.4, 13.12 — the handler's own face, narrowed by a pattern where the handler is keyed. An
    // `Rpc` is a `Selection` by having it (13.1).
    busy(pattern?: Partial<Args>): boolean
    ready(pattern?: Partial<Args>): boolean
    refresh(pattern?: Partial<Args>): void
    invalidate(pattern?: Partial<Args>): void
    isError<Name extends string>(
        error: unknown,
        name: Name,
    ): error is Extract<Failures, { name: Name }>
}

export type RpcOptions = {
    description?: string
}

// ONE CALL SIGNATURE PER HANDLER ARM, shared by all five names. The two `reactive` arms come first:
// a `Reactive` is itself a `() => Stored`, so the plain-function arm would otherwise swallow it
// and type the `Rpc` as holding the value's own getter. The four plain arms are `reactive`'s own
// overloads, in its order and for its reason (16.6).
type Declare = {
    <Stored, Args, Accepted, Failures, Produced>(
        handler: Keyed<Stored, Args, Accepted, Failures, Produced>,
        options?: RpcOptions,
    ): Rpc<Stored, Args, Failures, Produced>
    <Stored, Accepted, Failures, Produced>(
        handler: Reactive<Stored, Accepted, Failures, Produced>,
        options?: RpcOptions,
    ): Rpc<Stored, undefined, Failures, Produced>
    <Chunk>(
        handler: () => AsyncGenerator<Chunk>,
        options?: RpcOptions,
    ): Rpc<Chunk[], undefined, never, Chunk>
    <Chunk, Args>(
        handler: (args: Args) => AsyncGenerator<Chunk>,
        options?: RpcOptions,
    ): Rpc<Chunk[], Args, never, Chunk>
    <Computed>(
        handler: () => Computed,
        options?: RpcOptions,
    ): Rpc<
        Kept<Awaited<Computed>>,
        undefined,
        AdoptedFailures<Computed> | Refused<Awaited<Computed>>,
        AdoptedProduced<Computed, Kept<Awaited<Computed>>>
    >
    <Computed, Args>(
        handler: (args: Args) => Computed,
        options?: RpcOptions,
    ): Rpc<
        Kept<Awaited<Computed>>,
        Args,
        AdoptedFailures<Computed> | Refused<Awaited<Computed>>,
        AdoptedProduced<Computed, Kept<Awaited<Computed>>>
    >
}

function declare(method: Method): Declare {
    return ((handler: unknown, options?: RpcOptions): unknown => {
        // 16.5 — THE ARM IS READ OFF A BRAND. A `Keyed` and a one-parameter plain function have
        // the same shape, and only the first has already decided its own keying.
        const value =
            isReactive(handler) || isKeyed(handler)
                ? handler
                : // 16.6, and 16.7's `ttl` of 0 on a mutation: each call is a write, so nothing a
                  // previous call produced is served to the next one.
                  reactive(
                      handler as (args: never) => unknown,
                      method === 'GET' ? undefined : { ttl: 0 },
                  )
        // 16.3 — the handler's own `Reactive`. A `Keyed` reaches its entry, which is 1.7's start
        // and 1.8's join; an unkeyed value has one entry and the call is the reach of it.
        const call = isKeyed(value)
            ? (args?: unknown): unknown =>
                  (value as (args: unknown) => unknown)(args)
            : (): unknown => value
        // THE HANDLER'S OWN MEMBERS, handed the pattern. A `Keyed` narrows by it and a `Reactive`'s
        // take no argument, so one spelling serves both arms and neither is a second mechanism.
        const face = value as {
            busy(pattern?: unknown): boolean
            ready(pattern?: unknown): boolean
            refresh(pattern?: unknown): void
            invalidate(pattern?: unknown): void
        }
        return Object.assign(call, {
            method,
            description: options?.description,
            busy: (pattern?: unknown): boolean => face.busy(pattern),
            ready: (pattern?: unknown): boolean => face.ready(pattern),
            refresh: (pattern?: unknown): void => face.refresh(pattern),
            invalidate: (pattern?: unknown): void => face.invalidate(pattern),
            isError(error: unknown, name: string): boolean {
                return isFailed(error) && (error as Failed).name === name
            },
        })
    }) as Declare
}

export const GET: Declare = declare('GET')
export const POST: Declare = declare('POST')
export const PUT: Declare = declare('PUT')
export const PATCH: Declare = declare('PATCH')
export const DELETE: Declare = declare('DELETE')
