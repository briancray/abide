// 2.7, 11.19 — A DERIVED THAT STOPS ADOPTING A STREAM STILL RUNNING SETTLES: the busy was the
// adopted stream's, so handing back a plain value ends it, and an await taken while it streamed
// resolves to that value rather than waiting on a run this derived no longer serves.

import { expect, test } from 'bun:test'

import { memo, reactive, watch } from '#shared'

// THE REVERT: drop the `probesMoved` `dropAdoption` makes where the adoption was busy; the await
// is still pending, and the derived reports busy false all the same.
test('an await on a derived that drops a running stream resolves to what it hands back — 2.7, 11.19', async () => {
    const which = reactive(1)
    const streaming = memo(({ n }: { n: number }) =>
        (async function* () {
            yield n
            await new Promise(() => {})
        })(),
    )
    const shown = reactive(() =>
        which() === 0 ? [] : streaming({ n: which() }),
    )
    const stop = watch(() => {
        try {
            shown()
        } catch {}
    })
    let answered: unknown = 'pending'
    void (async () => {
        answered = await shown
    })()
    await Bun.sleep(5)
    which.set(0)
    await Bun.sleep(20)
    stop()
    expect(answered).toEqual([])
})
