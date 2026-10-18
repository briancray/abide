import { expect, test } from 'bun:test'
import exportDeals from '../exportDeals.ts'

test('the export answers a CSV file', async () => {
    const file = await exportDeals()
    expect(file.type).toBe('text/csv')
})
