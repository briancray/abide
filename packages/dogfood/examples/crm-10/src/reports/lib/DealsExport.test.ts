import { expect, test } from 'bun:test'

import { render } from '@abide/abide/server'
import { bytes } from '@abide/harness/server'

import DealsExport from './DealsExport.abide'
import { dealsOf } from './dealsOf.ts'

const exportOf = async (count: number) =>
    bytes(await render(DealsExport({ deals: dealsOf(count) })))

test('every deal adds the same bytes at any length', async () => {
    const [twenty, forty, eighty] = await Promise.all([
        exportOf(20),
        exportOf(40),
        exportOf(80),
    ])
    expect(eighty - forty).toBe(2 * (forty - twenty))
})
