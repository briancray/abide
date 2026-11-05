// THE SELECTION INDEX ON ITS OWN, without the graph: the cells are built bare and never run, so
// what is asserted is which values a selection REACHES (13.1, 13.6, 13.8) — what it does to them is
// `bareSelection.test.ts`'s and `reactive.test.ts`'s. The tags carry a prefix no other file uses:
// the index is process-wide, and `bun run test:serial` runs every file in one process.

import { beforeEach, expect, test } from 'bun:test'

import { CELL } from '#shared/reactive/CELL.ts'
import { Cell } from '#shared/reactive/cellShape.ts'
import {
    fileProducer,
    inReach,
    leaveSelections,
    tagCell,
    unfileProducers,
} from '#shared/reactive/selections.ts'

function bareCell(label: string, tags?: string[]): Cell {
    const cell = new Cell(
        label,
        null,
        undefined,
        tags === undefined ? undefined : { tags },
        false,
    )
    if (cell.tags !== null) tagCell(cell)
    return cell
}

beforeEach(unfileProducers)

test('a tag selection reaches each value carrying any of its tags, once — 13.1', () => {
    const both = bareCell('both', ['index:a', 'index:b'])
    const onlyB = bareCell('onlyB', ['index:b'])
    bareCell('other', ['index:c'])
    expect(inReach(['index:a'])).toEqual([both])
    expect(inReach(['index:a', 'index:b'])).toEqual([both, onlyB])
})

test('the bare selection reaches what is filed and nothing merely tagged — 13.6', () => {
    const filed = bareCell('filed')
    bareCell('tagged', ['index:t'])
    fileProducer(filed)
    expect(inReach(null)).toEqual([filed])
})

test('an evicted value leaves every selection at once — 13.1, 13.6', () => {
    const cell = bareCell('evicted', ['index:gone'])
    fileProducer(cell)
    leaveSelections({ [CELL]: cell })
    expect(inReach(['index:gone'])).toEqual([])
    expect(inReach(null)).toEqual([])
    // Not filed again by a later load: `filed` stays set, and the dropped handle is what took it out.
    expect(cell.filed).toBe(true)
})
