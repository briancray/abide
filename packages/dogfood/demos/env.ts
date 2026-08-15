// Declaring an environment variable from a case, in whichever lane the case is running in.
//
// Every knob abide reads goes through `$shared/log.ts`'s `env`, which captures `Bun.env` — a live
// view of `process.env` — or `process.env`, or an object neither lane can reach. So a demo that wants
// to exercise one writes to the SAME object the runtime reads, and a lane with no environment at all
// says so through `DECLARABLE` rather than pretending a knob was turned.
//
// Here rather than in the suite that needed it first: two suites now declare variables, and a helper
// copied into both is one that gets fixed in one of them.

import { config } from 'abide/server'

const ENVIRONMENT =
    (globalThis as { Bun?: { env: Record<string, string | undefined> } }).Bun?.env ??
    (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env

/** Whether a variable can be DECLARED here at all — false in a browser, which has no environment. */
export const DECLARABLE = ENVIRONMENT !== undefined

/**
 * Set one, or delete it. A lane with no environment writes nothing and reports it through `DECLARABLE`.
 *
 * The resolved config goes with it. `config()` is the SOURCE every knob abide reads is answered
 * from, and it is memoised for the process by design — so a variable declared after something asked
 * would otherwise be a knob that moved with nothing reading the new number.
 */
export function writeEnv(name: string, value: string | undefined): void {
    if (ENVIRONMENT === undefined) return
    if (value === undefined) delete ENVIRONMENT[name]
    else ENVIRONMENT[name] = value
    config.invalidate()
}

/**
 * Declared for the length of `fn`, and put back however `fn` ended — including by throwing.
 *
 * A RECORD rather than one name, because two variables are one call: nesting was the shape a case
 * reached for, and it put the restoring half of the outer one behind the inner one's. `undefined` is
 * how a call says "with this one ABSENT", which is what a check for a required variable needs.
 *
 * Awaited rather than sync because a body may change the same variable: restoring in a `finally`
 * that ran before the body settled would put the name back while the body was still using it.
 */
export async function withEnv<T>(
    declared: Record<string, string | undefined>,
    fn: () => T | Promise<T>,
): Promise<T> {
    if (ENVIRONMENT === undefined) return await fn()
    const held: Record<string, string | undefined> = {}
    for (const name in declared) {
        held[name] = ENVIRONMENT[name]
        writeEnv(name, declared[name])
    }
    try {
        return await fn()
    } finally {
        for (const name in declared) writeEnv(name, held[name])
    }
}
