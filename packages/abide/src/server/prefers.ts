import { qualitiesOf } from './qualitiesOf.ts'

/**
 * Whether the request's `accept` header takes `wanted` over `over`.
 *
 * Listed at a higher quality, or at the same one and ahead of it. `wanted` has to be NAMED — a
 * wildcard says nothing about which the reader prefers — and `wanted;q=0` is a refusal of it, not
 * a low preference.
 */
export function prefers(
    request: Request,
    wanted: string,
    over: string,
): boolean {
    const qualities = qualitiesOf(request.headers.get('accept') ?? '')
    const wantedQuality = qualities.get(wanted) ?? 0
    if (wantedQuality <= 0) return false
    const overQuality = qualities.get(over) ?? 0
    if (wantedQuality !== overQuality) return wantedQuality > overQuality
    for (const token of qualities.keys()) {
        if (token === wanted) return true
        if (token === over) return false
    }
    return false
}
