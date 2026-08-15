// Every public name, its one line, and where its rungs are — and nothing else.
//
// `/docs` is keyed by CALLABLE rather than by capability, because a callable is what a reader arrives
// with. Somebody who has seen `cookies()` in a codebase is looking up `cookies`, not "the request
// scope", and a suite page made them read five other rungs to find it.
//
// The split from `SUITES.ts` is the same split for the same reason: this file is prose plus `import()`
// thunks, so `/docs` draws all forty-five entries without pulling one ladder, and `/docs/<callable>` pulls the
// one or two ladders that hold its rungs. Reaching them through a static list put every rung's source
// on every page.
//
// A name is here IFF an APP TYPES IT — that is the rule `SURFACE-CUT.md` decided, narrowed to the
// standard that rule always named: the dogfood app's own pages, server and site. Both directions are
// asserted in `test/docs.test.ts`, against `SPECIFIERS` — a name missing from this list fails, and a
// name here that no rung claims fails too.
//
// `abide/ui` is therefore absent: `mount` and `hydrate` are reached only by the GENERATED client entry
// and a bench harness, so they are surface the framework writes for itself rather than surface anybody
// is asked to learn. The `client` and `hydrate` LADDERS still exist and still run — they are just not
// about a name a reader types, so their rungs claim nothing.

import type { Example } from 'harness'
import type { SuiteName } from './SUITES.ts'

/** A suite whose fixtures directory holds a ladder. `overview` is the hub and has none. */
export type LadderName = Exclude<SuiteName, 'overview'>

export interface CallableMeta {
    /** Route segment and import name: `cookies` → `/docs/cookies`. */
    name: string
    /**
     * The specifier to import it FROM, which is half of what a reader came for.
     *
     * One string, not a list, even though `identity` is on two: the isomorphic front door is the one an
     * app should type, and the server's re-export is a fact about the seam rather than a second answer.
     *
     * Read off `SPECIFIERS` rather than spelled again, so the entry points have ONE definition — the
     * index page, the browser spec and `test/docs.test.ts` all group by that same list.
     */
    from: (typeof SPECIFIERS)[number]
    /** The one line under the name, on the index and on the page. */
    blurb: string
    /**
     * The ladders holding this callable's rungs — usually one.
     *
     * Hand-written, and therefore the one thing here that can go stale: the rungs themselves say what
     * they are `of`, and this says where to look. `test/docs.test.ts` loads every ladder and compares
     * the two, in both directions, so a rung that moves suites is a red gate rather than a page that
     * quietly comes up short.
     */
    ladders: LadderName[]
}

/**
 * Every ladder, absent until asked for.
 *
 * Keyed by `LadderName`, so a suite with a fixtures directory and no entry here is a type error rather
 * than a ladder nothing can reach.
 */
export const LADDERS: Record<LadderName, () => Promise<{ LADDER: Example[] }>> = {
    state: () => import('./fixtures/state/ladder.ts'),
    memo: () => import('./fixtures/memo/ladder.ts'),
    verbs: () => import('./fixtures/verbs/ladder.ts'),
    channel: () => import('./fixtures/channel/ladder.ts'),
    watch: () => import('./fixtures/watch/ladder.ts'),
    scope: () => import('./fixtures/scope/ladder.ts'),
    routing: () => import('./fixtures/routing/ladder.ts'),
    template: () => import('./fixtures/template/ladder.ts'),
    client: () => import('./fixtures/client/ladder.ts'),
    server: () => import('./fixtures/server/ladder.ts'),
    hydrate: () => import('./fixtures/hydrate/ladder.ts'),
    transport: () => import('./fixtures/transport/ladder.ts'),
    responses: () => import('./fixtures/responses/ladder.ts'),
    request: () => import('./fixtures/request/ladder.ts'),
    logging: () => import('./fixtures/logging/ladder.ts'),
    health: () => import('./fixtures/health/ladder.ts'),
    identity: () => import('./fixtures/identity/ladder.ts'),
    config: () => import('./fixtures/config/ladder.ts'),
    lifecycle: () => import('./fixtures/lifecycle/ladder.ts'),
    ceilings: () => import('./fixtures/ceilings/ladder.ts'),
    compiler: () => import('./fixtures/compiler/ladder.ts'),
}

