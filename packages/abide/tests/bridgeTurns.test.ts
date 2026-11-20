import { expect, test } from 'bun:test'

import { serveTurns, type TurnReport } from '../../bridge/src/serveTurns.ts'

// THE REVERT: with `beforeTurn` awaited outside the `try`, as a turn once had it, a readying that fails
// reports nothing and leaves the turn registered — 0 of the 2 reports here.
test('a turn and a call whose readying fails are each reported failed — 44.21', async () => {
    const reports: TurnReport[] = []
    const core = serveTurns({
        site: 'http://127.0.0.1:1',
        claude: 'claude',
        claudeArgs: () => [],
        full: false,
        report: (report) => reports.push(report),
        say: () => {},
        beforeTurn: () => Promise.reject(new Error('unreadable')),
    })
    try {
        core.take({
            type: 'turn',
            id: 't',
            prompt: [],
            config: {} as never,
            maxTurns: 1,
        })
        core.take({ type: 'call', id: 'c', name: 'tool', input: {} } as never)
        await Bun.sleep(0)
        await Bun.sleep(0)
        expect(reports).toEqual([
            { type: 'fail', turn: 't', message: 'unreadable' },
            { type: 'fail', turn: 'c', message: 'unreadable' },
        ])
    } finally {
        core.stop()
    }
})
