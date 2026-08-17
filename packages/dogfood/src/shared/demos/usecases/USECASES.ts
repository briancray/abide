// The use cases — the third vocabulary, beside `SUITES.ts` (keyed by capability) and `CALLABLES.ts`
// (keyed by public name).
//
// A SUITE is a body this app runs and a CALLABLE is a name it documents. A use case is neither: it is
// a whole page at scale — a thousand keyed rows, a filtered table, a payload five levels deep over an
// rpc — and what it demonstrates is the shape an app has rather than the shape a primitive has.
//
// These used to be a separate application framed on `/demos`, and the separation bought exactly one
// thing: a shell with NO stylesheet, because Blink builds its style invalidation sets from the sheets
// and one CSS rule was the whole of a "4.5x faster" reading once. That claim is not made here any
// more and nothing on these pages depends on it: what `/demos/<name>` reports is DOM CALLS, which are
// exact, substrate-independent and unmoved by any stylesheet, plus a wall clock declared coarse. The
// pricing claim that DID need an unstyled arm lives in the cross-repo comparison in ~/code, where the
// harness installs one stylesheet into every arm alike.
//
// So a use case is now an ordinary component this app renders inline, and the three things a reader
// wants are on one page: the demo RUNNING, the files it is written in, and what its ops cost.
//
// ONE list, read by three things that must agree: `/demos` indexes it, `/demos/[name]` renders and
// drives it, and `SOURCES.ts` carries the file text keyed by the same names — gated in
// `#tests/unit/usecases.test.ts` in both directions, because a name in one and not the other is a
// page that renders a demo with no source or a source with no demo.

/**
 * One operation worth PRICING, named by a control inside the demo.
 *
 * A SELECTOR rather than a function, and that is the same split the frame version had for the same
 * reason: the demo declares what it can be asked to do and the driver lives outside it, so nothing a
 * demo does is tuned to the instrument and nothing in a demo knows it is being measured.
 *
 * `value` is what separates an op on a BUTTON from an op on a control that holds one. The three
 * reordering demos exist for their sort and their filter — a click on a `<select>` changes nothing,
 * so pricing them at all needs the value written and an `input` dispatched. See `priceOps.ts`.
 */
export interface Op {
    label: string
    /** The control, as a selector resolved INSIDE the demo rather than against the whole document. */
    on: string
    /** When present, written into the control instead of clicking it. */
    value?: string
}

export interface UseCase {
    /**
     * The segment under `/demos`, the stem of the view file (`complex` → `Complex.abide`) and the
     * heading a card and a page show. ONE string: a separate `title` was the same six words twice,
     * and the only thing a second field could ever do is disagree with the address.
     */
    name: string
    blurb: string
    /**
     * The ops, in the order a reader would press them.
     *
     * EMPTY is a real answer and not a gap — see `wake`, which is itself a measurement and reports its
     * own numbers. Every op here is client work on data the page already holds: an op that crosses the
     * wire would price the 120 ms `Bun.sleep` in `server/rpc/catalogue.ts` and call it a render.
     *
     * THE FIRST OP RUNS ONCE MORE at the end, unmeasured — `priceOps` leaves the demo showing
     * something rather than whatever `clear` left. So the order is chosen to land somewhere a reader
     * would want to arrive at: the first op is one whose replay is harmless or restorative, and the
     * last is the one that tidies up.
     */
    ops: Op[]
}

