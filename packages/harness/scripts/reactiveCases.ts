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

type Case = {
    name: string
    // What the case is FOR. A benchmark case earns its place by DISTINGUISHING
    // implementations, not by being representative.
    distinguishes: string
    vanilla: () => void
    abide: () => void
    // Wake counts, taken in a separate pass — counting and timing cannot share one.
    work: () => {
        vanilla: Record<string, number>
        abide: Record<string, number>
    }
}

// CONSTRUCTION, WHICH NOTHING HERE PRICED. Every other case builds its values in setup
// and times what happens to them afterwards, so the cost of MAKING one was invisible —
// and it was 547 ns against the hand-written arm's 15, a 36x ratio and two orders of
// magnitude over the read it precedes. A table builds one of these per cell per row, so
// it is walked more often than most of what follows.
//
// The two forms are separate rows because they allocate differently: the value form is
// a callable and its fields, the body form is that plus a first run under tracking.
//
// BOTH ROWS RUN A NOISY A/A FLOOR — 1% to 13% across runs, where the ops that only read
// and write settle under 1%. Construction is the one thing here that allocates per
// operation, so the sample carries whatever collection it triggered, and `ratio()`
// classifies against the floor it measured rather than against a fixed bar. The ratios
// are several times the worst floor seen; a change worth believing here moves them by
// more than that, and is confirmed by a second run.
function constructValue(): Case {
    return {
        name: 'construct a value',
        distinguishes:
            'the cost of MAKING a reactive value rather than using one — the op a table pays once per cell per row, and the one every other case here hides in its setup',
        vanilla: (): void => {
            sink = signal(1)
        },
        abide: (): void => {
            sink = reactive(1)
        },
        work: () => ({ vanilla: { values: 1 }, abide: { values: 1 } }),
    }
}

function constructDerived(): Case {
    return {
        name: 'construct a source and a value derived from it',
        distinguishes:
            'construction plus the first run under tracking, against a hand-written dirty-flag node subscribing to its source',
        // THE SOURCE IS FRESH PER OP, and it has to be: a derived node SUBSCRIBES, so a
        // shared source would grow a reader per operation and the case would price an
        // array climbing into the millions rather than a construction. Both arms build
        // the same two nodes and the same one edge.
        vanilla: (): void => {
            const held = signal(1)
            sink = handDerived([held], () => held.read() * 2)
        },
        abide: (): void => {
            const source = reactive(1)
            sink = reactive(() => source() * 2)
        },
        // Both arms build one node and compute it once — the hand-written node's first
        // `read` is what its `dirty: true` makes happen, and abide's is 3.16.
        work: () => ({
            vanilla: { values: 2, bodyRuns: 1 },
            abide: { values: 2, bodyRuns: 1 },
        }),
    }
}

function readSettled(): Case {
    const held = signal(41)
    const value = reactive(41)
    return {
        name: 'read a settled value',
        distinguishes:
            'the cost of a read that finds a landed value — the hottest path in the design, walked per template slot per row',
        vanilla: (): void => {
            sink = held.read()
        },
        abide: (): void => {
            sink = value()
        },
        work: () => ({ vanilla: { wakes: 0 }, abide: { wakes: 0 } }),
    }
}

function writeChanged(): Case {
    const held = signal(0)
    const value = reactive(0)
    held.subscribe(() => {})
    const stop = value.watch(() => {})
    void stop
    let flip = 0
    let flop = 0
    return {
        name: 'write a value that changed',
        distinguishes:
            'the write path with one subscriber attached — both arms must wake, so this is cost with the work held equal',
        vanilla: (): void => {
            flip = flip === 0 ? 1 : 0
            held.write(flip)
        },
        abide: (): void => {
            flop = flop === 0 ? 1 : 0
            value.set(flop)
            // THE TURN IS ENDED INSIDE THE OP. An effect is batched to the end of one, so
            // a timed loop of n writes would run the effect ONCE for the whole batch while
            // the hand-written arm runs its subscriber n times — the ratio of two
            // different jobs, and the work counts would say so only if somebody looked.
            flushSync()
        },
        work: () => {
            const one = signal(0)
            const two = reactive(0)
            let a = 0
            let b = 0
            one.subscribe(() => {
                a += 1
            })
            two.watch(() => {
                b += 1
            })
            b = 0
            one.write(1)
            two.set(1)
            flushSync()
            return { vanilla: { wakes: a }, abide: { wakes: b } }
        },
    }
}

