// 41.13, 41.20 — ONE PAGE'S RENDER, as the calls it makes see it. A page's render calls its handlers
// in process; each call is recorded once (1.8) — left in the seed buffer for the browser's own call
// to be answered from, and written into the document's head as the request the browser will make
// for it, so it starts before the bundle has arrived. The router begins one where it renders a page,
// a call made in it records into it through `RPC_SERVER.reached`, the document takes its early-call
// script, and the browser's call takes the seed back.
//
// ON THE SCOPE because that is the only thing a call made deep in a page's setup can find it through
// when requests interleave — `RPC_SERVER.reached` is one slot for every request in flight.

import { EARLY_CALLS } from '#shared/EARLY_CALLS.ts'
import type { HandlerRoute } from '#shared/HandlerRoute.ts'
import { KEEP_HEADER } from '#shared/KEEP_HEADER.ts'
import type { Rpc } from '#shared/rpc.ts'
import { type RpcRequest, rpcRequest } from '#shared/rpcRequest.ts'

import { callerOf, callerOrMint } from './callerOf.ts'
import { markPainted } from './deferredBuilds.ts'
import { currentRequestScope, type RequestScope } from './requestScope.ts'
import {
    callsOnly,
    type Outcome,
    seedFor,
    type SeedSink,
    takeSeed,
} from './seedBuffer.ts'

/**
 * One call a page's render made: the request the browser will make for it, what it reached, and
 * whether the markup was built from it settled — `undefined` until the pass that built from it
 * ends (41.25, `markPainted`).
 */
export type PageCall = {
    request: RpcRequest
    reached: unknown
    painted: boolean | undefined
}

// SYNCHRONOUS SETUP IS WHAT MAKES ONE COUNTER ENOUGH. 34.3 keeps a setup from awaiting, so no other
// request's render runs between a component's two reads, however many renders are in flight.
let callsInRenders = 0

/**
 * How many calls renders have made, read on either side of a component's setup.
 *
 * 41.28 — what tells a child whose setup made a call, which is built after the turn as a page is.
 */
export function callsInRender(): number {
    return callsInRenders
}

// 41.29 — the seed sink of a render no page hydrates: every call is left to run when it is made.
const SEEDS_NOTHING: SeedSink = () => false

/** A page's render: the seed sink its calls report into, and the calls the browser will make. */
export class PageRender {
    readonly calls: PageCall[] = []
    private readonly seed: SeedSink

    constructor(seed: SeedSink) {
        this.seed = seed
    }

    /**
     * Records a call the render made: into the seed buffer (41.13), and — where the handler is
     * mounted — as the request the browser will make for it, for the early-call script (41.20). Once
     * per render, as the browser's `Rpc` makes it once, and the seed sink is what says which is the
     * once. `route` is the one the `Rpc` compiled for its address — `undefined` on a handler nothing
     * mounted (16.10).
     */
    record(
        rpc: object,
        args: unknown,
        reached: unknown,
        route: HandlerRoute | undefined,
    ): void {
        callsInRenders += 1
        if (!this.seed(rpc, args, reached)) return
        if (route === undefined) return
        this.calls.push({
            request: rpcRequest(
                (rpc as Rpc<unknown, unknown>).method,
                route,
                args as Record<string, unknown> | undefined,
            ),
            reached,
            painted: undefined,
        })
    }

    /**
     * The head markup that starts each of the page's calls before the bundle arrives, or `''` where
     * it made none — every call marked first as the markup just built read it (41.25).
     *
     * 41.20 — THE SCRIPT ITSELF: each call started with `fetch`, and its answer left under the call's
     * key in `EARLY_CALLS` for `wire` to take (41.21). An answer's body is left UNREAD (16.32), so a
     * streaming handler's copy takes its chunks as they land rather than after the last one.
     * Inline because nothing else runs before the bundle has arrived, which is the wait it exists
     * to overlap.
     *
     * 41.25 — A ROW ENDING IN `1` IS A CALL THE MARKUP WAS BUILT FROM SETTLED, a refusal included,
     * and its entry is marked `painted` for hydration to wait on — its body read to its bytes, so
     * the wait covers it too. 41.26 — A CALL THAT STREAMS IS NEVER MARKED: the browser reads its
     * chunks as they land (16.32), so no wait for its answer makes it settled where the page
     * hydrates, and its region is 41.24's to put right.
     *
     * 29.9, 29.10 — THE CALLS ARE DATA AND THE RUNNER IS A CONSTANT. What a page called differs per
     * response, so it rides in a JSON block a browser never executes, and the one script that does
     * run is the same bytes in every response — which is what lets `csp` permit it by its hash
     * rather than by the nonce an app's own inline script spends. The JSON has `<` escaped, so no
     * string in it can close the element.
     */
    earlyCallScript(): string {
        const calls = this.calls
        markPainted(calls)
        if (calls.length === 0) return ''
        const rows: (
            [string, string, RequestInit] | [string, string, RequestInit, 1]
        )[] = []
        for (const { request, painted } of calls)
            rows.push(
                painted === true
                    ? [request.key, request.url, request.init, 1]
                    : [request.key, request.url, request.init],
            )
        return `<script type="application/json">${JSON.stringify(rows).replace(/</g, '\\u003c')}</script><script>${EARLY_CALL_RUNNER}</script>`
    }
}

