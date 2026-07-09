import { describe, expect, test } from 'bun:test'
import { parseArgs } from '../src/lib/server/rpc/parseArgs.ts'
import { encodeRefJson } from '../src/lib/shared/encodeRefJson.ts'
import { REF_JSON_HEADER } from '../src/lib/shared/REF_JSON_HEADER.ts'
import type { InputCoercion } from '../src/lib/shared/types/InputCoercion.ts'

/*
ADR-0028: a GET/form request delivers every field as a string, so the build stamps a `coerce`
plan of exactly which fields are numeric/boolean in the endpoint's Args type. parseArgs turns
those string values into the typed value the input schema expects — and leaves everything else a
string, so a value that merely looks numeric never gets corrupted.
*/
const PLAN: InputCoercion = { id: 'number', active: 'boolean', tags: 'number' }

const get = (query: string, coerce?: InputCoercion) =>
    parseArgs(
        'GET',
        new Request(`https://test.local/rpc/x?${query}`),
        undefined,
        coerce,
    ) as Promise<Record<string, unknown>>

describe('parseArgs query coercion (ADR-0028)', () => {
    test('numeric and boolean query fields coerce to their typed values', async () => {
        const args = await get('id=2&active=true', PLAN)
        expect(args).toEqual({ id: 2, active: true })
    })

    test('a repeated key coerces per element into a typed array', async () => {
        const args = await get('tags=1&tags=2&tags=3', PLAN)
        expect(args.tags).toEqual([1, 2, 3])
    })

    test('a string field that looks numeric is left a string (not in the plan)', async () => {
        /* `name` is a string field the plan omits — a numeric-looking id/zip must survive. */
        const args = await get('id=2&name=007', PLAN)
        expect(args).toEqual({ id: 2, name: '007' })
    })

    test('active=false coerces to the boolean false, not a truthy string', async () => {
        const args = await get('active=false', PLAN)
        expect(args.active).toBe(false)
    })

    test('a non-numeric value for a numeric field stays a string so validation can reject it', async () => {
        const args = await get('id=abc', PLAN)
        expect(args.id).toBe('abc')
    })

    test('an empty numeric value stays the empty string (never coerced to 0)', async () => {
        const args = await get('id=', PLAN)
        expect(args.id).toBe('')
    })

    test('with no plan every field stays a string (fail-open, today’s behavior)', async () => {
        const args = await get('id=2&active=true')
        expect(args).toEqual({ id: '2', active: 'true' })
    })

    test('a JSON body value already typed is not re-coerced', async () => {
        /* A POST whose JSON body carries a real number: the merge keeps it a number, and coercion
           only touches strings, so it is untouched. */
        const request = new Request('https://test.local/rpc/x', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: 2, active: true }),
        })
        const args = (await parseArgs('POST', request, undefined, PLAN)) as Record<string, unknown>
        expect(args).toEqual({ id: 2, active: true })
    })

    test('a form-encoded body coerces its numeric/boolean fields', async () => {
        const request = new Request('https://test.local/rpc/x', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: 'id=5&active=false&name=keep',
        })
        const args = (await parseArgs('POST', request, undefined, PLAN)) as Record<string, unknown>
        expect(args).toEqual({ id: 5, active: false, name: 'keep' })
    })
})

/*
ADR-0029: the plan codomain widens from scalars to structured wire kinds. parseArgs revives a
`Date` from an ISO string, a `bigint` from a numeric string (query paths), and a `Set`/`Map` from
a JSON array/entries (a non-abide JSON body) — top-level fields only, fail-open for the
unrevivable, and already-typed values (the abide ref-json path) pass through untouched.
*/
const STRUCTURED: InputCoercion = {
    when: 'date',
    big: 'bigint',
    ids: 'set',
    counts: 'map',
}

describe('parseArgs structured wire codec (ADR-0029)', () => {
    test('an ISO-string query field revives to a Date', async () => {
        const args = await get('when=2020-01-02T03:04:05.000Z', STRUCTURED)
        expect(args.when).toBeInstanceOf(Date)
        expect((args.when as Date).toISOString()).toBe('2020-01-02T03:04:05.000Z')
    })

    test('an unparseable date stays a string so validation can reject it', async () => {
        const args = await get('when=not-a-date', STRUCTURED)
        expect(args.when).toBe('not-a-date')
    })

    test('a numeric-string query field revives to a bigint', async () => {
        const args = await get('big=9007199254740993', STRUCTURED)
        expect(args.big).toBe(9007199254740993n)
    })

    test('a non-integer bigint value stays a string (fail-open)', async () => {
        const args = await get('big=1.5', STRUCTURED)
        expect(args.big).toBe('1.5')
    })

    test('an empty bigint value stays the empty string (never coerced to 0n)', async () => {
        const args = await get('big=', STRUCTURED)
        expect(args.big).toBe('')
    })

    test('a JSON array body field revives to a Set', async () => {
        const request = new Request('https://test.local/rpc/x', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ids: ['a', 'b', 'a'] }),
        })
        const args = (await parseArgs('POST', request, undefined, STRUCTURED)) as Record<
            string,
            unknown
        >
        expect(args.ids).toBeInstanceOf(Set)
        expect([...(args.ids as Set<string>)]).toEqual(['a', 'b'])
    })

    test('a JSON entries body field revives to a Map', async () => {
        const request = new Request('https://test.local/rpc/x', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                counts: [
                    ['a', 1],
                    ['b', 2],
                ],
            }),
        })
        const args = (await parseArgs('POST', request, undefined, STRUCTURED)) as Record<
            string,
            unknown
        >
        expect(args.counts).toBeInstanceOf(Map)
        expect([...(args.counts as Map<string, number>)]).toEqual([
            ['a', 1],
            ['b', 2],
        ])
    })

    test('an already-typed ref-json body value passes through untouched', async () => {
        /* The abide client encodes a structured POST body with ref-json (which round-trips Set/Map/
           Date/bigint). parseArgs decodes it to real values BEFORE applying the plan, so reviveValue
           must leave an existing Set/Map/Date/bigint alone rather than re-wrap it. */
        const request = new Request('https://test.local/rpc/x', {
            method: 'POST',
            headers: { 'content-type': 'application/json', [REF_JSON_HEADER]: '1' },
            body: encodeRefJson({
                ids: new Set(['x', 'y']),
                counts: new Map([['a', 1]]),
                when: new Date('2021-06-07T00:00:00.000Z'),
                big: 42n,
            }),
        })
        const args = (await parseArgs('POST', request, undefined, STRUCTURED)) as Record<
            string,
            unknown
        >
        expect([...(args.ids as Set<string>)]).toEqual(['x', 'y'])
        expect([...(args.counts as Map<string, number>)]).toEqual([['a', 1]])
        expect((args.when as Date).toISOString()).toBe('2021-06-07T00:00:00.000Z')
        expect(args.big).toBe(42n)
    })

    test('with no structured field present the untouched fields survive', async () => {
        /* A query that carries only an unrelated string leaves the plan a no-op on absent keys. */
        const args = await get('name=keep', STRUCTURED)
        expect(args).toEqual({ name: 'keep' })
    })
})
