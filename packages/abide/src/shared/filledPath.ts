// A ROUTE'S PATH WITH ITS PARAMETERS WRITTEN IN, for the two things that build an address from a
// route: `url`, from a page's literal (30.1), and a call, from its handler's route (16.9).

import { parseRoutePattern, type Segment } from './routePattern.ts'

/**
 * `pattern` with each parameter `params` names written in as a path segment, or `/` for none.
 *
 * `spelled` is how the caller is named where a parameter is refused — `url('/x/[id]')`, or a
 * handler's route — and `refused` what is thrown for it: an `Error` naming the clause, by default.
 */
export function filledPath(
    pattern: string,
    params: Record<string, unknown>,
    spelled: string,
    refused: (name: string, message: string) => unknown = thrownError,
): string {
    return filledSegments(parseRoutePattern(pattern), params, spelled, refused)
}

/** `filledPath` over a route already parsed, for a caller that fills the same route per call. */
export function filledSegments(
    segments: Segment[],
    params: Record<string, unknown>,
    spelled: string,
    refused: (name: string, message: string) => unknown,
): string {
    let address = ''
    for (const segment of segments) {
        if (segment.kind === 'static') {
            address += `/${segment.name}`
            continue
        }
        const value = params[segment.name]
        if (value === undefined || value === null || value === '') {
            // 30.4 — an optional left out omits its segment, and so does an empty rest (30.5).
            if (segment.kind !== 'required') continue
            throw refused(
                segment.name,
                `abide: ${spelled} was given no '${segment.name}', and the route requires it. RULEBOOK 30.3.`,
            )
        }
        if (segment.kind === 'rest' && Array.isArray(value)) {
            for (const each of value)
                address += `/${encodedSegment(spelled, segment.name, each, refused)}`
            continue
        }
        address += `/${encodedSegment(spelled, segment.name, value, refused)}`
    }
    return address === '' ? '/' : address
}

/** The names of `pattern`'s parameters — what a call takes out of its args and into the path (16.66). */
export function parametersOf(pattern: string): Set<string> {
    const names = new Set<string>()
    for (const segment of parseRoutePattern(pattern))
        if (segment.kind !== 'static') names.add(segment.name)
    return names
}

/**
 * A param value encoded as one path segment; `.` and `..` are refused.
 *
 * 30.19 — A VALUE OF `.` OR `..` HAS NO SPELLING AS A SEGMENT: the URL parser collapses it as a
 * dot-segment, and `%2E` / `%2E%2E` with it, so the address would land on another route. Refused
 * rather than written, as a missing required segment is (30.3).
 */
function encodedSegment(
    spelled: string,
    name: string,
    value: unknown,
    refused: (name: string, message: string) => unknown,
): string {
    const text = String(value)
    if (text === '.' || text === '..')
        throw refused(
            name,
            `abide: ${spelled} was given '${text}' for '${name}', and no address carries it as a segment — the URL parser resolves it to another route. RULEBOOK 30.19.`,
        )
    return encodeURIComponent(text)
}

function thrownError(_name: string, message: string): Error {
    return new Error(message)
}