// WHAT THE BATCH BUYS, and the case the one above cannot show. A handler that writes the
// same value ten times is a loop, a reducer applying ten actions, a drag moving a
// coordinate — and only the last of the ten is ever seen. The hand-written arm runs its
// subscriber ten times because it has nowhere to put the other nine; abide runs it once at
// the end of the turn.
//
// THE WORK DISAGREES ON PURPOSE AND THE TIMING IS NOT THE CLAIM. Ten wakes against one is
// the claim; the ratio beside it reads the wrong way round because the hand-written arm's
// subscriber is `() => {}` and saving nine calls to nothing saves nothing. What a saved
// wake is actually worth is counted where it lands — `packages/abide/tests/dom.test.ts`
// puts the same ten writes through a binding and reports 10 `.data` writes against 1.
function writeTenTimes(): Case {
    const held = signal(0)
    held.subscribe(() => {})
    const value = reactive(0)
    value.watch(() => {})
    let handAt = 0
    let abideAt = 0
    return {
        name: 'ten writes in one handler',
        distinguishes:
            'the batch: a turn that writes the same value ten times reaches its reader once, where an arm with nowhere to hold the intermediate values reaches it ten times',
        vanilla: (): void => {
            for (let step = 0; step < 10; step += 1) held.write(handAt++)
        },
        abide: (): void => {
            for (let step = 0; step < 10; step += 1) value.set(abideAt++)
            flushSync()
        },
        work: () => {
            let handWakes = 0
            let abideWakes = 0
            const one = signal(0)
            one.subscribe(() => {
                handWakes += 1
            })
            const two = reactive(0)
            two.watch(() => {
                abideWakes += 1
            })
            flushSync()
            abideWakes = 0
            for (let step = 1; step <= 10; step += 1) {
                one.write(step)
                two.set(step)
            }
            flushSync()
            return {
                vanilla: { wakes: handWakes },
                abide: { wakes: abideWakes },
            }
        },
    }
}

// THE DEFAULT, PRICED HONESTLY. Both arms compare by reference, so a fresh object with
// the same contents wakes on both — the work AGREES, and what is left is the cost of
// abide's write path against a bare assignment. This is the case that used to disagree,
// and it stopped disagreeing when the default changed.
function writeEqualObject(): Case {
    const held = signal({ id: 1, total: 100 })
    const value = reactive({ id: 1, total: 100 })
    held.subscribe(() => {})
    value.watch(() => {})
    return {
        name: 'write a re-materialised equal value, default identity',
        distinguishes:
            'the write path with a fresh object and a reference compare on both arms — cost with the work held equal',
        vanilla: (): void => {
            held.write({ id: 1, total: 100 })
        },
        abide: (): void => {
            value.set({ id: 1, total: 100 })
            flushSync()
        },
        work: () => {
            const one = signal({ id: 1, total: 100 })
            const two = reactive({ id: 1, total: 100 })
            let a = 0
            let b = 0
            one.subscribe(() => {
                a += 1
            })
            two.watch(() => {
                b += 1
            })
            b = 0
            one.write({ id: 1, total: 100 })
            two.set({ id: 1, total: 100 })
            flushSync()
            return { vanilla: { wakes: a }, abide: { wakes: b } }
        },
    }
}

// WHAT DECLARING `structural` COSTS AND BUYS, which is now the app's decision rather
// than the framework's. The walk is paid on EVERY write; the wake it saves is only
// collected when the payload really is equal. An app names it on the values where
// re-materialisation is the common case, and this is the number that decision is made
// against.
function writeEqualObjectStructural(): Case {
    const held = signal({ id: 1, total: 100 })
    const value = reactive({ id: 1, total: 100 }, { identity: structural })
    held.subscribe(() => {})
    value.watch(() => {})
    return {
        name: 'write a re-materialised equal value, structural declared',
        distinguishes:
            'the option an app passes where a reload rebuilds an equal payload — a deep walk per write against a wake per write',
        vanilla: (): void => {
            held.write({ id: 1, total: 100 })
        },
        abide: (): void => {
            value.set({ id: 1, total: 100 })
            flushSync()
        },
        work: () => {
            const one = signal({ id: 1, total: 100 })
            const two = reactive(
                { id: 1, total: 100 },
                { identity: structural },
            )
            let a = 0
            let b = 0
            one.subscribe(() => {
                a += 1
            })
            two.watch(() => {
                b += 1
            })
            b = 0
            one.write({ id: 1, total: 100 })
            two.set({ id: 1, total: 100 })
            flushSync()
            return { vanilla: { wakes: a }, abide: { wakes: b } }
        },
    }
}

