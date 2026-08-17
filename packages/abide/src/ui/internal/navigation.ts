// A navigation, as a streamed request — the sink `#shared/router.ts` asks for.
//
// Here for the reason `history.ts` is here: this is the package that owns the DOM, and `#shared`
// keeps the policy. What the policy amounts to is one sentence — a client-side navigation asks the
// server for the page it is navigating to — and the value is in the address it asks at and in what it
// does with the answer before the answer has finished arriving.
//
// It asks at the TARGET URL. Not an endpoint under `/__abide/`, which `handle` dispatches in FRONT of
// the app's routes, and not a preflight beside the real thing: the request has the path the reader is
// navigating to, the cookies that document was served with, and a request scope of its own, so the
// app's middleware onion runs around it exactly once and sees precisely what it would have seen for a
// full page load. There is no second chain to keep in step and no authorization written twice.
//
// What comes back is the outlet, streamed out of order in the same hydratable markup the document was
// served in — so the part showing the outlet CLAIMS it rather than building over it, and the page's
// own module is only what makes it interactive rather than what makes it visible.
//
// The parsing is the whole reason this file is not four lines. HTML cannot be parsed halfway: there
// is no browser API that feeds a partial tree, `document.write` is deprecated and needs an active
// parser, and re-running `innerHTML` over a growing buffer re-parses everything already on screen.
// So the server frames the response into pieces that are each complete on their own, and this reads
// to the sentinel between them and parses exactly once per piece.
//
// NOT `#shared`'s `chunksOf` (`internal/wire.ts`), which frames a stream the same way and shares the
// `STREAMING` constant with this file — from a LEAF, not from `wire.ts`, because naming it there put
// the whole rpc encoder in the chunk every page loads. The invariant differs at the BOUND: a line there is
// one NDJSON value, small enough that it can hold a flat buffer and re-slice it, while a piece here is
// a whole page — which is exactly what makes `held += chunk` quadratic at this size, and what the
// unjoined rope and the straddle window below exist to avoid. Merging them would put this file's
// machinery on every rpc line to buy nothing.

import { PATCH_FORM, PIECE_END, placeholderId } from '#shared/internal/MARKERS.ts'
import { NAVIGATION_DEPTH_HEADER, NAVIGATION_FROM_HEADER, NAVIGATION_HEADER } from '#shared/internal/PATHS.ts'
import { addSeeds, SEED_ELEMENT_ID } from '#shared/internal/seed.ts'
import { STREAMING } from '#shared/internal/STREAMING.ts'
import { abideLog } from '#shared/log.ts'
import {
    type Entered,
    type NavigationSink,
    outletChain,
    placeableRouteName,
    useNavigationSink,
} from '#shared/router.ts'
import type { ChildPart, Reclaiming } from './parts.ts'
// One complete piece, parsed once — HTML cannot be parsed halfway, so the piece is the unit.
import { fragmentOf } from './prepare.ts'

const navigateLog = abideLog.channel('navigate')

/**
 * Whether this app wants its navigations to cross-fade — ASKED OF ITS CSS, not of a flag.
 *
 * The whole control surface of view transitions is CSS: `::view-transition-old(root)` and friends say
 * what the animation is, and `view-transition-name` says which elements morph rather than fade. An app
 * that wrote any of that has already said it wants this, in the place the standard puts it — so a
 * boolean somewhere else would be the same intent spelled a second time, and the two would drift.
 *
 * This is the same shape as `installNavigation`, which is chosen by `view === outlet` rather than by an
 * option: the decision is read off something the app already says.
 *
 * Asked PER NAVIGATION and not cached, which was measured rather than assumed: the walk is 50 µs on
 * this repo's own app — 2 sheets, 60 top-level rules, and the worst case since an app declaring
 * nothing is walked to the end — against a navigation costing 2.3-7.3 ms. So the cache saved under 2%
 * of the op and cost a correctness hole: keyed on `document.styleSheets.length` it answered stale
 * whenever a sheet was SWAPPED rather than added, which is exactly what a dev CSS reload does. A gate
 * caught it, and the number says the cache was never worth having.
 *
 * Two things it cannot see, and both are silent:
 *   · a CROSS-ORIGIN stylesheet, whose `cssRules` throws by design. Transition CSS on a CDN is not
 *     detectable from here at all, and such an app has to name its transition on an element it also
 *     styles from a same-origin sheet.
 *   · CSS that names nothing and only overrides the browser's default animation timing. That is an
 *     app tuning a transition it never asked for, which is not a thing to detect.
 */
