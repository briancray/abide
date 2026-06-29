import { describe, expect, test } from 'bun:test'
import { withResponseDefaults } from '../src/lib/server/runtime/withResponseDefaults.ts'

const DEFAULTS = { 'cache-control': 'no-store', 'content-type': 'application/json' }

function headerEntries(init: ResponseInit): [string, string][] {
    return [...(init.headers as Headers).entries()].sort()
}

describe('withResponseDefaults', () => {
    test('no init: ships the defaults alone (skip-merge fast path)', () => {
        const init = withResponseDefaults(undefined, DEFAULTS)
        expect(headerEntries(init)).toEqual([
            ['cache-control', 'no-store'],
            ['content-type', 'application/json'],
        ])
    })

    test('init without headers: defaults preserved, status/statusText pass through', () => {
        const init = withResponseDefaults({ status: 201, statusText: 'Created' }, DEFAULTS)
        expect(init.status).toBe(201)
        expect(init.statusText).toBe('Created')
        expect((init.headers as Headers).get('cache-control')).toBe('no-store')
    })

    test('caller header overrides win per-key; un-overridden defaults remain', () => {
        const init = withResponseDefaults({ headers: { 'cache-control': 'max-age=60' } }, DEFAULTS)
        expect((init.headers as Headers).get('cache-control')).toBe('max-age=60')
        expect((init.headers as Headers).get('content-type')).toBe('application/json')
    })

    test('merges a Headers instance the same as a record', () => {
        const init = withResponseDefaults(
            { headers: new Headers({ 'x-extra': '1', 'cache-control': 'public' }) },
            DEFAULTS,
        )
        expect((init.headers as Headers).get('x-extra')).toBe('1')
        expect((init.headers as Headers).get('cache-control')).toBe('public')
    })

    test('positional status wins over init.status', () => {
        const init = withResponseDefaults({ status: 200 }, DEFAULTS, 404)
        expect(init.status).toBe(404)
    })
})
