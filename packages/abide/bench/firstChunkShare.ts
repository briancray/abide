// WHAT THE LOST EARLY CALL COSTS (16.93, 41.20), in a real browser. A server-rendered page reading a
// streaming `GET`: over http its call is started by the head's early-call script, before the bundle;
// over the mux it is started once the bundle has run and the socket is open. The op somebody waits on
// is navigation -> first streamed chunk painted, so that is what is timed — in chromium, from the
// navigation's own time origin to the frame after the chunk's text landed, which is far above the
// browser clock's 100 µs (43.11). Each repo builds and serves the same fixture with its own CLI.
//
// `bun run bench:first-chunk <repo> [runs] [first chunk delay ms] [latency ms]`

import { chromium } from '@playwright/test'

import { servedFixture } from '../e2e/servedFixture.ts'
import { median } from './median.ts'

const REPO = process.argv[2] as string
const RUNS = Number(process.argv[3] ?? 15)
const DELAY = Number(process.argv[4] ?? 100)
// A round trip the network adds, emulated over CDP: localhost has none, and the bundle and the
// socket's handshake are what the mux waits on that the early call does not.
const LATENCY = Number(process.argv[5] ?? 0)

const TICKS = `import { GET } from '@abide/abide/server'

export default GET(async function* ({ n }: { n: string }) {
    await Bun.sleep(${DELAY})
    for (let at = 0; at < 40; at++) {
        yield { n, at }
        await Bun.sleep(25)
    }
})
`

const PAGE = `<script>
import { reactive } from '@abide/abide'
import ticks from '#src/data/ticks.handler.ts'

const a = reactive.derived(() => ticks({ n: 'a' }))
</script>

<main><p id="a">{a.ready() ? a().length : 0}</p></main>`

const { base, server } = await servedFixture(
    'first-chunk',
    {
        'data/ticks.handler.ts': TICKS,
        'streams/index.abide': PAGE,
    },
    {},
    REPO,
)

const browser = await chromium.launch()
const times: number[] = []
let landedBeforeLoad = 0
for (let run = 0; run < RUNS; run++) {
    const context = await browser.newContext()
    const page = await context.newPage()
    if (LATENCY > 0) {
        const session = await context.newCDPSession(page)
        await session.send('Network.enable')
        await session.send('Network.emulateNetworkConditions', {
            offline: false,
            latency: LATENCY,
            downloadThroughput: -1,
            uploadThroughput: -1,
        })
    }
    await page.addInitScript(() => {
        const seen = (): void => {
            const text = document.getElementById('a')?.textContent ?? '0'
            if (text === '0') return
            observer.disconnect()
            const at = performance.now()
            requestAnimationFrame(() => {
                ;(window as unknown as { painted: number[] }).painted = [
                    at,
                    performance.now(),
                ]
            })
        }
        const observer = new MutationObserver(seen)
        observer.observe(document, {
            subtree: true,
            childList: true,
            characterData: true,
        })
    })
    await page.goto(`${base}/streams`)
    const initial = await page.textContent('#a')
    if (initial !== '0') landedBeforeLoad += 1
    const painted = (await page
        .waitForFunction(
            () => (window as unknown as { painted?: number[] }).painted,
            undefined,
            { timeout: 10_000 },
        )
        .then((handle) => handle.jsonValue())) as number[]
    times.push(painted[1] as number)
    await context.close()
}
await browser.close()
server.kill()

times.sort((a, b) => a - b)
const middle = median(times)
console.log(
    `${REPO}: delay ${DELAY} ms, latency ${LATENCY} ms, ${RUNS} runs — navigation -> first chunk painted: median ${middle.toFixed(1)} ms, min ${times[0]?.toFixed(1)}, max ${times.at(-1)?.toFixed(1)}${landedBeforeLoad > 0 ? ` (${landedBeforeLoad} landed before load)` : ''}`,
)