function declares(rules: CSSRuleList): boolean {
    for (let i = 0; i < rules.length; i++) {
        const rule = rules[i] as CSSRule
        // The declaration and the selector rather than `cssText`, which SERIALISES the rule — over a
        // utility-class stylesheet that is thousands of strings built to be thrown away.
        if (rule instanceof CSSStyleRule) {
            if (rule.selectorText.includes('view-transition')) return true
            if (rule.style.getPropertyValue('view-transition-name') !== '') return true
            continue
        }
        // `@media`, `@layer`, `@supports` — a grouping rule holds the rules that matter.
        const grouping = rule as CSSRule & { cssRules?: CSSRuleList }
        if (grouping.cssRules !== undefined && declares(grouping.cssRules)) return true
    }
    return false
}

function wantsTransitions(): boolean {
    const sheets = document.styleSheets
    for (let i = 0; i < sheets.length; i++) {
        let rules: CSSRuleList
        try {
            rules = (sheets[i] as CSSStyleSheet).cssRules
        } catch {
            // Cross-origin. Reading it is a SecurityError by design, so it is skipped rather than
            // guessed at — see the note above.
            continue
        }
        if (declares(rules)) return true
    }
    return false
}

/** The browser's own call when this app's CSS asked for it and this browser has it, `null` otherwise. */
function startTransition(): ((update: () => void) => { updateCallbackDone: Promise<void> }) | null {
    const owner = document as Document & {
        startViewTransition?: (update: () => void) => { updateCallbackDone: Promise<void> }
    }
    if (typeof owner.startViewTransition !== 'function') return null
    return wantsTransitions() ? owner.startViewTransition.bind(owner) : null
}

/**
 * The range a fragment is filling, OPENED BY ITS FIRST PIECE rather than by the caller.
 *
 * `reclaiming()` tears the old page down, and under a view transition that has to happen inside the
 * update callback: the browser snapshots the old state when `startViewTransition` is called, so a
 * page emptied before that snapshots as empty and the animation crossfades from nothing to the new
 * page. Reading the piece first and opening second is also what keeps the transition off the network
 * — a callback that awaited the body would hold the snapshot, and rendering with it, for the whole
 * download.
 */
class Filling {
    private held: Reclaiming | null = null

    constructor(
        private readonly part: ChildPart,
        private readonly live: () => boolean,
    ) {}

    /** Stand the first piece in the range. Resolves once it is on screen, animation still running. */
    async stand(fragment: DocumentFragment): Promise<void> {
        const start = startTransition()
        if (start === null) {
            this.open(fragment)
            return
        }
        // `updateCallbackDone` and not `finished`: the page is on screen when the DOM is written, and
        // waiting for the animation to END would hold the address bar and the commit behind it.
        await start(() => this.open(fragment)).updateCallbackDone
    }

    private open(fragment: DocumentFragment): void {
        // The ONE mutation this file makes to a range it does not already own, so this is where the
        // question belongs — asked here rather than in `stand`, because a transition callback runs on
        // the browser's frame and a click can land between the two. `enter` re-checks after this
        // resolves, which is too late by exactly one repaint: an overtaken answer would have stood
        // its page over the one the reader chose, and the markup is correct markup for a page they
        // already left, so nothing downstream can tell.
        if (!this.live()) return
        const held = this.part.reclaiming()
        held.insert(fragment)
        this.held = held
    }

    /** What was actually opened. `null` until the first piece lands, and never opens one to answer. */
    opened(): Reclaiming | null {
        return this.held
    }
}

class DocumentNavigation implements NavigationSink {
    constructor(private readonly part: ChildPart) {}

