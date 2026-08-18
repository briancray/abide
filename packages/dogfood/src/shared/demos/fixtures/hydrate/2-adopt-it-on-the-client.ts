import { hydrate } from 'abide/ui'
import Page from '../Suspending.abide'

/**
 * Every part claims the range its two markers mark out, then runs the ordinary first update — which
 * writes NOTHING, because every binding compares before it writes. One node is inserted in the whole
 * process: the root anchor.
 *
 * `mount` is the same call for a client with no markup to adopt. Whichever runs, the component is the
 * same file — which is the isomorphism claim.
 */
export function adopt(host: HTMLElement): void {
    hydrate(host, () => Page({}))
}
