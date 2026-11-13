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

import { heldGenerationOf } from '#shared/reactive/producer.ts'
import { buildHere } from '#shared/reactive/scoped.ts'

const LOADING: unknown[] = []

/**
 * Keeps `forwarder` where its home has a load in flight — `undefined` as the generation it stands at.
 * Told outside every request, where a forwarder answers with its home.
 */
export function fileIfLoading(forwarder: unknown): void {
    if (heldGenerationOf(forwarder) === undefined) LOADING.push(forwarder)
}

/** Builds the current scope's instance of every value `fileIfLoading` kept, starting its load. */
export function buildFiledLoads(): void {
    for (const forwarder of LOADING) buildHere(forwarder)
}
