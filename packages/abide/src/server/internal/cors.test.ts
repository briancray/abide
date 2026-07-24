// CORS normalization — the security-relevant case here is M4: a MALFORMED `crossOrigin.origin` must
// fail CLOSED (admit no origin), never fall open to allow-any.

import { expect, test } from 'bun:test'
import { corsAllowOrigin, normalizeCrossOrigin } from './cors.ts'

test('a malformed crossOrigin.origin fails closed — admits no origin (M4)', () => {
    // null / number / object / Set are all "not a string, not a boolean, not an array" — the branch that
    // previously fell to allow-any. Each must now admit nothing.
    for (const bad of [null, 0, {}, new Set(['https://ok.example'])]) {
        const cors = normalizeCrossOrigin({ origin: bad } as never)
        // A CORS policy is still produced (origin was present, just malformed) but its allowlist is empty.
        expect(cors).toBeDefined()
        if (cors === undefined) continue
        expect(corsAllowOrigin(cors, 'https://evil.example')).toBeUndefined()
        expect(corsAllowOrigin(cors, 'https://ok.example')).toBeUndefined()
    }
})

test('origin: true still admits any origin (unchanged)', () => {
    const cors = normalizeCrossOrigin(true)
    expect(cors).toBeDefined()
    if (cors === undefined) return
    expect(corsAllowOrigin(cors, 'https://any.example')).toBe('*')
})

test('a string origin admits only that origin', () => {
    const cors = normalizeCrossOrigin({ origin: 'https://ok.example' })
    expect(cors).toBeDefined()
    if (cors === undefined) return
    expect(corsAllowOrigin(cors, 'https://ok.example')).toBe('https://ok.example')
    expect(corsAllowOrigin(cors, 'https://evil.example')).toBeUndefined()
})
