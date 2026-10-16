import { expect, test } from 'bun:test'
import { createApp } from '@abide/abide/server'

const sync = () =>
    new Request('http://crm.invalid/ops/syncContact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'c2' }),
    })

test('both modules log under the one trace of the request', async () => {
    await using app = await createApp()
    const answer = await app.fetch(sync())
    const { trace, lines } = await answer.json()
    expect(lines).toEqual([
        'contact c2 loaded',
        'billing told about contact c2',
    ])
    // A second request is a second trace.
    const again = await (await app.fetch(sync())).json()
    expect(again.trace).not.toBe(trace)
})
