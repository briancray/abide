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
// asserted in `#tests/unit/docs.test.ts`, against `SPECIFIERS` — a name missing from this list fails, and a
// name here that no rung claims fails too.
//
// `abide/ui` is therefore absent: `mount` and `hydrate` are reached only by the GENERATED client entry
// and a bench harness, so they are surface the framework writes for itself rather than surface anybody
// is asked to learn. The `client` and `hydrate` LADDERS still exist and still run — they are just not
// about a name a reader types, so their rungs claim nothing.
//
// `html` is off the list for the same reason, and it had a page for a reason that has since gone away:
// the escape hatch used to be spelled `html(…)`, so the name meant the TAG and the hatch at once and
// the page was really about the hatch. The hatch is `raw` now — renamed so a reader never has to know
// the syntax to know the trust — which leaves `html` as the tag the compiler EMITS into every `.abide`
// file. It is on `abide` rather than `abide/runtime` so the emitted import merges with an author's own
// (see `emit.ts`), not because a page, server or site here types it: none does.
//
// THIS IS NOT THE ONLY LIST. Taking `html` off left thirty rungs about the template reachable from no
// page at all, and that is a fact about the KEY rather than about those rungs: `{#for}`, `bind:value`
// and `<slot/>` import nothing, so a reader who met one has no name to look up here. `SPELLINGS.ts` is
// the second axis and `/docs/syntax` is where it lands — same shape, same gates, keyed by how a thing
// is TYPED. A rung claims into either list, or both.
//
// `TOPICS.ts` is the third file and is NOT a third axis: it is a grouping OVER these two, holding an
// order and a paragraph and no rungs at all. It owns `CALLABLE_ORDER`, which used to be written out
// below — the order was encoding a grouping whose groups were named nowhere, which is why the sidebar
// was forty-four names in one flat run.

import type { Example } from 'harness'
import { claimed, type LadderName } from './LADDERS.ts'

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
     * index page, the browser spec and `#tests/unit/docs.test.ts` all group by that same list.
     */
    from: (typeof SPECIFIERS)[number]
    /** The one line under the name, on the index and on the page. */
    blurb: string
    /**
     * The ONE thing about this name that is easy to get wrong.
     *
     * A different job from `blurb`, which says what the name is for. This says what a reader who has
     * already decided to use it will discover the hard way — and it is on the METADATA rather than in
     * a rung's prose because it is usually true of the callable as a whole rather than of any one step
     * of its ladder.
     *
     * Required, and gated in `#tests/unit/docs.test.ts` exactly like `blurb`. Optional was the obvious
     * spelling and is the wrong one: the docs app this shape was taken from carries its equivalent as a
     * per-route map with holes in it, and a hole is indistinguishable from a name with no pitfall.
     * Everything public has one — where the honest answer is "it does what it says", say that.
     */
    pitfall: string
    /**
     * The ladders holding this callable's rungs — usually one.
     *
     * Hand-written, and therefore the one thing here that can go stale: the rungs themselves say what
     * they are `of`, and this says where to look. `#tests/unit/docs.test.ts` loads every ladder and compares
     * the two, in both directions, so a rung that moves suites is a red gate rather than a page that
     * quietly comes up short.
     */
    ladders: LadderName[]
}

