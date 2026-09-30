// 18.10, 18.11, 18.13, 18.14 — WHERE A READER OF A VALUE'S PRODUCTIONS STARTS, for every lane that
// carries them: a socket's subscription over the mux, and a `GET` answered one production per frame
// (16.49). ONE MINTING FOR BOTH: the sequence number is the ordinal the value's owner minted (9.14),
// and the epoch is minted here the first time the value is carried — so a reader that moves from one
// lane to the other resumes rather than starting over.

import { historyFrom, retained } from '#shared/reactive/History.ts'
import { pastOf } from '#shared/reactive/index.ts'

// 18.11 — ONE EPOCH PER VALUE, minted the first time the value is carried and never moved after
// (9.19). Compared for equality alone.
const EPOCHS = new WeakMap<object, string>()

function epochOf(cell: object): string {
    let epoch = EPOCHS.get(cell)
    if (epoch === undefined) {
        epoch = crypto.randomUUID()
        EPOCHS.set(cell, epoch)
    }
    return epoch
}

/**
 * What a reader standing at `seq` under `epoch` is owed: the ring past where it stood, and a cursor
 * over every production after it.
 *
 * 18.13, 18.14 — ALL OF THE RING for a fresh reader, what it holds past `seq` for one resuming under
 * this value's epoch, and all of it `moved` where the epoch it carried is not this value's. The ring
 * is read and the cursor opened in one turn, so no production lands between the two.
 *
 * The cursor is NUMBERED BY WHERE IT STANDS (`at`) rather than by counting its turns: a cursor with
 * no ring collapses a burst onto the standing production (5.10), and that production's number is
 * the one a reconnect resumes from.
 */
export function resumeProductions(
    value: unknown,
    seq: number | undefined,
    epoch: string | undefined,
): {
    epoch: string
    moved: boolean
    ring: [number, unknown][]
    cursor: AsyncIterator<unknown> & { at: number }
} {
    // The past `s.history` would hand back — the adopted value's, swept of what outlived its `ttl`.
    const cell = pastOf(value)
    const current = epochOf(cell)
    const resumed = seq !== undefined && epoch === current
    const ring: [number, unknown][] = []
    // THE OLDEST PRODUCTION THE VALUE STILL RETAINS, which is where a fresh reader starts and where
    // one older than it is clamped to (9.10).
    const floor = cell.ordinal - retained(cell)
    let at = resumed ? Math.max(seq, floor) : floor
    for (const item of historyFrom(cell, at) as Iterable<unknown>) {
        at += 1
        ring.push([at, item])
    }
    return {
        epoch: current,
        moved: seq !== undefined && epoch !== current,
        ring,
        cursor: (historyFrom(cell, cell.ordinal) as AsyncIterable<unknown>)[
            Symbol.asyncIterator
        ]() as AsyncIterator<unknown> & { at: number },
    }
}
