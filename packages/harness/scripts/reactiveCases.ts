// THE CASES, HOMED WHERE BOTH SUBSTRATES CAN IMPORT THEM. `bun run bench:reactive`
// runs these under JSC and the browser injectable runs the SAME bytes under V8 and
// under WebKit — which is the whole of CLAUDE.md's substrate rule: the same graph
// measured 1.67x a hand-written signal in one engine and 0.21x in another, INVERTED
// rather than scaled, so a design decision taken on one engine's numbers is taken on a
// coin flip.
//
// In `scripts/` rather than under `src/measure/` deliberately: this imports abide, and
// `harness/measure` has no abide in its graph at all — the property `lanes.test.ts`
// walks by resolution, and the reason the harness is a package.

import { flushSync, reactive, structural, watch } from 'abide'
import { carelessSignal, signal } from 'harness/measure/vanilla'

// Defeats dead-code elimination without allocating: every read writes here.
let sink: unknown

/** One reactive bench case: a hand-written arm, an abide arm, and the work each does. */
type Case = {
    name: string
    /**
     * What the case is FOR. A benchmark case earns its place by DISTINGUISHING
     * implementations, not by being representative.
     */
    distinguishes: string
    vanilla: () => void
    abide: () => void
    /**
     * Work counts, taken in a separate pass over the SAME closures the timer runs.
     *
     * Counting and timing cannot share a pass, and the work cannot come off a replica either: a
     * fresh graph or a scripted sequence agrees with itself whatever the timed arm does, so two
     * arms that had drifted apart would read as agreeing.
     */
    work: () => WorkPair
}

type WorkPair = {
    vanilla: Record<string, number>
    abide: Record<string, number>
}

/**
 * Runs each timed arm `ops` times and reports how far its counter moved.
 *
 * THE COUNTER LIVES IN THE TIMED GRAPH, in a callback both arms have — a subscriber, a derived
 * body — so the increment is priced alike on each side, and the delta is taken across the arm's
 * own op rather than a re-enactment of it.
 */
function countedOver(
    field: string,
    arms: { vanilla: () => void; abide: () => void },
    counters: { vanilla: () => number; abide: () => number },
    ops = 1,
): WorkPair {
    const handBefore = counters.vanilla()
    for (let at = 0; at < ops; at += 1) arms.vanilla()
    const handMoved = counters.vanilla() - handBefore
    const abideBefore = counters.abide()
    for (let at = 0; at < ops; at += 1) arms.abide()
    return {
        vanilla: { [field]: handMoved },
        abide: { [field]: counters.abide() - abideBefore },
    }
}

/**
 * Case: making a reactive value against making a hand-written signal.
 *
 * CONSTRUCTION, WHICH NOTHING HERE PRICED. Every other case builds its values in setup
 * and times what happens to them afterwards, so the cost of MAKING one was invisible —
 * and it was 547 ns against the hand-written arm's 15, a 36x ratio and two orders of
 * magnitude over the read it precedes. A table builds one of these per cell per row, so
 * it is walked more often than most of what follows.
 *
 * The two forms are separate rows because they allocate differently: the value form is
 * a callable and its fields, the body form is that plus a first run under tracking.
 *
 * BOTH ROWS RUN A NOISY A/A FLOOR — 1% to 13% across runs, where the ops that only read
 * and write settle under 1%. Construction is the one thing here that allocates per
 * operation, so the sample carries whatever collection it triggered, and `ratio()`
 * classifies against the floor it measured rather than against a fixed bar. The ratios
 * are several times the worst floor seen; a change worth believing here moves them by
 * more than that, and is confirmed by a second run.
 */
function constructValue(): Case {
    const vanilla = (): void => {
        sink = signal(1)
    }
    const abide = (): void => {
        sink = reactive(1)
    }
    return {
        name: 'construct a value',
        distinguishes:
            'the cost of MAKING a reactive value rather than using one — the op a table pays once per cell per row, and the one every other case here hides in its setup',
        vanilla,
        abide,
        // WHAT EACH ARM MADE, read back: the value the timed op built holds what it was given.
        work: () => {
            vanilla()
            const hand = (sink as { read(): number }).read()
            abide()
            return {
                vanilla: { holds: hand },
                abide: { holds: (sink as () => number)() },
            }
        },
    }
}

function constructDerived(): Case {
    let handRuns = 0
    let abideRuns = 0
    const vanilla = (): void => {
        const held = signal(1)
        const node = handDerived([held], () => {
            handRuns += 1
            return held.read() * 2
        })
        node.read()
        sink = node
    }
    const abide = (): void => {
        const source = reactive(1)
        sink = reactive(() => {
            abideRuns += 1
            return source() * 2
        })
    }
    return {
        name: 'construct a source and a value derived from it',
        distinguishes:
            'construction plus the first run under tracking, against a hand-written dirty-flag node subscribing to its source',
        // THE SOURCE IS FRESH PER OP, and it has to be: a derived node SUBSCRIBES, so a
        // shared source would grow a reader per operation and the case would price an
        // array climbing into the millions rather than a construction. Both arms build
        // the same two nodes and the same one edge.
        //
        // BOTH ARMS COMPUTE ONCE, and the hand-written one has to be TOLD to: its `dirty: true`
        // computes on the first `read`, where abide's first run is at construction (3.16).
        // Without the read the ratio is a construction against a construction plus a run, and
        // `work` counts 0 body runs against 1.
        vanilla,
        abide,
        work: () =>
            countedOver(
                'bodyRuns',
                { vanilla, abide },
                { vanilla: () => handRuns, abide: () => abideRuns },
            ),
    }
}

function readSettled(): Case {
    const held = signal(41)
    const value = reactive(41)
    const vanilla = (): void => {
        sink = held.read()
    }
    const abide = (): void => {
        sink = value()
    }
    return {
        name: 'read a settled value',
        distinguishes:
            'the cost of a read that finds a landed value — the hottest path in the design, walked per template slot per row',
        vanilla,
        abide,
        // WHAT THE READ RETURNED, off the timed op. A read wakes nothing on either arm, so there
        // is no counter to move — the answer is the one thing the op produces.
        work: () => {
            vanilla()
            const hand = sink as number
            abide()
            return {
                vanilla: { read: hand },
                abide: { read: sink as number },
            }
        },
    }
}