    async enter(url: URL, live: () => boolean): Promise<Entered> {
        let answered: Response
        try {
            answered = await fetch(url, {
                // Where the reader IS, so the answer can leave off the layouts they are already
                // looking at. A hint, and read as one — see `NAVIGATION_FROM_HEADER`.
                headers: { [NAVIGATION_HEADER]: '1', [NAVIGATION_FROM_HEADER]: placeableRouteName() },
                // The cookies are the whole point — the app's auth rung reads the same seal it would
                // read for a full page load. `same-origin` rather than `include`: a navigation is
                // within this app, and an app's own route is not a cross-site call.
                credentials: 'same-origin',
                // FOLLOWED rather than manual, so a rung that redirects to a login page has that page
                // rendered here instead of costing a second round trip to discover. `answered.url` is
                // then where it actually ended up, which is what the address bar has to say.
                redirect: 'follow',
            })
        } catch (failure) {
            // The network, not the app. Handing the URL to the browser is the honest answer: it has an
            // offline page and a reload button, and this side has neither.
            navigateLog.warning(`${url.pathname} did not reach the server — ${String(failure)}`)
            return this.leave(url)
        }

        // The app refused, or answered with something that is not a page, or redirected somewhere
        // else on the way. Either way the SERVER has written the response for this URL, so the
        // browser renders that response rather than this side inventing a second refusal beside it.
        const landed = new URL(answered.url, url)
        const body = answered.body
        if (!answered.ok || answered.headers.get(NAVIGATION_HEADER) === null || body === null) {
            return this.leave(url)
        }
        if (landed.pathname !== url.pathname) return this.leave(landed)

        const reader = body.getReader()
        // Which part the answer belongs in. A fragment rendered from depth 2 is the tree that goes
        // inside layout 1's `<slot/>`, so reclaiming the OUTLET's range for it would put the page
        // where the whole document goes and take the shared layouts down on the way — which is the
        // rebuild this exists to avoid.
        const into = this.receiving(answered.headers.get(NAVIGATION_DEPTH_HEADER))
        if (into === null) return this.leave(url)
        // NOT reclaimed here. The reclaim tears the old page down, and under a view transition that
        // has to happen inside the callback — the browser snapshots the OLD state when
        // `startViewTransition` is called, so a page already emptied snapshots as empty and the
        // animation crossfades from nothing. `Filling` opens on the first piece instead.
        const filling = new Filling(into, live)

        // The FIRST piece is the whole page bar its suspended subtrees, and it is what this call
        // resolves on. Everything after it — the panels, as their own loads settle — lands while the
        // caller is already committing, which is the difference between a navigation that waits for
        // the slowest thing on the page and one that waits for the fastest.
        const remainder = await this.pieces(reader, filling, true)
        if (remainder === null) return this.leave(url)

        return {
            left: false,
            complete: this.rest(reader, filling, remainder),
        }
    }

    /**
     * The part a fragment left `depth` layouts off belongs in — the `<slot/>` of the innermost layout
     * the reader already has.
     *
     * Walked down one level at a time, because that is the only way to reach it: each step asks the
     * instance currently showing layout `i` for the child part holding what layout `i` was handed as
     * children, which `outletFrom` recorded. `chain[i]` is that value, and its `values` array is
     * unique to one evaluation — so this is a lookup and not a guess about which slot a `<slot/>` is.
     *
     * `null` when a step cannot find its part, and that answer is load-bearing rather than defensive.
     * The server has ALREADY left those layouts out of the body, so there is no arrangement in which
     * the outlet's own range is the right place for it — putting it there paints a page with its
     * chrome missing, which is worse than the rebuild this exists to avoid. A miss means the tree is
     * not the one the depth was computed against (a render in flight, a table re-installed), and the
     * caller hands the url to the BROWSER, which is the same answer every other unusable response
     * here gets.
     */
    private receiving(depth: string | null): ChildPart | null {
        // ABSENT and UNREADABLE are two different facts and only one of them means "nothing was left
        // off". The header is written only for a depth of 1 or more (see `cli/internal/layers.ts`), so
        // no header is a complete answer and belongs in the outlet's own range — while a header abide
        // cannot have written is a number this side must not guess at. Read as "absent", a truncated
        // or proxy-mangled value put a depth-2 fragment in the outlet and painted the page with its
        // layouts stripped, silently: the one arrangement the walk below exists to rule out.
        if (depth === null) return this.part
        const levels = Number(depth)
        if (!Number.isInteger(levels) || levels <= 0) {
            navigateLog.warning(`the answer says ${depth} layouts were left off, which is not a count`)
            return null
        }
        const chain = outletChain()
        let part = this.part
        for (let i = 0; i < levels; i++) {
            const showing = chain[i]
            const inner = showing === undefined ? null : part.partShowing(showing)
            if (inner === null) {
                navigateLog.warning(`the answer left ${levels} layouts off and level ${i} is not on screen`)
                return null
            }
            part = inner
        }
        return part
    }

