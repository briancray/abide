// 53.53, 53.61-53.63 — A SCROLLING ELEMENT KEPT AT ITS BOTTOM, as `Chat`'s transcript is (53.40), as parts
// an app spreads onto markup of its own: the scroller, and a button taking the reader back down once
// they have scrolled up — which the server writes hidden, since a page arrives following.

import { type Live, live } from './live.ts'
import { type Reactive, reactive } from './reactive/index.ts'
import type { Disposer } from './reactive/watch.ts'

/** Whether the scroller is following, how near its bottom counts as at it, and how a jump scrolls. */
export type FollowBottomOptions = {
    /** Whether the scroller is kept at its bottom: a `Reactive` to read it and to stop following from the app. Held by the parts, `true`, and handed back as `following`, where none is given. */
    following?: Reactive<boolean>
    /** Pixels from the bottom that still count as at it. `2` by default; a function is read live. */
    threshold?: Live<number>
    /** How `toBottom` scrolls. `'smooth'` by default; a function is read live. */
    behavior?: Live<'auto' | 'smooth'>
}

/** The parts `followBottom` hands back: `<ol {...follow.host}>` and `<button {...follow.jump}>`. */
export type FollowBottom = {
    /** The scroller's part: what keeps it at its bottom, and `data-following` while it does. */
    readonly host: Record<string, unknown>
    /** The button's part taking the reader back down: `hidden` while following, `data-unseen` once something arrived while scrolled up. */
    readonly jump: Record<string, unknown>
    /** Whether the scroller is following — the `following` handed in, or one of its own. */
    readonly following: Reactive<boolean>
    /** Scrolls the scroller to its bottom, and follows again. */
    toBottom(): void
}

/** A scrolling element kept at its bottom as what it holds grows, until the reader scrolls up. */
export function followBottom(options: FollowBottomOptions = {}): FollowBottom {
    const following = options.following ?? reactive(true)
    const unseen = reactive(false)
    let scroller: Element | undefined
    // Set while a smooth jump is under way: the scrolls it makes on the way down are not the reader's.
    let jumping = false

    // 49.13 — read where it is used.
    const atBottom = (element: Element): boolean =>
        element.scrollHeight - element.scrollTop - element.clientHeight <=
        (live(options.threshold) ?? 2)

    function toBottom(): void {
        unseen.set(false)
        following.set(true)
        if (scroller === undefined) return
        jumping = true
        scroller.scrollTo({
            top: scroller.scrollHeight,
            behavior: live(options.behavior) ?? 'smooth',
        })
    }

    const bind = (element: Element): Disposer => {
        scroller = element
        const scrolled = (): void => {
            const at = atBottom(element)
            if (jumping) {
                if (at) jumping = false
                return
            }
            if (at !== following.peek()) following.set(at)
            if (at) unseen.set(false)
        }
        // One delivery per batch of changes, however many chunks the batch held. AN OBSERVER OF ITS
        // OWN, not one shared as resizes are (32.81): a mutation record names the node that changed,
        // deep in the subtree, so a shared observer would walk each record's ancestors to find which
        // followed element it belongs to — a walk per record of a stream writing one per chunk — where
        // an observer per element is handed only its own, and is told nothing it has to sort.
        const observer = new MutationObserver(() => {
            if (following.peek()) element.scrollTop = element.scrollHeight
            else unseen.set(true)
        })
        observer.observe(element, {
            childList: true,
            subtree: true,
            characterData: true,
        })
        element.addEventListener('scroll', scrolled, { passive: true })
        return () => {
            observer.disconnect()
            element.removeEventListener('scroll', scrolled)
            if (scroller === element) scroller = undefined
        }
    }

    return {
        host: {
            'bind:element': bind,
            'data-follow-bottom': 'host',
            get 'data-following'() {
                return following() ? '' : undefined
            },
        },
        jump: {
            type: 'button',
            'data-follow-bottom': 'jump',
            get hidden() {
                return following()
            },
            get 'data-unseen'() {
                return unseen() ? '' : undefined
            },
            onclick: toBottom,
        },
        following,
        toBottom,
    }
}
