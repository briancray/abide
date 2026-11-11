// 16.89 TO 16.92 — A MUTATION'S `refreshes`, called in process: what it reloads is counted as BODY
// RUNS of the values tagged, never read off their values, since a reload landing an equal value
// reads the same. The tags carry a prefix no other file uses: the selection index is process-wide,
// and `bun run test:serial` runs every file in one process. What reaches a browser is `follow.test.ts`'s.

import { expect, test } from 'bun:test'

import { GET, POST, reactive, refuse, watch } from '#server'

import { inMemoryApp } from './inMemoryApp.ts'

const runs = { cars: 0, boats: 0, car1: 0, car2: 0 }
const cars = reactive(async () => ++runs.cars, {
    global: true,
    tags: ['refreshes:cars'],
})
const boats = reactive(async () => ++runs.boats, {
    global: true,
    tags: ['refreshes:boats'],
})
const car = reactive(
    async ({ id }: { id: number }) => (id === 1 ? ++runs.car1 : ++runs.car2),
    { global: true, tags: ({ id }) => [`refreshes:car:${id}`] },
)
// 13.7 — read, so a refresh reloads them rather than marking them.
watch(() => {
    cars()
    boats()
    car({ id: 1 })()
    car({ id: 2 })()
})

const settled = async (): Promise<void> => {
    await cars
    await boats
    await car({ id: 1 })
    await car({ id: 2 })
}

const counted = (): string =>
    `cars ${runs.cars}, boats ${runs.boats}, car 1 ${runs.car1}, car 2 ${runs.car2}`

const save = POST(
    ({ ok }: { ok: boolean }) => (ok ? 'saved' : refuse(409, 'taken')),
    { refreshes: ['refreshes:cars'] },
)

const guarded = POST(() => 'saved', {
    refreshes: ['refreshes:cars'],
    middleware: [async () => refuse(403, 'not yours')],
})

const repaint = POST(({ id }: { id: number }) => id, {
    refreshes: ({ id }) => [`refreshes:car:${id}`],
})

// 16.89 — AN ACCEPTED CALL REFRESHES EXACTLY THE ENTRIES ITS TAGS NAME, and a refused one nothing,
// whether the handler refused or a rung did — the rung's over the wire, where a request is there for
// it to read (16.25). THE REVERT: drop the `isFailed` check in `answerThenRefresh` and refresh
// whatever the run answered; the rung's refusal reloads `cars`, `cars 2` where `cars 1` is due.
test('a call that answers refreshes its tags, and one refused refreshes nothing — 16.89', async () => {
    await settled()
    const before = counted()
    expect(before).toBe('cars 1, boats 1, car 1 1, car 2 1')

    await save({ ok: false }).then(
        () => undefined,
        () => undefined,
    )
    await using app = await inMemoryApp({
        'garage/guarded.handler.ts': { default: guarded },
    })
    const answer = await app.fetch(
        new Request('http://app.invalid/garage/guarded', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
        }),
    )
    expect(`guarded: ${answer.status}`).toBe('guarded: 403')
    await settled()
    expect(`refused: ${counted()}`).toBe(`refused: ${before}`)

    await save({ ok: true })
    await settled()
    expect(`accepted: ${counted()}`).toBe(
        'accepted: cars 2, boats 1, car 1 1, car 2 1',
    )
})

// 16.89 — THE FUNCTION FORM IS HANDED THE CALL'S ARGS, as a value's own `tags` is, so one entry of a
// keyed value is reloaded and its sibling is not. THE REVERT: hand `refreshes` `undefined` for the
// args; the function's destructure throws, the call is refused, and `car 1` is not reloaded.
test('a refreshes function reads the call args, and reaches that entry alone — 16.89', async () => {
    await settled()
    const car2 = runs.car2
    const car1 = runs.car1
    await repaint({ id: 1 })
    await settled()
    expect(`car 1 +${runs.car1 - car1}, car 2 +${runs.car2 - car2}`).toBe(
        'car 1 +1, car 2 +0',
    )
})

// 16.90 — THE REFRESH HAS STARTED BY THE TIME THE CALL'S ANSWER SETTLES, so the first thing to
// hear the answer already sees the reload begun. THE REVERT: run the refresh in a `setTimeout` after
// the answer; the answer is heard with `cars +0` where `cars +1` is due.
test('a call refreshes before its answer settles — 16.90', async () => {
    await settled()
    const before = runs.cars
    let atTheAnswer = -1
    await save({ ok: true }).then(() => {
        atTheAnswer = runs.cars - before
    })
    expect(`at the answer: cars +${atTheAnswer}`).toBe('at the answer: cars +1')
    await Bun.sleep(1)
    await settled()
})

// 16.91 — A STREAMED ANSWER REFRESHES AT ITS CLOSE, not at its first chunk, and not at all where it
// ends on a failure. THE REVERT: refresh as soon as the run turns out to stream rather than wrapping
// its chunks; `after the first chunk` reads +2 where +0 is due — the failing run's refresh included.
test('a streamed answer refreshes once it closes, and not where it fails — 16.91', async () => {
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
        release = resolve
    })
    const stream = POST(
        async function* ({ fail }: { fail: boolean }) {
            yield 1
            await held
            if (fail) throw refuse(500, 'broke')
            yield 2
        },
        { refreshes: ['refreshes:boats'] },
    )
    await settled()
    const before = runs.boats

    const failing = stream({ fail: true })
    const failed = (async () => {
        try {
            for await (const _ of failing) {
            }
        } catch {}
    })()
    const closing = stream({ fail: false })
    const chunks: unknown[] = []
    const closed = (async () => {
        for await (const chunk of closing) chunks.push(chunk)
    })()
    while (chunks.length === 0) await Bun.sleep(0)
    expect(`after the first chunk: +${runs.boats - before}`).toBe(
        'after the first chunk: +0',
    )
    release()
    await closed
    await failed
    await settled()
    expect(`after the close: +${runs.boats - before}`).toBe(
        'after the close: +1',
    )
})

// 16.92 — A `GET` TAKES NO `refreshes`: its options lack the key, so the declaration is a type
// error, and a caller the types did not reach is refused where it declares. THE REVERT for the type:
// hand `GET` the mutations' options, and the `@ts-expect-error` below is unused, failing
// `bun run typecheck`. For the refusal: drop the check in `declare`; nothing is thrown.
test('a GET declared with refreshes is refused — 16.92', () => {
    expect(() =>
        // @ts-expect-error — `refreshes` is a mutation's option alone.
        GET(() => 1, { refreshes: ['refreshes:cars'] }),
    ).toThrow('RULEBOOK 16.92')
    const untyped = { refreshes: ['refreshes:cars'] } as object
    expect(() => GET(() => 1, untyped)).toThrow('RULEBOOK 16.92')
})
