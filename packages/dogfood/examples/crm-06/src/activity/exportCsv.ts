import { bytes, GET } from '@abide/abide/server'

const ENCODER = new TextEncoder()

const ROWS = [
    ['2026-09-02', 'Call', 'Intro call, asked for pricing'],
    ['2026-09-09', 'Email', 'Sent the proposal'],
    ['2026-10-01', 'Meeting', 'Signed for 40 seats'],
]

/** A cursor over the rows, so the file is written as they are read. */
async function* csvOf(): AsyncGenerator<Uint8Array> {
    yield ENCODER.encode('date,kind,note\n')
    for (const [date, kind, note] of ROWS) {
        await Bun.sleep(200)
        yield ENCODER.encode(`${date},${kind},"${note}"\n`)
    }
}

/** Answers at /activity/exportCsv with a file, whatever the caller asks. */
export default GET(() => bytes(csvOf()), {
    description: "Hopper & Co's activity, as CSV.",
})
