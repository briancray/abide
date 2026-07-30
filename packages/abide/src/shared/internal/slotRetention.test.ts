// Retention as ARITHMETIC, with the clock supplied.
//
// While this was two predicates inside `memo.ts` the only way to test any of it was to build a real memo
// and `await sleep(...)` past a ttl — which `memo.test.ts` does exactly once. Every other rule (the
// deadline flag beating an infinite ttl, ttl:0, the open-stream exemption, ttl-from-close) was reachable
// only by racing a timer, so none of them had a test.

import { afterEach, describe, expect, test } from 'bun:test'
import { isRetentionStale, type RetentionFields, stampRetained } from './slotRetention.ts'

// The clock every case supplies. A local `let` rather than a swapped global: nothing here can reach
// another test file, so no later suite runs against a frozen clock.
let now = 1_000
const at = (): number => now
afterEach(() => {
    now = 1_000
})

function slot(fields?: Partial<RetentionFields>): RetentionFields {
    return { loadedAt: now, expired: false, ...fields }
}

describe('the ttl window', () => {
    test('a value inside its window is fresh, and stale once the window has elapsed', () => {
        const fields = slot()
        now += 999
        expect(isRetentionStale(fields, 1_000, 'value', at)).toBe(false)
        now += 1
        // `>=`, not `>`: at exactly ttl the value has been served for the whole window.
        expect(isRetentionStale(fields, 1_000, 'value', at)).toBe(true)
    })

    test('ttl: 0 is stale immediately — every read runs cold', () => {
        expect(isRetentionStale(slot(), 0, 'value', at)).toBe(true)
    })

    test('an infinite ttl never expires, however far the clock moves', () => {
        const fields = slot()
        now += 10 ** 12
        expect(isRetentionStale(fields, Number.POSITIVE_INFINITY, 'value', at)).toBe(false)
    })

    // THE HOT PATH: a memo naming no retention must not read the clock at all. Asserted as WORK — the
    // clock is a spy — because "the value is fresh" is the right answer either way.
    test('an infinite ttl answers without consulting the clock', () => {
        let reads = 0
        const counted = (): number => {
            reads++
            return now
        }
        expect(isRetentionStale(slot(), Number.POSITIVE_INFINITY, 'value', counted)).toBe(false)
        expect(reads).toBe(0)
        // And the finite case does read it, so the assertion above is about the short-circuit rather
        // than about the spy never being wired up.
        isRetentionStale(slot(), 1_000, 'value', counted)
        expect(reads).toBe(1)
    })
})

describe('what the slot is holding', () => {
    test('nothing retained is never stale, whatever the clock says', () => {
        const fields = slot()
        now += 10 ** 6
        expect(isRetentionStale(fields, 1_000, 'nothing', at)).toBe(false)
    })

    // replayable-streams §2: an open stream is retained regardless of ttl — its clock starts at CLOSE, at
    // which point the caller passes 'value' and the elapsed window is measured from the settle stamp.
    test('an OPEN stream is exempt; the same stamp is stale once it has closed', () => {
        const fields = slot()
        now += 10_000
        expect(isRetentionStale(fields, 1_000, 'openStream', at)).toBe(false)
        expect(isRetentionStale(fields, 1_000, 'value', at)).toBe(true)
    })

    test('ttl-from-close: re-stamping at close restarts the window', () => {
        const fields = slot()
        now += 10_000 // the stream ran for ten seconds
        stampRetained(fields, at) // …and settled now
        expect(isRetentionStale(fields, 1_000, 'value', at)).toBe(false)
        now += 1_000
        expect(isRetentionStale(fields, 1_000, 'value', at)).toBe(true)
    })
})

describe('the deadline flag (ADR 0028 D7)', () => {
    // A tripped run deadline retains the slot as SETTLED BUT EXPIRED, so `fn.error()` still reports the
    // TimeoutError while the very next read runs cold. It has to beat the ttl short-circuit, because a
    // read's default ttl is Infinity and a stamp cannot express "expired at an infinite ttl".
    test('beats an infinite ttl', () => {
        expect(
            isRetentionStale(slot({ expired: true }), Number.POSITIVE_INFINITY, 'value', at),
        ).toBe(true)
    })

    test('beats a fresh stamp', () => {
        expect(isRetentionStale(slot({ expired: true }), 10_000, 'value', at)).toBe(true)
    })

    // Even with nothing retained: the flag says this slot must run cold next, and 'nothing' would
    // otherwise answer "fresh" and let a cached rejection stand.
    test('beats an empty slot', () => {
        expect(isRetentionStale(slot({ expired: true }), 1_000, 'nothing', at)).toBe(true)
    })
})
