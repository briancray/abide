// 50.68-50.74 — A LIST OF NOTICES AN APP BUILDS: its own notices apart from every other list's, the
// ones it starts with, the dismissals it remembers in its `store` and for how long, and the moment a
// notice stops showing. What the notices render is the CRM's tests', which mount them.

import { afterEach, expect, test } from 'bun:test'

import { installServer } from '#server/installServer.ts'
import { inScope } from '#server/requestScope.ts'
import { hashText } from '#shared/hashText.ts'
import { appName } from '#shared/log.ts'
import { notices } from '#shared/notices.ts'
import type { Store } from '#shared/reactive/index.ts'
import { collectWatches } from '#shared/reactive/watch.ts'
import { cookies } from '#shared/stores/cookies.ts'
import { toasts } from '#shared/toasts.ts'

installServer()

const stops: (() => void)[] = []
afterEach(() => {
    for (const stop of stops.splice(0)) stop()
})

// A host stands as a component's setup stands it: its watches collected, and stopped after.
function shown(list: ReturnType<typeof notices>) {
    const previous = collectWatches(stops)
    const host = list.host()
    collectWatches(previous)
    return host
}

// A `Store` held in memory: what was written last, and every write.
function memory(held: Record<string, number> = {}) {
    const writes: Record<string, number>[] = []
    const store: Store<Record<string, number>> = {
        get: () => held,
        set: (value) => {
            held = value
            writes.push(value)
        },
    }
    return { store, writes }
}

const texts = (shown: readonly { text: string }[]): string[] =>
    shown.map((notice) => notice.text)

// THE REVERT: build every list over one module-level `list`, as `toasts` was, and the banner shows
// the toast.
test("one list's notices never enter another's — 50.68", () => {
    const banner = notices({ timeout: Infinity })
    const corner = notices({ timeout: Infinity })
    const id = corner.notify('Saved')
    banner.notify('We are live')
    banner.dismiss(id)
    expect(texts(corner.list())).toEqual(['Saved'])
    expect(texts(shown(banner).notices)).toEqual(['We are live'])
})

// Keyed by text, and the key a store holds for `text`.
const byText = (notice: { text: string }): string => notice.text
const keyed = hashText

// THE REVERT: keep what `key` answers as it is, and the long announcement's key is the whole
// sentence — what the store would hold, in a cookie of 4096 bytes.
test('a list starts with its initial notices, in order, each keyed by a hash of what its key answers — 50.70, 50.71', () => {
    const banner = notices({
        timeout: Infinity,
        key: (notice) => `${notice.tone}:${notice.text}`,
        initial: [
            'We are live',
            {
                text: 'Pipelines can now be shared with a link, from any pipeline.',
                tone: 'success',
            },
        ],
    })
    expect(banner.list().map((notice) => notice.key)).toEqual([
        keyed('info:We are live'),
        keyed(
            'success:Pipelines can now be shared with a link, from any pipeline.',
        ),
    ])
    expect(banner.list()[1]?.key.length).toBeLessThan(12)
})

// THE REVERT: hash the notice with its `id` in it, and the same announcement is a new key on every
// page load — the two lists below disagree, and nothing closed stays closed.
test('a notice is keyed by default by a short hash of it as JSON, its id left out — 50.71', () => {
    const LONG =
        'Pipelines can now be shared with a link, from the menu on any pipeline.'
    const run = () => {}
    const first = notices({ timeout: Infinity, initial: [LONG] }).list()[0]
    const second = notices({
        timeout: Infinity,
        initial: ['other', LONG, { text: LONG, tone: 'error' }],
    }).list()
    expect(first?.id).not.toBe(second[1]?.id)
    expect(second[1]?.key).toBe(first?.key as string)
    expect(first?.key.length).toBeLessThan(12)
    // Its content is the key: other words, or another tone, are another notice.
    expect(second[0]?.key).not.toBe(first?.key as string)
    expect(second[2]?.key).not.toBe(first?.key as string)
    // An action's `run` is no part of it, as JSON has no function.
    const withAction = (label: string) =>
        notices({
            timeout: Infinity,
            initial: [{ text: LONG, action: { label, run } }],
        }).list()[0]?.key
    expect(withAction('Open')).toBe(
        notices({
            timeout: Infinity,
            initial: [{ text: LONG, action: { label: 'Open', run: () => 1 } }],
        }).list()[0]?.key as string,
    )
})

