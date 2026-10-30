// WHAT THE REACTIVE CORE COSTS THE DOM. Every other gate in this package counts wakes and
// body runs, which are the currency of the graph; this one counts the currency of the
// page. A DOM mutation costs more than the JS that decides it, and a wake that reaches a
// binding is a mutation whether or not anything about the value moved.
//
// `harness/measure` is the lane for it — DOM call counts taken from inside the page, the
// only lane that runs in both substrates. The binding here is deliberately the most naive
// one a compiler could emit: write on every wake, compare nothing. That is what makes the
// count a property of the CORE rather than of a binding's cleverness.
//
// EVERY CASE ENDS THE TURN INSIDE THE MEASUREMENT, because a drain is batched to the end
// of one — so the question is what a TURN costs the page, and a count taken without the
// flush would be zero for every case here and prove nothing.

import { expect, test } from 'bun:test'

import { measure } from '@abide/harness/abide'

import { flushSync, reactive, watch } from '#shared'

function bind(value: () => number, count: number): (() => void)[] {
    const list = document.createElement('ul')
    const stops: (() => void)[] = []
    for (let index = 0; index < count; index += 1) {
        const node = document.createTextNode('')
        list.appendChild(node)
        stops.push(
            watch(() => {
                node.data = String(value())
            }),
        )
    }
    return stops
}

// 5.2 IN THE CURRENCY THAT MATTERS. A write the identity gate collapses reaches no
// binding, so it touches no node — and a write that moves the value reaches every one,
// with nothing redundant about any of them.
test('a write that changes nothing touches no node', () => {
    const value = reactive(1)
    const stops = bind(value as unknown as () => number, 50)

    const same = measure(() => {
        value.set(1)
        flushSync()
    })
    expect(same.dataWrites).toBe(0)

    const moved = measure(() => {
        value.set(2)
        flushSync()
    })
    expect(moved.dataWrites).toBe(50)
    expect(moved.redundantDataWrites).toBe(0)
    for (const stop of stops) stop()
})

// 3.3's EDGE, PRICED IN NODES. A refresh moves `busy` and moves no value (7.4), so the
// guards asking about it have to run and the bindings painting it must not. Subscribing a
// probe reader through the VALUE edge instead — twenty lines lighter, and it passes every
// wake-counting test in this package — reports 50 `.data` writes here with the same string
// in every one of them, which is exactly what 5.2 exists to stop and cannot see, because
// no production was minted for it to gate.
//
// The revert is `trackProbe` becoming `track` in `isBusy` and `isReady`, with the flip
// sites calling `cascade` rather than `probesMoved`: 0 -> 50 redundant writes per refresh,
// per fifty rows, and not one test that counts wakes moves.
test('a load starting touches no node', async () => {
    const answer = 1
    const value = reactive(() => Promise.resolve(answer))
    await value
    const stops = bind(value as unknown as () => number, 50)

    const refresh = measure(() => {
        value.refresh()
        flushSync()
    })
    expect(refresh.dataWrites).toBe(0)
    expect(refresh.redundantDataWrites).toBe(0)

    // And the landing repaints once, because the value did move.
    await value
    for (const stop of stops) stop()
})

// THE BATCH, IN NODES. A drain is deferred to the end of the turn, so a handler that steps
// a value ten times reaches the page once — the nine intermediate values are ones no human
// was ever going to see. Marking stays synchronous, which is what keeps a read taken
// between two of those writes correct.
//
// The revert is `schedule()` becoming `drainPending()` in `cascade`: ten writes become ten
// `.data` writes, and three values written together become five, because the binding that
// reads all three runs once per write instead of once per turn.
test('a handler that writes many times reaches the page once', () => {
    const value = reactive(0)
    const stops = bind(value as unknown as () => number, 1)
    const ten = measure(() => {
        for (let step = 1; step <= 10; step += 1) value.set(step)
        flushSync()
    })
    expect(ten.dataWrites).toBe(1)
    for (const stop of stops) stop()

    // Three values a handler updates together, with a binding over all three. One write
    // each, not one per value per write.
    const first = reactive('a')
    const second = reactive('b')
    const total = reactive(0)
    const paragraph = document.createElement('p')
    const nodes = [
        document.createTextNode(''),
        document.createTextNode(''),
        document.createTextNode(''),
    ]
    for (const node of nodes) paragraph.appendChild(node)
    const watches = [
        watch(() => {
            ;(nodes[0] as Text).data = first()
        }),
        watch(() => {
            ;(nodes[1] as Text).data = second()
        }),
        watch(() => {
            ;(nodes[2] as Text).data = `${first()} ${second()} ${total()}`
        }),
    ]
    const together = measure(() => {
        first.set('x')
        second.set('y')
        total.set(1)
        flushSync()
    })
    expect(together.dataWrites).toBe(3)
    for (const stop of watches) stop()
})
