import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

const post = (address: string, body: unknown, cookie: string) =>
    new Request(`http://crm.invalid${address}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
    })

test('a report of the failed call is listed by its browser alone', async () => {
    await using app = await createApp()
    const failed = await app.fetch(
        post('/ops/sendStatement', { id: 'c2' }, 'abide-caller=desk'),
    )
    expect(failed.status).toBe(502)
    // The trace `onRefusal` hands the page, from the answer's own header.
    const trace = failed.headers.get('traceresponse')?.split('-')[1]
    const sent = await app.fetch(
        post(
            '/__abide/report',
            { summary: 'Statements do not send', traces: [trace], lines: [] },
            'abide-caller=desk',
        ),
    )
    expect(sent.status).toBe(200)
    const listed = (cookie: string) =>
        app
            .fetch(
                new Request('http://crm.invalid/ops/listReports', {
                    headers: { cookie },
                }),
            )
            .then((answer) => answer.json())
    expect(await listed('abide-caller=desk')).toEqual([
        'Statements do not send',
    ])
    expect(await listed('abide-caller=elsewhere')).toEqual([])
})
