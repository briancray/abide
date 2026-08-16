import { GET } from 'abide/server'

/**
 * A handler yields IFF it is declared `function*`. The compiler reads that off the SYNTAX, so the
 * generated stub knows to stream without the declaration saying "stream" anywhere.
 *
 * A caller consumes it with `for await`, and gets the replay first: everything that already happened,
 * then everything that comes next — the same contract a `channel`'s cursor has, because it is the same
 * transcript underneath.
 */
export const countdown = GET(async function* ({ from }: { from: number }) {
    for (let n = from; n > 0; n--) {
        await new Promise((settle) => setTimeout(settle, 50))
        yield n
    }
})
