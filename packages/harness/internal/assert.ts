// Structural equality and the failure message.
//
// Deliberately not `bun:test`'s `expect`: the SAME assertion has to run in a browser, where there is
// no test runner to report to. An assertion here is a value comparison plus a thrown `AssertionError`
// — the demo card catches it and paints the line red, the test runner catches it and fails the test.

import { messageOf } from './probes.ts'

export class AssertionError extends Error {
    constructor(
        message: string,
        readonly actual: unknown,
        readonly expected: unknown,
    ) {
        super(message)
        this.name = 'AssertionError'
    }
}

/**
 * Structural, one level of container at a time: primitives by `Object.is`, arrays and plain objects
 * field by field, `Error` by name and message. Deliberately shallow on anything else — a comparison
 * that silently walks a DOM node or a state is a comparison nobody can predict.
 */
export function equals(actual: unknown, expected: unknown): boolean {
    if (Object.is(actual, expected)) return true
    if (typeof actual !== 'object' || typeof expected !== 'object') return false
    if (actual === null || expected === null) return false

    if (Array.isArray(actual) || Array.isArray(expected)) {
        if (!Array.isArray(actual) || !Array.isArray(expected)) return false
        if (actual.length !== expected.length) return false
        for (let i = 0; i < actual.length; i++) {
            if (!equals(actual[i], expected[i])) return false
        }
        return true
    }

    if (actual instanceof Error || expected instanceof Error) {
        return (
            actual instanceof Error &&
            expected instanceof Error &&
            actual.name === expected.name &&
            actual.message === expected.message
        )
    }

    // Anything with a prototype of its own — a state, a DOM node, a Map — compares by identity, which
    // `Object.is` already answered `false` for.
    if (Object.getPrototypeOf(actual) !== Object.prototype) return false
    if (Object.getPrototypeOf(expected) !== Object.prototype) return false

    const actualKeys = Object.keys(actual as Record<string, unknown>)
    const expectedKeys = Object.keys(expected as Record<string, unknown>)
    if (actualKeys.length !== expectedKeys.length) return false
    for (const key of actualKeys) {
        if (!Object.hasOwn(expected as Record<string, unknown>, key)) return false
        if (!equals((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key])) {
            return false
        }
    }
    return true
}

/** How a value is written into a log line or a failure message. */
export function show(value: unknown): string {
    if (typeof value === 'string') return value
    if (value === undefined) return 'undefined'
    if (value === null) return 'null'
    if (Array.isArray(value)) return `[${value.map(show).join(', ')}]`
    if (value instanceof Error) return `${value.name}: ${value.message}`
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value)
        } catch {
            return String(value)
        }
    }
    return String(value)
}

export function fail(label: string, actual: unknown, expected: unknown): never {
    throw new AssertionError(
        `${label}\n  expected: ${show(expected)}\n  actual:   ${show(actual)}`,
        actual,
        expected,
    )
}

/**
 * Does a thrown value's message match? A string matches as a substring, the way a reader reads it.
 *
 * `messageOf` rather than `error.message`: a transpile or resolution failure arrives as an aggregate,
 * and matching on the wrapper's generic sentence instead of the diagnostic is what `throws(fn, 'unexpected
 * token')` would silently stop being able to do.
 */
export function messageMatches(error: unknown, match: string | RegExp | undefined): boolean {
    if (match === undefined) return true
    const message = messageOf(error)
    return typeof match === 'string' ? message.includes(match) : match.test(message)
}