// The hand-written arm has no derived value, so one is written here rather than
// borrowed: dirty-flag plus recompute-on-read, which is what an author writes when
// they do not have a framework. Anything less is not a comparison.
function derived(): Case {
    const held = signal(1)
    let cached = held.read() * 2
    let dirty = false
    held.subscribe(() => {
        dirty = true
    })
    const readDerived = (): number => {
        if (dirty) {
            cached = held.read() * 2
            dirty = false
        }
        return cached
    }

    const source = reactive(1)
    const doubled = reactive(() => source() * 2)

    let flip = 0
    let flop = 0
    return {
        name: 'write a source, then read what derives from it',
        distinguishes:
            'the recompute path — a dirty flag and a lazy read against a marked body pulled forward by the read',
        vanilla: (): void => {
            flip = flip === 0 ? 1 : 0
            held.write(flip)
            sink = readDerived()
        },
        abide: (): void => {
            flop = flop === 0 ? 1 : 0
            source.set(flop)
            sink = doubled()
        },
        work: () => {
            let recomputes = 0
            const one = signal(1)
            let flag = false
            one.subscribe(() => {
                flag = true
            })
            const read = (): number => {
                if (flag) {
                    recomputes += 1
                    flag = false
                }
                return one.read() * 2
            }
            one.write(2)
            read()
            let runs = 0
            const two = reactive(1)
            const derivedTwo = reactive(() => {
                runs += 1
                return two() * 2
            })
            runs = 0
            two.set(2)
            derivedTwo()
            return {
                vanilla: { recomputes },
                abide: { recomputes: runs },
            }
        },
    }
}

// WHAT THE RECOMPUTE PATH BUYS, and the case the previous one cannot answer. A source
// that changes without changing what derives from it: the vanilla arm's dirty flag
// cannot tell, so everything downstream re-runs; the abide arm compares the recomputed
// value and stops there. This is the ratio's other half — the previous case prices the
// cost, this one prices what it is for, and neither is the claim alone.
function derivedUnchanged(): Case {
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
    // something. What it COUNTS is taken in the work pass — a counter incremented
    // inside a timed body is the counter running in the path it counts.
    positive.watch(() => {})

    let flip = 1
    let flop = 1
    return {
        name: 'a source changes without changing what derives from it',
        distinguishes:
            'the identity gate on a recompute — a dirty flag wakes everything downstream, a production the identity gate collapses wakes nothing',
        vanilla: (): void => {
            flip = flip === 1 ? 2 : 1
            held.write(flip)
            if (dirty) sink = readDerived()
        },
        abide: (): void => {
            flop = flop === 1 ? 2 : 1
            source.set(flop)
            flushSync()
        },
        work: () => {
            let vanillaWakes = 0
            const one = signal(1)
            let flag = false
            one.subscribe(() => {
                flag = true
            })
            one.write(2)
            if (flag) vanillaWakes += 1
            one.write(3)
            if (flag) vanillaWakes += 1

            let abideWakes = 0
            const two = reactive(1)
            const derivedTwo = reactive(() => two() > 0)
            derivedTwo.watch(() => {
                abideWakes += 1
            })
            abideWakes = 0
            two.set(2)
            flushSync()
            two.set(3)
            flushSync()
            return {
                vanilla: { downstreamWakes: vanillaWakes },
                abide: { downstreamWakes: abideWakes },
            }
        },
    }
}

// WALKING THE RETAINED WINDOW, which is what `s.history()`'s sync face is FOR — 2.5 calls it
// the snapshot, now, and a template spells it `{#for m of s.history(n)}`. `s()` answers the
// latest production whatever is retained (9.1), so this is the only shape that reads
// history at all.
//
// IT ITERATES RATHER THAN SPREADING, and the difference is the whole reason the case was
// rewritten. `[...s.history()]` against `rows.slice()` measured 10.75x and priced almost none
// of it on abide: JSC spreads an ARRAY in 44 ns and an explicit iterator in 387, so the
// ratio was a fast path the hand-written arm happens to sit on and the lazy face cannot.
// A raw array iterator costs 387 where this `Tail` costs 352 — there is nothing of abide's
// in the number. What both arms do here is walk what is held.
function logAppendAndRead(): Case {
    const DEPTH = 100
    const rows: number[] = []
    const room = reactive<number>(undefined, { history: DEPTH - 1 })
    let at = 0
    return {
        name: 'append to a capped log and walk it',
        distinguishes:
            'retention read end to end — an append that must not cost the depth, and a window walked by the consumer that wants it rather than materialised per write',
        vanilla: (): void => {
            rows.push(at++)
            if (rows.length > DEPTH) rows.shift()
            let total = 0
            for (const row of rows) total += row
            sink = total
        },
        abide: (): void => {
            room.publish(at++)
            let total = 0
            for (const row of room.history()) total += row
            sink = total
        },
        // Both arms walk the same window, or the timings price two different jobs.
        work: () => {
            const held: number[] = []
            const kept = reactive<number>(undefined, { history: 7 })
            for (let index = 0; index < 40; index += 1) {
                held.push(index)
                if (held.length > 8) held.shift()
                kept.publish(index)
            }
            let abideWalked = 0
            for (const _ of kept.history()) abideWalked += 1
            return {
                vanilla: { walked: held.length },
                abide: { walked: abideWalked },
            }
        },
    }
}