function writeChanged(): Case {
    const held = signal(0)
    const value = reactive(0)
    let handWakes = 0
    let abideWakes = 0
    held.subscribe(() => {
        handWakes += 1
    })
    value.watch(() => {
        abideWakes += 1
    })
    flushSync()
    let flip = 0
    let flop = 0
    const vanilla = (): void => {
        flip = flip === 0 ? 1 : 0
        held.write(flip)
    }
    const abide = (): void => {
        flop = flop === 0 ? 1 : 0
        value.set(flop)
        // THE TURN IS ENDED INSIDE THE OP. An effect is batched to the end of one, so
        // a timed loop of n writes would run the effect ONCE for the whole batch while
        // the hand-written arm runs its subscriber n times — the ratio of two
        // different jobs, and the work counts would say so only if somebody looked.
        flushSync()
    }
    return {
        name: 'write a value that changed',
        distinguishes:
            'the write path with one subscriber attached — both arms must wake, so this is cost with the work held equal',
        vanilla,
        abide,
        work: () =>
            countedOver(
                'wakes',
                { vanilla, abide },
                { vanilla: () => handWakes, abide: () => abideWakes },
            ),
    }
}

/**
 * Case: ten writes in one handler, which abide batches into one wake.
 *
 * WHAT THE BATCH BUYS, and the case the one above cannot show. A handler that writes the
 * same value ten times is a loop, a reducer applying ten actions, a drag moving a
 * coordinate — and only the last of the ten is ever seen. The hand-written arm runs its
 * subscriber ten times because it has nowhere to put the other nine; abide runs it once at
 * the end of the turn.
 *
 * THE WORK DISAGREES ON PURPOSE AND THE TIMING IS NOT THE CLAIM. Ten wakes against one is
 * the claim; the ratio beside it reads the wrong way round because the hand-written arm's
 * subscriber is `() => {}` and saving nine calls to nothing saves nothing. What a saved
 * wake is actually worth is counted where it lands — `packages/abide/tests/dom.test.ts`
 * puts the same ten writes through a binding and reports 10 `.data` writes against 1.
 */
function writeTenTimes(): Case {
    let handWakes = 0
    let abideWakes = 0
    const held = signal(0)
    held.subscribe(() => {
        handWakes += 1
    })
    const value = reactive(0)
    value.watch(() => {
        abideWakes += 1
    })
    flushSync()
    // FROM 1, so the first write differs from the 0 both hold and the first op is ten changes too.
    let handAt = 1
    let abideAt = 1
    const vanilla = (): void => {
        for (let step = 0; step < 10; step += 1) held.write(handAt++)
    }
    const abide = (): void => {
        for (let step = 0; step < 10; step += 1) value.set(abideAt++)
        flushSync()
    }
    return {
        name: 'ten writes in one handler',
        distinguishes:
            'the batch: a turn that writes the same value ten times reaches its reader once, where an arm with nowhere to hold the intermediate values reaches it ten times',
        vanilla,
        abide,
        work: () =>
            countedOver(
                'wakes',
                { vanilla, abide },
                { vanilla: () => handWakes, abide: () => abideWakes },
            ),
    }
}

/**
 * Case: writing a fresh equal object under the default reference compare.
 *
 * THE DEFAULT, PRICED HONESTLY. Both arms compare by reference, so a fresh object with
 * the same contents wakes on both — the work AGREES, and what is left is the cost of
 * abide's write path against a bare assignment. This is the case that used to disagree,
 * and it stopped disagreeing when the default changed.
 */
function writeEqualObject(): Case {
    const held = signal({ id: 1, total: 100 })
    const value = reactive({ id: 1, total: 100 })
    let handWakes = 0
    let abideWakes = 0
    held.subscribe(() => {
        handWakes += 1
    })
    value.watch(() => {
        abideWakes += 1
    })
    flushSync()
    const vanilla = (): void => {
        held.write({ id: 1, total: 100 })
    }
    const abide = (): void => {
        value.set({ id: 1, total: 100 })
        flushSync()
    }
    return {
        name: 'write a re-materialised equal value, default identity',
        distinguishes:
            'the write path with a fresh object and a reference compare on both arms — cost with the work held equal',
        vanilla,
        abide,
        work: () =>
            countedOver(
                'wakes',
                { vanilla, abide },
                { vanilla: () => handWakes, abide: () => abideWakes },
            ),
    }
}

/**
 * Case: writing a fresh equal object with `structural` declared.
 *
 * WHAT DECLARING `structural` COSTS AND BUYS, which is now the app's decision rather
 * than the framework's. The walk is paid on EVERY write; the wake it saves is only
 * collected when the payload really is equal. An app names it on the values where
 * re-materialisation is the common case, and this is the number that decision is made
 * against.
 */
function writeEqualObjectStructural(): Case {
    const held = signal({ id: 1, total: 100 })
    const value = reactive({ id: 1, total: 100 }, { identity: structural })
    let handWakes = 0
    let abideWakes = 0
    held.subscribe(() => {
        handWakes += 1
    })
    value.watch(() => {
        abideWakes += 1
    })
    flushSync()
    const vanilla = (): void => {
        held.write({ id: 1, total: 100 })
    }
    const abide = (): void => {
        value.set({ id: 1, total: 100 })
        flushSync()
    }
    return {
        name: 'write a re-materialised equal value, structural declared',
        distinguishes:
            'the option an app passes where a reload rebuilds an equal payload — a deep walk per write against a wake per write',
        vanilla,
        abide,
        work: () =>
            countedOver(
                'wakes',
                { vanilla, abide },
                { vanilla: () => handWakes, abide: () => abideWakes },
            ),
    }
}

