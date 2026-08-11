// Every suite's NAME, TITLE, TAG and BLURB — and nothing else.
//
// Split out from the suites themselves so a page can draw its nav and the hub can draw its index
// without importing twenty suite modules. That mattered once `compiler` existed: it pulls
// TypeScript's scanner, so a static list of suites put ~700 kB of compiler on `/state`.
//
// This is the ONE place the prose lives. A suite spreads its own entry into `suite({ ... })`, so the
// hub and the page it links to cannot describe the same suite differently.

export interface SuiteMeta {
    /** Route segment and test-file name: `state` -> `/state`. */
    name: string
    title: string
    /** The one-line label under the title on the hub. */
    tag: string
    blurb: string
}

export const META = {
    overview: {
        name: 'overview',
        title: 'abide',
        blurb:
            'Three primitives, one template tag, two substrates. Every page below is the live surface of ' +
            'one of them — the same modules this repo ships, and the same code `bun test` runs.',
        tag: 'what is here',
    },
    state: {
        name: 'state',
        title: 'state',
        blurb:
            'Own a value. `x()` reads and subscribes, `x.set(v)` writes, `x.peek()` reads untracked. ' +
            'Handing one a promise starts a LOAD instead of storing the promise, so the read is the same ' +
            'call either way.',
        tag: 'own a value',
    },
    memo: {
        name: 'memo',
        title: 'memo',
        blurb:
            'Derive one or load one. Declaring an argument is the declaration that the args are the ' +
            'dependency set — and that they are the cache key. Both forms take the same options and ' +
            'carry the same verbs.',
        tag: 'derive or load one',
    },
    verbs: {
        name: 'verbs',
        title: 'verbs',
        blurb:
            '`invalidate` says this data is WRONG — drop it, clear the error, start nothing. `refresh` says ' +
            'it may be STALE — keep serving it and re-run now. One needs only data; the other needs a body.',
        tag: 'invalidate · refresh · tags · ttl',
    },
    channel: {
        name: 'channel',
        title: 'channel',
        blurb:
            'Subscribe to values arriving over time. `feed()` is the latest message and subscribes the ' +
            'caller — the same call every other source spells a read with. The reactive reads go through ' +
            'a `state` cell, so a component re-renders on publish with no bridging code.',
        tag: 'subscribe to them',
    },
    watch: {
        name: 'watch',
        title: 'watch · untrack · scope',
        blurb:
            'React to the graph. Reading a cell inside a `watch` IS the subscription — there is no ' +
            'dependency array. Effects are batched onto a microtask, isolated per node, and owned by ' +
            'whatever `scope` they were created inside.',
        tag: 'react · untrack · scope',
    },
    scope: {
        name: 'scope',
        title: 'scope',
        blurb:
            'A memo’s cache is per-caller by default, so a module-level handler cannot serve the last ' +
            'caller’s data. `{ global }` opts back in to one cache for the whole process. On a client ' +
            'there is one caller forever, so nothing here costs anything.',
        tag: 'per-caller caches · { global }',
    },
    routing: {
        name: 'routing',
        title: 'routing',
        blurb:
            'Which page a URL names, and what that page may ask about the caller that asked for it. ' +
            '`route()` is an ambient like `request()`, but a REACTIVE one — a client moves without a new ' +
            'caller arriving — so it is four small cells rather than one record, and a same-route ' +
            'navigation is a republish rather than a remount.',
        tag: 'route · url · navigate',
    },
    template: {
        name: 'template',
        title: 'html',
        blurb:
            'One tagged template, consumed by both substrates. `${}` in child position is content; inside a ' +
            'tag it is a WHOLE attribute value, written unquoted. Neither substrate is allowed its own ' +
            'idea of what a slot is — `classifySlots` is the single classifier, and the lanes differ only ' +
            'in the action they take per kind.',
        tag: 'the one template tag',
    },
    client: {
        name: 'client',
        title: 'client',
        blurb:
            'A TemplateResult becomes DOM, and slots become effects. A call site is parsed once into a ' +
            '<template> with each slot recorded as a node index; every later instantiation is a clone ' +
            'plus one walk. Every write compares before it writes.',
        tag: 'mount · keyed lists',
    },
    server: {
        name: 'server',
        title: 'server',
        blurb:
            'Streaming SSR: in-order by default, out-of-order for anything suspended. A pending cell renders ' +
            'blank, because a snapshot has nothing to wake later — `suspend(cell, v => …)` is how a load ' +
            'reaches SSR, and every cell is thenable, so it can be suspended directly.',
        tag: 'SSR · streaming · suspend',
    },
    hydrate: {
        name: 'hydrate',
        title: 'hydrate',
        blurb:
            'The client adopts the server’s markup rather than building its own. Every part claims the ' +
            'range two comments mark out for it, then runs the ordinary first update — which writes ' +
            'nothing, because every binding compares before it writes. One node is inserted: the root anchor.',
        tag: 'adopt the server’s markup',
    },
    transport: {
        name: 'transport',
        title: 'rpc · socket',
        blurb:
            'Two laws over the three primitives: `rpc` is a `memo` whose body is a fetch, `socket` is a ' +
            '`channel` whose subscribers arrived over a wire. The right-hand sides are already written, ' +
            'so three concurrent readers of one key cost one request without the transport doing anything.',
        tag: 'rpc = memo + transport',
    },
    logging: {
        name: 'logging',
        title: 'log',
        blurb:
            'The app’s own channel always writes; a named one is off until `DEBUG` names it, in the ' +
            'debug-npm spelling every operator already knows. `warning` and `error` are never gated — ' +
            'the gate is there to control volume, not to hide breakage. `DEBUG=abide:*` is the request, ' +
            'the call and the frame, each on its own channel and each carrying the trace it belongs to.',
        tag: 'channels · levels · DEBUG',
    },
    health: {
        name: 'health',
        title: 'health',
        blurb:
            'What the app says about itself, asked with the same call on both sides. abide fills in a ' +
            'floor — version, start, uptime — and `onHealth` merges the app’s own fields over it. A ' +
            'reporter that throws is an account of not working rather than a route falling over.',
        tag: 'the app’s own account',
    },
    identity: {
        name: 'identity',
        title: 'identity',
        blurb:
            'Who the server decided this caller is, asked with the same call on both sides. A principal ' +
            'is never null — anonymous is an answer — and never guessed by the client: the two writers ' +
            'are the server’s, and a browser calling one gets a message rather than a different answer.',
        tag: 'the sealed principal',
    },
    config: {
        name: 'config',
        title: 'config',
        blurb:
            'What the process was TOLD, typed, with the app’s own defaults under it. Three layers — ' +
            'abide’s floor, the app’s defaults, what the operator declared — and the app’s layer losing ' +
            'to the environment is what makes it a default rather than a knob that does nothing.',
        tag: 'the typed environment',
    },
    lifecycle: {
        name: 'lifecycle',
        title: 'lifecycle',
        blurb:
            'What a process does before it serves, around every request, and on its way out. Three of ' +
            'the four hooks are onions rather than pairs of before/after hooks — the socket binds INSIDE ' +
            '`onStart`, so an app cannot answer a request against setup that has not finished.',
        tag: 'boot · middleware · teardown',
    },
    ceilings: {
        name: 'ceilings',
        title: 'ceilings',
        blurb:
            'What a process is allowed to remember, and what asking for a bound costs. All three ' +
            'knobs are unset by default, and a ceiling nobody declared has to cost nothing — so each ' +
            'is read where it could first matter and nothing on the paths between them charges anything.',
        tag: 'retention · LRU · wall budget',
    },
    compiler: {
        name: 'compiler',
        title: 'compiler',
        blurb:
            'A `.abide` file compiled with TypeScript 7’s own scanner. Reads and writes desugar — `{count}` ' +
            'is the value and `count = n` is the write — control flow becomes ordinary expressions, and ' +
            'what comes out is an `html` template indistinguishable from a hand-written one.',
        tag: '.abide → the file you would have written',
    },
} satisfies Record<string, SuiteMeta>

export type SuiteName = keyof typeof META

/** Nav order, and the hub's order. */
export const ORDER: SuiteName[] = [
    'overview',
    'state',
    'memo',
    'verbs',
    'channel',
    'watch',
    'scope',
    'routing',
    'template',
    'client',
    'server',
    'hydrate',
    'transport',
    'logging',
    'health',
    'identity',
    'config',
    'lifecycle',
    'ceilings',
    'compiler',
]

export const NAV: SuiteMeta[] = ORDER.map((name) => META[name])
