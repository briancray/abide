import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import NewDeal from './NewDeal.abide'

test('a deal that does not fit is refused, field by field', async () => {
    using _form = await mount(NewDeal({}))
    document.querySelector('button')?.click()
    await Bun.sleep(50)
    flushSync()
    const fields = [...document.querySelectorAll('li span')].map(
        (field) => field.textContent,
    )
    expect(fields.sort()).toEqual(['amount', 'company'])
})