/**
 * Case: write a source, then read a value derived from it.
 *
 * The hand-written arm has no derived value, so one is written here rather than
 * borrowed: dirty-flag plus recompute-on-read, which is what an author writes when
 * they do not have a framework. Anything less is not a comparison.
 */
function derived(): Case {
    let handRecomputes = 0
    let abideRecomputes = 0
    const held = signal(1)
    let cached = held.read() * 2
    let dirty = false
    held.subscribe(() => {
        dirty = true
    })
    const readDerived = (): number => {
        if (dirty) {
            handRecomputes += 1
            cached = held.read() * 2
            dirty = false
        }
        return cached
    }

    const source = reactive(1)
    const doubled = reactive(() => {
        abideRecomputes += 1
        return source() * 2
    })

    // FROM 1, the value the source holds, so the first op writes 0 and is a change.
    let flip = 1
    let flop = 1
    const vanilla = (): void => {
        flip = flip === 0 ? 1 : 0
        held.write(flip)
        sink = readDerived()
    }
    const abide = (): void => {
        flop = flop === 0 ? 1 : 0
        source.set(flop)
        sink = doubled()
    }
    return {
        name: 'write a source, then read what derives from it',
        distinguishes:
            'the recompute path — a dirty flag and a lazy read against a marked body pulled forward by the read',
        vanilla,
        abide,
        work: () =>
            countedOver(
                'recomputes',
                { vanilla, abide },
                {
                    vanilla: () => handRecomputes,
                    abide: () => abideRecomputes,
                },
            ),
    }
}

/**
 * Case: a source change that leaves the derived value unchanged.
 *
 * WHAT THE RECOMPUTE PATH BUYS, and the case the previous one cannot answer. A source
 * that changes without changing what derives from it: the vanilla arm's dirty flag
 * cannot tell, so everything downstream re-runs; the abide arm compares the recomputed
 * value and stops there. This is the ratio's other half — the previous case prices the
 * cost, this one prices what it is for, and neither is the claim alone.
 */
function derivedUnchanged(): Case {
    let handWakes = 0
    let abideWakes = 0
    const held = signal(1)
    let dirty = false
    held.subscribe(() => {
        dirty = true
    })
    const readDerived = (): boolean => {
        if (dirty) dirty = false
        return held.read() > 0
    }

    const source = reactive(1)
    const positive = reactive(() => source() > 0)
    // A downstream reader on both arms, so the wake each arm causes is a wake into
    // something — and the counter is in that reader on both, so it is priced alike.
    positive.watch(() => {
        abideWakes += 1
    })
    flushSync()

    let flip = 1
    let flop = 1
    const vanilla = (): void => {
        flip = flip === 1 ? 2 : 1
        held.write(flip)
        if (dirty) {
            handWakes += 1
            sink = readDerived()
        }
    }
    const abide = (): void => {
        flop = flop === 1 ? 2 : 1
        source.set(flop)
        flushSync()
    }
    return {
        name: 'a source changes without changing what derives from it',
        distinguishes:
            'the identity gate on a recompute — a dirty flag wakes everything downstream, a production the identity gate collapses wakes nothing',
        vanilla,
        abide,
        work: () =>
            countedOver(
                'downstreamWakes',
                { vanilla, abide },
                { vanilla: () => handWakes, abide: () => abideWakes },
                2,
            ),
    }
}

/**
 * Case: append to a capped array and walk it.
 *
 * A CHANNEL IS AN ARRAY: an app that keeps the last hundred messages pushes into one with `patch`
 * and trims it, and a reader walks what is held. Both arms do the same job — push, shift past the
 * cap, walk — so what is left is the cost of `patch`'s write recording and wake against the bare
 * array.
 */
function appendToCappedArrayAndWalk(): Case {
    const DEPTH = 100
    const rows: number[] = []
    const room = reactive<number[]>([])
    let at = 0
    let handWalked = 0
    let abideWalked = 0
    const vanilla = (): void => {
        rows.push(at++)
        if (rows.length > DEPTH) rows.shift()
        let total = 0
        for (const row of rows) total += row
        handWalked = rows.length
        sink = total
    }
    const abide = (): void => {
        room.patch((list) => {
            list.push(at++)
            if (list.length > DEPTH) list.shift()
        })
        let total = 0
        let walked = 0
        for (const row of room()) {
            total += row
            walked += 1
        }
        abideWalked = walked
        sink = total
    }
    return {
        name: 'append to a capped array and walk it',
        distinguishes:
            'a channel kept as an array — a patch that must not cost more than the push it records, and the array walked by the consumer that wants it',
        vanilla,
        abide,
        // Both arms walk the same window, or the timings price two different jobs. Run past
        // the cap, so the window counted is the full one rather than a warm-up's.
        work: () => {
            for (let index = 0; index <= DEPTH; index += 1) {
                vanilla()
                abide()
            }
            return {
                vanilla: { walked: handWalked },
                abide: { walked: abideWalked },
            }
        },
    }
}

/**
 * Returns the dead-code-elimination sink every arm writes.
 *
 * `sink` exists to defeat dead-code elimination — every arm writes it, and an unread
 * write is exactly what an optimiser removes. Read once, so the linter does not read it
 * as dead, which it is not.
 */
export function sinkValue(): unknown {
    return sink
}

// ── GRAPH SHAPES ─────────────────────────────────────────────────────────────────
//
// Every case above is one source and one reader, which is the topology that HIDES what
// this core does. Sharing is what creates re-walks: a probe over a 26-cell layered DAG
// was counted at 19,660 edge visits where the graph has 130 edges, and a tree of the
// same depth costs exactly its edges. So the shapes below vary fan-out, fan-in, depth
// and sharing independently, and each reports BODY RUNS beside its timing — the count
// is contention-immune and is what an asymptote shows up in first.
//
// THE VANILLA ARM IS THE PATTERN AN AUTHOR WRITES, REPLICATED. `harness/measure/vanilla`
// stays `let value; const subscribers = []` and is not grown; a dirty flag plus
// recompute-on-read is what somebody without a framework writes per derived node, and
// building a topology out of those is the fair comparison. Anything less is not one.

