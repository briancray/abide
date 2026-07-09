import { describe, expect, test } from 'bun:test'
import { parseArgs } from '../src/lib/server/rpc/parseArgs.ts'
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
