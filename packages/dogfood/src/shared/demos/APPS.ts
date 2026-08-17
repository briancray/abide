// The demo APPS — the third vocabulary, and the first one that is not a list of names in this app.
//
// `SUITES.ts` is keyed by capability and `CALLABLES.ts` by callable; both describe things that live
// INSIDE this app. These are separate applications, served by their own processes, reached through a
// prefix on one origin. What makes them worth the separation is what they cannot inherit: their own
// `app.html`, their own headers, their own stylesheet — or none, which is the whole reason `perf`
// exists and the one thing it could never keep while being a page in here.
//
// ONE list, read by two things that must agree: `fleet.ts` spawns what is here, and `/demos` frames
// it. A prefix written in two places is a demo that is served at one address and shown at another.

export interface DemoApp {
    /** Route segment and package name: `perf` → `/demo/perf`, `packages/perf`. */
    name: string
    /** Where the door puts it. Leading slash, no trailing one — what `APP_URL` is built from. */
    prefix: string
    /** The port its own process binds behind the door. Fixed, never hopped: see `fleet.ts`. */
    port: number
    title: string
    blurb: string
    /** The page inside it worth showing first, under its own prefix. */
    entry: string
    /**
     * The operations worth PRICING on that page, each named by a control inside it.
     *
     * A selector rather than a function, because the op belongs to the demo app and the driver lives
     * out here: a demo declares what it can be asked to do, and `/demos` asks. Anything more coupled
     * would put this app's measuring code inside the app being measured, which is the one arrangement
     * that cannot produce an honest number.
     */
    ops: { label: string; click: string }[]
}

export const APPS: DemoApp[] = [
    {
        name: 'perf',
        prefix: '/demo/perf',
        port: 4402,
        title: 'use cases, at scale',
        blurb:
            'Full pages rather than a case: a thousand rows created, updated and swapped, a dashboard, ' +
            'a table filtered over an rpc. Its shell ships NO stylesheet, deliberately — one CSS rule ' +
            'was the whole of a “4.5x faster” reading once, so this app may never gain one. That is ' +
            'why it is its own application and not a page in this one.',
        entry: '/complex',
        // The four the whole page exists for, in the order a reader would press them. `create` first
        // because everything after it is a measurement ON a thousand rows, and `swap` last because a
        // two-row swap is the case that distinguishes a keyed reconcile from a rebuild — a full
        // rewrite produces the same screen and cannot be told from it by looking.
        ops: [
            { label: 'create 1,000 rows', click: '#create' },
            { label: 'update every tenth', click: '#update' },
            { label: 'swap two rows', click: '#swap' },
            { label: 'clear', click: '#clear' },
        ],
    },
]

/** The door's own port. One origin, and everything above is behind it. */
export const DOOR = 4400

/** This app, behind the same door — the fallback everything outside a prefix reaches. */
export const HOST = 4401