type Subscribable = { subscribe(reader: () => void): () => void }

type HandWritten = Subscribable & { read(): number }

/**
 * A hand-written derived node: eager dirty push, recompute pulled on read.
 *
 * The hand-written derived node, and it has to be SUBSCRIBABLE or a chain cannot be
 * built out of it: a dirty flag that nothing propagates makes every node above the
 * first stale forever. Dirtiness pushes eagerly and the recompute is pulled on the
 * read, which is what an author writes and is the pattern the whole comparison is
 * against.
 */
function handDerived(
    sources: Subscribable[],
    compute: () => number,
): HandWritten {
    let cached = 0
    let dirty = true
    const subscribers: (() => void)[] = []
    const soil = (): void => {
        if (dirty) return
        dirty = true
        for (let index = 0; index < subscribers.length; index += 1)
            (subscribers[index] as () => void)()
    }
    for (let index = 0; index < sources.length; index += 1)
        (sources[index] as Subscribable).subscribe(soil)
    return {
        read(): number {
            if (dirty) {
                cached = compute()
                dirty = false
            }
            return cached
        },
        subscribe(reader: () => void): () => void {
            subscribers.push(reader)
            return (): void => {
                const at = subscribers.indexOf(reader)
                if (at >= 0) subscribers.splice(at, 1)
            }
        },
    }
}

/**
 * Case: one source, `width` readers, one read after the write.
 *
 * ONE SOURCE, MANY READERS. A write has to reach all of them; a read of one must not
 * pay for the other nine. This is a row's worth of cells over one record.
 */
function fanOut(width: number): Case {
    let handRuns = 0
    let abideRuns = 0
    const held = signal(0)
    const hand: HandWritten[] = []
    for (let index = 0; index < width; index += 1)
        hand.push(
            handDerived([held], () => {
                handRuns += 1
                return held.read() + index
            }),
        )

    const source = reactive(0)
    const derivedValues: (() => number)[] = []
    for (let index = 0; index < width; index += 1)
        derivedValues.push(
            reactive(() => {
                abideRuns += 1
                return source() + index
            }) as unknown as () => number,
        )

    let flip = 0
    let flop = 0
    const vanilla = (): void => {
        flip = flip === 0 ? 1 : 0
        held.write(flip)
        sink = (hand[0] as HandWritten).read()
    }
    const abide = (): void => {
        flop = flop === 0 ? 1 : 0
        source.set(flop)
        sink = (derivedValues[0] as () => number)()
    }
    return {
        name: `fan-out to ${width} readers, one read after the write`,
        distinguishes:
            'a write that must reach every reader against a read that wants one of them — both arms mark the fan and run the one node that is read, so what is left is the cost of a mark',
        vanilla,
        abide,
        work: () =>
            countedOver(
                'bodyRuns',
                { vanilla, abide },
                { vanilla: () => handRuns, abide: () => abideRuns },
            ),
    }
}

/**
 * Case: `width` sources read by one body, one of them changes.
 *
 * MANY SOURCES, ONE READER. The cursor protocol's steady state: a body reading N values
 * in the same order every run should compare N pointers and mutate nothing.
 */
function fanIn(width: number): Case {
    const held: ReturnType<typeof signal<number>>[] = []
    for (let index = 0; index < width; index += 1) held.push(signal(index))
    let handRuns = 0
    let abideRuns = 0
    const hand = handDerived(held, () => {
        handRuns += 1
        let total = 0
        for (let index = 0; index < width; index += 1)
            total += (held[index] as { read(): number }).read()
        return total
    })

    const sources: ReturnType<typeof reactive<number>>[] = []
    for (let index = 0; index < width; index += 1) sources.push(reactive(index))
    const summed = reactive(() => {
        abideRuns += 1
        let total = 0
        for (let index = 0; index < width; index += 1)
            total += (sources[index] as () => number)()
        return total
    }) as unknown as () => number

    let flip = 0
    let flop = 0
    const vanilla = (): void => {
        flip = flip === 0 ? 1 : 0
        ;(held[0] as { write(value: number): void }).write(flip)
        sink = hand.read()
    }
    const abide = (): void => {
        flop = flop === 0 ? 1 : 0
        ;(sources[0] as { set(value: number): void }).set(flop)
        sink = summed()
    }
    return {
        name: `fan-in from ${width} sources, one changes`,
        distinguishes:
            'the cursor protocol in steady state — a body whose source order never changes should mutate nothing, and one source moving should not re-subscribe the other nine',
        vanilla,
        abide,
        work: () =>
            countedOver(
                'bodyRuns',
                { vanilla, abide },
                { vanilla: () => handRuns, abide: () => abideRuns },
            ),
    }
}

/**
 * Case: a layered DAG, every node reading every node of the layer below.
 *
 * FAN-IN AND FAN-OUT AT EVERY LEVEL — the shape where sharing makes a walk re-walk.
 * Each layer reads every node of the one below it, so the edge count is width squared
 * per level and every path from the top to the bottom is distinct.
 */
