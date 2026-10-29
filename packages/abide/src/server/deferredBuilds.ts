// 41.28 — A CHILD WHOSE SETUP MADE A CALL IS BUILT AS A PAGE IS: after the turn — and so is one whose
// markup reads a bare `busy` or `ready`, which the compiler writes to answer as a page does always.
// A component is set up where its parent's markup invokes it, so its build cannot wait inline; it is
// left as a marker in the parent's head and body, built once the turn has run, and written in where
// its marker stands. A child whose setup made no call builds where it stands, as before, and pays a
// counter read on either side of its setup for the difference.
//
// THE MARKERS ARE NEVER IN WHAT IS SENT. Every one is replaced before `composePage` answers, and the
// nonce is never written anywhere, so no text an author or a caller supplies can stand in for one.

import { regionMarkup } from '#shared/anchorMarkup.ts'
import { isReactive, isStreaming, loadOf } from '#shared/reactive/index.ts'
import type { Rendered } from './render.ts'
import type { PageCall } from './requestScope.ts'

// SYNCHRONOUS SETUP IS WHAT MAKES ONE COUNTER ENOUGH. 34.3 keeps a setup from awaiting, so no other
// request's render runs between a component's two reads, however many renders are in flight.
let callsInRenders = 0

/** How many calls renders have made, read on either side of a component's setup. */
export function callsInRender(): number {
    return callsInRenders
}

/** Counts a call a page's render made (`reachedInRender`). */
export function noteCallInRender(): void {
    callsInRenders += 1
}

/** A deferred child: its record, and the page's calls its setup made, marked with its build. */
type Deferred = { rendered: Rendered; callsFrom: number; callsTo: number }

type Build = { deferred: Deferred[]; calls: PageCall[] }

/**
 * The render whose markup is being built. Set only while `pass` runs, which is synchronous, so
 * renders in flight never see each other's.
 */
let building: Build | undefined

const NONCE = crypto.randomUUID()
const MARKER = new RegExp(`\u0000${NONCE}([hb])(\\d+)\u0000`, 'g')

/** The page's calls so far, for a child to note where its setup's begin; `-1` outside a build. */
export function callsMadeSoFar(): number {
    return building === undefined ? -1 : building.calls.length
}

/**
 * Where a child that deferred stands in its parent's markup: a marker in the head and in the body,
 * or `undefined` where no page is being built and the child builds where it stands.
 */
export function deferBuild(
    rendered: Rendered,
    heads: string[],
    callsFrom: number,
): string | undefined {
    if (building === undefined) return undefined
    const at = building.deferred.length
    building.deferred.push({
        rendered,
        callsFrom,
        callsTo: building.calls.length,
    })
    heads.push(`\u0000${NONCE}h${at}\u0000`)
    return regionMarkup(`\u0000${NONCE}b${at}\u0000`)
}

/**
 * `build`'s markup, with every child it deferred built after the turn — and the children those
 * defer after another — each written in where its marker stands.
 */
export async function buildDeferred(
    calls: PageCall[],
    build: () => { head: string; body: string },
): Promise<{ head: string; body: string }> {
    const state: Build = { deferred: [], calls }
    let built = { head: '', body: '' }
    pass(state, () => {
        built = build()
    })
    if (state.deferred.length === 0) return built
    const fills: { head: string; body: string }[] = []
    let from = 0
    while (from < state.deferred.length) {
        await new Promise((settled) => setImmediate(settled))
        const to = state.deferred.length
        pass(state, () => {
            for (let at = from; at < to; at++)
                fills.push(filled((state.deferred[at] as Deferred).rendered))
        })
        from = to
    }
    return {
        head: expanded(built.head, fills),
        body: expanded(built.body, fills),
    }
}

/**
 * Marks every call not yet marked: settled or not, as the markup just built read it.
 *
 * 41.25 — READ WHERE THE MARKUP HAS JUST BEEN BUILT, before anything has run since: a call that
 * settles a microtask later was painted in flight, and marked settled it has hydration choose an
 * arm the server never painted.
 */
export function markPainted(calls: PageCall[]): void {
    for (const call of calls)
        if (call.painted === undefined) call.painted = paintedSettled(call)
}

// One synchronous build pass, and the calls it built from marked at its end — all but those a
// child it deferred made, which its own pass marks.
function pass(state: Build, run: () => void): void {
    const deferredFrom = state.deferred.length
    building = state
    try {
        run()
    } finally {
        building = undefined
    }
    const { calls, deferred } = state
    for (let at = 0; at < calls.length; at++) {
        const call = calls[at] as PageCall
        if (
            call.painted !== undefined ||
            ownedByDeferred(at, deferred, deferredFrom)
        )
            continue
        call.painted = paintedSettled(call)
    }
}

function ownedByDeferred(
    call: number,
    deferred: Deferred[],
    from: number,
): boolean {
    for (let at = from; at < deferred.length; at++) {
        const child = deferred[at] as Deferred
        if (call >= child.callsFrom && call < child.callsTo) return true
    }
    return false
}

// 41.26 — a call that streams is never marked.
function paintedSettled({ reached }: PageCall): boolean {
    return (
        isReactive(reached) &&
        loadOf(reached) === undefined &&
        !isStreaming(reached)
    )
}

/** 35.16 — a document is written by the outermost component alone, and `rendered` is placed. */
export function refuseDocument(rendered: Rendered): void {
    if (rendered.document !== undefined)
        throw new Error(
            'abide: a component that writes <html> is placed inside another, and only the outermost component writes the document. RULEBOOK 35.16.',
        )
}

function filled(rendered: Rendered): { head: string; body: string } {
    refuseDocument(rendered)
    return { head: rendered.head, body: rendered.body }
}

function expanded(
    markup: string,
    fills: { head: string; body: string }[],
): string {
    return markup.replace(MARKER, (_, kind: string, at: string) => {
        const fill = fills[Number(at)] as { head: string; body: string }
        return expanded(kind === 'h' ? fill.head : fill.body, fills)
    })
}
