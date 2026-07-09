import { describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { reviveWireOutput } from '../src/lib/shared/reviveWireOutput.ts'
import type { OutputWirePlan } from '../src/lib/shared/types/OutputWirePlan.ts'
import { wireJsonReplacer } from '../src/lib/shared/wireJsonReplacer.ts'

/* ADR-0029 output path. The server ENCODE step (a value-directed replacer in json()) rewrites the
   structured runtime values plain JSON can't carry into honest JSON — a `Set` → array, a `Map` →
   `[K,V]` entries, a `bigint` → digit string, a `Date` → ISO string (native). The client DECODE step
   (reviveWireOutput, type-directed by the baked plan) revives them back off a decoded response. */

describe('wireJsonReplacer server encode (value-directed, all clients)', () => {
    test('a Set encodes to a JSON array', () => {
        expect(JSON.stringify(new Set([1, 2, 3]), wireJsonReplacer)).toBe('[1,2,3]')
    })

    test('a Map encodes to a JSON array of [key, value] entries', () => {
        const map = new Map<string, number>([
            ['a', 1],
            ['b', 2],
        ])
        expect(JSON.stringify(map, wireJsonReplacer)).toBe('[["a",1],["b",2]]')
    })

    test('a bigint encodes to a digit string (no throw)', () => {
        expect(JSON.stringify(10n, wireJsonReplacer)).toBe('"10"')
    })

    test('nested structured values encode recursively', () => {
        const value = { ids: new Set(['x']), counts: new Map([['a', 2n]]) }
        expect(JSON.stringify(value, wireJsonReplacer)).toBe('{"ids":["x"],"counts":[["a","2"]]}')
    })
})

describe('json() serializes structured returns to honest JSON (no 500)', () => {
    test('a top-level bigint return is a digit string, not a 500', async () => {
        const response = json(10n)
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain('application/json')
        expect(await response.text()).toBe('"10"')
    })

    test('Set/Map/bigint/Date fields cross as array/entries/string/ISO', async () => {
        const response = json({
            ids: new Set(['a', 'b']),
            counts: new Map<string, number>([['x', 1]]),
            big: 42n,
            when: new Date('2020-01-02T03:04:05.000Z'),
            name: 'plain',
        })
        expect(await response.json()).toEqual({
            ids: ['a', 'b'],
            counts: [['x', 1]],
            big: '42',
            when: '2020-01-02T03:04:05.000Z',
            name: 'plain',
        })
    })

    test('a plain array return still crosses as a plain array', async () => {
        const response = json({ tags: ['a', 'b'] })
        expect(await response.json()).toEqual({ tags: ['a', 'b'] })
    })
})

describe('reviveWireOutput client decode (type-directed by the baked plan)', () => {
    const plan: OutputWirePlan = { ids: 'set', counts: 'map', big: 'bigint', when: 'date' }

    test('round-trips Set/Map/bigint/Date from a decoded body, leaving unplanned fields alone', () => {
        /* The wire form a decoded json() response yields, then revived per the plan. */
        const body = {
            ids: ['a', 'b'],
            counts: [['x', 1]],
            big: '42',
            when: '2020-01-02T03:04:05.000Z',
            name: 'plain',
            tags: ['keep', 'as', 'array'],
        }
        const revived = reviveWireOutput(body, plan) as Record<string, unknown>
        expect(revived.ids).toBeInstanceOf(Set)
        expect([...(revived.ids as Set<string>)]).toEqual(['a', 'b'])
        expect(revived.counts).toBeInstanceOf(Map)
        expect([...(revived.counts as Map<string, number>)]).toEqual([['x', 1]])
        expect(revived.big).toBe(42n)
        expect(revived.when).toBeInstanceOf(Date)
        expect((revived.when as Date).toISOString()).toBe('2020-01-02T03:04:05.000Z')
        /* A field absent from the plan — a genuine array — is untouched. */
        expect(revived.tags).toEqual(['keep', 'as', 'array'])
        expect(revived.name).toBe('plain')
    })

    test('encode → decode is a full round trip for a handler return', async () => {
        const value = {
            ids: new Set(['a', 'b']),
            counts: new Map<string, number>([['x', 1]]),
            big: 42n,
            when: new Date('2020-01-02T03:04:05.000Z'),
        }
        const wire = await json(value).json()
        const revived = reviveWireOutput(wire, plan) as typeof value
        expect(revived).toEqual(value)
    })

    test('fail-open: no plan leaves the body untouched', () => {
        const body = { ids: ['a'] }
        expect(reviveWireOutput(body, undefined)).toBe(body)
    })

    test('fail-open: an unrevivable value keeps its wire form, never throws', () => {
        /* A non-integer bigint string and a non-array where a set is declared stay as-is. */
        const body = { big: 'not-a-number', ids: 42 }
        const revived = reviveWireOutput(body, { big: 'bigint', ids: 'set' }) as Record<
            string,
            unknown
        >
        expect(revived.big).toBe('not-a-number')
        expect(revived.ids).toBe(42)
    })

    test('a top-level array body (no named fields) is returned as-is', () => {
        const body = [1, 2, 3]
        expect(reviveWireOutput(body, plan)).toBe(body)
    })
})