function layeredDag(width: number, depth: number): Case {
    function build<Node>(
        source: (index: number) => Node,
        derive: (below: Node[], index: number) => Node,
    ): Node {
        let layer: Node[] = []
        for (let index = 0; index < width; index += 1) layer.push(source(index))
        const base = layer
        for (let level = 1; level < depth; level += 1) {
            const next: Node[] = []
            for (let index = 0; index < width; index += 1)
                next.push(derive(layer, index))
            layer = next
        }
        void base
        return derive(layer, 0)
    }

    const handBase: ReturnType<typeof signal<number>>[] = []
    let handRuns = 0
    const handTop = build<HandWritten>(
        (index) => {
            const made = signal(index)
            handBase.push(made)
            return made as unknown as HandWritten
        },
        (below, index) =>
            handDerived(below, () => {
                handRuns += 1
                let total = index
                for (let at = 0; at < below.length; at += 1)
                    total += (below[at] as HandWritten).read()
                return total
            }),
    )

    const abideBase: ReturnType<typeof reactive<number>>[] = []
    let abideRuns = 0
    const abideTop = build<() => number>(
        (index) => {
            const made = reactive(index)
            abideBase.push(
                made as unknown as ReturnType<typeof reactive<number>>,
            )
            return made as unknown as () => number
        },
        (below, index) =>
            reactive(() => {
                abideRuns += 1
                let total = index
                for (let at = 0; at < below.length; at += 1)
                    total += (below[at] as () => number)()
                return total
            }) as unknown as () => number,
    )

    let flip = 0
    let flop = 0
    const vanilla = (): void => {
        flip = flip === 0 ? 1 : 0
        ;(handBase[0] as { write(value: number): void }).write(flip)
        sink = handTop.read()
    }
    const abide = (): void => {
        flop = flop === 0 ? 1 : 0
        ;(abideBase[0] as unknown as { set(value: number): void }).set(flop)
        sink = abideTop()
    }
    return {
        name: `layered DAG ${width} wide x ${depth} deep, one base value changes`,
        distinguishes:
            'sharing at every level — a walk that guards the STACK rather than what it has VISITED re-walks each shared subgraph once per path, which is an asymptote rather than a constant',
        vanilla,
        abide,
        work: () =>
            countedOver(
                'bodyRuns',
                { vanilla, abide },
                { vanilla: () => handRuns, abide: () => abideRuns },
            ),
    }
}

/**
 * Case: a chain `depth` deep — depth with no sharing.
 *
 * A DEEP CHAIN. No sharing at all, so it prices depth alone — the control that says
 * which of the DAG's cost is depth and which is sharing.
 */
function chain(depth: number): Case {
    let handRuns = 0
    let abideRuns = 0
    const held = signal(0)
    let handNode = handDerived([held], () => {
        handRuns += 1
        return held.read() + 1
    })
    for (let level = 1; level < depth; level += 1) {
        const below = handNode
        handNode = handDerived([below], () => {
            handRuns += 1
            return below.read() + 1
        })
    }

    const source = reactive(0)
    let node = reactive(() => {
        abideRuns += 1
        return source() + 1
    }) as unknown as () => number
    for (let level = 1; level < depth; level += 1) {
        const below = node
        node = reactive(() => {
            abideRuns += 1
            return below() + 1
        }) as unknown as () => number
    }

    let flip = 0
    let flop = 0
    const vanilla = (): void => {
        flip = flip === 0 ? 1 : 0
        held.write(flip)
        sink = handNode.read()
    }
    const abide = (): void => {
        flop = flop === 0 ? 1 : 0
        source.set(flop)
        sink = node()
    }
    return {
        name: `chain ${depth} deep`,
        distinguishes:
            "depth with no sharing — the control against the DAG, so the DAG's extra cost is attributable to sharing rather than to size",
        vanilla,
        abide,
        work: () =>
            countedOver(
                'bodyRuns',
                { vanilla, abide },
                { vanilla: () => handRuns, abide: () => abideRuns },
            ),
    }
}

/**
 * Case: a body whose source order alternates every run.
 *
 * THE CURSOR PROTOCOL'S WORST CASE. A body whose source order ALTERNATES diverges on
 * every run: the cursor misses, the tail is detached and rebuilt, and every source is
 * re-subscribed. 14.15 warns on exactly this shape, and this is what the warning costs.
 */
function alternatingSources(): Case {
    let handRuns = 0
    let abideRuns = 0
    const flagHeld = signal(true)
    const left = signal(1)
    const right = signal(2)
    const hand = handDerived([flagHeld, left, right], () => {
        handRuns += 1
        return flagHeld.read() ? left.read() : right.read()
    })

    const flag = reactive(true)
    const one = reactive(1)
    const two = reactive(2)
    const picked = reactive(() => {
        abideRuns += 1
        return flag() ? one() : two()
    }) as unknown as () => number

    let handFlag = true
    let abideFlag = true
    const vanilla = (): void => {
        handFlag = !handFlag
        flagHeld.write(handFlag)
        sink = hand.read()
    }
    const abide = (): void => {
        abideFlag = !abideFlag
        flag.set(abideFlag)
        sink = picked()
    }
    type Source = { bump(): void }
    // BODY RUNS AND THE EDGES THE OP MOVED, on the timed graph. Neither arm exposes its
    // subscription list, so an edge is counted by what it DOES: a source REACHES the body
    // when writing it makes the next read re-run the body. The source the op stops reading is
    // asked after it (`edgesDropped` is 1 if it no longer reaches), and the one it starts
    // reading before and after (`edgesAdded` is 1 if it reaches only once the op has run).
    function counted(
        op: () => void,
        read: () => void,
        runs: () => number,
        reading: () => { now: Source; next: Source },
    ): Record<string, number> {
        const reaches = (source: Source): number => {
            const before = runs()
            source.bump()
            read()
            return runs() > before ? 1 : 0
        }
        read()
        const { now, next } = reading()
        const nextBefore = reaches(next)
        const before = runs()
        op()
        const bodyRuns = runs() - before
        return {
            bodyRuns,
            edgesDropped: 1 - reaches(now),
            edgesAdded: reaches(next) - nextBefore,
        }
    }
    const handLeft = { bump: () => left.write(left.read() + 1) }
    const handRight = { bump: () => right.write(right.read() + 1) }
    const abideLeft = { bump: () => one.set(one() + 1) }
    const abideRight = { bump: () => two.set(two() + 1) }
    return {
        name: 'a body whose source alternates every run',
        distinguishes:
            'the cursor protocol when it always misses — a stable body mutates nothing, and this one detaches and re-subscribes on every single run',
        vanilla,
        abide,
        // The hand-written node subscribes to all three once and re-subscribes nothing, so
        // the edge rows DISAGREE, 0 against 1 — the hand-written arm is the superset
        // subscription somebody writes, and this is the re-subscription it never pays.
        work: () => ({
            vanilla: counted(
                vanilla,
                () => void hand.read(),
                () => handRuns,
                () =>
                    handFlag
                        ? { now: handLeft, next: handRight }
                        : { now: handRight, next: handLeft },
            ),
            abide: counted(
                abide,
                () => void picked(),
                () => abideRuns,
                () =>
                    abideFlag
                        ? { now: abideLeft, next: abideRight }
                        : { now: abideRight, next: abideLeft },
            ),
        }),
    }
}