    /** The browser takes this URL. Nothing on this side is committed against a document that is going. */
    private leave(url: URL): Entered {
        location.href = url.href
        return { left: true, complete: NEVER }
    }

    /**
     * Read until one piece has been applied, or the stream ends.
     *
     * `first` says whether the piece STANDS in the range or replaces a placeholder in it, and it is
     * also what stops the read: the opening call returns as soon as one piece has landed, handing
     * back the unread remainder, while a patch read runs to the end of the stream.
     *
     * The remainder IS the answer — `null` is the stream ending before a piece landed, which is the
     * one thing the opening call has to act on. A patch read always reaches the end and always
     * answers `null`, which is why `rest` ignores what it gets back.
     */
    private async pieces(
        reader: ReadableStreamDefaultReader<Uint8Array>,
        filling: Filling,
        first: boolean,
        carried = '',
    ): Promise<string | null> {
        // Chunks are kept UNJOINED. `indexOf` needs a flat receiver, so searching an accumulating
        // `buffer += chunk` re-flattens everything that arrived before it: measured at 23 us per
        // chunk once 1 MB has landed and 244 us at 16 MB, which is O(size²) over a fragment. A
        // cursor bounds what is COMPARED but not what is copied, which is why stepping it back was
        // not enough on its own.
        //
        // Only the newest chunk can complete a sentinel, and only the last few characters before it
        // can have started one — so that pair is all any search looks at, and the join happens once
        // per PIECE, which is the unit being cut out anyway.
        const parts: string[] = []
        let tail = ''
        const OVERLAP = PIECE_END.length - 1

        /** Everything unsearched, as one string. Only ever called when a cut has actually landed. */
        const whole = (last: string): string => {
            parts.push(last)
            const text = parts.join('')
            parts.length = 0
            return text
        }

        const keep = (text: string): void => {
            parts.push(text)
            tail = text.length > OVERLAP ? text.slice(text.length - OVERLAP) : text
        }

        /**
         * Apply every whole piece in a FLAT remainder, and hand back what is left over.
         *
         * Both callers are past the point where `first` could still be true — the opening call
         * returns at its first piece — so a piece drained here is always a patch, and the text is
         * already one string, so there is no rope to re-flatten per search.
         *
         * A CURSOR rather than re-binding the remainder per piece: dropping the head of a k-piece
         * remainder copies what is left of it k times, and settled patches arrive in bursts, so a
         * remainder holding k pieces is the case this is on.
         */
        const drain = (text: string): string => {
            let from = 0
            for (;;) {
                const cut = text.indexOf(PIECE_END, from)
                if (cut === -1) return from === 0 ? text : text.slice(from)
                this.patch(filling, text.slice(from, cut))
                from = cut + PIECE_END.length
            }
        }

        // `carried` is the tail of the piece the opening call stopped inside, and it may hold whole
        // pieces of its own — it is flat and small, so it is searched from 0 exactly like before.
        const rest = drain(carried)
        if (rest !== '') keep(rest)

        for (;;) {
            const { done, value } = await reader.read()
            if (done) {
                // A stream that ended mid-piece: the response was cut off. What is on screen is
                // whatever pieces did arrive, which is the same partial page a document render would
                // have left — better than blanking it for a truncation the reader can just reload.
                if (parts.join('').trim() !== '') navigateLog.warning('the fragment ended mid-piece')
                return null
            }
            const chunk = DECODER.decode(value, STREAMING)
            // Searched as two pieces rather than as one joined string: `tail + chunk` copied every
            // byte of the response a second time, once per chunk, only to look at it. A sentinel
            // either STRADDLES the seam — it then starts inside `tail`, which is `PIECE_END.length
            // - 1` long, so a window that short catches every straddle and can hold nothing else —
            // or it sits wholly inside `chunk`. A straddle also always precedes an in-chunk match,
            // so finding one is finding the first.
            const seam = tail === '' ? '' : tail + (chunk.length > OVERLAP ? chunk.slice(0, OVERLAP) : chunk)
            const straddle = seam === '' ? -1 : seam.indexOf(PIECE_END)
            const within = straddle === -1 ? chunk.indexOf(PIECE_END) : -1
            const at = straddle !== -1 ? straddle : within === -1 ? -1 : tail.length + within
            // What `tail + chunk` would have measured, without building it.
            const spanned = tail.length + chunk.length
            if (at === -1) {
                // The window carries forward from the SEAM, not from `chunk` alone: chunks can be
                // shorter than the sentinel, and a window rebuilt from the newest one alone would
                // forget the head of a sentinel that started three chunks ago.
                parts.push(chunk)
                tail =
                    chunk.length >= OVERLAP
                        ? chunk.slice(chunk.length - OVERLAP)
                        : (tail + chunk).slice(-OVERLAP)
                continue
            }
            // The span is the suffix of the full text of its own length, so a match in one is a
            // match in the other at that distance from the end.
            const text = whole(chunk)
            const from = text.length - spanned + at
            if (first) {
                // The one piece that STANDS in the range, and the only one a transition wraps: it is
                // the visible change. Everything after it replaces a placeholder already on screen.
                await filling.stand(fragmentOf(text.slice(0, from)))
                return text.slice(from + PIECE_END.length)
            }
            this.patch(filling, text.slice(0, from))
            const remainder = text.slice(from + PIECE_END.length)
            const after = drain(remainder)
            tail = ''
            if (after !== '') keep(after)
        }
    }