export const CALLABLES = {
    // --- `abide` — what an author types on either substrate ----------------------
    state: {
        name: 'state',
        from: 'abide',
        blurb:
            'Own a value. `x()` reads and subscribes, `x.set(v)` writes. Handing one a promise starts a ' +
            'LOAD instead of storing the promise, so the read is the same call either way.',
        ladders: ['state', 'compiler'],
    },
    memo: {
        name: 'memo',
        from: 'abide',
        blurb:
            'Derive one or load one. Declaring an argument is the declaration that the args are the ' +
            'dependency set — and that they are the cache key.',
        ladders: ['memo', 'scope', 'compiler'],
    },
    channel: {
        name: 'channel',
        from: 'abide',
        blurb: 'Subscribe to values arriving over time. Reading the channel IS the subscription.',
        ladders: ['channel'],
    },
    watch: {
        name: 'watch',
        from: 'abide',
        blurb:
            'React to the graph. Reading a cell inside a `watch` IS the subscription — there is no ' +
            'dependency array — and the set is whatever the LAST RUN read.',
        ladders: ['watch'],
    },
    invalidate: {
        name: 'invalidate',
        from: 'abide',
        blurb: 'This data is WRONG: drop it, clear the error, start nothing. Reaches slots by tag as well as by memo.',
        ladders: ['verbs'],
    },
    refresh: {
        name: 'refresh',
        from: 'abide',
        blurb: 'It may be STALE: keep serving what is held and re-run the body now. Needs a body, so plain `state` has none.',
        ladders: ['verbs'],
    },
    isPending: {
        name: 'isPending',
        from: 'abide',
        blurb: 'The one predicate about the signal — for handing it back when your own `catch` swallowed it.',
        ladders: ['memo'],
    },
    html: {
        name: 'html',
        from: 'abide',
        blurb:
            'The template tag both substrates consume — the one a hand-written `.ts` component writes ' +
            'and the one a `.abide` file compiles to. It ESCAPES every slot; the hatch is `raw`.',
        ladders: ['template'],
    },
    raw: {
        name: 'raw',
        from: 'abide',
        blurb:
            'The escape hatch: says a string is already markup, so the slot skips the escape. Its own ' +
            'name rather than a spelling of `html`, so one grep finds every string an app does not escape.',
        ladders: ['template'],
    },
    props: {
        name: 'props',
        from: 'abide',
        blurb: 'What a component was called with, read inside it — the same shape a compiled `.abide` component gets.',
        ladders: ['template'],
    },
    route: {
        name: 'route',
        from: 'abide',
        blurb:
            'Which page this URL named, as a REACTIVE ambient — four small cells, so a same-route move ' +
            'republishes rather than remounting.',
        ladders: ['routing'],
    },
    navigate: {
        name: 'navigate',
        from: 'abide',
        blurb: 'Move, without a new caller arriving and without rebuilding what did not change.',
        ladders: ['routing'],
    },
    url: {
        name: 'url',
        from: 'abide',
        blurb: 'Build the same target as an href, so a link and a `navigate` cannot disagree about where they go.',
        ladders: ['routing'],
    },
    log: {
        name: 'log',
        from: 'abide',
        blurb:
            'The app’s own channel always writes; a named one is off until `DEBUG` names it. `warning` and ' +
            '`error` are never gated.',
        ladders: ['logging'],
    },
    health: {
        name: 'health',
        from: 'abide',
        blurb: 'What the app says about itself, asked with the same call on both sides, over a floor abide fills in.',
        ladders: ['health'],
    },
    online: {
        name: 'online',
        from: 'abide',
        blurb: 'Whether the network is there at all — which changes with no caller arriving.',
        ladders: ['health'],
    },
    identity: {
        name: 'identity',
        from: 'abide',
        blurb:
            'Who the server decided this caller is, asked with the same call on both sides. Never null — ' +
            'anonymous is an answer — and never guessed by the client.',
        ladders: ['identity'],
    },


    // --- `abide/server` — the transports -----------------------------------------
    GET: {
        name: 'GET',
        from: 'abide/server',
        blurb: 'A read any surface may call, addressed by its arguments — on the client it IS a keyed memo.',
        ladders: ['transport'],
    },
    POST: {
        name: 'POST',
        from: 'abide/server',
        blurb: 'A mutation: the same declaration as a `GET`, and the difference is that it retains nothing.',
        ladders: ['transport'],
    },
    PUT: {
        name: 'PUT',
        from: 'abide/server',
        blurb: 'A mutation, with the method changed. Nothing else about the declaration differs.',
        ladders: ['transport'],
    },
    PATCH: {
        name: 'PATCH',
        from: 'abide/server',
        blurb: 'A mutation, with the method changed. Nothing else about the declaration differs.',
        ladders: ['transport'],
    },
    DELETE: {
        name: 'DELETE',
        from: 'abide/server',
        blurb: 'A mutation, with the method changed. Nothing else about the declaration differs.',
        ladders: ['transport'],
    },
    socket: {
        name: 'socket',
        from: 'abide/server',
        blurb: 'The second law: a `channel` whose subscribers arrived over a wire. The server half is `channel()` unchanged.',
        ladders: ['transport'],
    },

    // --- `abide/server` — what a route answers with -------------------------------
    json: {
        name: 'json',
        from: 'abide/server',
        blurb: 'Answer with JSON, when the route builds its own Response instead of returning a value.',
        ladders: ['responses'],
    },
    page: {
        name: 'page',
        from: 'abide/server',
        blurb: 'Answer with HTML — and a streamed body is HELD past the handler, so the request scope outlives it.',
        ladders: ['responses'],
    },
    redirect: {
        name: 'redirect',
        from: 'abide/server',
        blurb: 'Answer with a location instead of a body, and say whether it is the permanent kind.',
        ladders: ['responses'],
    },
    error: {
        name: 'error',
        from: 'abide/server',
        blurb: 'Refuse with a status, THROWN so it can come from anywhere under the handler — and DECLARED so it crosses a wire as itself.',
        ladders: ['responses', 'transport'],
    },
    HttpError: {
        name: 'HttpError',
        from: 'abide/server',
        blurb: 'What `error` throws, so a catch can ask whether this failure is one the handler meant.',
        ladders: ['responses'],
    },
    jsonl: {
        name: 'jsonl',
        from: 'abide/server',
        blurb: 'Answer with many, one line each, as they arrive.',
        ladders: ['responses'],
    },
    sse: {
        name: 'sse',
        from: 'abide/server',
        blurb: 'Frame that same source as events, for an `EventSource` to read.',
        ladders: ['responses'],
    },
    render: {
        name: 'render',
        from: 'abide/server',
        blurb:
            'Streaming SSR: one walk in document order, out-of-order for anything that suspends. An async ' +
            'generator, so a caller wanting a string drains it.',
        ladders: ['server'],
    },

    // --- `abide/server` — the request scope --------------------------------------
    request: {
        name: 'request',
        from: 'abide/server',
        blurb:
            'The Request being answered, as an ambient rather than a parameter — so a helper four frames ' +
            'down reads it without every frame between declaring one.',
        ladders: ['request'],
    },
    cookies: {
        name: 'cookies',
        from: 'abide/server',
        blurb: 'What the caller sent, parsed once and held for the rest of the request.',
        ladders: ['request'],
    },
    bag: {
        name: 'bag',
        from: 'abide/server',
        blurb: 'Your own store, one per request — and the property that makes a module-level `memo` per-caller.',
        ladders: ['request'],
    },
    trace: {
        name: 'trace',
        from: 'abide/server',
        blurb: 'The id tying this request’s log lines to the caller’s.',
        ladders: ['request'],
    },
    nonce: {
        name: 'nonce',
        from: 'abide/server',
        blurb: 'One unguessable value per request, the same for every asker inside it.',
        ladders: ['request'],
    },
    csp: {
        name: 'csp',
        from: 'abide/server',
        blurb: 'The policy that makes that nonce mean something.',
        ladders: ['request'],
    },

    // --- `abide/server` — the process --------------------------------------------
    server: {
        name: 'server',
        from: 'abide/server',
        blurb:
            'The socket that is listening, as an ambient. A PROCESS fact rather than a caller’s, and it ' +
            'refuses rather than guessing before anything has served.',
        ladders: ['lifecycle'],
    },
    middleware: {
        name: 'middleware',
        from: 'abide/server',
        blurb: 'Wrap every request, outermost first — an ARRAY, because the order is the app’s to declare.',
        ladders: ['lifecycle'],
    },
    onStart: {
        name: 'onStart',
        from: 'abide/server',
        blurb:
            'Boot as an ONION rather than a before/after pair: the socket binds INSIDE it, so an app cannot ' +
            'answer against setup that has not finished.',
        ladders: ['lifecycle'],
    },
    onStop: {
        name: 'onStop',
        from: 'abide/server',
        blurb: 'The mirror on the way out — `stop()` is the socket closing, and what follows it is the drain.',
        ladders: ['lifecycle'],
    },
    onError: {
        name: 'onError',
        from: 'abide/server',
        blurb: 'Answer the requests that threw. What the hook returns IS the response.',
        ladders: ['lifecycle'],
    },
    config: {
        name: 'config',
        from: 'abide/server',
        blurb:
            'What the process was TOLD, typed, with the app’s own defaults under it — and the three ' +
            'ceilings, each unset by default and costing nothing while it is.',
        ladders: ['config', 'ceilings'],
    },
    onConfig: {
        name: 'onConfig',
        from: 'abide/server',
        blurb: 'Declare your own defaults — UNDER what the operator declared, which is what makes them defaults.',
        ladders: ['config'],
    },
    onHealth: {
        name: 'onHealth',
        from: 'abide/server',
        blurb: 'Merge the app’s own fields OVER abide’s floor. A reporter that throws is an account of not working.',
        ladders: ['health'],
    },
    onIdentity: {
        name: 'onIdentity',
        from: 'abide/server',
        blurb: 'Resolve a caller there is no cookie for — a token, a key, a session.',
        ladders: ['identity'],
    },
} satisfies Record<string, CallableMeta>

