// 11.12, 11.4 — A MEMO CARRIES THE FAILURES ITS FUNCTION'S ANSWER CARRIES: a memo over a handler hands
// back the call it answers (11.4), and a `reactive.derived` calling it adopts that call's refusal as its
// own (11.12), so `s.error()` is typed with the handler's refusals rather than as nothing.

import { expect, test } from 'bun:test'

import { GET } from '#server'
import { memo, reactive, refuse } from '#shared'

const tooBig = refuse.named('TooBig', {
    status: 413,
    schema: (value: unknown) => value as { n: number },
})

test("a derived over a memo of a handler is typed with the handler's refusals — 11.12", async () => {
    const bounded = GET(({ n }: { n: number }) => (n > 10 ? tooBig({ n }) : n))
    const paced = memo(bounded, { debounce: 0 })
    const shown = reactive.derived(() => paced({ n: 99 }))
    await Promise.resolve(shown).then(
        () => undefined,
        () => undefined,
    )
    // THE REVERT: drop the `[CALL_ENTRY]` member from `Memo`'s call; `error()` is `undefined` and
    // neither line compiles under `bun run typecheck`.
    const failed = shown.error()
    const data: { n: number } | undefined = shown.isError(failed, 'TooBig')
        ? failed.data
        : undefined
    const message: string | undefined = failed?.message
    expect(`${message !== undefined}: ${JSON.stringify(data)}`).toBe(
        'true: {"n":99}',
    )
})