export const CALLABLES = {
    // --- `abide` — what an author types on either substrate ----------------------
    state: {
        name: 'state',
        from: 'abide',
        blurb:
            'Own a value. `x()` reads and subscribes, `x.set(v)` writes. Handing one a promise starts a ' +
            'LOAD instead of storing the promise, so the read is the same call either way.',
        pitfall:
            'There is no spelling that makes a state keep the PROMISE — a gate written as ' +
            '`state(inFlight)` reads as whatever it resolved to. And every state is awaitable and iterable ' +
            'at once, so `x.set(anotherState)` is taken as a stream rather than as a value.',
        ladders: ['state', 'compiler'],
    },
    memo: {
        name: 'memo',
        from: 'abide',
        blurb:
            'Derive one or load one. Declaring an argument is the declaration that the args are the ' +
            'dependency set — and that they are the cache key.',
        pitfall:
            'The keyed form tracks only the KEY: the body is untracked, so a state it reads that is not in ' +
            'the args will never re-run it. Argless is the tracked form, and the choice between them is ' +
            'the choice of what "changed" means.',
        ladders: ['memo', 'scope', 'compiler'],
    },
    channel: {
        name: 'channel',
        from: 'abide',
        blurb: 'Subscribe to values arriving over time. Reading the channel IS the subscription.',
        pitfall:
            'A channel never LOADS, so `pending()`, `refreshing()` and `error()` are the cold answer ' +
            'forever and `settled()` is the only one of the four that says anything. The exception is a ' +
            'socket, whose connection is a load.',
        ladders: ['channel'],
    },
    watch: {
        name: 'watch',
        from: 'abide',
        blurb:
            'React to the graph. Reading a state inside a `watch` IS the subscription — there is no ' +
            'dependency array — and the set is whatever the LAST RUN read.',
        pitfall:
            'A source behind a branch that did not run this time is not subscribed, so an effect can go ' +
            'quiet by taking the other arm once. What the handler RETURNS is the teardown, not a result ' +
            '— there is no `onMount` and no `onDestroy`.',
        ladders: ['watch'],
    },
    invalidate: {
        name: 'invalidate',
        from: 'abide',
        blurb: 'This data is WRONG: drop it, clear the error, start nothing. Reaches slots by tag as well as by memo.',
        pitfall:
            'It goes back to COLD, so anything reading during the reload has nothing to serve and every ' +
            'reader sees the pending arm. When what is held is still worth showing, the verb is `refresh`.',
        ladders: ['verbs'],
    },
    refresh: {
        name: 'refresh',
        from: 'abide',
        blurb: 'It may be STALE: keep serving what is held and re-run the body now. Needs a body, so plain `state` has none.',
        pitfall:
            'A state you write yourself has nothing to recompute, so the verb is not merely a no-op on a ' +
            'plain `state` — it is not on it at all, and lives on `Memo` and `MemoHandle`.',
        ladders: ['verbs'],
    },
    raw: {
        name: 'raw',
        from: 'abide',
        blurb:
            'The escape hatch: says a string is already markup, so the slot skips the escape. Its own ' +
            'name rather than a spelling of `html`, so one grep finds every string an app does not escape.',
        pitfall:
            'It is a promise about the STRING and not about where the string came from, so one ' +
            '`raw(fromACaller)` is the whole of an injection. The separate name is what makes every one ' +
            'of them a single grep.',
        ladders: ['template'],
    },
    props: {
        name: 'props',
        from: 'abide',
        blurb: 'What a component was called with, read inside it — the same shape a compiled `.abide` component gets.',
        pitfall:
            '`<script>` only — module scope has no instance, so a `props()` in a `<script module>` is a ' +
            'compile error. A `...spread`’s key set is fixed at SETUP: a key the spread gains later has ' +
            'no state to be written into, and is reported rather than dropped in silence.',
        ladders: ['template'],
    },
    route: {
        name: 'route',
        from: 'abide',
        blurb:
            'Which page this URL named, as a REACTIVE ambient — four small states, so a same-route move ' +
            'republishes rather than remounting.',
        pitfall:
            'Read the member you need rather than the whole record — four states is what lets a query ' +
            'change wake nothing that only read `.name`. A LAYOUT that asks a load about it is the one ' +
            'shape to avoid: it renders before its page, so the answer is settled on a server and pending ' +
            'in a browser, and hydration rebuilds what it was handed correct.',
        ladders: ['routing'],
    },
    navigate: {
        name: 'navigate',
        from: 'abide',
        blurb: 'Move, without a new caller arriving and without rebuilding what did not change.',
        pitfall:
            'Import it from `abide`. It is on `abide/runtime` too, and that copy exists so the generated ' +
            'client entry can reach it without dragging the front door’s other names into the chunk every ' +
            'page loads — reaching for it there from an app is asking for someone else’s bundling ' +
            'decision.',
        ladders: ['routing'],
    },
    url: {
        name: 'url',
        from: 'abide',
        blurb: 'Build the same target as an href, so a link and a `navigate` cannot disagree about where they go.',
        pitfall:
            'The pitfall is not using it: a hand-built string and a `navigate` are two spellings that ' +
            'drift, and only one of them knows the sub-path the app is mounted under.',
        ladders: ['routing'],
    },
    log: {
        name: 'log',
        from: 'abide',
        blurb:
            'The app’s own channel always writes; a named one is off until `DEBUG` names it. `warning` and ' +
            '`error` are never gated.',
        pitfall:
            'A line you cannot find is usually a channel nobody enabled rather than code that did not ' +
            'run — a named channel is silent until `DEBUG` names it. `warning` and `error` are never ' +
            'gated, so anything that must be seen goes on one of those.',
        ladders: ['logging'],
    },
    health: {
        name: 'health',
        from: 'abide',
        blurb: 'What the app says about itself, asked with the same call on both sides, over a floor abide fills in.',
        pitfall:
            'Always a promise, on both sides. Naming a `base` means asking over a WIRE even from a process ' +
            'that could have answered itself, which is the difference between checking this app and ' +
            'checking the one it is talking to.',
        ladders: ['health'],
    },
    online: {
        name: 'online',
        from: 'abide',
        blurb: 'Whether the network is there at all — which changes with no caller arriving.',
        pitfall:
            'It changes with no caller arriving, so it is a read to subscribe to and not a value to copy ' +
            'into a local. A server is always online: the question the call asks is whether the CALLER can ' +
            'reach what it is talking to.',
        ladders: ['health'],
    },
    identity: {
        name: 'identity',
        from: 'abide',
        blurb:
            'Who the server decided this caller is, asked with the same call on both sides. Never null — ' +
            'anonymous is an answer — and never guessed by the client.',
        pitfall:
            'Never null, so `if (await identity())` is always true — the field to test is `authenticated`. ' +
            'A bad signature, a lapsed seal and a malformed cookie are ONE answer, and a resolver that ' +
            'throws fails closed to anonymous rather than refusing the request.',
        ladders: ['identity'],
    },

    // --- `abide/server` — the transports -----------------------------------------
    GET: {
        name: 'GET',
        from: 'abide/server',
        blurb: 'A read any surface may call, addressed by its arguments — on the client it IS a keyed memo.',
        pitfall:
            'The arguments are the ADDRESS, so two calls with the same args are one cached slot rather ' +
            'than two round trips. A read that must not be shared between callers needs something in the ' +
            'args that distinguishes them, or it is a `POST`.',
        ladders: ['transport'],
    },
    POST: {
        name: 'POST',
        from: 'abide/server',
        blurb: 'A mutation: the same declaration as a `GET`, and the difference is that it retains nothing.',
        pitfall:
            'It retains nothing, which also means it invalidates nothing: what the mutation changed is ' +
            'still held by whichever `GET` holds it until an `invalidate`, a `refresh` or a tag says ' +
            'otherwise.',
        ladders: ['transport'],
    },
    PUT: {
        name: 'PUT',
        from: 'abide/server',
        blurb: 'A mutation whose method says REPLACE: the declaration is a `POST`, and the argument carries every field.',
        pitfall:
            'REPLACE means the argument carries EVERY field, so a `PUT` with a partial argument is a ' +
            'request to erase what it left out. Amending is what `PATCH` is for, and the two differ by ' +
            'nothing but the method string.',
        ladders: ['transport'],
    },
    PATCH: {
        name: 'PATCH',
        from: 'abide/server',
        blurb: 'A mutation whose method says AMEND: what the argument leaves out, it leaves alone.',
        pitfall:
            'What it leaves out it leaves ALONE, so "clear this field" and "do not touch this field" are ' +
            'the same request unless the shape gives the first one a value of its own to send.',
        ladders: ['transport'],
    },
    DELETE: {
        name: 'DELETE',
        from: 'abide/server',
        blurb: 'A mutation whose method says REMOVE: the argument is the key, and no link can reach the method.',
        pitfall:
            'No link can reach the method, which is the safety and the constraint at once: a crawler or a ' +
            'prefetch cannot fire one, and neither can a plain `<a href>` — reaching it takes a call.',
        ladders: ['transport'],
    },
    socket: {
        name: 'socket',
        from: 'abide/server',
        blurb: 'The second law: a `channel` whose subscribers arrived over a wire. It always SELECTS — `s()` is the stream, `s(args)` a room — and the stream it selects is `channel()` unchanged.',
        pitfall:
            'Everything true of a room is true here, and the one that surprises is retention: a room is ' +
            'FORGOTTEN when its last subscriber leaves, with whatever it was holding, because rooms are ' +
            'named by the caller and a table that only grew is one an arriving connection could grow ' +
            'without bound.',
        ladders: ['transport'],
    },

    // --- `abide/server` — what a route answers with -------------------------------
    json: {
        name: 'json',
        from: 'abide/server',
        blurb: 'Answer with JSON, when the route builds its own Response instead of returning a value.',
        pitfall:
            '`undefined` is sent as `null` rather than as the four letters `undefined`, so a handler that ' +
            'falls off the end still produces a body a caller can parse instead of one that throws where ' +
            'it is read.',
        ladders: ['responses'],
    },
    page: {
        name: 'page',
        from: 'abide/server',
        blurb: 'Answer with HTML — and a streamed body is HELD past the handler, so the request scope outlives it.',
        pitfall:
            'It takes what a render PRODUCED rather than doing the render. The hold is the part worth ' +
            'knowing: a handler answering with a stream returns before a byte of the body is written, so ' +
            'without it a `memo` the body reads would find the cache torn down and build the same answer ' +
            'a second time.',
        ladders: ['responses'],
    },
    redirect: {
        name: 'redirect',
        from: 'abide/server',
        blurb: 'Answer with a location instead of a body, and say whether it is the permanent kind.',
        pitfall:
            'The status is a closed set — `301`/`302`/`303`/`307`/`308`, default `302` — and there is an ' +
            '`init`, which is where a login’s cookie goes. A redirect built without one is a sign-in that ' +
            'lands signed out.',
        ladders: ['responses'],
    },
    error: {
        name: 'error',
        from: 'abide/server',
        blurb: 'Refuse with a status, THROWN so it can come from anywhere under the handler — and DECLARED so it crosses a wire as itself.',
        pitfall:
            'It is declared `never`, so it vanishes from the return union and a bare call stands as a ' +
            'guard: `return error(404)` and `error(404)` are both right and neither wants a `throw` in ' +
            'front of it. What a caller can NARROW, though, is only what `error.typed` declared.',
        ladders: ['responses', 'transport'],
    },
    HttpError: {
        name: 'HttpError',
        from: 'abide/server',
        blurb: 'What `error` throws, so a catch can ask whether this failure is one the handler meant.',
        pitfall:
            'Match it STRUCTURALLY. What a caller catches is the same four members in-process and over a ' +
            'wire rather than a class it imported, so `instanceof` is the check that works in one lane ' +
            'and quietly fails in the other.',
        ladders: ['responses'],
    },
    jsonl: {
        name: 'jsonl',
        from: 'abide/server',
        blurb: 'Answer with many, one line each, as they arrive.',
        pitfall:
            'The SOURCE is claimed once, by whichever lane asks first — an rpc takes the values and the ' +
            'body is then empty, a route reads the body and the values are its own. And a throw mid-body ' +
            'ERRORS the stream rather than returning a status, because the status line is already out.',
        ladders: ['responses'],
    },
    sse: {
        name: 'sse',
        from: 'abide/server',
        blurb: 'Frame that same source as events, for an `EventSource` to read.',
        pitfall:
            'The same machine as `jsonl` with a different frame, so the choice between them is about who ' +
            'ELSE has to read the address — a caller’s own stub consumes either one identically, with ' +
            'nothing written to decode it.',
        ladders: ['responses'],
    },
    render: {
        name: 'render',
        from: 'abide/server',
        blurb:
            'Streaming SSR: one walk over a `Renderable`, in document order, handing over what it has ' +
            'written whenever it is about to wait. An async generator, so a caller wanting a string drains ' +
            'it and `page(render(view))` streams it. `shell` is the document around it — the app’s own, ' +
            'or one you pass — and `hydrate` is whether a client takes it over.',
        pitfall:
            'An async generator, so nothing happens until something DRAINS it: a caller wanting a string ' +
            'awaits it to the end, and `page(render(view))` is what streams it instead. Calling it and ' +
            'keeping the result is a render that has not started.',
        ladders: ['server'],
    },

    // --- `abide/server` — the request scope --------------------------------------
    request: {
        name: 'request',
        from: 'abide/server',
        blurb:
            'The Request being answered, as an ambient rather than a parameter — so a helper four frames ' +
            'down reads it without every frame between declaring one.',
        pitfall:
            'It THROWS outside a request, and that is the design rather than an oversight — module scope ' +
            'is outside one. A helper that may run in either lane branches on whether there is a scope to ' +
            'ask rather than catching the throw.',
        ladders: ['request'],
    },
    cookies: {
        name: 'cookies',
        from: 'abide/server',
        blurb: 'What the caller sent, parsed once and held for the rest of the request.',
        pitfall:
            'Live and MUTABLE: the map you read is the one the response is built from, so writing into it ' +
            'is how a cookie is set. Parsed once per request, so a second reader sees the first one’s ' +
            'writes rather than what the caller sent.',
        ladders: ['request'],
    },
    bag: {
        name: 'bag',
        from: 'abide/server',
        blurb: 'Your own store, one per request — and the property that makes a module-level `memo` per-caller.',
        pitfall:
            'One per REQUEST, so it is empty again on the next one. A value meant to outlive a caller ' +
            'belongs in module scope or behind `{ global }` — putting it here is how a cache silently ' +
            'stops caching while every read still returns the right answer.',
        ladders: ['request'],
    },
    trace: {
        name: 'trace',
        from: 'abide/server',
        blurb: 'The id tying this request’s log lines to the caller’s.',
        pitfall:
            'Nothing to do with `log.debug` — it is the OPERATION this work belongs to, carried in from ' +
            'the caller’s `traceparent` or minted here. abide mints exactly one span per hop and models ' +
            'no span tree, so there is no parent to build under.',
        ladders: ['request'],
    },
    nonce: {
        name: 'nonce',
        from: 'abide/server',
        blurb: 'One unguessable value per request, the same for every asker inside it.',
        pitfall:
            'Built on the FIRST ask and held for the rest of the request, so asking is what puts it in ' +
            'play. A policy that names a nonce nothing stamped refuses exactly the scripts it was written ' +
            'to allow.',
        ladders: ['request'],
    },
    csp: {
        name: 'csp',
        from: 'abide/server',
        blurb:
            'The opt-in half of a page’s policy. A page carries `object-src` and `base-uri` already; ' +
            'this adds every directive that names where a resource may load from, and the nonce.',
        pitfall:
            'It ADDS to a policy rather than declaring one, so leaving a directive out is not the same as ' +
            'turning it off — what a page already carries stays carried, and what this names is the part ' +
            'about where a resource may come from.',
        ladders: ['request'],
    },

    // --- `abide/server` — the process --------------------------------------------
    server: {
        name: 'server',
        from: 'abide/server',
        blurb:
            'The socket that is listening, as an ambient. A PROCESS fact rather than a caller’s, and it ' +
            'refuses rather than guessing before anything has served.',
        pitfall:
            'A PROCESS fact, so it throws before anything has served — and module scope at import time is ' +
            'before. `server.peek()` is the one that observes without throwing, which is what a path that ' +
            'may run either side of the bind asks.',
        ladders: ['lifecycle'],
    },
    middleware: {
        name: 'middleware',
        from: 'abide/server',
        blurb:
            'Wrap every request, outermost first. The one registration that APPENDS rather than replaces, so ' +
            'a rung declared late joins the chain instead of taking it over — and the disposer takes off its ' +
            'own rungs and no others.',
        pitfall:
            'It APPENDS, so a second registration does not replace the first and the disposer it hands ' +
            'back is the only way one comes off. Outermost first, which means the order rungs are ' +
            'declared in is the order requests walk them.',
        ladders: ['lifecycle', 'transport', 'request'],
    },
    onStart: {
        name: 'onStart',
        from: 'abide/server',
        blurb:
            'Boot as an ONION rather than a before/after pair: the socket binds INSIDE it, so an app cannot ' +
            'answer against setup that has not finished.',
        pitfall:
            'The socket binds INSIDE it, so everything before the inner call happens before anything is ' +
            'served and everything after it happens once the server is up. A hook that never calls in is ' +
            'a process that never binds.',
        ladders: ['lifecycle'],
    },
    onStop: {
        name: 'onStop',
        from: 'abide/server',
        blurb: 'The mirror on the way out — `stop()` is the socket closing, and what follows it is the drain.',
        pitfall:
            '`stop()` is the SOCKET closing rather than the process ending, so work that must finish goes ' +
            'after it — before it, the thing still accepting requests is racing the cleanup.',
        ladders: ['lifecycle'],
    },
    onError: {
        name: 'onError',
        from: 'abide/server',
        blurb: 'Answer the requests that threw. What the hook returns IS the response.',
        pitfall:
            'What the hook RETURNS is the response, so one that logs and falls off the end has not ' +
            'answered the request — it has only watched it fail.',
        ladders: ['lifecycle'],
    },
    config: {
        name: 'config',
        from: 'abide/server',
        blurb:
            'What the process was TOLD, typed, with the app’s own defaults under it — and the three ' +
            'ceilings, each unset by default and costing nothing while it is.',
        pitfall:
            'Resolved ONCE for the process, so a variable changed after anything has already asked needs ' +
            '`config.invalidate()`. The environment wins over the app’s layer, which is the whole of what ' +
            'makes that layer a default.',
        ladders: ['config', 'ceilings'],
    },
    onConfig: {
        name: 'onConfig',
        from: 'abide/server',
        blurb: 'Declare your own defaults — UNDER what the operator declared, which is what makes them defaults.',
        pitfall:
            'Called ONCE: a second `onConfig` replaces the first, schema included, and says so on ' +
            '`abide:config`. It also fails HARD — what the hook throws, the read carries, and boot asks ' +
            'before it binds.',
        ladders: ['config'],
    },
    onHealth: {
        name: 'onHealth',
        from: 'abide/server',
        blurb: 'Merge the app’s own fields OVER abide’s floor. A reporter that throws is an account of not working.',
        pitfall:
            'The app’s fields win every collision, `version` included — so a reporter that returns one ' +
            'moves what the document says the app IS. A reporter that throws does not take the document ' +
            'with it; the baseline stands and the failure lands under `error`.',
        ladders: ['health'],
    },
    onIdentity: {
        name: 'onIdentity',
        from: 'abide/server',
        blurb: 'Resolve a caller there is no cookie for — a token, a key, a session.',
        pitfall:
            'It receives `null` for a caller with no valid seal, and there is nothing under that to ' +
            'distinguish tampered from lapsed from absent — they are one answer by design. Resolution ' +
            'happens at most once per request, so two asks share one resolve.',
        ladders: ['identity'],
    },
} satisfies Record<string, CallableMeta>

export type CallableName = keyof typeof CALLABLES

// `CALLABLE_ORDER` was here, forty-four lines of it, under a comment explaining that alphabetical
// "reads as a glossary". It is `TOPICS.ts`'s flatten now: the order it was standing in for is a
// GROUPING, and writing it out here left the groups themselves unnamed and the sidebar flat.

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
 * The walk itself is `LADDERS.ts`'s, because `/docs/syntax` makes the same one against the other claim
 * — same ladders, same order, `spells` instead of `of`. Two copies of it is how the two vocabularies
 * would start disagreeing about what a rung list is.
 */
export async function rungsOf(callable: CallableMeta): Promise<Example[]> {
    return claimed(callable.ladders, (rung) => rung.of, callable.name)
}
