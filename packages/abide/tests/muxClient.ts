// A MUX CLIENT IN A PROCESS OF ITS OWN, for a file following a served app's `GET`s: happy-dom's preload
// is in the test's process, and its `WebSocket` is not bun's.

import { lastLinePrinted } from './builtApp.ts'
import { temporaryModule } from './temporaryModule.ts'

// Runs `steps` in a bun process against the mux, handing back every frame it received, in order.
// `get` and `post` call the app over http. NOTHING IS SEQUENCED BY THE CLOCK: `settled()` sends a
// subscription to an address nothing answers, which the mux refuses as it reads it, so its refusal
// coming back says every frame sent before it has been taken; `until` waits on a frame the test is
// owed. Then a last `settled()`, and the socket closed and drained, so a frame the server sent
// before it took the close — one too many, which is what most of these are about — lands ahead
// of what is said.
export async function muxClient(
    base: string,
    directory: string,
    steps: string,
    upgrade: Record<string, string> = {},
): Promise<Record<string, unknown>[]> {
    const dir = temporaryModule({
        'client.ts': `const base = process.argv[2]
type Frame = Record<string, unknown>
const frames: Frame[] = []
const ws = new WebSocket(base.replace('http', 'ws') + '/__abide/socket', { headers: ${JSON.stringify(upgrade)} } as never)
const send = (frame: unknown) => ws.send(JSON.stringify(frame))
const get = (path: string, headers: Record<string, string> = {}) => fetch(base + '/${directory}/' + path, { headers })
const post = (path: string, body: unknown) => fetch(base + '/${directory}/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const BARRIER = 1000
let barrier = BARRIER
const refused = new Map<number, () => void>()
const settled = () =>
    new Promise<void>((done) => {
        barrier += 1
        refused.set(barrier, done)
        send({ op: 'sub', id: barrier, address: '/${directory}/nothingAnswersHere' })
    })
let arrived = () => {}
const until = async (owed: (frames: Frame[]) => boolean) => {
    const deadline = Date.now() + 3000
    while (!owed(frames) && Date.now() < deadline)
        await new Promise<void>((done) => {
            arrived = done
            setTimeout(done, 50).unref()
        })
}
ws.onmessage = (event) => {
    const frame = JSON.parse(String(event.data)) as Frame
    if (frame.op === 'error' && (frame.id as number) > BARRIER) {
        refused.get(frame.id as number)?.()
        return
    }
    frames.push(frame)
    arrived()
}
await new Promise((done) => (ws.onopen = done))
${steps}
await settled()
ws.close()
await new Promise((done) => (ws.onclose = done))
console.log(JSON.stringify(frames))
process.exit(0)
`,
    })
    return lastLinePrinted(['bun', `${dir}/client.ts`, base])
}
