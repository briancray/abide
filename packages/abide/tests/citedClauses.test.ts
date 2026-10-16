import { expect, test } from 'bun:test'
import { citedClauses } from '#compiler/citedClauses.ts'
import { isIgnored } from '#compiler/isIgnored.ts'

// 14.19, 38.118 — one reading of what a message cites: a trailing list names every clause in it,
// and a citation mid-message is read where it stands.
test('every clause a message cites is read, in order — 14.19, 38.118', () => {
    expect(citedClauses('abide: x. RULEBOOK 14.14.')).toEqual(['14.14'])
    expect(citedClauses('abide: x. RULEBOOK 32.14, 32.32.')).toEqual([
        '32.14',
        '32.32',
    ])
    expect(
        citedClauses('abide: x (RULEBOOK 31.3). Give the app a tsconfig.'),
    ).toEqual(['31.3'])
    expect(citedClauses('abide: x.')).toEqual([])
})

test('a directive naming any clause a warning cites silences it — 14.19', () => {
    const text = '// abide-ignore 32.32\nread'
    const offset = text.indexOf('read')
    expect(isIgnored(text, offset, 'abide: x. RULEBOOK 32.14, 32.32.')).toBe(
        true,
    )
    expect(isIgnored(text, offset, 'abide: x. RULEBOOK 32.14.')).toBe(false)
})
