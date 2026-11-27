// 16.48, 16.62, 7.23 THROUGH A `memo`'s CALL — the `signal` an `Rpc`'s call takes, on the memo it may be
// built over: one run per key shared by every call awaiting it, ended — its `abortSignal` with it —
// only once every call that reached it handed a signal and every one of those has aborted (11.83).
// THE TYPE'S REVERT: type `Memo`'s call with `ArgsTuple` alone, and every signaled call here fails
// typecheck, TS2554.

import { expect, test } from 'bun:test'

import { abortSignal, flushSync, memo } from '#shared'

// A memo whose runs finish only when the test says so, each run's signal kept.
function held() {
    const runs: { signal: AbortSignal; finish: (value: string) => void }[] = []
    const build = memo(
        ({ path }: { path: string }) => {
            const signal = abortSignal()
            return new Promise<string>((finish) => {
                runs.push({ signal, finish })
            }).then((value) => `${path} ${value}`)
        },
        { global: true },
    )
    return { build, runs }
}

const outcome = (answer: Promise<unknown>): Promise<string> =>
    answer.then(
        (value) => `value ${value}`,
        (failure: { name?: string }) => `refused ${failure.name}`,
    )

// THE REVERT: drop `endRun` from `abandonLoad` in `Reactive.ts`; the run is never told to stop,
// `run aborted: false`.
test('a run every call left is ended, and told so through its signal — 16.48, 7.23', async () => {
    const { build, runs } = held()
    const first = new AbortController()
    const second = new AbortController()
    const one = outcome(build({ path: 'a' }, { signal: first.signal }))
    const two = outcome(build({ path: 'a' }, { signal: second.signal }))
    expect(`runs: ${runs.length}`).toBe('runs: 1')
    first.abort()
    flushSync()
    expect(`after one left: ${runs[0]?.signal.aborted}`).toBe(
        'after one left: false',
    )
    second.abort()
    flushSync()
    expect(`run aborted: ${runs[0]?.signal.aborted}`).toBe('run aborted: true')
    expect(`${await one}, ${await two}`).toBe(
        'refused Aborted, refused Aborted',
    )
})

// THE REVERT: create the record in `attendCall` with `pinned` false whatever `started` says; the run a
// call with no signal started is ended under it, `run aborted: true`.
test('a call with no signal that started the run pins it — 11.84', async () => {
    const { build, runs } = held()
    const pinned = build({ path: 'b' })
    const leaving = new AbortController()
    void build({ path: 'b' }, { signal: leaving.signal }).catch(() => {})
    leaving.abort()
    flushSync()
    expect(`run aborted: ${runs[0]?.signal.aborted}`).toBe('run aborted: false')
    runs[0]?.finish('built')
    expect(await pinned).toBe('b built')
})

// THE REVERT: drop the `cell.loading` arm from the memo's call in `createMemo.ts`; the call joining with
// no signal files nothing, and the run is ended under it, `run aborted: true`.
test('a call with no signal joining a signaled run pins it — 16.48', async () => {
    const { build, runs } = held()
    const leaving = new AbortController()
    void build({ path: 'c' }, { signal: leaving.signal }).catch(() => {})
    const pinned = build({ path: 'c' })
    leaving.abort()
    flushSync()
    expect(`run aborted: ${runs[0]?.signal.aborted}`).toBe('run aborted: false')
    runs[0]?.finish('built')
    expect(await pinned).toBe('c built')
})

// THE REVERT: drop the `abandoned` read from `attendCall`; the call joins the ended run's refusal,
// `runs: 1`.
test('a call after an ended run starts another — 16.62', async () => {
    const { build, runs } = held()
    const leaving = new AbortController()
    void build({ path: 'd' }, { signal: leaving.signal }).catch(() => {})
    leaving.abort()
    flushSync()
    const again = outcome(build({ path: 'd' }))
    expect(`runs: ${runs.length}`).toBe('runs: 2')
    runs[1]?.finish('built')
    expect(await again).toBe('value d built')
})

// THE REVERT: hand `answerOfCall` no `signal` from the memo's call; the call that left waits on the
// run with the one that stayed, `still waiting, value e built`.
test('a call whose signal aborts is refused at once, while the run goes on for the rest — 16.120', async () => {
    const { build, runs } = held()
    const leaving = new AbortController()
    const left = outcome(build({ path: 'e' }, { signal: leaving.signal }))
    const stayed = outcome(build({ path: 'e' }))
    leaving.abort()
    const leftFirst = await Promise.race([
        left,
        Bun.sleep(20).then(() => 'still waiting'),
    ])
    runs[0]?.finish('built')
    expect(`${leftFirst}, ${await stayed}`).toBe(
        'refused Aborted, value e built',
    )
})