/**
 * Case: one source read `times` times in one body.
 *
 * ONE VALUE READ MANY TIMES IN ONE BODY — a template with several slots over one record.
 * The cursor matches each read in order, so the list holds the same value repeatedly and
 * the dedupe in `track` is what keeps the wake count at one.
 */
function repeatedReads(times: number): Case {
    let handRuns = 0
    let abideRuns = 0
    const held = signal(1)
    const hand = handDerived([held], () => {
        handRuns += 1
        let total = 0
        for (let index = 0; index < times; index += 1) total += held.read()
        return total
    })

    const source = reactive(1)
    const summed = reactive(() => {
        abideRuns += 1
        let total = 0
        for (let index = 0; index < times; index += 1) total += source()
        return total
    }) as unknown as () => number

    let flip = 1
    let flop = 1
    const vanilla = (): void => {
        flip = flip === 1 ? 2 : 1
        held.write(flip)
        sink = hand.read()
    }
    const abide = (): void => {
        flop = flop === 1 ? 2 : 1
        source.set(flop)
        sink = summed()
    }
    return {
        name: `one source read ${times} times in one body`,
        distinguishes:
            'a duplicate in the source list — the cursor must match it each time and the reader must still be woken exactly once',
        vanilla,
        abide,
        work: () =>
            countedOver(
                'bodyRuns',
                { vanilla, abide },
                { vanilla: () => handRuns, abide: () => abideRuns },
            ),
    }
}

/**
 * Case: a `busy` probe over a settled, shared DAG.
 *
 * THE PROBE OVER A SETTLED, SHARED GRAPH — the case a stack guard cannot survive and a
 * visited stamp makes linear. It is the ALL-IDLE graph on purpose: the walk
 * short-circuits on a busy node, so the exhaustive traversal is the spinner read that
 * renders no spinner, which is the one a frame takes over and over.
 */
function probeSettledDag(width: number, depth: number): Case {
    type HandNode = { busy: boolean; sources: HandNode[] }
    function handLayer(): HandNode {
        let layer: HandNode[] = []
        for (let index = 0; index < width; index += 1)
            layer.push({ busy: false, sources: [] })
        for (let level = 1; level < depth; level += 1) {
            const next: HandNode[] = []
            for (let index = 0; index < width; index += 1)
                next.push({ busy: false, sources: layer })
            layer = next
        }
        return { busy: false, sources: layer }
    }
    const handTop = handLayer()
    // The hand-written arm walks with a VISITED set, because that is what somebody
    // writing this by hand reaches for — the comparison is against competent code.
    const seen = new Set<HandNode>()
    function anyBusy(node: HandNode): boolean {
        if (node.busy) return true
        if (seen.has(node)) return false
        seen.add(node)
        for (let index = 0; index < node.sources.length; index += 1)
            if (anyBusy(node.sources[index] as HandNode)) return true
        return false
    }

    let layer: (() => number)[] = []
    for (let index = 0; index < width; index += 1)
        layer.push(reactive(index) as unknown as () => number)
    for (let level = 1; level < depth; level += 1) {
        const below = layer
        const next: (() => number)[] = []
        for (let index = 0; index < width; index += 1)
            next.push(
                reactive(() => {
                    let total = index
                    for (let at = 0; at < below.length; at += 1)
                        total += (below[at] as () => number)()
                    return total
                }) as unknown as () => number,
            )
        layer = next
    }
    const below = layer
    const top = reactive(() => {
        let total = 0
        for (let at = 0; at < below.length; at += 1)
            total += (below[at] as () => number)()
        return total
    }) as unknown as (() => number) & { busy(): boolean }
    top()

    const vanilla = (): void => {
        seen.clear()
        sink = anyBusy(handTop)
    }
    const abide = (): void => {
        sink = top.busy()
    }
    return {
        name: `probe a settled DAG ${width} wide x ${depth} deep`,
        distinguishes:
            'a probe walk over a SHARED graph — a guard that tracks the stack re-walks each shared subgraph once per path, where one that tracks what it visited walks each edge once',
        vanilla,
        abide,
        // THE ANSWER EACH ARM GAVE, taken from the timed op rather than written down: an
        // all-idle graph probes not-busy in both. How many nodes abide's walk VISITED has no
        // public counter — `WORK.descents` counts the mark walk, not this one — so the visit
        // count that tells a stack guard from a visited stamp is not on this record.
        work: () => {
            vanilla()
            const hand = sink === true ? 1 : 0
            abide()
            return {
                vanilla: { busy: hand },
                abide: { busy: sink === true ? 1 : 0 },
            }
        },
    }
}

/**
 * Case: an equal write against a hand-written arm that notifies unconditionally.
 *
 * WHAT THE MACHINERY BUYS, which is the other half of every ratio above. The CAREFUL
 * hand-written arm already carries an identity check, so those rows price abide
 * against a guard somebody had to know to write. These two price it against the
 * version most people write first — an unconditional notify — and the answer goes the
 * other way.
 *
 * READERS ARE THE POINT. With nobody subscribed a careless write is a store and the
 * two arms are level; the cost only exists where somebody is listening, so the width
 * is the case. 100 is a table with a bound cell per row, not a stress test.
 */
