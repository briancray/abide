import { expect, test } from 'bun:test'
import getDeal from '../getDeal.handler.ts'

test('the handler answers the deal its args name', async () => {
    const deal = await getDeal({ id: 'd2' })
    expect(deal.name).toBe('Compiler pilot')
})
