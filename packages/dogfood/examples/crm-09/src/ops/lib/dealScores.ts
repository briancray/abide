import { reactive } from '@abide/abide'

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
        worker.terminate()
    }
}

export const dealScores = reactive(scoreInWorker, { global: true })
