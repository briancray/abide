import { expect, test } from 'bun:test'
import moveDeal from '../moveDeal.handler.ts'

test('a closed deal is refused by name, with its stage as data', async () => {
    try {
        await moveDeal({ id: 'd3', stage: 'lead' })
        throw new Error('expected a refusal')
    } catch (error) {
        if (!moveDeal.isError(error, 'DealClosed')) throw error
        expect(error.data).toEqual({ stage: 'won' })
    }
})
