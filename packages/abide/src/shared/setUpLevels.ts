import {
    currentShare,
    leaveShare,
    resumeShare,
    type ShareScope,
} from './reactive/share.ts'

/**
 * Sets up levels `from` to `count - 1` of a page chain — its layouts outermost first, the page
 * last — and builds none of them.
 *
 * THE ONE PLACE THE CHAIN'S RULES ARE WRITTEN. `render`'s `composePage` and the client `Router`
 * each compose the chain, and what differs between them is what a level's `children` is and what
 * happens once every level is set up; these three hold for both.
 *
 * 41.19, 41.23 — EVERY LEVEL IS SET UP BEFORE ANY IS BUILT, so a page's setup has run before the
 * layout reading what it wrote is built — on the server, where the layout was painted after that
 * write, and on the client, where hydrating the layout first read the value before the page had
 * written it. This sets up and builds nothing; `setUp` leaves its level's build for the caller.
 *
 * 10.5 — A PAGE IS A DESCENDANT OF ITS LAYOUT, so each level is set up inside the share scope the
 * setup above it left — `outer` for the first, and whatever is current at the top of the chain.
 * Each level is called by the composer rather than from inside the one above it, so without this a
 * page opened a share chain of its own: the server painted the layout's value and hydration
 * replaced it with the page's.
 *
 * 35.1 — ONE PROPS SHAPE AT EVERY LEVEL: the caller's record with `children` after it, present on
 * every level and `undefined` until `setUp` hands the level the one below it — so on the innermost,
 * which has nothing below it. Every compiled page and layout loads its props off this record, and
 * a level that omits a key the one above carries is a second hidden class for all of them.
 */
export function setUpLevels(
    from: number,
    count: number,
    /** The share scope the level above `from` left; `undefined` at the top of the chain. */
    outer: ShareScope | null | undefined,
    props: Record<string, () => unknown>,
    /** Sets level `at` up over `levelProps`, answering the share scope its setup left. */
    setUp: (
        at: number,
        levelProps: Record<string, (() => unknown) | undefined>,
    ) => ShareScope | null,
): void {
    let share = outer === undefined ? currentShare() : outer
    for (let at = from; at < count; at += 1) {
        const back = resumeShare(share)
        try {
            share = setUp(at, { ...props, children: undefined })
        } finally {
            leaveShare(back)
        }
    }
}
