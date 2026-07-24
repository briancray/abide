// Baseline security headers stamped at the one router choke point (auth.md §baseline). Focus here: the
// X-Frame-Options clickjacking guard must key off the content-type CASE-INSENSITIVELY (M8) — a
// `Content-Type` is a case-insensitive token, so `Text/HTML` must not slip past.

import { expect, test } from 'bun:test'
import { applyResponseHeaders } from './applyResponseHeaders.ts'

test('X-Frame-Options is stamped for a mixed-case text/html content-type (M8)', () => {
    const response = new Response('<h1>hi</h1>', {
        headers: { 'content-type': 'Text/HTML; charset=utf-8' },
    })
    applyResponseHeaders(response)
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN')
})

test('X-Frame-Options is stamped for a canonical text/html content-type', () => {
    const response = new Response('<h1>hi</h1>', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
    })
    applyResponseHeaders(response)
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN')
})

test('X-Frame-Options is NOT stamped for a non-HTML content-type', () => {
    const response = new Response('{}', { headers: { 'content-type': 'application/json' } })
    applyResponseHeaders(response)
    expect(response.headers.get('x-frame-options')).toBeNull()
})