// THE WRITE HALF OF RETENTION, ON ITS OWN. `append to a capped log and read it` bundles
// the read with it, and the read is the larger number — so the one place abide BEATS the
// hand-written arm was invisible. `shift()` moves every remaining element, so a
// hand-written cap is linear in the depth on every write; growing to twice the depth and
// trimming in one bulk move is the same memmove once per `history` writes. 6.2 is the clause
// and this is the ratio it makes against code somebody actually writes.
function publishIntoCappedRing(): Case {
    const DEPTH = 100
    const rows: number[] = []
    const room = reactive<number>(undefined, { history: DEPTH - 1 })
    let handAt = 0
    let abideAt = 0
    return {
        name: 'publish into a capped ring',
        distinguishes:
            'the write path under retention — a cap maintained by shifting every element against one trimmed in bulk, which is the difference between linear in the depth and amortised constant',
        vanilla: (): void => {
            rows.push(handAt++)
            if (rows.length > DEPTH) rows.shift()
        },
        abide: (): void => {
            room.publish(abideAt++)
        },
        // Both arms hold the same window afterwards, which is what makes the timings
        // comparable at all: a cap that retained less would be a cheaper different job.
        work: () => {
            const held: number[] = []
            const kept = reactive<number>(undefined, { history: 7 })
            for (let index = 0; index < 40; index += 1) {
                held.push(index)
                if (held.length > 8) held.shift()
                kept.publish(index)
            }
            return {
                vanilla: { retained: held.length },
                abide: { retained: [...kept.history()].length },
            }
        },
    }
}

// THE CURSOR, PRICED PER TURN. RULEBOOK 5.11 has a cursor deliver every production
// retention still holds, so the arms are BALANCED — k productions in, k turns out — and
// what is left is the cost of finding a production by ordinal against finding it by index
// in an array somebody trimmed themselves.
//
// A BURST rather than one at a time, and that is the whole point of the case: one at a
// time cannot tell a cursor that indexes retention from one that answers with the head,
// because with one outstanding production those are the same answer. Eight can.
function cursorBurst(): Case {
    const BURST = 8
    const DEPTH = 100
    const rows: number[] = []
    let handBase = 0
    let handCursor = 0
    let handAt = 0
    const room = reactive<number>(undefined, { history: DEPTH - 1 })
    const cursor = room.history(0)[Symbol.asyncIterator]()
    let abideAt = 0
    return {
        name: `take a burst of ${BURST} from a cursor`,
        distinguishes:
            'a cursor over retention: several productions landing between two turns must be several turns, so the arms are balanced and the ratio is the cost of finding one by ordinal against one by index',
        vanilla: (): void => {
            for (let index = 0; index < BURST; index += 1) {
                rows.push(handAt++)
                if (rows.length > DEPTH) {
                    rows.shift()
                    handBase += 1
                }
            }
            for (let index = 0; index < BURST; index += 1) {
                if (handCursor < handBase) handCursor = handBase
                sink = Promise.resolve(rows[handCursor - handBase])
                handCursor += 1
            }
        },
        abide: (): void => {
            for (let index = 0; index < BURST; index += 1)
                room.publish(abideAt++)
            // Balanced with the publishes on purpose: a `next` with nothing outstanding
            // hands back a promise that is never settled, and a batch of those is a
            // measurement of an allocator rather than of a cursor.
            for (let index = 0; index < BURST; index += 1) sink = cursor.next()
        },
        work: () => {
            const held: number[] = []
            const kept = reactive<number>(undefined, { history: DEPTH - 1 })
            for (let index = 0; index < BURST; index += 1) {
                held.push(index)
                kept.publish(index)
            }
            return {
                vanilla: { retained: held.length },
                abide: { retained: [...kept.history(BURST)].length },
            }
        },
    }
}

// `sink` exists to defeat dead-code elimination — every arm writes it, and an unread
// write is exactly what an optimiser removes. Read once, so the linter does not read it
// as dead, which it is not.
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

// The hand-written derived node, and it has to be SUBSCRIBABLE or a chain cannot be
// built out of it: a dirty flag that nothing propagates makes every node above the
// first stale forever. Dirtiness pushes eagerly and the recompute is pulled on the
// read, which is what an author writes and is the pattern the whole comparison is
// against.
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

