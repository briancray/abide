import { describe, expect, test } from 'bun:test'
import { columnise } from './columnise.ts'

describe('columnise', () => {
    test('fills DOWN then across, so a sorted list stays alphabetical under your eye', () => {
        // Reading order for a sorted list runs down a column; across-then-down would zig-zag.
        // Width 7 with 1-char names is exactly two columns (cell = name + 2 gutter).
        expect(columnise(['a', 'b', 'c', 'd'], 7, 0)).toEqual(['a  c', 'b  d'])
    })

    test('pads to the longest name so the columns align', () => {
        expect(columnise(['short', 'muchlonger', 'x', 'y'], 40, 0)).toEqual([
            'short       x',
            'muchlonger  y',
        ])
    })

    test('does not pad the last cell on a row', () => {
        // Trailing spaces are invisible and would be the only content on the line after a resize.
        for (const line of columnise(['a', 'b', 'c'], 40, 0)) {
            expect(line).toBe(line.trimEnd())
        }
    })

    test('a ragged final column leaves the short row short', () => {
        expect(columnise(['a', 'b', 'c'], 7, 0)).toEqual(['a  c', 'b'])
    })

    test('narrower than one name still gives one column per row, never a dropped name', () => {
        const items = ['averylongcommandname', 'another']
        const lines = columnise(items, 4, 0)
        expect(lines).toEqual(['averylongcommandname', 'another'])
    })

    test('indents every row', () => {
        expect(columnise(['a', 'b'], 40, 2)).toEqual(['  a  b'])
    })

    test('an empty list produces no lines at all, not one blank one', () => {
        expect(columnise([], 40)).toEqual([])
    })

    test('every item appears exactly once', () => {
        const items = Array.from({ length: 59 }, (_, index) => `command${index}`)
        const emitted = columnise(items, 100).join(' ').trim().split(/\s+/)
        expect(emitted.sort()).toEqual([...items].sort())
    })
})
