import { url } from 'abide'

/**
 * The same TARGET `navigate` takes, as an href instead of a move — so a link and a programmatic
 * navigation cannot disagree about where they go.
 *
 * Not a template literal. A missing required segment THROWS here rather than producing a 404 nobody
 * traced, a root-absolute pattern is normalised, and under a mount the result carries the base.
 */
export function userHref(id: string): string {
    return url('/users/[id]', { id })
}