function equalWriteAgainstCareless(width: number, fresh: boolean): Case {
    const name = fresh
        ? `a re-materialised equal value, ${width} readers, structural vs CARELESS`
        : `a write of the value already held, ${width} readers, vanilla written CARELESSLY`
    const make = (): { id: number; total: number } => ({ id: 1, total: 100 })
    const standing = make()
    // SEEDED WITH THE VALUE THE WRITE WRITES, so "already held" is true on the first
    // write and not only from the second.
    const held = carelessSignal(fresh ? make() : standing)
    const value = fresh
        ? reactive(make(), { identity: structural })
        : reactive(standing)
    // THE READER BODY IS ONE FIELD INCREMENT AND NOTHING ELSE, because only the
    // hand-written arm ever runs it — the counter is not priced alike on both sides
    // here, it is priced on one, and with 100 readers it IS the vanilla arm. Measured
    // in chromium on the held-value row: `sink = next` plus a captured `let` counter
    // 495 ns, the `let` alone 420, `sink = next` alone 350, this 121 — a store into a
    // captured or module `let` is 2-3 ns a wake dearer than a field under V8. The dear
    // body inflated the ratio in abide's favor, and since n is sized by abide's 6 ns
    // op, every vanilla batch was ~1.1 s and the row ran out the injectable's 20 s
    // budget.
    const wakes = { hand: 0, abide: 0 }
    for (let at = 0; at < width; at += 1) {
        held.subscribe(() => {
            wakes.hand += 1
        })
        value.watch(() => {
            wakes.abide += 1
        })
    }
    flushSync()
    const vanilla = (): void => {
        held.write(fresh ? make() : standing)
    }
    const abide = (): void => {
        value.set(fresh ? make() : standing)
        flushSync()
    }
    return {
        name,
        distinguishes:
            'what the gate BUYS rather than what it costs — abide skips the wake and this arm wakes every reader on a write that moved nothing, which is the version most people write first',
        vanilla,
        abide,
        work: () =>
            countedOver(
                'wakes',
                { vanilla, abide },
                { vanilla: () => wakes.hand, abide: () => wakes.abide },
            ),
    }
}

/**
 * Case: mount and tear down `width` readers on one value.
 *
 * THE SUBSCRIBE PATH, WHICH NOTHING HERE PRICED. Every fan-out case builds its readers in
 * SETUP and times the write afterwards, so the cost of a reader ARRIVING on a value was
 * invisible to the whole bench — and it was quadratic: `track` deduped by scanning
 * `source.readers`, whose length is the number of readers already on the value, so mounting
 * n of them was n²/2 pointer compares. Per reader under JSC: 446 ns at n=500 rising to
 * 3,872 ns at n=8000, which put a 30.98 ms mount on the click that opens a long list.
 * Deduping from the reader's own `sources` prefix instead — as long as what this BODY reads
 * rather than how many readers the VALUE has — is 0.45 ms at the same width.
 *
 * THE OP IS A MOUNT AND A TEARDOWN, both arms, so neither is left holding what the other
 * dropped. FIFTY readers, and the width is chosen by the batcher rather than by the claim: at
 * 200 the op is 26.7 µs, which clears the clock bar at n=1, and a sample of one op under a
 * frame is what `ratio()` refuses — so the row came out `underOneFrame` and was a figure
 * rather than a claim. At 50 the batcher takes n=4 and the ratio resolves.
 *
 * WHAT THE ROW IS WORTH, run both ways: 1.67x with the reader-side dedup and 2.21x with it
 * out, against an A/A floor of 3-7%. What it distinguishes is a CONSTANT the subscribe path
 * grows, because it is abide against the hand-written arm at ONE width — a constant is exactly
 * what a same-structure ratio divides out, so this row and `mountingIsLinear` in
 * `benchReactive.ts` cover different regressions and neither subsumes the other.
 *
 * THE SLOPE IS `mountingIsLinear`'S, at 16 against 112 with a calibrated bar. It is worth
 * reading that function's header before touching either: a first attempt at it compared against
 * what a COMPLEXITY CLASS predicts (4x linear, 16x quadratic) and reported the mechanism out as
 * holding, because at any priceable width `watch` construction dominates and the n² term is a
 * minority of the op. The bar has to be set by what the fixed mechanism measures.
 *
 * THE PER-READER FIGURES in `track`'s own comment are the third record and the widest — 446 ns
 * rising to 3,872 ns against ~60 ns flat, measured directly at n=500 through n=8000, where
 * neither of the two rows reaches past 112. Those are a measurement to re-run rather than a
 * gate; the gate that runs in `bun test` is the dedup's subscription count in `reactive.test.ts`.
 */

function mountReaders(width: number): Case {
    let handMounted = 0
    let abideMounted = 0
    const vanilla = (): void => {
        const held = signal(0)
        const stops: (() => void)[] = []
        for (let index = 0; index < width; index += 1) {
            stops.push(
                held.subscribe(() => {
                    sink = held.read()
                }),
            )
            sink = held.read()
            handMounted += 1
        }
        for (const stop of stops) stop()
    }
    const abide = (): void => {
        const source = reactive(0)
        const stops: (() => void)[] = []
        for (let index = 0; index < width; index += 1)
            stops.push(
                watch(() => {
                    sink = source()
                    abideMounted += 1
                }),
            )
        for (const stop of stops) stop()
    }
    return {
        name: `mount ${width} readers on one value`,
        distinguishes:
            'the subscribe path, which every fan-out case builds in setup and never times — a dedup scanned per arriving reader against one scanned per value the body reads, which is the difference between quadratic in the reader count and flat',
        vanilla,
        abide,
        // BOTH ARMS HOLD THE SAME FAN while they are up, which is what makes the timings
        // comparable: an arm that subscribed fewer readers would be a cheaper different job.
        // A watch's mount IS its first run, so the abide count is taken in the body; the
        // hand-written subscriber runs on a write and none comes, so it is taken beside
        // the subscribe.
        work: () =>
            countedOver(
                'subscribed',
                { vanilla, abide },
                { vanilla: () => handMounted, abide: () => abideMounted },
            ),
    }
}