export type CallableName = keyof typeof CALLABLES

/**
 * The index order, which is the order of the entry points and then of the ideas inside each.
 *
 * Written out rather than sorted: alphabetical puts `DELETE` above `GET` and `bag` above `request`,
 * which reads as a glossary. The order a reader wants is the order they would meet these in.
 */
export const CALLABLE_ORDER: CallableName[] = [
    'state',
    'memo',
    'channel',
    'watch',
    'invalidate',
    'refresh',
    'isPending',
    'html',
    'raw',
    'props',
    'route',
    'navigate',
    'url',
    'log',
    'health',
    'online',
    'identity',
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'socket',
    'json',
    'page',
    'redirect',
    'error',
    'HttpError',
    'jsonl',
    'sse',
    'render',
    'request',
    'cookies',
    'bag',
    'trace',
    'nonce',
    'csp',
    'server',
    'middleware',
    'onStart',
    'onStop',
    'onError',
    'config',
    'onConfig',
    'onHealth',
    'onIdentity',
]

/**
 * The entry points an APP TYPES, in the order the index groups them.
 *
 * `abide/ui` is deliberately not among them. `mount` and `hydrate` are real exports on a real entry
 * point, but the only things that import them are `abide build`'s GENERATED client entry and a bench
 * harness — no page, server or site in either app types either one. The standard for this list is what
 * an author writes, so an entry point only the framework's own generated code reaches is not on it.
 */
export const SPECIFIERS = ['abide', 'abide/server'] as const

/**
 * One callable's rungs, in ladder order, from the one or two ladders that hold them.
 *
 * The rungs of a ladder stay in THAT ladder's order, because the order is the content: rung 4 of
 * `request` is rung 3 plus one thing, and reordering them by anything else would break the only
 * property that makes a rung small enough to read.
 */
export async function rungsOf(callable: CallableMeta): Promise<Example[]> {
    // Opened together rather than one after the next: the ladders of a callable on two of them have no
    // dependency on each other, so awaiting inside the loop serialised two chunk loads for nothing.
    const opened = await Promise.all(callable.ladders.map((ladder) => LADDERS[ladder]()))
    const found: Example[] = []
    for (const { LADDER } of opened) {
        for (const rung of LADDER) {
            if (rung.of.includes(callable.name)) found.push(rung)
        }
    }
    return found
}
