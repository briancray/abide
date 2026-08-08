// The knobs a SHARED path reads, answered by `config()` where there is one.
//
// `config()` is the source of truth for every knob abide reads: the floor, then the app's `onConfig`
// defaults, then what the operator declared, resolved once and read from there. The three ceilings
// are read from `$shared`, which may not import `$server` — so the server REGISTERS itself here, the
// same inversion `useLogSink`, `useAppNameSource` and `useIdentitySource` already are.
//
// Nothing registered is the honest answer in a browser: there is no config there, `env()` reads an
// environment that does not exist, and the floor each call site passes is its own. That is also what
// makes the UI lane cost nothing for a seam it never uses — one null check.

import { env, envNumber } from './env.ts'

/** What the server hands over: one field, and `undefined` when config has nothing to say about it. */
type Resolver = (field: string) => unknown

let resolver: Resolver | null = null

/** Registered by `$server/config.ts` on import, so loading `abide/server` is what wires this up. */
export function useConfigSource(source: Resolver): void {
    resolver = source
}

/**
 * One numeric knob — a size, a deadline, a ring — from the document when there is one.
 *
 * The floor read is LAZY, which is this seam's whole cost model: a server that has a document never
 * parses anything, and eagerly it was an `env()` read plus a `Number()` parse per log line, per rpc
 * call and per settled memo slot, all of it recomputing what `config()` already merged. The rule is
 * here rather than at each call site because a floor spelled twice is one typo away from a variable
 * that means two different things — the same reason `knobOf` takes no fallback either.
 */
export function numberKnob(field: string, floor: number): number {
    const held = resolver?.(field)
    return held === undefined ? envNumber(field, floor) : (held as number)
}

/** One textual knob. `null` is what a variable nobody set means, on both sides of the seam. */
export function textKnob(field: string): string | null {
    const held = resolver?.(field)
    if (held !== undefined) return held as string | null
    return env(field) ?? null
}
