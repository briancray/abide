// 16.11, 16.7 — A NO-ARGS MUTATION BEHIND RUNGS RUNS ITS BODY ONLY THROUGH THEM, OVER THE WIRE. Its
// call drops the last call's spent answer first, and reaching the handler's own value to drop it
// built the request's instance, which started the bare body ahead of the rungs: a streaming write
// began, and a rung that read what it wrote then refused the call in its place. THE REVERT: have
// `call` drop `value`'s answer whatever the rungs; `order` reads body before rung, and the guard
// answers 409 to a call it should have let through.

import { expect, test } from 'bun:test'

import { POST, refuse } from '#server'

import { inMemoryApp } from './inMemoryApp.ts'

const order: string[] = []
let running = false

const guard = async <Ctx>(next: (ctx?: Ctx) => Promise<unknown>, ctx: Ctx) => {
    order.push('rung')
    if (running) return refuse(409, 'already running')
    return next(ctx)
}

const HANDLERS = {
    'jobs/stream.handler.ts': {
        default: POST(
            async function* () {
                order.push('body')
                running = true
                try {
                    yield 1
                    yield 2
                } finally {
                    running = false
                }
            },
            { middleware: [guard] },
        ),
    },
    'jobs/plain.handler.ts': {
        default: POST(
            () => {
                order.push('body')
                return 'done'
            },
            { middleware: [guard] },
        ),
    },
}

test('a no-args mutation behind a rung, called over the wire, runs the rung first and the body once — 16.11, 16.7', async () => {
    await using app = await inMemoryApp(HANDLERS)
    for (const name of ['stream', 'plain']) {
        order.length = 0
        const answer = await app.fetch(
            new Request(`http://app.invalid/jobs/${name}`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    accept: 'application/jsonl',
                },
                body: '{}',
            }),
        )
        const text = await answer.text()
        expect({ name, status: answer.status, order: [...order] }).toEqual({
            name,
            status: 200,
            order: ['rung', 'body'],
        })
        expect(text).toBe(name === 'stream' ? '1\n2\n' : '"done"')
    }
})
