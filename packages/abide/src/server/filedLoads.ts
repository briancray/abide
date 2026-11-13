// 41.34 AND 11.67 — A MODULE'S VALUE WHOSE BUILD STARTED A LOAD IS BUILT IN EVERY RENDER'S SETUP. A
// browser builds a module's values at import, before anything renders, so a call a body makes is in
// flight before the first setup runs. A server builds a request's instance where the request first
// reaches it (`scoped.ts`), and a value first reached in markup started its call halfway through the
// build: what was built inline painted it in flight and a child 41.28 built after the turn painted
// it landed — two answers in one page, and a region rebuilt at hydration whichever one the browser
// held (41.24).
//
// ONLY A VALUE WHOSE HOME HAS A LOAD IN FLIGHT once built, which is read where it is filed and costs
// nothing per render: building one whose body is synchronous up front changes nothing about what it
// paints, and a value derived from one that loads is built where it is first read, over an instance
// that is already in flight. EVERY ONE THE PROCESS'S MODULES DECLARED, not the page's module graph
// alone: the runtime holds no graph to walk, and the bundle an executable holds (38.10) keeps no
// module's path to key a value by.
//
// 41.35 — HELD WEAKLY, so a value built outside every request that is no declaration — one a
// callback or a timer builds — is dropped once nothing reaches it, where a list holding it grew by
// one per build and built every one of them in every render after. A declaration is held by its
// module for the life of the process.

import { heldGenerationOf } from '#shared/reactive/producer.ts'
import { buildHere } from '#shared/reactive/scoped.ts'

const LOADING: WeakRef<object>[] = []
/** The length past which `fileIfLoading` drops what was collected before it files another. */
let pruneAt = 64

/** Drops every value collected since it was filed, keeping the rest in the order they were filed. */
function prune(): void {
    let kept = 0
    for (const held of LOADING)
        if (held.deref() !== undefined) LOADING[kept++] = held
    LOADING.length = kept
}

/**
 * Keeps `forwarder` where its home has a load in flight — `undefined` as the generation it stands at.
 * Told outside every request, where a forwarder answers with its home.
 */
export function fileIfLoading(forwarder: unknown): void {
    if (heldGenerationOf(forwarder) !== undefined) return
    if (LOADING.length >= pruneAt) {
        prune()
        pruneAt = Math.max(64, LOADING.length * 2)
    }
    LOADING.push(new WeakRef(forwarder as object))
}

/** Builds the current scope's instance of every value `fileIfLoading` kept, starting its load. */
export function buildFiledLoads(): void {
    prune()
    for (const held of LOADING) buildHere(held.deref())
}
