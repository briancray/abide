import { memo } from 'abide'
import { bag, cookies, GET } from 'abide/server'

/**
 * The property that makes `bag` more than a scratch map: it is what a module-level `memo` is keyed
 * INSIDE, so one declaration written once at module scope is per-caller without saying so.
 *
 * A memo's cache is per caller by default, and this is the mechanism under that default rather than a
 * second one beside it — which is why a server can have that default at all. The alternative is a
 * module-level cache, and a module-level cache on a server means one visitor's answer served to the
 * next.
 *
 * What `bag` adds is a store of your OWN in the same scope, for the things that are not a memo: a
 * value a middleware resolved and three handlers below it read, without a parameter threaded through
 * every frame between.
 */
const session = memo(() => ({ theme: cookies().get('theme') ?? 'light', at: 'resolved once per caller' }))

export const page = GET(() => {
    // Read twice in one request, computed once — and computed AGAIN for the next caller, with their
    // cookies rather than these.
    const first = session()
    const second = session()

    bag().set('greeted', true)
    return { theme: first.theme, sameObject: first === second, greeted: bag().get('greeted') === true }
})