/**
 * Begins the render of the page `request` asks for, in its scope, and returns it.
 *
 * 26.5 — the caller the seed buffer is keyed by is minted where the browser carries none: the same
 * one `principal.caller` reads for the rest of the request. 41.13 — every call the render makes is
 * left for the browser's own call to be answered from. 41.29 — BUT NOT A PAGE A SCRIPT FETCHED, which
 * nothing hydrates: its entries would answer the next call this caller makes with what the render
 * saw, a sign-in since included. The worker asks for the navigation it answers as that navigation
 * (45.25), so the page that hydrates is never one a script fetched. 41.30 — SAVE ONE THE WORKER
 * KEEPS, whose early calls are what a later open of it starts.
 */
export function beginPageRender(request: Request): PageRender {
    const caller = callerOrMint()
    const keep = request.headers.get(KEEP_HEADER)
    const page = new PageRender(
        // A WORKER'S NAVIGATION IS STILL ONE: forwarded unchanged (45.25) it arrives `navigate` with
        // its destination `empty`, and no script's fetch can ask in that mode.
        request.headers.get('sec-fetch-dest') !== 'empty' ||
            request.headers.get('sec-fetch-mode') === 'navigate'
            ? seedFor(caller)
            : keep !== null
              ? callsOnly()
              : SEEDS_NOTHING,
    )
    ;(currentRequestScope() as RequestScope).page = page
    return page
}

/** Renders on in this scope as no page's: an error page's render records nothing. 41.13. */
export function leavePageRender(): void {
    ;(currentRequestScope() as RequestScope).page = undefined
}

/** Records a call made in the page this scope is rendering, where it renders one. */
export function recordInRender(
    rpc: object,
    args: unknown,
    reached: unknown,
    route: HandlerRoute | undefined,
): void {
    currentRequestScope()?.page?.record(rpc, args, reached, route)
}

/**
 * Takes what this request's caller's render reached for `rpc` and `args`, or `undefined`.
 *
 * 41.7 — the call a hydrating page makes for what its render already reached is answered from
 * that, and the handler is not run again (41.13).
 */
export function takeSeeded(
    rpc: object,
    args: unknown,
): Promise<Outcome> | undefined {
    const caller = callerOf()
    return caller === undefined ? undefined : takeSeed(caller, rpc, args)
}

// THE RUNNER RECORDS, IT NEVER CLASSIFIES: the `Response`, and a painted call's body read to its end
// — the one decision is `painted`, which the server made. `answerOf` reads the record as it reads an
// answer it fetched, so no second reading of a content type lives in a string no typecheck reaches.
// The shape is `EarlyCall`'s. 16.80 — a page the worker answers has it answer the page's calls too,
// which the browser alone can tell: the server cannot see whether a worker will replay this page.
export const EARLY_CALL_RUNNER = `(function(s,c,w){for(var i=0;i<c.length;i++)(function(k,u,n,h){if(w)n.cache='force-cache';var e=s[k]={painted:h,response:void 0,bytes:void 0};e.promise=fetch(u,n).then(function(r){return h?r.arrayBuffer().then(function(b){e.bytes=b;e.response=r}):e.response=r}).catch(function(){})})(c[i][0],c[i][1],c[i][2],c[i][3])})(self.${EARLY_CALLS}||(self.${EARLY_CALLS}={}),JSON.parse(document.currentScript.previousElementSibling.textContent),(self.navigator.serviceWorker||{}).controller)`

/** The early-call runner's hash, as `script-src` names it. 29.9. */
export const EARLY_CALL_HASH = `'sha256-${new Bun.CryptoHasher('sha256').update(EARLY_CALL_RUNNER).digest('base64')}'`
