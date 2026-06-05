import { describe, expect, test } from 'bun:test'
import { createPushIterator } from '../src/lib/shared/createPushIterator.ts'

/*
The pending-value buffer is bounded so a subscriber whose next() falls behind a
chatty producer can't grow server memory without limit. At the cap the oldest
pending value is dropped (live fan-out is latest-wins); terminal end is always
delivered.
*/
describe('createPushIterator bounded buffer', () => {
    test('drops the oldest pending value once the cap is exceeded', async () => {
        const iterator = createPushIterator<number>(undefined, 3)
        // Push 5 values with no consumer parked — only the newest 3 survive.
        for (let value = 1; value <= 5; value++) {
            iterator.push(value)
        }
        iterator.end()

        const drained: number[] = []
        for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
            drained.push(next.value)
        }
        expect(drained).toEqual([3, 4, 5])
    })

    test('a parked consumer receives values without buffering', async () => {
        const iterator = createPushIterator<string>(undefined, 2)
        const pending = iterator.next()
        iterator.push('live')
        expect(await pending).toEqual({ value: 'live', done: false })
    })
})