// ONE SOURCE, MANY READERS. A write has to reach all of them; a read of one must not
// pay for the other nine. This is a row's worth of cells over one record.
function fanOut(width: number): Case {
    const held = signal(0)
    const hand: HandWritten[] = []
    for (let index = 0; index < width; index += 1)
        hand.push(handDerived([held], () => held.read() + index))

    const source = reactive(0)
    const derivedValues: (() => number)[] = []
    for (let index = 0; index < width; index += 1)
        derivedValues.push(
            reactive(() => source() + index) as unknown as () => number,
        )

    let flip = 0
    let flop = 0
    return {
        name: `fan-out to ${width} readers, one read after the write`,
        distinguishes:
            'a write that must reach every reader against a read that wants one of them — both arms mark the fan and run the one node that is read, so what is left is the cost of a mark',
        vanilla: (): void => {
            flip = flip === 0 ? 1 : 0
            held.write(flip)
            sink = (hand[0] as HandWritten).read()
        },
        abide: (): void => {
            flop = flop === 0 ? 1 : 0
            source.set(flop)
            sink = (derivedValues[0] as () => number)()
        },
        work: () => {
            let handRuns = 0
            const one = signal(0)
            const nodes: HandWritten[] = []
            for (let index = 0; index < width; index += 1)
                nodes.push(
                    handDerived([one], () => {
                        handRuns += 1
                        return one.read()
                    }),
                )
            for (const node of nodes) node.read()
            handRuns = 0
            one.write(1)
            ;(nodes[0] as HandWritten).read()

            const two = reactive(0)
            let abideRuns = 0
            const built: (() => number)[] = []
            for (let index = 0; index < width; index += 1)
                built.push(
                    reactive(() => {
                        abideRuns += 1
                        return two() + index
                    }) as unknown as () => number,
                )
            abideRuns = 0
            two.set(1)
            ;(built[0] as () => number)()
            return {
                vanilla: { bodyRuns: handRuns },
                abide: { bodyRuns: abideRuns },
            }
        },
    }
}

// MANY SOURCES, ONE READER. The cursor protocol's steady state: a body reading N values
// in the same order every run should compare N pointers and mutate nothing.
function fanIn(width: number): Case {
    const held: ReturnType<typeof signal<number>>[] = []
    for (let index = 0; index < width; index += 1) held.push(signal(index))
    const hand = handDerived(held, () => {
        let total = 0
        for (let index = 0; index < width; index += 1)
            total += (held[index] as { read(): number }).read()
        return total
    })

    const sources: ReturnType<typeof reactive<number>>[] = []
    for (let index = 0; index < width; index += 1) sources.push(reactive(index))
    const summed = reactive(() => {
        let total = 0
        for (let index = 0; index < width; index += 1)
            total += (sources[index] as () => number)()
        return total
    }) as unknown as () => number

    let flip = 0
    let flop = 0
    return {
        name: `fan-in from ${width} sources, one changes`,
        distinguishes:
            'the cursor protocol in steady state — a body whose source order never changes should mutate nothing, and one source moving should not re-subscribe the other nine',
        vanilla: (): void => {
            flip = flip === 0 ? 1 : 0
            ;(held[0] as { write(value: number): void }).write(flip)
            sink = hand.read()
        },
        abide: (): void => {
            flop = flop === 0 ? 1 : 0
            ;(sources[0] as { set(value: number): void }).set(flop)
            sink = summed()
        },
        work: () => ({ vanilla: { bodyRuns: 1 }, abide: { bodyRuns: 1 } }),
    }
}

