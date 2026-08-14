// A navigation, as a streamed request — the sink `$shared/router.ts` asks for.
//
// Here for the reason `history.ts` is here: this is the package that owns the DOM, and `$shared`
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
// NOT `$shared`'s `chunksOf` (`internal/wire.ts`), which frames a stream the same way and already
// shares the `STREAMING` constant with this file. The invariant differs at the BOUND: a line there is
// one NDJSON value, small enough that it can hold a flat buffer and re-slice it, while a piece here is
// a whole page — which is exactly what makes `held += chunk` quadratic at this size, and what the
// unjoined rope and the straddle window below exist to avoid. Merging them would put this file's
// machinery on every rpc line to buy nothing.

import { PATCH_FORM, PIECE_END, placeholderId } from '$shared/internal/MARKERS.ts'
import { NAVIGATION_HEADER } from '$shared/internal/PATHS.ts'
import { addSeeds, SEED_ELEMENT_ID } from '$shared/internal/seed.ts'
import { STREAMING } from '$shared/internal/wire.ts'
import { abideLog } from '$shared/log.ts'
import { type Entered, type NavigationSink, useNavigationSink } from '$shared/router.ts'
import type { ChildPart, Reclaiming } from './parts.ts'

const navigateLog = abideLog.channel('navigate')

class DocumentNavigation implements NavigationSink {
    constructor(private readonly part: ChildPart) {}

    async enter(url: URL): Promise<Entered> {
        let answered: Response
        try {
            answered = await fetch(url, {
                headers: { [NAVIGATION_HEADER]: '1' },
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
        const held = this.part.reclaiming()

        // The FIRST piece is the whole page bar its suspended subtrees, and it is what this call
        // resolves on. Everything after it — the panels, as their own loads settle — lands while the
        // caller is already committing, which is the difference between a navigation that waits for
        // the slowest thing on the page and one that waits for the fastest.
        const remainder = await this.pieces(reader, held, true)
        if (remainder === null) return this.leave(url)

        return {
            left: false,
            complete: this.rest(reader, held, remainder),
        }
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
        held: Reclaiming,
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
                this.apply(held, text.slice(from, cut), false)
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
            this.apply(held, text.slice(0, from), first)
            const remainder = text.slice(from + PIECE_END.length)
            if (first) return remainder
            const after = drain(remainder)
            tail = ''
            if (after !== '') keep(after)
        }
    }

    /** Everything after the first piece, applied as it lands. Nothing awaits this but `complete`. */
    private async rest(
        reader: ReadableStreamDefaultReader<Uint8Array>,
        held: Reclaiming,
        carried: string,
    ): Promise<void> {
        try {
            await this.pieces(reader, held, false, carried)
        } catch (failure) {
            navigateLog.warning(`the fragment stopped early — ${String(failure)}`)
        }
        // Whatever arrived is the range, however it ended. `done` is what makes the next update ADOPT
        // it rather than build over it, so a stream that failed halfway still hands over what it has.
        held.done()
    }

    /** One complete piece: parsed once, then either stood in the range or swapped for a placeholder. */
    private apply(held: Reclaiming, markup: string, standing: boolean): void {
        const parsed = document.createElement('template')
        parsed.innerHTML = markup
        if (standing) {
            held.insert(parsed.content)
            return
        }
        const carried = parsed.content.firstElementChild
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