// THE REVERT: remember a notice whatever took it, and the timed-out one lands in the store beside the
// two a person closed — three keys where two are due.
test('a dismissal and an action are remembered for ttl, and a timeout is not — 50.69, 50.17', async () => {
    const { store, writes } = memory()
    const banner = notices({
        store,
        ttl: 60_000,
        timeout: Infinity,
        key: byText,
        initial: [
            'We are live',
            'Pipelines',
            { text: 'Brief', timeout: 5 },
            { text: 'Try it', action: { label: 'Open', run: () => {} } },
        ],
    })
    const host = shown(banner)
    const before = Date.now()
    banner.dismiss((banner.list()[1] as { id: number }).id)
    host.notice(banner.list().at(-1) as never).act()
    await Bun.sleep(20)
    const remembered = writes.at(-1) ?? {}
    expect(Object.keys(remembered).sort()).toEqual(
        [keyed('Pipelines'), keyed('Try it')].sort(),
    )
    expect(remembered[keyed('Pipelines')]).toBeGreaterThanOrEqual(
        before + 60_000,
    )
    expect(remembered[keyed('Pipelines')]).toBeLessThan(Date.now() + 60_001)

    // The next page builds the list again over the same store, and shows only what nobody closed.
    const again = notices({
        store,
        timeout: Infinity,
        key: byText,
        initial: ['We are live', 'Pipelines', 'Try it'],
    })
    expect(texts(shown(again).notices)).toEqual(['We are live'])
    // `list` holds them still: the host is what leaves them out.
    expect(again.list()).toHaveLength(3)
})

// THE REVERT: write the remembered keys back as read, and the one forgotten an hour ago rides along
// on every write after — the cookie grows by every banner ever closed.
test('a write leaves out every dismissal already forgotten — 50.73', () => {
    const { store, writes } = memory({
        old: Date.now() - 3_600_000,
        kept: Date.now() + 3_600_000,
    })
    const banner = notices({
        store,
        timeout: Infinity,
        key: byText,
        initial: ['We are live'],
    })
    banner.dismiss((banner.list()[0] as { id: number }).id)
    expect(Object.keys(writes.at(-1) ?? {}).sort()).toEqual(
        [keyed('We are live'), 'kept'].sort(),
    )
})

test('a dismissal remembered forever is kept as a number JSON holds — 50.69', () => {
    const { store, writes } = memory()
    const banner = notices({
        store,
        timeout: Infinity,
        key: byText,
        initial: ['We are live'],
    })
    banner.dismiss((banner.list()[0] as { id: number }).id)
    expect(JSON.parse(JSON.stringify(writes.at(-1)))).toEqual({
        [keyed('We are live')]: Number.MAX_SAFE_INTEGER,
    })
})

// THE REVERT: drop `expires` from the timer's due, and the notice outlives its moment — still
// listed at 20 ms where it was due to leave at 5.
test('a notice leaves at its expires, told so as a timeout, and one already past never shows — 50.72, 50.42', async () => {
    const reasons: string[] = []
    const banner = notices({
        timeout: Infinity,
        initial: [{ text: 'Launch week', expires: Date.now() - 1 }],
    })
    const host = shown(banner)
    expect(host.notices).toEqual([])
    banner.notify('Sale ends', {
        expires: new Date(Date.now() + 5),
        onclose: (reason) => reasons.push(reason),
    })
    await Bun.sleep(20)
    expect(banner.list()).toEqual([])
    expect(reasons).toEqual(['timeout'])
})

// 50.70, 50.69 ON A SERVER — THE PAGE IS RENDERED WITHOUT WHAT THE VISITOR CLOSED, read from the
// request's cookie, so a dismissed banner never paints to be taken down. THE REVERT: filter the
// remembered keys in `notify` alone, and the seeded banner renders.
test("a server's render leaves out what the request's cookie remembers — 50.70, 50.69", async () => {
    const banner = notices({
        store: cookies('announcements'),
        timeout: Infinity,
        key: byText,
        initial: ['We are live', 'New: pipelines'],
    })
    const kept = encodeURIComponent(
        JSON.stringify({
            value: { [keyed('We are live')]: Number.MAX_SAFE_INTEGER },
            expires: null,
        }),
    )
    const name = encodeURIComponent(`${appName()}:announcements`)
    await inScope(
        new Request('http://app/', { headers: { cookie: `${name}=${kept}` } }),
        async () => {
            expect(texts(shown(banner).notices)).toEqual(['New: pipelines'])
        },
    )
})

test('toasts is a list built with no options — 50.74', () => {
    expect(Object.keys(toasts).sort()).toEqual(Object.keys(notices()).sort())
    expect(toasts.list()).toEqual([])
})