// A KEYED VALUE, WHICH NOTHING HERE PRICED: every case above is an unkeyed value. Three ops,
// because the three touch different parts of a `Keyed` — MAKING one (its statics and entry map),
// REACHING an entry that stands (the key and the lookup), and a STATIC walking the entries
// (`ready` with no pattern, then `busy` narrowed by one). The hand-written arm is a map of
// records keyed the same way, so both arms walk the same entries and build the same key.
const KEYED_WIDTH = 8

function constructKeyed(): Case {
    // NO ENTRY IS BUILT BY MAKING ONE: an entry is the factory run once for its key, so the
    // abide arm counts factory runs and the hand-written arm counts what its map grew by.
    let handBuilt = 0
    let abideBuilt = 0
    const vanilla = (): void => {
        const entries = new Map<string, { ready: boolean }>()
        sink = (args: { id: number }) => entries.get(JSON.stringify(args))
        handBuilt += entries.size
    }
    const abide = (): void => {
        sink = reactive((args: { id: number }) => {
            abideBuilt += 1
            return args.id
        })
    }
    return {
        name: 'construct a keyed value',
        distinguishes:
            'the cost of MAKING a keyed factory — its entry map and its statics — before any key is reached',
        vanilla,
        abide,
        work: () =>
            countedOver(
                'built',
                { vanilla, abide },
                { vanilla: () => handBuilt, abide: () => abideBuilt },
            ),
    }
}

function reachKeyed(): Case {
    const handEntries = new Map<
        string,
        { args: { id: number }; value: number }
    >()
    let abideBuilt = 0
    const keyed = reactive((args: { id: number }) => {
        abideBuilt += 1
        return args.id
    })
    for (let index = 0; index < KEYED_WIDTH; index += 1) {
        handEntries.set(JSON.stringify({ id: index }), {
            args: { id: index },
            value: index,
        })
        keyed({ id: index })
    }
    let at = 0
    const vanilla = (): void => {
        at = (at + 1) % KEYED_WIDTH
        sink = handEntries.get(JSON.stringify({ id: at }))
    }
    const abide = (): void => {
        at = (at + 1) % KEYED_WIDTH
        sink = keyed({ id: at })
    }
    return {
        name: `reach a standing keyed entry among ${KEYED_WIDTH}`,
        distinguishes:
            'the reach that finds its entry already standing (1.8) — the key and the lookup, no entry built',
        vanilla,
        abide,
        // A FULL LAP OF THE TIMED REACHES, counting entries built during it: the factory's
        // runs for abide, the map's growth for the hand-written arm.
        work: () =>
            countedOver(
                'built',
                { vanilla, abide },
                {
                    vanilla: () => handEntries.size,
                    abide: () => abideBuilt,
                },
                KEYED_WIDTH,
            ),
    }
}

function probeKeyed(): Case {
    const handEntries = new Map<
        string,
        { args: { id: number }; ready: boolean; busy: boolean }
    >()
    let abideBuilt = 0
    const keyed = reactive((args: { id: number }) => {
        abideBuilt += 1
        return args.id
    })
    for (let index = 0; index < KEYED_WIDTH; index += 1) {
        handEntries.set(JSON.stringify({ id: index }), {
            args: { id: index },
            ready: true,
            busy: false,
        })
        sink = keyed({ id: index })()
    }
    const pattern = { id: KEYED_WIDTH - 1 }
    function handProbe(): boolean {
        let ready = true
        for (const entry of handEntries.values())
            if (!entry.ready) {
                ready = false
                break
            }
        let busy = false
        for (const entry of handEntries.values())
            if (entry.args.id === pattern.id && entry.busy) {
                busy = true
                break
            }
        return ready && !busy
    }
    const vanilla = (): void => {
        sink = handProbe()
    }
    const abide = (): void => {
        sink = keyed.ready() && !keyed.busy(pattern)
    }
    return {
        name: `probe a keyed value of ${KEYED_WIDTH} entries, whole and by pattern`,
        distinguishes:
            'a keyed STATIC walking its entries — where the statics live is what this reaches first',
        vanilla,
        abide,
        // WHAT THE PROBE ANSWERED, and what it BUILT doing so — a static walks the entries that
        // stand and builds none. How many entries abide's static walked has no public counter.
        work: () => {
            const built = countedOver(
                'built',
                { vanilla, abide },
                {
                    vanilla: () => handEntries.size,
                    abide: () => abideBuilt,
                },
            )
            const abideSettled = sink === true ? 1 : 0
            vanilla()
            return {
                vanilla: { settled: sink === true ? 1 : 0, ...built.vanilla },
                abide: { settled: abideSettled, ...built.abide },
            }
        },
    }
}

export const reactiveCases = (): Case[] => [
    constructKeyed(),
    reachKeyed(),
    probeKeyed(),
    constructValue(),
    constructDerived(),
    readSettled(),
    writeChanged(),
    writeTenTimes(),
    writeEqualObject(),
    writeEqualObjectStructural(),
    derived(),
    derivedUnchanged(),
    appendToCappedArrayAndWalk(),
    mountReaders(50),
    fanOut(10),
    fanOut(100),
    // A THOUSAND, because the two earlier widths only show the slope and this is where
    // it starts mattering: a 400-row table with a few derived cells per row is already
    // past it. This is the width that priced push-pull — a write ran a thousand bodies
    // and now marks a thousand flags, which is 10.82x the hand-written arm against 1.56x.
    fanOut(1000),
    fanIn(10),
    fanIn(100),
    fanIn(1000),
    chain(20),
    layeredDag(5, 3),
    layeredDag(5, 5),
    alternatingSources(),
    repeatedReads(5),
    probeSettledDag(5, 3),
    probeSettledDag(5, 5),
    equalWriteAgainstCareless(100, false),
    equalWriteAgainstCareless(100, true),
]

/** One case's reading in the page's engine, as `__REACTIVE_BENCH__` hands it back to the spec. */
export type ReactiveBenchRow = {
    case: string
    abide: number
    vanilla: number
    claim: string
    n: number
    floor: number
    substrate: string
    workDisagreement: string[]
}

export type { Case }
