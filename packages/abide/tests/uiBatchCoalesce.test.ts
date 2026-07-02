import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { batch } from '../src/lib/ui/runtime/batch.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

describe('write coalescing', () => {
    test('unbatched: each write flushes its effect (the eager default)', () => {
        const a = state(0)
        const b = state(0)
        let runs = 0
        effect(() => {
            a.value
            b.value
            runs += 1
        })
        expect(runs).toBe(1) // initial
        a.value = 1
        b.value = 1
        expect(runs).toBe(3) // one flush per write
    })

    test('batch(): a burst of writes re-runs the effect once', () => {
        const a = state(0)
        const b = state(0)
        let runs = 0
        effect(() => {
            a.value
            b.value
            runs += 1
        })
        expect(runs).toBe(1)
        batch(() => {
            a.value = 1
            b.value = 1
        })
        expect(runs).toBe(2) // coalesced into a single flush
    })

    /* An effect that writes a signal a LATER-created effect reads must not jump that
       effect ahead of the ones already queued: the flush drains in queue order (which
       follows creation order), re-queuing anything an effect dirties for a later pass
       rather than re-entering the flush mid-drain. Regression for re-entrant flush. */
    test("effects flush in creation order even when one writes another effect's dependency", () => {
        const s = state(0)
        const q = state(0)
        const order: string[] = []
        effect(() => {
            const value = s.value
            order.push('A')
            if (value > 0) {
                q.value = value // dirties C, created after B
            }
        })
        effect(() => {
            s.value
            order.push('B')
        })
        effect(() => {
            q.value
            order.push('C')
        })
        order.length = 0 // drop the initial runs
        s.value = 1 // wakes A and B; A then wakes C
        expect(order).toEqual(['A', 'B', 'C'])
    })

    test('batch() nests: inner batch defers to the outermost exit', () => {
        const a = state(0)
        const b = state(0)
        let runs = 0
        effect(() => {
            a.value
            b.value
            runs += 1
        })
        expect(runs).toBe(1)
        batch(() => {
            a.value = 1
            batch(() => {
                b.value = 1
            })
            expect(runs).toBe(1) // inner exit must NOT flush — still inside outer
        })
        expect(runs).toBe(2) // single flush at the outer exit
    })
})

describe('on() handler coalesces its writes', () => {
    let uninstall: () => void
    beforeAll(() => {
        uninstall = installMiniDom()
    })
    afterAll(() => {
        uninstall()
    })

    test('a click handler setting two signals re-runs a dependent effect once', () => {
        const a = state(0)
        const b = state(0)
        let runs = 0
        effect(() => {
            a.value
            b.value
            runs += 1
        })
        expect(runs).toBe(1)

        const button = document.createElement('button')
        on(button, 'click', () => {
            a.value = 1
            b.value = 1
        })
        button.dispatchEvent(new Event('click'))
        expect(runs).toBe(2) // both writes in one flush, not two
    })

    /* Contract pinned by coalescing: a DOM binding deferred to batch exit means a
       handler that writes then synchronously reads the bound DOM sees the PRE-write
       value; the new value lands once the handler returns. Value reads stay current
       (they pull on read) — only the effect/DOM side defers. */
    test('a handler reads stale bound DOM mid-write, fresh after it returns', () => {
        const label = state('a')
        const div = document.createElement('div')
        attr(div, 'data-v', () => label.value)
        expect(div.getAttribute('data-v')).toBe('a') // initial binding applied

        let midWriteValue: unknown
        let midReadOfSignal: unknown
        on(div, 'click', () => {
            label.value = 'b'
            midReadOfSignal = label.value // value read is immediate
            midWriteValue = div.getAttribute('data-v') // DOM deferred to batch exit
        })
        div.dispatchEvent(new Event('click'))

        expect(midReadOfSignal).toBe('b') // signal current mid-handler
        expect(midWriteValue).toBe('a') // DOM still pre-write mid-handler
        expect(div.getAttribute('data-v')).toBe('b') // applied after handler returns
    })
})
