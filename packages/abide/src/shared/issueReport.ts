// AN ISSUES RECORD — what a refusal found, keyed by path (`Issues`, 15.8): filled one issue at a time
// by `note`, and handed out by `issuesOf` in the shape the value refused calls for.

import { putOwn } from './putOwn.ts'

/**
 * Appends one issue under its path in an issues record.
 *
 * ONE ISSUE, APPENDED UNDER ITS PATH, into an ORDINARY record — so what is handed out is the
 * record that was filled, and `String(report)` prints `[object Object]` rather than throwing
 * `No default value` out of a slot writer (`escapeText`, `escapeless`) on a null prototype.
 *
 * A path is built from the INPUT's own keys, so both halves go through the own-member door. The
 * READ: `found['constructor']` answers `Object` rather than `undefined`, and the append threw
 * `standing.push is not a function` out of the validator for any of the twelve names
 * `Object.prototype` carries — so it is asked with `Object.hasOwn`. The WRITE: see `putOwn` —
 * `found['__proto__'] = [...]` recorded nothing, the report came back empty, and
 * `{"__proto__": …}` passed `additionalProperties: false` as valid.
 */
export function note(
    found: Record<string, string[]>,
    path: string,
    said: string,
): void {
    if (Object.hasOwn(found, path)) (found[path] as string[]).push(said)
    else putOwn(found, path, [said])
}

/**
 * Issues in the shape `Issues<T>` gives them for the value refused: by path for an object or an
 * array, the bare list for anything else.
 *
 * DECIDED BY THE VALUE, because the value is all the runtime holds — `T` is erased. A scalar has
 * no path to key by, so every issue about one stands on `''`, and handing back `{ '': [...] }`
 * there is the wrapper `Issues<T>` says a reader never unwraps: `error().data[0]` read `undefined`.
 */
export function issuesOf(
    found: Record<string, string[]>,
    value: unknown,
): Record<string, string[]> | string[] {
    if (typeof value === 'object' && value !== null) return found
    const listed: string[] = []
    for (const path in found)
        for (const said of found[path] as string[]) listed.push(said)
    return listed
}