export const USECASES: UseCase[] = [
    {
        name: 'simple',
        blurb:
            'The smallest thing that is still an app: one cell, one list of ten rows, one event ' +
            'handler. Here as the floor the other five are read against.',
        ops: [{ label: 'increment', on: '#inc' }],
    },
    {
        name: 'dashboard',
        blurb:
            'A filtered table of 200 records: two cells, two derived values over them, and a ' +
            'component reused four times. The shape most application pages actually have.',
        // The checkbox first: it is a TOGGLE, so the replay at the end puts it back where it started
        // and the demo is left as a reader would want to find it.
        ops: [
            { label: 'only active', on: '#active' },
            { label: 'filter to “red”', on: '#filter', value: 'red' },
            { label: 'clear the filter', on: '#filter', value: '' },
        ],
    },
    {
        name: 'complex',
        blurb:
            'A keyed table of 1,000 rows, server-rendered and adopted — js-framework-benchmark’s ops ' +
            'on js-framework-benchmark’s row count.',
        // `create` first because everything after it is a measurement ON a thousand rows, and `swap`
        // before `clear` because a two-row swap is the case that distinguishes a keyed reconcile from
        // a rebuild — a full rewrite produces the same screen and cannot be told from it by looking.
        ops: [
            { label: 'create 1,000 rows', on: '#create' },
            { label: 'update every tenth', on: '#update' },
            { label: 'swap two rows', on: '#swap' },
            { label: 'clear', on: '#clear' },
        ],
    },
    {
        name: 'media',
        blurb:
            '500 keyed rows, a component per row with a nested component and a branch chain inside ' +
            'it — the shape ~/code/media’s list page has. The query filters; the sort REORDERS the ' +
            'same rows, which is what a distance-based placement walk pays most for.',
        // The two sorts back to back, because a REORDER of the same keyed rows is the op this demo was
        // written for — a filter changes which rows exist and cannot tell a minimal-move placement
        // walk from a rebuild, while a re-sort of the identical set can.
        ops: [
            { label: 'hide the details', on: '#details' },
            { label: 'sort by recently added', on: '#sort', value: 'added' },
            { label: 'sort by last watched', on: '#sort', value: 'watched' },
            { label: 'filter to “winter”', on: '#query', value: 'winter' },
            { label: 'clear the filter', on: '#query', value: '' },
        ],
    },
    {
        name: 'data',
        blurb:
            'One rpc answering about 10,000 objects five levels deep, and six derived values hanging ' +
            'off it. The other demos start warm; this one starts COLD and over a wire, which is where ' +
            'an app actually starts.',
        // `shard`, `refresh` and `invalidate` are on the page and deliberately NOT here: each crosses
        // the wire, so pricing one would report the endpoint's own 120 ms delay as a render cost.
        // What is priced is the fan — a sort that must wake one memo, and a filter that must wake five.
        ops: [
            { label: 're-sort — one memo', on: '#sort', value: 'rating' },
            { label: 'filter — five memos', on: '#query', value: 'a' },
            // The op that prices a documented reactive invariant. Clearing the query puts `matching`
            // back to a set with the same contents it had two ops ago — and wakes all five readers
            // again anyway, because `matching` builds a FRESH ARRAY and its identity is what they
            // subscribe to. "A freshly built wrapper defeats an identity check", as a number.
            { label: 'clear it — five again', on: '#query', value: '' },
            { label: 'sample the counters', on: '#sample' },
        ],
    },
    {
        name: 'wake',
        blurb:
            'Where a wake’s time goes, in the browser rather than in the emulator. Each arm adds one ' +
            'layer to the one above it, so the difference between two neighbours is what that layer ' +
            'costs — and the first arm is a hand-written signal, which is what the rest are a ratio ' +
            'against.',
        // NO OPS, and that is the honest entry rather than a missing one: this demo IS the instrument.
        // Its arms interleave batches under `timeArms` and take seconds to settle, so a driver that
        // clicked the button and read 60 ms later would report the click and miss the measurement —
        // which is precisely the "one pass on a coarse clock" mistake the ladder exists to avoid.
        ops: [],
    },
]

/**
 * The same list keyed by its address, for the two questions asked by NAME: `/demos/[name]`'s lookup
 * and `#server/app.ts`'s 404.
 *
 * BUILT HERE rather than taken off `VIEWS` or `SOURCES`, which answer it equally well and are gated
 * key-for-key against this in `#tests/unit/usecases.test.ts`. An import edge is priced by the module
 * it lands on: `VIEWS` lands on six compiled views — and through them on `abide/ui`'s mount and
 * `harness/measure` — so a server whose only question is "is this a name" would have compiled the
 * whole browser-side demo graph at boot. This module imports nothing, and that is what it is for.
 *
 * The list stays the source of truth because its ORDER is what `/demos` indexes in.
 */
export const USECASES_BY_NAME: Record<string, UseCase> = Object.fromEntries(
    USECASES.map((usecase) => [usecase.name, usecase]),
)
