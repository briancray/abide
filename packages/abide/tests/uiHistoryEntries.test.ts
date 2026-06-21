import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { historyEntries } from '../src/lib/ui/runtime/historyEntries.ts'

/* The module reads scroll off globalThis (a no-op on the server). Install a stub
   window-scroll surface where scrollTo moves a tracked offset, so save/restore are
   observable. The module's entry counter is a process singleton, so each test mints
   its own fresh ids — buckets never collide across tests. */
const view = globalThis as {
    scrollX?: number
    scrollY?: number
    scrollTo?: (x: number, y: number) => void
    document?: { getElementById: (id: string) => { scrollIntoView: () => void } | null }
    history?: { state: unknown; replaceState: (state: unknown, unused: string) => void }
}
const previous = {
    scrollX: view.scrollX,
    scrollY: view.scrollY,
    scrollTo: view.scrollTo,
    document: view.document,
    history: view.history,
}

/* A stub History whose state is a plain mutable object — `replaceState` overwrites it,
   mirroring the durable store a reload reads back. */
const historyStub = {
    state: null as unknown,
    replaceState(state: unknown) {
        historyStub.state = state
    },
}

beforeEach(() => {
    view.scrollX = 0
    view.scrollY = 0
    view.scrollTo = (x, y) => {
        view.scrollX = x
        view.scrollY = y
    }
    historyStub.state = null
})
afterAll(() => {
    view.scrollX = previous.scrollX
    view.scrollY = previous.scrollY
    view.scrollTo = previous.scrollTo
    view.document = previous.document
    view.history = previous.history
})

describe('historyEntries — manual scroll restoration buckets', () => {
    test('save buckets the active entry; restore returns to it after navigating away', () => {
        const here = historyEntries.next()
        view.scrollTo?.(10, 200)
        historyEntries.save() // bucket `here` → [10, 200]

        historyEntries.next() // navigate away — a new entry
        view.scrollTo?.(0, 0) // browser lands the new page at the top

        historyEntries.adopt(here) // back to `here`
        historyEntries.restore()
        expect([view.scrollX, view.scrollY]).toEqual([10, 200])
    })

    test('restore on an entry seen for the first time scrolls to the top', () => {
        historyEntries.next()
        view.scrollTo?.(5, 5)
        historyEntries.restore() // no bucket for a fresh entry
        expect([view.scrollX, view.scrollY]).toEqual([0, 0])
    })

    test('next mints monotonically increasing ids and tracks the active entry', () => {
        const a = historyEntries.next()
        const b = historyEntries.next()
        expect(b).toBe(a + 1)
        expect(historyEntries.current).toBe(b)
    })

    test('adopt keeps the counter ahead so a later push never reuses an id', () => {
        const far = historyEntries.current + 50
        historyEntries.adopt(far)
        expect(historyEntries.current).toBe(far)
        expect(historyEntries.next()).toBe(far + 1)
    })

    test('a fresh entry with a resolving #hash scrolls the anchor into view, not the top', () => {
        let scrolledIntoView = ''
        view.document = {
            getElementById: (id) =>
                id === 'section' ? { scrollIntoView: () => (scrolledIntoView = id) } : null,
        }
        historyEntries.next() // fresh entry, no bucket
        view.scrollTo?.(0, 99)
        historyEntries.restore('#section')
        expect(scrolledIntoView).toBe('section') // anchored, not scrolled to top
        expect(view.scrollY).toBe(99) // scrollTo(0,0) was NOT called — the anchor won
    })

    test('a fresh entry whose #hash matches no element falls back to the top', () => {
        view.document = { getElementById: () => null }
        historyEntries.next()
        view.scrollTo?.(0, 50)
        historyEntries.restore('#missing')
        expect([view.scrollX, view.scrollY]).toEqual([0, 0])
    })

    test('discard drops the active entry bucket so restore lands at the top (a replace supersedes it)', () => {
        const here = historyEntries.next()
        view.scrollTo?.(0, 300)
        historyEntries.save() // bucket `here` → [0, 300]
        historyEntries.discard() // a replace lands fresh content over `here`
        view.scrollTo?.(0, 0)
        historyEntries.restore()
        expect([view.scrollX, view.scrollY]).toEqual([0, 0]) // the stale bucket is gone
    })

    test('persist mirrors live scroll into history.state; restore recovers it once the Map is gone (a reload)', () => {
        view.history = historyStub
        const here = historyEntries.next()
        historyStub.state = { abideEntry: here } // the id `navigate` stamped
        view.scrollTo?.(0, 420)
        historyEntries.persist() // pagehide → state carries the live offset
        expect((historyStub.state as { scroll: [number, number] }).scroll).toEqual([0, 420])

        /* A reload: no in-memory bucket for `here` (save was never called), but the
           persisted state survives, so restore recovers from it. */
        view.scrollTo?.(0, 0)
        historyEntries.restore()
        expect([view.scrollX, view.scrollY]).toEqual([0, 420])
    })

    test('a persisted offset stamped with a different entry id is ignored (foreign history state)', () => {
        view.history = historyStub
        const here = historyEntries.next()
        historyStub.state = { abideEntry: here + 999, scroll: [0, 700] } // not this entry
        view.scrollTo?.(0, 0)
        historyEntries.restore()
        expect([view.scrollX, view.scrollY]).toEqual([0, 0]) // foreign scroll not applied
    })

    test('with no scroll surface, save and restore are no-ops (no throw)', () => {
        view.scrollTo = undefined
        const here = historyEntries.next()
        expect(() => {
            historyEntries.save()
            historyEntries.adopt(here)
            historyEntries.restore()
        }).not.toThrow()
    })
})
