import { expect, test } from 'bun:test'
import salesReport from '../salesReport.ts'

test('a report slower than the timeout runs, a row at a time', async () => {
    const rows = []
    for await (const row of salesReport({ region: 'north' })) rows.push(row)
    // 600 ms in all, under a 500 ms timeout.
    expect(rows).toHaveLength(2)
})

test('a report that stops producing is refused 504', async () => {
    const rows = []
    try {
        for await (const row of salesReport({ region: 'south' })) rows.push(row)
        throw new Error('the stall was not refused')
    } catch (refusal) {
        if (!salesReport.isError(refusal, 'HttpError')) throw refusal
        expect(refusal.status).toBe(504)
    }
    expect(rows).toHaveLength(1)
})
