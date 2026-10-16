import { expect, test } from 'bun:test'
import olderActivity from '../olderActivity.ts'

test('the first entry is in hand while the rest are still read', async () => {
    const entries = olderActivity()
    const stillReading: boolean[] = []
    for await (const _entry of entries) stillReading.push(entries.busy())
    expect(stillReading).toHaveLength(3)
    expect(stillReading[0]).toBe(true)
})
