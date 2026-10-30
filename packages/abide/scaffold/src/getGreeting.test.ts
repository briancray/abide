import { expect, test } from 'bun:test'

import getGreeting from './getGreeting.handler.ts'

test('the handler answers with the name it is given', async () => {
    expect(await getGreeting({ name: 'Ada' })).toBe('Hello, Ada')
})