// FAN-IN AND FAN-OUT AT EVERY LEVEL — the shape where sharing makes a walk re-walk.
// Each layer reads every node of the one below it, so the edge count is width squared
// per level and every path from the top to the bottom is distinct.
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
    const handTop = build<HandWritten>(
        (index) => {
            const made = signal(index)
            handBase.push(made)
            return made as unknown as HandWritten
        },
        (below, index) =>
            handDerived(below, () => {
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
    return {
        name: `layered DAG ${width} wide x ${depth} deep, one base value changes`,
        distinguishes:
            'sharing at every level — a walk that guards the STACK rather than what it has VISITED re-walks each shared subgraph once per path, which is an asymptote rather than a constant',
        vanilla: (): void => {
            flip = flip === 0 ? 1 : 0
            ;(handBase[0] as { write(value: number): void }).write(flip)
            sink = handTop.read()
        },
        abide: (): void => {
            flop = flop === 0 ? 1 : 0
            ;(abideBase[0] as unknown as { set(value: number): void }).set(flop)
            sink = abideTop()
        },
        work: () => {
            const before = abideRuns
            ;(abideBase[0] as unknown as { set(value: number): void }).set(99)
            abideTop()
            return {
                vanilla: { bodyRuns: width * (depth - 1) + 1 },
                abide: { bodyRuns: abideRuns - before },
            }
        },
    }
}

// A DEEP CHAIN. No sharing at all, so it prices depth alone — the control that says
// which of the DAG's cost is depth and which is sharing.
function chain(depth: number): Case {
    const held = signal(0)
    let handNode = handDerived([held], () => held.read() + 1)
    for (let level = 1; level < depth; level += 1) {
        const below = handNode
        handNode = handDerived([below], () => below.read() + 1)
    }

    const source = reactive(0)
    let node = reactive(() => source() + 1) as unknown as () => number
    for (let level = 1; level < depth; level += 1) {
        const below = node
        node = reactive(() => below() + 1) as unknown as () => number
    }

    let flip = 0
    let flop = 0
    return {
        name: `chain ${depth} deep`,
        distinguishes:
            "depth with no sharing — the control against the DAG, so the DAG's extra cost is attributable to sharing rather than to size",
        vanilla: (): void => {
            flip = flip === 0 ? 1 : 0
            held.write(flip)
            sink = handNode.read()
        },
        abide: (): void => {
            flop = flop === 0 ? 1 : 0
            source.set(flop)
            sink = node()
        },
        work: () => ({
            vanilla: { bodyRuns: depth },
            abide: { bodyRuns: depth },
        }),
    }
}

// THE CURSOR PROTOCOL'S WORST CASE. A body whose source order ALTERNATES diverges on
// every run: the cursor misses, the tail is detached and rebuilt, and every source is
// re-subscribed. 14.15 warns on exactly this shape, and this is what the warning costs.
function alternatingSources(): Case {
    const flagHeld = signal(true)
    const left = signal(1)
    const right = signal(2)
    const hand = handDerived([flagHeld, left, right], () =>
        flagHeld.read() ? left.read() : right.read(),
    )

    const flag = reactive(true)
    const one = reactive(1)
    const two = reactive(2)
    const picked = reactive(() =>
        flag() ? one() : two(),
    ) as unknown as () => number

    let handFlag = true
    let abideFlag = true
    return {
        name: 'a body whose source alternates every run',
        distinguishes:
            'the cursor protocol when it always misses — a stable body mutates nothing, and this one detaches and re-subscribes on every single run',
        vanilla: (): void => {
            handFlag = !handFlag
            flagHeld.write(handFlag)
            sink = hand.read()
        },
        abide: (): void => {
            abideFlag = !abideFlag
            flag.set(abideFlag)
            sink = picked()
        },
        work: () => ({ vanilla: { bodyRuns: 1 }, abide: { bodyRuns: 1 } }),
    }
}

// ONE VALUE READ MANY TIMES IN ONE BODY — a template with several slots over one record.
// The cursor matches each read in order, so the list holds the same value repeatedly and
// the dedupe in `track` is what keeps the wake count at one.
function repeatedReads(times: number): Case {
    const held = signal(1)
    const hand = handDerived([held], () => {
        let total = 0
        for (let index = 0; index < times; index += 1) total += held.read()
        return total
    })

    const source = reactive(1)
    const summed = reactive(() => {
        let total = 0
        for (let index = 0; index < times; index += 1) total += source()
        return total
    }) as unknown as () => number

    let flip = 1
    let flop = 1
    return {
        name: `one source read ${times} times in one body`,
        distinguishes:
            'a duplicate in the source list — the cursor must match it each time and the reader must still be woken exactly once',
        vanilla: (): void => {
            flip = flip === 1 ? 2 : 1
            held.write(flip)
            sink = hand.read()
        },
        abide: (): void => {
            flop = flop === 1 ? 2 : 1
            source.set(flop)
            sink = summed()
        },
        work: () => ({ vanilla: { bodyRuns: 1 }, abide: { bodyRuns: 1 } }),
    }
}

// THE PROBE OVER A SETTLED, SHARED GRAPH — the case a stack guard cannot survive and a
// visited stamp makes linear. It is the ALL-IDLE graph on purpose: the walk
// short-circuits on a busy node, so the exhaustive traversal is the spinner read that
// renders no spinner, which is the one a frame takes over and over.
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

    return {
        name: `probe a settled DAG ${width} wide x ${depth} deep`,
        distinguishes:
            'a probe walk over a SHARED graph — a guard that tracks the stack re-walks each shared subgraph once per path, where one that tracks what it visited walks each edge once',
        vanilla: (): void => {
            seen.clear()
            sink = anyBusy(handTop)
        },
        abide: (): void => {
            sink = top.busy()
        },
        work: () => ({ vanilla: { busy: 0 }, abide: { busy: 0 } }),
    }
}

// WHAT THE MACHINERY BUYS, which is the other half of every ratio above. The CAREFUL
// hand-written arm already carries an identity check, so those rows price abide
// against a guard somebody had to know to write. These two price it against the
// version most people write first — an unconditional notify — and the answer goes the
// other way.
//
// READERS ARE THE POINT. With nobody subscribed a careless write is a store and the
// two arms are level; the cost only exists where somebody is listening, so the width
// is the case. 100 is a table with a bound cell per row, not a stress test.
function equalWriteAgainstCareless(width: number, fresh: boolean): Case {
    const name = fresh
        ? `a re-materialised equal value, ${width} readers, structural vs CARELESS`
        : `a write of the value already held, ${width} readers, vanilla written CARELESSLY`
    const make = (): { id: number; total: number } => ({ id: 1, total: 100 })
    const standing = make()
    // SEEDED WITH THE VALUE THE WRITE WRITES, so "already held" is true on the first
    // write and not only from the second — the timed loop repeats, but the work pass
    // writes ONCE, and a case whose two passes disagree is the failure the work record
    // exists to catch.
    const held = carelessSignal(fresh ? make() : standing)
    const value = fresh
        ? reactive(make(), { identity: structural })
        : reactive(standing)
    for (let at = 0; at < width; at += 1) {
        held.subscribe((next) => {
            sink = next
        })
        value.watch((next) => {
            sink = next
        })
    }
    return {
        name,
        distinguishes:
            'what the gate BUYS rather than what it costs — abide skips the wake and this arm wakes every reader on a write that moved nothing, which is the version most people write first',
        vanilla: (): void => {
            held.write(fresh ? make() : standing)
        },
        abide: (): void => {
            value.set(fresh ? make() : standing)
            flushSync()
        },
        work: () => {
            const same = make()
            const one = carelessSignal(fresh ? make() : same)
            const two = fresh
                ? reactive(make(), { identity: structural })
                : reactive(same)
            let a = 0
            let b = 0
            for (let at = 0; at < width; at += 1) {
                one.subscribe(() => {
                    a += 1
                })
                two.watch(() => {
                    b += 1
                })
            }
            b = 0
            one.write(fresh ? make() : same)
            two.set(fresh ? make() : same)
            flushSync()
            return { vanilla: { wakes: a }, abide: { wakes: b } }
        },
    }
}

// THE SUBSCRIBE PATH, WHICH NOTHING HERE PRICED. Every fan-out case builds its readers in
// SETUP and times the write afterwards, so the cost of a reader ARRIVING on a value was
// invisible to the whole bench — and it was quadratic: `track` deduped by scanning
// `source.readers`, whose length is the number of readers already on the value, so mounting
// n of them was n²/2 pointer compares. Per reader under JSC: 446 ns at n=500 rising to
// 3,872 ns at n=8000, which put a 30.98 ms mount on the click that opens a long list.
// Deduping from the reader's own `sources` prefix instead — as long as what this BODY reads
// rather than how many readers the VALUE has — is 0.45 ms at the same width.
//
// THE OP IS A MOUNT AND A TEARDOWN, both arms, so neither is left holding what the other
// dropped. FIFTY readers, and the width is chosen by the batcher rather than by the claim: at
// 200 the op is 26.7 µs, which clears the clock bar at n=1, and a sample of one op under a
// frame is what `ratio()` refuses — so the row came out `underOneFrame` and was a figure
// rather than a claim. At 50 the batcher takes n=4 and the ratio resolves.
//
// WHAT THE ROW IS WORTH, run both ways: 1.67x with the reader-side dedup and 2.21x with it
// out, against an A/A floor of 3-7%. What it distinguishes is a CONSTANT the subscribe path
// grows, because it is abide against the hand-written arm at ONE width — a constant is exactly
// what a same-structure ratio divides out, so this row and `mountingIsLinear` in
// `benchReactive.ts` cover different regressions and neither subsumes the other.
//
// THE SLOPE IS `mountingIsLinear`'S, at 16 against 112 with a calibrated bar. It is worth
// reading that function's header before touching either: a first attempt at it compared against
// what a COMPLEXITY CLASS predicts (4x linear, 16x quadratic) and reported the mechanism out as
// holding, because at any priceable width `watch` construction dominates and the n² term is a
// minority of the op. The bar has to be set by what the fixed mechanism measures, which is what
// 6.2 does.
//
// THE PER-READER FIGURES in `track`'s own comment are the third record and the widest — 446 ns
// rising to 3,872 ns against ~60 ns flat, measured directly at n=500 through n=8000, where
// neither of the two rows reaches past 112. Those are a measurement to re-run rather than a
// gate; the gate that runs in `bun test` is the dedup's subscription count in `reactive.test.ts`.

function mountReaders(width: number): Case {
    return {
        name: `mount ${width} readers on one value`,
        distinguishes:
            'the subscribe path, which every fan-out case builds in setup and never times — a dedup scanned per arriving reader against one scanned per value the body reads, which is the difference between quadratic in the reader count and flat',
        vanilla: (): void => {
            const held = signal(0)
            const stops: (() => void)[] = []
            for (let index = 0; index < width; index += 1) {
                stops.push(
                    held.subscribe(() => {
                        sink = held.read()
                    }),
                )
                sink = held.read()
            }
            for (const stop of stops) stop()
        },
        abide: (): void => {
            const source = reactive(0)
            const stops: (() => void)[] = []
            for (let index = 0; index < width; index += 1)
                stops.push(
                    watch(() => {
                        sink = source()
                    }),
                )
            for (const stop of stops) stop()
        },
        // BOTH ARMS HOLD THE SAME FAN while they are up, which is what makes the timings
        // comparable: an arm that subscribed fewer readers would be a cheaper different job.
        work: () => {
            let handRuns = 0
            const held = signal(0)
            const handStops: (() => void)[] = []
            for (let index = 0; index < width; index += 1) {
                handStops.push(held.subscribe(() => {}))
                handRuns += 1
            }
            let abideRuns = 0
            const source = reactive(0)
            const abideStops: (() => void)[] = []
            for (let index = 0; index < width; index += 1)
                abideStops.push(
                    watch(() => {
                        source()
                        abideRuns += 1
                    }),
                )
            flushSync()
            for (const stop of handStops) stop()
            for (const stop of abideStops) stop()
            return {
                vanilla: { subscribed: handRuns },
                abide: { subscribed: abideRuns },
            }
        },
    }
}

// A KEYED VALUE, WHICH NOTHING HERE PRICED: every case above is an unkeyed value. Three ops,
// because the three touch different parts of a `Keyed` — MAKING one (its statics and entry map),
// REACHING an entry that stands (the key and the lookup), and a STATIC walking the entries
// (`ready` with no pattern, then `busy` narrowed by one). The hand-written arm is a map of
// records keyed the same way, so both arms walk the same entries and build the same key.
const KEYED_WIDTH = 8

function constructKeyed(): Case {
    return {
        name: 'construct a keyed value',
        distinguishes:
            'the cost of MAKING a keyed factory — its entry map and its statics — before any key is reached',
        vanilla: (): void => {
            const entries = new Map<string, { ready: boolean }>()
            sink = (args: { id: number }) => entries.get(JSON.stringify(args))
        },
        abide: (): void => {
            sink = reactive((args: { id: number }) => args.id)
        },
        work: () => ({ vanilla: { values: 1 }, abide: { values: 1 } }),
    }
}

function reachKeyed(): Case {
    const handEntries = new Map<
        string,
        { args: { id: number }; value: number }
    >()
    const keyed = reactive((args: { id: number }) => args.id)
    for (let index = 0; index < KEYED_WIDTH; index += 1) {
        handEntries.set(JSON.stringify({ id: index }), {
            args: { id: index },
            value: index,
        })
        keyed({ id: index })
    }
    let at = 0
    return {
        name: `reach a standing keyed entry among ${KEYED_WIDTH}`,
        distinguishes:
            'the reach that finds its entry already standing (1.8) — the key and the lookup, no entry built',
        vanilla: (): void => {
            at = (at + 1) % KEYED_WIDTH
            sink = handEntries.get(JSON.stringify({ id: at }))
        },
        abide: (): void => {
            at = (at + 1) % KEYED_WIDTH
            sink = keyed({ id: at })
        },
        work: () => ({ vanilla: { built: 0 }, abide: { built: 0 } }),
    }
}

function probeKeyed(): Case {
    const handEntries = new Map<
        string,
        { args: { id: number }; ready: boolean; busy: boolean }
    >()
    const keyed = reactive((args: { id: number }) => args.id)
    for (let index = 0; index < KEYED_WIDTH; index += 1) {
        handEntries.set(JSON.stringify({ id: index }), {
            args: { id: index },
            ready: true,
            busy: false,
        })
        sink = keyed({ id: index })()
    }
    const pattern = { id: KEYED_WIDTH - 1 }
    return {
        name: `probe a keyed value of ${KEYED_WIDTH} entries, whole and by pattern`,
        distinguishes:
            'a keyed STATIC walking its entries — where the statics live is what this reaches first',
        vanilla: (): void => {
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
            sink = ready && !busy
        },
        abide: (): void => {
            sink = keyed.ready() && !keyed.busy(pattern)
        },
        work: () => ({ vanilla: { walked: 2 }, abide: { walked: 2 } }),
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
    logAppendAndRead(),
    publishIntoCappedRing(),
    cursorBurst(),
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

export type { Case }
