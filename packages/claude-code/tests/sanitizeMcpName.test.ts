import { describe, expect, test } from 'bun:test'
import { sanitizeMcpName } from '../src/sanitizeMcpName.ts'

/* The prefix permission rules rely on must be a legal `mcp__<name>__*` token and
deterministic — same input, same token — so rules stay valid across deploys. */
describe('sanitizeMcpName', () => {
    test('keeps the npm scope for uniqueness, dropping the leading @', () => {
        expect(sanitizeMcpName('@acme/shop')).toBe('acme_shop')
    })

    test('collapses every non-word run to a single underscore', () => {
        expect(sanitizeMcpName('belte-app')).toBe('belte_app')
        expect(sanitizeMcpName('My App v2.0')).toBe('My_App_v2_0')
    })

    test('trims edge underscores', () => {
        expect(sanitizeMcpName('@scope/')).toBe('scope')
    })

    test('is idempotent on an already-legal token', () => {
        expect(sanitizeMcpName('acme_shop')).toBe('acme_shop')
    })
})
