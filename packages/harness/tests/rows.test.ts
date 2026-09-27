// WHAT A RUN SELECTS. The page shows the rows `matchesFilter` keeps and the runner runs the rows
// `inScope` and `matchesFilter` keep, so "Run 6 shown" running a seventh is a bug in here.

import { expect, test } from 'bun:test'
import { inScope, matchesFilter } from '../scripts/rows.ts'

const ITEM = {
    id: 'reactive/fan-out',
    section: 'Reactive core',
    name: 'fan-out to 10 readers',
}

test('a scope selects everything, a section, one item, or nothing', () => {
    expect(inScope(ITEM, 'all')).toBe(true)
    expect(inScope(ITEM, 'section:Reactive core')).toBe(true)
    expect(inScope(ITEM, 'section:Compiler')).toBe(false)
    expect(inScope(ITEM, 'item:reactive/fan-out')).toBe(true)
    expect(inScope(ITEM, 'item:reactive/fan-in')).toBe(false)
    expect(inScope(ITEM, '')).toBe(false)
})

test('the filter reads the section and the name, whatever the case', () => {
    expect(matchesFilter(ITEM, '')).toBe(true)
    expect(matchesFilter(ITEM, '  FAN ')).toBe(true)
    expect(matchesFilter(ITEM, 'reactive')).toBe(true)
    expect(matchesFilter(ITEM, 'compiler')).toBe(false)
})
