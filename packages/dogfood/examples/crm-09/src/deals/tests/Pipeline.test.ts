import { expect, test } from 'bun:test'
import { reactive, refresh } from '@abide/abide'
import listDeals from '../listDeals.ts'

test('a refresh is busy and still ready; a first load is not', async () => {
    const deals = reactive(() => listDeals())
    expect([deals.busy(), deals.ready()]).toEqual([true, false])
    await deals
    refresh(deals)
    // The figures already on screen stay there.
    expect([deals.busy(), deals.ready()]).toEqual([true, true])
})
