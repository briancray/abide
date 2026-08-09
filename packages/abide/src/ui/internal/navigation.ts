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

import { PATCH_FORM, PIECE_END, placeholderId } from '$shared/internal/MARKERS.ts'
import { NAVIGATION_HEADER } from '$shared/internal/PATHS.ts'
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
        const painting = await this.pieces(reader, held, true)
        if (!painting.ok) return this.leave(url)

        return {
            left: false,
            complete: this.rest(reader, held, painting.buffer),
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
     * `first` says whether the piece STANDS in the range or replaces a placeholder in it, which is
     * the only thing that differs between the opening piece and every patch behind it.
     */
    private async pieces(
        reader: ReadableStreamDefaultReader<Uint8Array>,
        held: Reclaiming,
        first: boolean,
        carried = '',
    ): Promise<{ ok: boolean; buffer: string }> {
        let buffer = carried
        // Where the last search gave up. Without it every chunk re-scans the whole accumulated
        // buffer from 0 — and since `+=` builds a rope, re-flattens it too, so a page arriving in
        // 16 kB chunks costs O(size²) rather than O(size). Only the tail of what was already
        // searched can hide a straddled sentinel, so that is all this steps back over.
        let searched = 0
        for (;;) {
            const cut = buffer.indexOf(PIECE_END, searched)
            if (cut !== -1) {
                this.apply(held, buffer.slice(0, cut), first)
                buffer = buffer.slice(cut + PIECE_END.length)
                searched = 0
                if (first) return { ok: true, buffer }
                continue
            }
            searched = Math.max(0, buffer.length - PIECE_END.length + 1)
            const { done, value } = await reader.read()
            if (done) {
                // A stream that ended mid-piece: the response was cut off. What is on screen is
                // whatever pieces did arrive, which is the same partial page a document render would
                // have left — better than blanking it for a truncation the reader can just reload.
                if (buffer.trim() !== '') navigateLog.warning('the fragment ended mid-piece')
                return { ok: !first, buffer: '' }
            }
            buffer += DECODER.decode(value, { stream: true })
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
        // A patch piece is exactly one `<template id="tN">`. Read rather than assumed, because the
        // id is what says WHICH placeholder this is, and there is no ambient correlation to fall
        // back on — the walker handed the id out when it reached the marker.
        const carried = parsed.content.firstElementChild
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
export function installNavigation(part: ChildPart): void {
    if (typeof fetch !== 'function') return
    useNavigationSink(new DocumentNavigation(part))
}