    /** Everything after the first piece, applied as it lands. Nothing awaits this but `complete`. */
    private async rest(
        reader: ReadableStreamDefaultReader<Uint8Array>,
        filling: Filling,
        carried: string,
    ): Promise<void> {
        try {
            await this.pieces(reader, filling, false, carried)
        } catch (failure) {
            navigateLog.warning(`the fragment stopped early — ${String(failure)}`)
        }
        // Whatever arrived is the range, however it ended. `done` is what makes the next update ADOPT
        // it rather than build over it, so a stream that failed halfway still hands over what it has.
        // Only what was actually OPENED: asking for it here would reclaim the live page to say a
        // navigation that never stood anything is finished with it.
        filling.opened()?.done()
    }

    /**
     * One complete piece AFTER the first: a deferred subtree, swapped for the placeholder standing in
     * for it, or the seed block. The `standing` flag this used to take is gone — the piece that stands
     * in the range is `Filling.stand`, which is the one a transition has to wrap.
     */
    private patch(filling: Filling, markup: string): void {
        const held = filling.opened()
        if (held === null) return
        const parsed = fragmentOf(markup)
        const carried = parsed.firstElementChild
        // The seed piece, which the server writes LAST. It stays in this template and never enters
        // the document: what it carries is VALUES, and the slots that want them are on the render
        // the commit is about to run. A superseded handle drops them — an abandoned navigation's
        // answers are for a page nobody is going to see, and a table nothing consumes is never
        // emptied, so merging them would leak one entry per rpc per overtaken click.
        if (carried instanceof HTMLScriptElement && carried.id === SEED_ELEMENT_ID) {
            if (held.alive()) addSeeds(carried.textContent ?? '')
            return
        }
        // Every other piece is exactly one `<template id="tN">`. Read rather than assumed, because
        // the id is what says WHICH placeholder this is, and there is no ambient correlation to fall
        // back on — the walker handed the id out when it reached the marker.
        if (!(carried instanceof HTMLTemplateElement)) {
            navigateLog.warning('a fragment piece was not a patch')
            return
        }
        const id = PATCH_FORM.exec(carried.id)
        if (id === null) {
            navigateLog.warning('a fragment piece was not a patch')
            return
        }
        if (!held.patch(placeholderId(Number(id[1])), carried.content)) {
            navigateLog.warning(`no placeholder for patch ${carried.id}`)
        }
    }
}

const DECODER = new TextDecoder()

/** A promise for a navigation that is over. Shared: nothing ever settles it, and nothing awaits it twice. */
const NEVER: Promise<void> = new Promise<void>(() => {})

/**
 * Called by `mount`/`hydrate` when what they are showing IS the router's outlet.
 *
 * That test is the whole of the rule, and it is the honest one: a navigation repaints the part that
 * is showing the page, and a renderer showing something else — a card, a widget, a second mount — is
 * not that part. An app that never puts the outlet on the screen has no navigation to serve and
 * installs nothing, which is also what makes this cost a bundle that renders no pages nothing.
 */
export function installNavigation(part: ChildPart): (() => void) | null {
    if (typeof fetch !== 'function') return null
    return useNavigationSink(new DocumentNavigation(part))
}
