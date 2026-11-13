import { reactive, stopSignal } from '@abide/abide'

import { DEALS } from '../../pipeline/lib/DEALS.server.ts'

type Score = { name: string; score: number }

/** Scores every deal in a worker thread, yielding each score as it lands. */
async function* scoreInWorker(): AsyncGenerator<Score> {
    // ref: false — the worker alone never keeps the process up
    const worker = new Worker(new URL('./scoreWorker.ts', import.meta.url), {
        ref: false,
    })
    const landed: (Score | Error | null)[] = []
    let wake = () => {}
    worker.onmessage = ({ data }) => {
        landed.push(data)
        wake()
    }
    worker.onerror = (event) => {
        landed.push(new Error(event.message))
        wake()
    }
    // the app stopping ends the scoring now, ahead of any score still queued
    const stopping = stopSignal()
    const stop = () => {
        landed.unshift(null)
        wake()
    }
    stopping.addEventListener('abort', stop)
    // the worker has its own modules: send it the data
    worker.postMessage(DEALS)
    try {
        for (;;) {
            if (landed.length === 0)
                await new Promise<void>((done) => (wake = done))
            const next = landed.shift()
            if (next === null) return
            if (next instanceof Error) throw next
            if (next !== undefined) yield next
        }
    } finally {
        stopping.removeEventListener('abort', stop)
        worker.terminate()
    }
}

/** Rescored an hour after the last scoring ends, from a minute in. */
export const dealScores = reactive(scoreInWorker, {
    global: true,
    poll: { every: 3_600_000, after: 'settle', delay: 60_000 },
})
