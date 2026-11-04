// 38.4, 38.11 — A KEPT CHECKER HEALS ITSELF: one whose project moved is closed and another opened,
// and one a question threw from is dropped, so `abide dev` and `abide lsp` each just ask for a live
// one. Asserted on the WORK — how many checkers were opened and closed — over a stand-in for
// `openChecker`, so nothing here spawns a checker or boots either server.

import { afterAll, expect, test } from 'bun:test'

import type { AppChecker } from '#compiler/compileApp.ts'
import { KeptChecker } from '#compiler/KeptChecker.ts'

import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

/** An opener of stand-in checkers, counting each opened and closed, and every move each was told. */
function opener(): {
    open: (root: string) => Promise<AppChecker>
    opened: number
    closed: number
    stale: boolean
    seen: (string | undefined)[]
} {
    const counts = {
        opened: 0,
        closed: 0,
        stale: false,
        seen: [] as (string | undefined)[],
        open: async (root: string): Promise<AppChecker> => {
            counts.opened += 1
            return {
                root,
                session: undefined as unknown as AppChecker['session'],
                saw: (path) => void counts.seen.push(path),
                layout: () => Promise.reject(new Error('unasked')),
                current: () => !counts.stale,
                close: async () => {
                    counts.closed += 1
                },
            }
        },
    }
    return counts
}

// THE REVERT: answer the kept checker from `live` without asking `current`; the second ask gets the
// stale one back, 1 opened where 2 are due and none closed.
test('a checker whose project moved is closed and another opened — 38.4', async () => {
    const counts = opener()
    const kept = new KeptChecker(temporaryModule({}), () => {}, counts.open)
    try {
        const first = await kept.live()
        expect(await kept.live()).toBe(first)
        counts.stale = true
        const second = await kept.live()
        counts.stale = false
        expect(second).not.toBe(first)
        expect({ opened: counts.opened, closed: counts.closed }).toEqual({
            opened: 2,
            closed: 1,
        })
    } finally {
        await kept.close()
    }
})

// THE REVERT: drop the `drop()` in `run`'s catch; the next question is asked of the checker that
// threw, 1 opened where 2 are due.
test('a checker a question threw from is dropped, and the next opens another — 38.11', async () => {
    const counts = opener()
    const kept = new KeptChecker(temporaryModule({}), () => {}, counts.open)
    try {
        const failed = await kept.live()
        await expect(
            kept.run(async () => {
                throw new Error('the checker died')
            }),
        ).rejects.toThrow('the checker died')
        expect(counts.closed).toBe(1)
        expect(await kept.run(async (checker) => checker)).not.toBe(failed)
        expect(counts.opened).toBe(2)
    } finally {
        await kept.close()
    }
})

// THE REVERT: drop the checker's `saw` from `KeptChecker.saw`; the move is heard and the checker is
// never told, `[]` where the path is due.
test('a move is told to the checker before whoever asked to hear it — 38.4', async () => {
    const counts = opener()
    let heard = 0
    const root = temporaryModule({})
    const kept = new KeptChecker(root, () => void (heard += 1), counts.open)
    try {
        await kept.live()
        kept.saw(`${root}/index.abide`)
        await kept.live()
        expect({ seen: counts.seen, heard }).toEqual({
            seen: [`${root}/index.abide`],
            heard: 1,
        })
    } finally {
        await kept.close()
    }
})
