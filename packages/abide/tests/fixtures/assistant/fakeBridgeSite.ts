#!/usr/bin/env bun
// A SITE'S RELAY THAT MISBEHAVES ON PURPOSE, for the bridge's own failures (44.24, 44.25, 44.27). It
// prints its origin, then one line per thing it saw: `resumed <authorization>` for a redial,
// `report <line>` for each report posted.
//
// `bun fakeBridgeSite.ts <how>`, where `how` is
//   drop        the pairing stream ends right after `paired`; a redial is told `bye`.
//   mute        the pairing stream says `paired` and then nothing, never ending; a redial is told `bye`.
//   refuse      a turn is sent, and every report is refused 500.
//   silent      a turn is sent, every report is taken, and no reply is ever sent.
// A refuse or silent site says `bye` once a turn's `end` or `fail` is reported.

const how = process.argv[2]
const ENCODER = new TextEncoder()
const TOKEN = 'token-1'
let pairing: ReadableStreamDefaultController<Uint8Array> | undefined

const frame = (value: unknown): Uint8Array =>
    ENCODER.encode(`data: ${JSON.stringify(value)}\n\n`)

function events(
    start: (stream: ReadableStreamDefaultController<Uint8Array>) => void,
): Response {
    return new Response(new ReadableStream<Uint8Array>({ start }), {
        headers: { 'content-type': 'text/event-stream' },
    })
}

const server = Bun.serve({
    port: 0,
    // The pairing stream is quiet for as long as a turn is: bun's idle timeout would end it.
    idleTimeout: 0,
    async fetch(request) {
        const url = new URL(request.url)
        if (request.method === 'GET' && url.searchParams.has('code'))
            return events((stream) => {
                pairing = stream
                stream.enqueue(frame({ type: 'paired', token: TOKEN }))
                if (how === 'drop') stream.close()
                else if (how === 'mute') return
                else
                    stream.enqueue(
                        frame({
                            type: 'turn',
                            id: 'turn-1',
                            prompt: [{ type: 'text', text: 'record' }],
                            config: {},
                            maxTurns: 5,
                        }),
                    )
            })
        if (request.method === 'GET') {
            console.log(`resumed ${request.headers.get('authorization')}`)
            return events((stream) => {
                stream.enqueue(frame({ type: 'bye' }))
                stream.close()
            })
        }
        let ended = false
        for (const line of (await request.text()).split('\n')) {
            console.log(`report ${line}`)
            const { type } = JSON.parse(line) as { type: string }
            if (type === 'end' || type === 'fail') ended = true
        }
        if (ended && pairing !== undefined) {
            pairing.enqueue(frame({ type: 'bye' }))
            pairing.close()
            pairing = undefined
        }
        return new Response(null, { status: how === 'refuse' ? 500 : 204 })
    },
})

console.log(server.url.href)
