import { describe, expect, test } from 'bun:test'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { escapeKey } from '../src/lib/ui/runtime/escapeKey.ts'

describe('doc paths — JSON Pointer escaping for keys containing / or ~', () => {
    test('escapeKey follows RFC 6901 (~ before /)', () => {
        expect(escapeKey('plain')).toBe('plain')
        expect(escapeKey('a/b')).toBe('a~1b')
        expect(escapeKey('a~b')).toBe('a~0b')
        expect(escapeKey('~/')).toBe('~0~1')
    })

    test('a key containing / round-trips through read/replace when escaped', () => {
        const d = doc({ byDate: {} })
        const key = '2026/06/18' // a date-shaped key — the classic breakage
        const path = `byDate/${escapeKey(key)}`

        d.replace(path, 'launch')
        expect(d.read<string>(path)).toBe('launch')
        // stored under the REAL key, not split into nested segments
        expect(d.snapshot()).toEqual({ byDate: { '2026/06/18': 'launch' } })
    })

    test('a slashed key is one segment, not a nested path', () => {
        const d = doc({ map: {} })
        d.replace(`map/${escapeKey('a/b')}`, 1)
        d.replace(`map/${escapeKey('c/d')}`, 2)
        expect(d.snapshot()).toEqual({ map: { 'a/b': 1, 'c/d': 2 } })
        expect(d.read<number>(`map/${escapeKey('a/b')}`)).toBe(1)
    })

    test('a cell bound to a slashed key reads and writes the right slot', () => {
        const d = doc({ map: { 'x/y': 0 } })
        const cell = d.cell<number>(`map/${escapeKey('x/y')}`)
        expect(cell.get()).toBe(0)
        cell.set(7)
        expect(cell.get()).toBe(7)
        expect((d.snapshot() as { map: Record<string, number> }).map['x/y']).toBe(7)
    })

    test('remove deletes the slashed key, not a phantom nested path', () => {
        const d = doc({ map: { 'a/b': 1, keep: 2 } })
        d.remove(`map/${escapeKey('a/b')}`)
        expect(d.snapshot()).toEqual({ map: { keep: 2 } })
    })
})
