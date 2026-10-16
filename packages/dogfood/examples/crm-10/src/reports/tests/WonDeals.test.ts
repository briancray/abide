import { expect, spyOn } from 'bun:test'
import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'
import { gate } from '@abide/harness/gate'
import { money } from '../lib/money.ts'
import WonDeals from '../lib/WonDeals.abide'

gate(
    'a won deal is formatted without building a formatter',
    {
        // The version this replaced: a formatter built for every amount.
        revert: () => {
            const shared = money.format
            money.format = (amount) =>
                new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: 'USD',
                    maximumFractionDigits: 0,
                }).format(amount)
            return () => {
                money.format = shared
            }
        },
        worth: { formatters: 1 },
    },
    async () => {
        using _deals = await mount(WonDeals({}))
        const built = spyOn(Intl, 'NumberFormat')
        document.querySelector('button')?.click()
        flushSync()
        // Read before the restore, which clears what the spy recorded.
        const formatters = built.mock.calls.length
        built.mockRestore()
        expect(document.body.textContent).toContain('$12,500')
        expect(`formatters: ${formatters}`).toBe('formatters: 0')
    },
)
