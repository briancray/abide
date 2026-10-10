// WHAT A DOCS CARD CLAIMS, ASSERTED AGAINST THE HAND-WRITTEN ARM BESIDE IT. Every arm under
// `arms/` is the other half of a ratio `bench:compiler` reports, and a ratio against an arm that
// does not do the work is a figure rather than a claim — so each arm has to HOLD the invariant its
// card's prose states: a hand-written dependency list, a hand-written entry table.
//
// The card itself runs the `.abide` component in the docs app; this pins the arm it is priced
// against.
import { expect, test } from 'bun:test'
import { abideSourcesOf, DOGFOOD } from '../scripts/exampleSources.ts'

const ARMS_DIR = new URL('../arms/', import.meta.url)

// The `<script src>` is dropped rather than resolved: happy-dom declines to load one, and the
// module is imported below anyway. A cache-buster on the specifier so two tests over one arm
// each get a fresh module scope, the arms being top-level scripts rather than exports.
async function mount(name: string, script: string): Promise<void> {
    const markup = await Bun.file(
        new URL(`${name}/index.html`, ARMS_DIR),
    ).text()
    document.body.innerHTML = markup.replace(/<script[^>]*><\/script>/, '')
    await import(
        `${new URL(`${name}/${script}`, ARMS_DIR).pathname}?${Math.random()}`
    )
}

// AN ARM THAT SERVES ITSELF answers from routes rather than from a fixture, so a spec over one
// captures them the way the frame does: `Bun.serve` is stubbed and the file is imported for the
// call it makes at the top level.
type Routes = Record<string, (request: Request) => Response | Promise<Response>>

async function routesOf(name: string, file: string): Promise<Routes> {
    let captured: Routes = {}
    const serve = Bun.serve
    ;(Bun as { serve: unknown }).serve = (options: { routes?: Routes }) => {
        captured = options.routes ?? {}
    }
    try {
        await import(
            `${new URL(`${name}/${file}`, ARMS_DIR).pathname}?${Math.random()}`
        )
    } finally {
        Bun.serve = serve
    }
    return captured
}

function read(id: string): string {
    return document.querySelector(id)?.textContent ?? ''
}

function click(id: string): void {
    ;(document.querySelector(id) as HTMLElement).click()
}

function type(id: string, value: string): void {
    const field = document.querySelector(id) as HTMLInputElement
    field.value = value
    field.dispatchEvent(new Event('input'))
}

test('memo-tracked: the total follows the seats', async () => {
    await mount('memo-tracked', 'deal.js')
    expect(read('#total')).toBe('$50')
    click('#more')
    expect([read('#seats'), read('#total')]).toEqual(['3', '$75'])
    click('#fewer')
    expect([read('#seats'), read('#total')]).toEqual(['2', '$50'])
})

test('memo-adoption: reopening a loaded tab makes no request', async () => {
    let requests = 0
    const opened: Record<string, number> = {}
    globalThis.fetch = (async (input: string) => {
        requests += 1
        const id = new URL(input, 'http://example.invalid').searchParams.get(
            'id',
        )
        opened[id ?? ''] = (opened[id ?? ''] ?? 0) + 1
        await Bun.sleep(20)
        return Response.json(
            id === '1'
                ? {
                      name: 'Ada Lovelace',
                      role: 'Engineer',
                      opened: opened['1'],
                  }
                : {
                      name: 'Grace Hopper',
                      role: 'Admiral',
                      opened: opened['2'],
                  },
        )
    }) as typeof fetch

    await mount('memo-adoption', 'profile.js')
    expect(read('#status')).toBe('loading…')
    await Bun.sleep(50)
    expect([read('#name'), read('#opened'), String(requests)]).toEqual([
        'Ada Lovelace',
        '1',
        '1',
    ])

    click('#grace')
    await Bun.sleep(50)
    expect([read('#name'), read('#opened'), String(requests)]).toEqual([
        'Grace Hopper',
        '1',
        '2',
    ])

    // Back to a tab already held: no request, no status, and the RECORD says so — its own
    // count is still 1. That count is domain data, so it survived the counters leaving.
    click('#ada')
    expect([
        read('#name'),
        read('#opened'),
        String(requests),
        read('#status'),
    ]).toEqual(['Ada Lovelace', '1', '2', ''])
})

test('memo-write: typing stands, and an unchanged reload still takes it', async () => {
    globalThis.fetch = Object.assign(
        async () => {
            await Bun.sleep(20)
            return Response.json({ id: '42', name: 'Ada Lovelace' })
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('memo-write', 'draft.js')
    expect(read('#status')).toBe('loading…')
    await Bun.sleep(60)
    const field = document.querySelector('#draft') as HTMLInputElement
    expect([field.value, read('#status')]).toEqual(['Ada Lovelace', ''])

    field.value = 'Ada, mid-edit'
    click('#reload')
    // A value is still being served, so the reload is `refreshing` rather than `pending`,
    // and the box keeps showing the edit until the answer lands.
    expect([read('#status'), field.value]).toEqual([
        'refreshing…',
        'Ada, mid-edit',
    ])

    await Bun.sleep(60)
    // The record never changed, and the box was refilled anyway.
    expect([field.value, read('#status')]).toEqual(['Ada Lovelace', ''])
    expect(document.querySelector('#status')).not.toBeNull()
})

test('memo-keyed: a prefix already typed is answered with no request and no spinner', async () => {
    let requests = 0
    globalThis.fetch = (async (input: string) => {
        requests += 1
        const query =
            new URL(input, 'http://example.invalid').searchParams.get(
                'query',
            ) ?? ''
        await Bun.sleep(20)
        const people = ['Ada Lovelace', 'Alan Turing', 'Grace Hopper']
        return Response.json(
            people.filter((one) => one.toLowerCase().includes(query)),
        )
    }) as typeof fetch

    await mount('memo-keyed', 'search.js')
    const rows = () => document.querySelectorAll('#results li').length
    await Bun.sleep(50)
    expect([rows(), requests]).toEqual([3, 1])

    type('#query', 'ad')
    expect(read('#status')).toBe('searching…')
    await Bun.sleep(50)
    expect([rows(), requests]).toEqual([1, 2])

    type('#query', 'ada')
    await Bun.sleep(50)
    expect([rows(), requests]).toEqual([1, 3])

    // THE CLAIM, and now there is somewhere for it to be false: backspacing lands on a prefix
    // already typed, which is an entry already held — nothing is asked for, the spinner never
    // gets a moment, and the three rows are back on the same tick.
    type('#query', 'ad')
    expect([rows(), requests, read('#status')]).toEqual([1, 3, ''])
    type('#query', 'a')
    expect([rows(), requests, read('#status')]).toEqual([3, 3, ''])
})

// WHAT THIS FILE CANNOT REACH, said out loud. `memo-tracked` claims a body did NOT re-run over
// a SYNCHRONOUS local derivation, and that is unobservable by construction: no request, no
// probe, and a value identical either way. The arm holds the invariant and nothing checks it.
// `memo-keyed` had the same gap and lost it by moving behind a handler, which is the repair
// available wherever the work crosses a transport — and it is not available here.

test('memo-await: the early label follows the filter, and the late one froze', async () => {
    await mount('memo-await', 'counts.js')
    await Bun.sleep(300)
    expect([read('#label'), read('#stale')]).toEqual([
        'showing 12 of 12 for all',
        'showing 12 of 12 for all',
    ])

    const filter = document.querySelector('#filter') as HTMLSelectElement
    filter.value = 'leads'
    filter.dispatchEvent(new Event('change'))
    await Bun.sleep(300)
    expect(read('#label')).toBe('showing 1 of 12 for leads')
    // The label beside it names the filter it counted, and it is not the one selected.
    expect(read('#stale')).toBe('showing 12 of 12 for all')
})

test('memo-provisional: the unguarded Save is live before the gate lands', async () => {
    globalThis.fetch = Object.assign(
        async () => {
            await Bun.sleep(20)
            return Response.json({ readOnly: true })
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('memo-provisional', 'contact.js')
    const save = (id: string) =>
        (document.querySelector(id) as HTMLButtonElement).disabled
    // THE CLAIM. The gate is unlanded, so the first branch took its `else`
    // and handed a read-only viewer a live button; the second defaulted to
    // locked instead of guessing.
    expect([save('#mode'), save('#guarded')]).toEqual([false, true])

    await Bun.sleep(60)
    // Both agree once there is an answer, which is why nothing downstream
    // of the value can catch this.
    expect([save('#mode'), save('#guarded')]).toEqual([true, true])
})

test('state-owned: the heading follows the field with nothing wired up', async () => {
    await mount('state-owned', 'handle.js')
    const field = document.querySelector('#handle') as HTMLInputElement
    expect(read('#heading')).toBe('@ada')
    field.value = 'grace'
    field.dispatchEvent(new Event('input'))
    expect(read('#heading')).toBe('@grace')
})

test('state-loaded: the record is read straight, never unwrapped', async () => {
    globalThis.fetch = Object.assign(
        async () => {
            await Bun.sleep(20)
            return Response.json({ name: 'Ada Lovelace', role: 'Engineer' })
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('state-loaded', 'record.js')
    expect([read('#name'), read('#status')]).toEqual(['—', 'loading…'])
    await Bun.sleep(60)
    // A `Reactive<Contact>`, never a `Reactive<Promise<Contact>>` — the settled value is what
    // is served, so the read is `contact.name` at every site rather than an await.
    expect([read('#name'), read('#role'), read('#status')]).toEqual([
        'Ada Lovelace',
        'Engineer',
        '',
    ])
})

test('state-transform: what is stored is not what was typed', async () => {
    await mount('state-transform', 'handle.js')
    const field = document.querySelector('#handle') as HTMLInputElement
    field.value = '  Ada Lovelace '
    field.dispatchEvent(new Event('input'))
    // `Accepted` was the typed string; `Stored` is what the transform returned, and the field
    // reads the stored one back because the binding holds the value rather than a copy.
    expect([field.value, read('#stored')]).toEqual([
        'ada_lovelace',
        '@ada_lovelace',
    ])
})

test('channel-shared: a component the writer never names follows the write', async () => {
    await mount('channel-shared', 'chat.js')
    expect([read('#speaker'), read('#text')]).toEqual(['nobody', 'nothing yet'])

    // THE CLAIM. The composer knows the room and not the readout, and the readout
    // knows the room and not the composer — the room is the whole of what is between
    // them, so breaking the notify leaves the value right and the screen stale.
    click('#send')
    expect([read('#speaker'), read('#text')]).toEqual([
        'you',
        'How do I rotate an API key?',
    ])
})

test('channel-rooms: each args key is its own room, kept across a switch', async () => {
    await mount('channel-rooms', 'chat.js')
    const draft = document.querySelector('#draft') as HTMLInputElement

    draft.value = 'Does the old key keep working?'
    click('#send')
    expect([read('#conversation'), read('#last')]).toEqual([
        'onboarding',
        'Does the old key keep working?',
    ])

    // A key nothing has published to lands `undefined` (11.62), which is the readout's
    // 'nothing here yet' rather than the other room's message.
    click('[data-conversation="billing"]')
    expect([read('#conversation'), read('#last')]).toEqual([
        'billing',
        'nothing here yet',
    ])

    draft.value = 'Why was I charged twice?'
    click('#send')
    expect(read('#last')).toBe('Why was I charged twice?')

    // THE CLAIM. Coming back finds the first room as it was left: its own messages,
    // its own seq, untouched by anything that happened in the second.
    click('[data-conversation="onboarding"]')
    expect([read('#conversation'), read('#last')]).toEqual([
        'onboarding',
        'Does the old key keep working?',
    ])
})

test('channel-tail: the room caps the transcript, not the reader', async () => {
    await mount('channel-tail', 'chat.js')
    // The speaker is the ROW's, not a prefix inside the text — the transcript carries
    // it as an attribute so the layout can put a turn on the side that said it.
    const rows = () =>
        [...document.querySelectorAll('#transcript li')].map((li) => [
            (li as HTMLElement).dataset.speaker,
            li.querySelector('p')?.textContent,
        ])

    // The reader asked for fifty and three were published, so three is what fifty is.
    expect(rows()).toEqual([
        ['you', 'How do I rotate an API key?'],
        ['assistant', 'Settings, then Keys, then Rotate.'],
        ['you', 'Does the old key keep working?'],
    ])

    // THE CLAIM. A fourth message does not make a fourth row: retention is the room's,
    // so the oldest leaves as the newest lands and the count never moves.
    click('#send')
    expect(rows()).toEqual([
        ['assistant', 'Settings, then Keys, then Rotate.'],
        ['you', 'Does the old key keep working?'],
        ['you', 'Can I revoke the old one early?'],
    ])
})

test('channel-transform: a message over the limit is refused under its own name', async () => {
    await mount('channel-transform', 'chat.js')
    const draft = document.querySelector('#draft') as HTMLInputElement
    expect(draft.value.length).toBe(124)

    // THE CLAIM. The gate is on the way in, so nothing was stored and the refusal
    // arrives carrying a name the app declared and data of its own — not a boolean,
    // and not a sequence number a caller has to tell from one.
    click('#send')
    expect([read('#refusal'), read('#last')]).toEqual([
        'TooLong at 124 characters',
        'nothing sent yet',
    ])

    draft.value = 'How do I rotate an API key?'
    click('#send')
    expect([read('#refusal'), read('#last')]).toEqual([
        '',
        'How do I rotate an API key?',
    ])
})

test('share-agree: the bar follows a row it has no path to', async () => {
    await mount('share-agree', 'player.js')
    expect(read('#playing')).toBe('nothing')

    // THE CLAIM. The row writes and the bar reads, and the only thing between them is
    // the key held above both — no prop through the list, and no module either of them
    // imports.
    click('#t1')
    expect(read('#playing')).toBe('A Love Supreme')
    click('#t2')
    expect(read('#playing')).toBe('Blue Train')
})

test('share-winner: the value handed in is the one nobody reads', async () => {
    await mount('share-winner', 'volume.js')
    expect([read('#volume'), read('#shared'), read('#built')]).toEqual([
        '4',
        '4',
        '4',
    ])

    // THE CLAIM, and it is the silent half: the second call hands back the value that
    // won, so `shared` moves and the box it was handed stands still. Both look right
    // at rest, which is why the card puts all three on screen at once.
    click('#up')
    expect([read('#volume'), read('#shared'), read('#built')]).toEqual([
        '5',
        '5',
        '4',
    ])
    click('#up')
    expect([read('#volume'), read('#shared'), read('#built')]).toEqual([
        '6',
        '6',
        '4',
    ])
})

test('share-scope: a key reaches below the shelf that made it and not across', async () => {
    await mount('share-scope', 'shelves.js')
    expect([
        read('#jazz'),
        read('#jazz-below'),
        read('#ambient'),
        read('#ambient-below'),
    ]).toEqual(['nothing', 'nothing', 'nothing', 'nothing'])

    // THE CLAIM, AND IT IS BOTH HALVES AT ONCE. The control is below the shelf that
    // created the key, so it found that one rather than building its own — and neither
    // is above the other shelf, so the other shelf and ITS control stand still. A
    // registry keyed process-wide would have made all four one value and said nothing
    // about it; one keyed per instance would have left the control out.
    click('#queue-jazz')
    expect([
        read('#jazz'),
        read('#jazz-below'),
        read('#ambient'),
        read('#ambient-below'),
    ]).toEqual(['jazz pick', 'jazz pick', 'nothing', 'nothing'])

    click('#queue-ambient')
    expect([
        read('#jazz'),
        read('#jazz-below'),
        read('#ambient'),
        read('#ambient-below'),
    ]).toEqual(['jazz pick', 'jazz pick', 'ambient pick', 'ambient pick'])
})

test('patch-wakes: a patch writes one entry and leaves the rest of the table alone', async () => {
    await mount('patch-wakes', 'dashboard.js')
    const rows = () =>
        [...document.querySelectorAll('#regions li')].map(
            (li) => li.querySelector('strong')?.textContent,
        )
    expect(rows()).toEqual(['120', '80', '64', '91'])

    // THE CLAIM. One frame names one region, so one entry is written and the
    // three that did not move are the three the frame never named. `set` would
    // have been a copy of all four.
    click('#apply')
    expect(rows()).toEqual(['120', '95', '64', '91'])

    click('#apply')
    expect(rows()).toEqual(['130', '95', '64', '91'])
})

test('patch-unseen: a mutation without a production is invisible until something else wakes', async () => {
    await mount('patch-unseen', 'dashboard.js')
    const rows = () =>
        [...document.querySelectorAll('#regions li')].map(
            (li) => li.querySelector('strong')?.textContent,
        )
    expect(rows()).toEqual(['120', '80', '64', '91'])

    // THE CLAIM, first half. The same feed and the same fold, reached without
    // `patch`: the data moved and the screen did not, and nothing threw.
    click('#apply-unseen')
    expect(rows()).toEqual(['120', '80', '64', '91'])

    // THE CLAIM, second half, and it is the part that makes the bug expensive.
    // The next real production repaints from the whole map, so the write that
    // woke nobody arrives now — attached to an interaction that had nothing to
    // do with it. South is the frame nobody asked for; north is the one pressed.
    click('#apply')
    expect(rows()).toEqual(['130', '95', '64', '91'])
})

test('patch-transform: the load lands as an index, and the feed writes into it by id', async () => {
    globalThis.fetch = Object.assign(
        async () => {
            await Bun.sleep(20)
            return Response.json([
                { id: 'north', name: 'North', orders: 120 },
                { id: 'south', name: 'South', orders: 80 },
                { id: 'east', name: 'East', orders: 64 },
                { id: 'west', name: 'West', orders: 91 },
            ])
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('patch-transform', 'dashboard.js')
    const rows = () =>
        [...document.querySelectorAll('#regions li')].map(
            (li) => li.querySelector('strong')?.textContent,
        )
    expect([read('#status'), ...rows()]).toEqual(['loading…'])

    await Bun.sleep(60)
    expect([read('#status'), ...rows()]).toEqual(['', '120', '80', '64', '91'])

    // THE CLAIM. What arrived was an ARRAY, and what is held is an index — so a
    // frame naming `south` is a `get`, not a scan, and the entry it finds is the
    // one the load put there rather than a copy the page made afterwards.
    click('#apply')
    expect(rows()).toEqual(['120', '95', '64', '91'])
})

test('watch-tracked: the effect follows the value, whatever moved it', async () => {
    await mount('watch-tracked', 'handle.js')
    expect([read('#tab'), document.title]).toEqual([
        '@ada — Contacts',
        '@ada — Contacts',
    ])

    type('#handle', 'grace')
    expect(read('#tab')).toBe('@grace — Contacts')

    // THE CLAIM. The reset writes the value and never touches the title, so anything
    // keeping the two in step is keeping up with the VALUE rather than with the field —
    // which in this arm is a `retitle()` call, and the line a third writer forgets.
    click('#reset')
    expect([read('#tab'), document.title]).toEqual([
        '@ada — Contacts',
        '@ada — Contacts',
    ])
})

test('watch-disposer: a burst of keystrokes leaves one timer standing', async () => {
    const started: number[] = []
    const cleared: number[] = []
    const realTimeout = globalThis.setTimeout
    const realClear = globalThis.clearTimeout
    globalThis.setTimeout = ((fn: () => void, ms: number) => {
        const id = realTimeout(fn, ms)
        started.push(id as unknown as number)
        return id
    }) as typeof setTimeout
    globalThis.clearTimeout = ((id: number) => {
        cleared.push(id)
        return realClear(id)
    }) as typeof clearTimeout

    try {
        await mount('watch-disposer', 'autosave.js')
        for (const draft of ['C', 'Ca', 'Cal', 'Call', 'Calle', 'Called Ada']) {
            type('#notes', draft)
        }
        // THE CLAIM, and it is the half the screen cannot show: six keystrokes started
        // six timers and five were torn down, so one is left to fire. Without the
        // teardown all six fire and the page still looks right, the last to land
        // holding the newest draft.
        expect([started.length, cleared.length]).toEqual([6, 5])
        expect(read('#saved')).toBe('Called Tuesday.')

        await Bun.sleep(700)
        expect(read('#saved')).toBe('Called Ada')
    } finally {
        globalThis.setTimeout = realTimeout
        globalThis.clearTimeout = realClear
    }
})

test('watch-sources: the notes are read by the effect and do not wake it', async () => {
    await mount('watch-sources', 'assignment.js')
    expect(read('#audited')).toBe('ada — 15 characters of notes')

    // THE CLAIM. The effect reads the notes — the line it writes counts them — and
    // typing moves nothing, because what wakes it is the list and not the reads.
    type('#notes', 'Called Tuesday and again on Friday.')
    expect(read('#audited')).toBe('ada — 15 characters of notes')

    // And when the source does move, the effect sees the notes as they now stand.
    const owner = document.querySelector('#owner') as HTMLSelectElement
    owner.value = 'grace'
    owner.dispatchEvent(new Event('change'))
    expect(read('#audited')).toBe('grace — 35 characters of notes')
})

test('cap-debounce: a burst of keystrokes is one load, and the held figure stays up', async () => {
    let requests = 0
    globalThis.fetch = (async (input: string) => {
        requests += 1
        const region =
            new URL(input, 'http://example.invalid').searchParams.get(
                'region',
            ) ?? ''
        const byRegion: Record<string, number> = {
            n: 412,
            no: 412,
            nor: 128,
            north: 128,
        }
        return Response.json(byRegion[region.toLowerCase()] ?? 0)
    }) as typeof fetch

    await mount('cap-debounce', 'orders.js')
    await Bun.sleep(20)
    expect([read('#orders'), requests]).toEqual(['128', 1])

    for (const draft of ['n', 'no', 'nor', 'nort', 'north'])
        type('#region', draft)

    // THE CLAIM, first half. Five keystrokes and no load yet — and the figure already
    // held is still on screen rather than a blank, which is the `refreshing` contract
    // and is why there is no fourth probe to learn.
    expect([read('#orders'), read('#status'), requests]).toEqual([
        '128',
        'updating…',
        1,
    ])

    await Bun.sleep(500)
    // THE CLAIM, second half. One load for the burst, not five.
    expect([read('#orders'), read('#status'), requests]).toEqual(['128', '', 2])
})

test('cap-throttle: the tile lands the first arrival and then caps its rate', async () => {
    await mount('cap-throttle', 'live.js')

    // The first arrival is immediate — a throttle LEADS, where a debounce would have
    // shown nothing at all for the whole first window.
    await Bun.sleep(120)
    expect(Number(read('#tile'))).toBeGreaterThan(0)

    // THE CLAIM, and it is a work claim rather than a value one: both figures are
    // right at every moment a reader looks, and only one of them cost a repaint per
    // arrival. So the assertion is PAINTS, counted off the nodes themselves.
    const paints = (id: string) => {
        let seen = 0
        const observer = new MutationObserver((records) => {
            seen += records.length
        })
        observer.observe(document.querySelector(id) as HTMLElement, {
            childList: true,
            characterData: true,
            subtree: true,
        })
        return () => {
            observer.disconnect()
            return seen
        }
    }
    const feed = paints('#feed')
    const tile = paints('#tile')
    await Bun.sleep(1000)
    const arrivals = feed()
    const repaints = tile()

    expect(arrivals).toBeGreaterThan(15)
    expect(repaints).toBeLessThan(5)
})

test('cache-shared: two panels on one range are one load', async () => {
    let requests = 0
    const computed: Record<string, number> = {}
    globalThis.fetch = (async (input: string) => {
        requests += 1
        const range =
            new URL(input, 'http://example.invalid').searchParams.get(
                'range',
            ) ?? ''
        computed[range] = (computed[range] ?? 0) + 1
        await Bun.sleep(20)
        return Response.json(
            range === '7d'
                ? { orders: 128, average: 42.5, computed: computed[range] }
                : { orders: 512, average: 44.9, computed: computed[range] },
        )
    }) as typeof fetch

    await mount('cache-shared', 'metrics.js')
    await Bun.sleep(60)

    // THE FIRST PAINT. Two panels that never speak to each other asked on the
    // same tick, and what went into the table was the ENTRY rather than the
    // answer — so the second joined the first instead of starting a load of
    // its own. The record's own count says so.
    expect([
        read('#total [data-value]'),
        read('#average [data-value]'),
        read('#total [data-computed]'),
        read('#average [data-computed]'),
        requests,
    ]).toEqual(['128', '42.5', '1', '1', 1])

    // A DIFFERENT KEY IS A DIFFERENT ENTRY, and only the panel that moved
    // pays for it.
    click('#average [data-range="30d"]')
    await Bun.sleep(60)
    expect([
        read('#total [data-value]'),
        read('#average [data-value]'),
        requests,
    ]).toEqual(['128', '44.9', 2])

    // THE CLAIM. The other panel arriving on that same key gets the entry
    // already held: no request, and the record's count still 1.
    click('#total [data-range="30d"]')
    expect([
        read('#total [data-value]'),
        read('#total [data-computed]'),
        requests,
    ]).toEqual(['512', '1', 2])

    // And back, to a key held since the first paint.
    click('#average [data-range="7d"]')
    expect([read('#average [data-value]'), requests]).toEqual(['42.5', 2])
})

test('cache-canonical: three spellings of one query land on one entry', async () => {
    let requests = 0
    const asked: string[] = []
    const computed: Record<string, number> = {}
    globalThis.fetch = (async (input: string) => {
        requests += 1
        const url = new URL(input, 'http://example.invalid')
        asked.push(url.search)
        const region = url.searchParams.get('region') ?? ''
        computed[region] = (computed[region] ?? 0) + 1
        await Bun.sleep(20)
        return Response.json({
            orders: region === 'north' ? 128 : 74,
            computed: computed[region],
        })
    }) as typeof fetch

    await mount('cache-canonical', 'metrics.js')
    await Bun.sleep(60)
    expect([read('#orders'), read('#computed'), requests]).toEqual([
        '128',
        '1',
        1,
    ])

    // THE CLAIM. Argument order does not split the entry and an `undefined`
    // member is dropped rather than keyed, so neither spelling is a second
    // request — and the one request that went out went under the canonical
    // spelling rather than under whichever caller happened to be first.
    click('[data-spelling="region first"]')
    click('[data-spelling="with compare"]')
    expect([read('#orders'), read('#computed'), requests, asked]).toEqual([
        '128',
        '1',
        1,
        ['?range=7d&region=north'],
    ])

    // An argument that genuinely differs is the other side of the same rule.
    click('[data-region="south"]')
    await Bun.sleep(60)
    expect([read('#orders'), requests, asked[1]]).toEqual([
        '74',
        2,
        '?range=7d&region=south',
    ])

    click('[data-region="north"]')
    expect([read('#orders'), read('#computed'), requests]).toEqual([
        '128',
        '1',
        2,
    ])
})

test('cache-tags: one tag reaches two memos and stops at the next region', async () => {
    const served: Record<string, number> = {}
    globalThis.fetch = (async (input: string) => {
        const url = new URL(input, 'http://example.invalid')
        const key = url.pathname + url.search
        served[key] = (served[key] ?? 0) + 1
        const region = url.searchParams.get('region') ?? ''
        if (url.pathname.includes('/api/totals')) {
            return Response.json({
                revenue: region === 'north' ? 48200 : 31400,
                computed: served[key],
            })
        }
        return Response.json({
            count: region === 'north' ? 37 : 24,
            loaded: served[key],
        })
    }) as typeof fetch

    await mount('cache-tags', 'region.js')
    await Bun.sleep(20)
    expect([
        read('#north [data-revenue]'),
        read('#north [data-count]'),
        read('#north [data-computed]'),
        read('#north [data-loaded]'),
    ]).toEqual(['48200', '37', '1', '1'])

    // THE CLAIM. One tag, two memos, and the caller named neither of them —
    // the selection matched on what the entries declared about themselves.
    // A SELECTION IS ALSO WHAT IT DOES NOT REACH, which is the half a card
    // showing one region cannot fail on: south declares `region:south` and
    // stands still.
    click('#north [data-reload]')
    await Bun.sleep(20)
    expect([
        read('#north [data-computed]'),
        read('#north [data-loaded]'),
        read('#south [data-computed]'),
        read('#south [data-loaded]'),
    ]).toEqual(['2', '2', '1', '1'])

    click('#south [data-reload]')
    await Bun.sleep(20)
    expect([
        read('#north [data-computed]'),
        read('#south [data-computed]'),
        read('#south [data-loaded]'),
    ]).toEqual(['2', '2', '2'])
})

test('probe-hole: the fields are holes until the row lands', async () => {
    globalThis.fetch = Object.assign(
        async () => {
            await Bun.sleep(30)
            return Response.json({
                number: 'INV-4021',
                customer: 'Ada Bell',
                total: '$82.40',
            })
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('probe-hole', 'invoice.js')
    // THE CLAIM. Nothing branched on a flag and the page rendered anyway — the three
    // reads are three holes, and the arm needed a write per site to fill them.
    expect([read('#number'), read('#customer'), read('#total')]).toEqual([
        '',
        '',
        '',
    ])

    await Bun.sleep(80)
    expect([read('#number'), read('#customer'), read('#total')]).toEqual([
        'INV-4021',
        'Ada Bell',
        '$82.40',
    ])
})

test('probe-refresh: a reload keeps the figures that are already up', async () => {
    let sent = 0
    globalThis.fetch = Object.assign(
        async () => {
            sent += 1
            await Bun.sleep(30)
            return Response.json({ total: '$82.40', sent })
        },
        { preconnect: () => {} },
    ) as typeof fetch

    const hidden = (id: string) =>
        (document.querySelector(id) as HTMLElement).hidden

    await mount('probe-refresh', 'invoice.js')
    // A FIRST load has nothing to serve, so the pending branch is the one on screen.
    expect([hidden('#loading'), read('#status'), read('#total')]).toEqual([
        false,
        '',
        '',
    ])

    await Bun.sleep(80)
    expect([hidden('#loading'), read('#total'), read('#sent')]).toEqual([
        true,
        '$82.40',
        '1',
    ])

    // THE CLAIM. The second load is not the first: the figures stay up, the pending
    // branch does not come back, and only `refreshing` moved. One boolean cannot tell
    // these apart, which is why the arm carries two.
    click('#refresh')
    expect([hidden('#loading'), read('#status'), read('#total')]).toEqual([
        true,
        'refreshing…',
        '$82.40',
    ])

    await Bun.sleep(80)
    expect([read('#status'), read('#sent')]).toEqual(['', '2'])
})

test('probe-derived: the count says it is counting rather than saying zero', async () => {
    globalThis.fetch = Object.assign(
        async () => {
            await Bun.sleep(30)
            return Response.json([
                { id: 4021, paid: true },
                { id: 4022, paid: false },
                { id: 4023, paid: false },
            ])
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('probe-derived', 'unpaid.js')
    // THE CLAIM, and it is the whole reason the probe walks the sources. The filter
    // runs fine over nothing and returns an empty array, so a page keyed on the COUNT
    // renders a confident "0 unpaid" for the length of the load — right-looking, wrong,
    // and with nothing pending and nothing failed to say so.
    expect(read('#unpaid')).toBe('counting…')

    await Bun.sleep(80)
    expect(read('#unpaid')).toBe('2')
})

test('probe-error: the page renders the refusal instead of escalating it', async () => {
    let answers = 0
    globalThis.fetch = Object.assign(
        async () => {
            answers += 1
            await Bun.sleep(20)
            if (answers === 1) {
                return Response.json({
                    name: 'NotReachable',
                    status: 503,
                    message: 'The billing service did not answer.',
                    data: { id: '4021' },
                })
            }
            return Response.json({ total: '$82.40' })
        },
        { preconnect: () => {} },
    ) as typeof fetch

    const hidden = (id: string) =>
        (document.querySelector(id) as HTMLElement).hidden

    await mount('probe-error', 'invoice.js')
    await Bun.sleep(60)
    // THE CLAIM. `error()` hands the failure back rather than throwing, so the page
    // declines to escalate and renders its own message.
    expect([hidden('#message'), read('#message'), read('#total')]).toEqual([
        false,
        'The billing service did not answer.',
        'unavailable',
    ])

    // And the retry CLEARS it. That is the half a hand-kept third variable forgets —
    // the message would sit there under the new answer with nothing reading as wrong.
    click('#retry')
    await Bun.sleep(60)
    expect([hidden('#message'), read('#total')]).toEqual([true, '$82.40'])
})

test('reload-triggers: marking stale sends nothing, and the two in order blank the page', async () => {
    let loads = 0
    globalThis.fetch = Object.assign(
        async () => {
            loads += 1
            await Bun.sleep(20)
            return Response.json({ onHand: 128, counted: loads })
        },
        { preconnect: () => {} },
    ) as typeof fetch

    const blank = () =>
        (document.querySelector('#figures') as HTMLElement).hidden

    await mount('reload-triggers', 'level.js')
    // A FIRST load has nothing to serve, so the pending branch is what is on screen.
    expect(blank()).toBe(true)
    await Bun.sleep(60)
    expect([blank(), read('#onhand'), read('#counted')]).toEqual([
        false,
        '128',
        '1',
    ])

    // `refresh` ALONE is stale-while-revalidate: what is held keeps being served, so
    // the figures are up the whole way across.
    click('#reload')
    expect([blank(), read('#onhand')]).toEqual([false, '128'])
    await Bun.sleep(60)
    expect([blank(), read('#counted'), loads]).toEqual([false, '2', 2])

    // `invalidate` ALONE moves nothing and sends nothing. It is the cache behind the
    // value that goes, not the value.
    click('#stale')
    await Bun.sleep(40)
    expect([blank(), read('#onhand'), loads]).toEqual([false, '128', 2])

    // THE CLAIM. In that order they are the one way the eager trigger blanks a page:
    // the invalidate threw away exactly what stale-while-revalidate would have served,
    // so the refresh behind it is a load with nothing underneath and the pending branch
    // is what mounts.
    click('#reload')
    expect(blank()).toBe(true)

    await Bun.sleep(60)
    expect([blank(), read('#counted'), loads]).toEqual([false, '3', 3])
})

test('reload-args: a partial args pattern reaches one warehouse and not the other', async () => {
    const loads: Record<string, number> = { east: 0, west: 0 }
    let onHand = 128
    globalThis.fetch = Object.assign(
        async (input: string) => {
            if (input.startsWith('/api/book')) {
                onHand -= 1
                return Response.json({ onHand })
            }
            const warehouse =
                new URL(input, 'http://example.invalid').searchParams.get(
                    'warehouse',
                ) ?? 'east'
            loads[warehouse] = (loads[warehouse] ?? 0) + 1
            return Response.json({
                onHand: warehouse === 'east' ? onHand : 64,
                loads: loads[warehouse],
            })
        },
        { preconnect: () => {} },
    ) as unknown as typeof fetch

    await mount('reload-args', 'shelves.js')
    await Bun.sleep(40)
    expect([read('#east'), read('#east-loads'), read('#west-loads')]).toEqual([
        '128',
        '1',
        '1',
    ])

    // THE CLAIM. The pattern names a warehouse and not a key, so it reaches east's
    // entry whatever its sku — and leaves west's alone, which a whole-memo refresh
    // would not have.
    click('#book')
    await Bun.sleep(60)
    expect([read('#east'), read('#east-loads'), read('#west-loads')]).toEqual([
        '127',
        '2',
        '1',
    ])
})

test('reload-ttl: a lapse loads nothing until somebody reads', async () => {
    let loads = 0
    globalThis.fetch = Object.assign(
        async () => {
            loads += 1
            return Response.json({ onHand: 128, loads })
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('reload-ttl', 'shelf.js')
    await Bun.sleep(20)
    expect([read('#onhand'), read('#loads')]).toEqual(['128', '1'])

    // Inside the window, a read is served from what is held.
    click('#again')
    await Bun.sleep(20)
    expect([read('#loads'), loads]).toEqual(['1', 1])

    // THE CLAIM. The lapse itself woke nobody and sent nothing — the figure is still
    // on screen three seconds later — and the READ that follows is what fetches.
    await Bun.sleep(3100)
    expect([read('#loads'), loads]).toEqual(['1', 1])

    click('#again')
    await Bun.sleep(20)
    expect([read('#loads'), loads]).toEqual(['2', 2])
})

test('store-restore: the value comes back from the store, not from the fallback', async () => {
    const stored: Record<string, unknown> = {}
    globalThis.fetch = Object.assign(
        async (input: string, init?: { method?: string; body?: string }) => {
            if (init?.method === 'POST') {
                const body = JSON.parse(init.body ?? '{}')
                stored[body.name] = body.value
                return Response.json(stored[body.name] ?? null)
            }
            const name =
                new URL(input, 'http://example.invalid').searchParams.get(
                    'name',
                ) ?? ''
            return Response.json(stored[name] ?? null)
        },
        { preconnect: () => {} },
    ) as unknown as typeof fetch

    await mount('store-restore', 'volume.js')
    await Bun.sleep(20)
    // A miss falls back to the initial value, which is the order the option reads in.
    expect(read('#volume')).toBe('4')

    click('#up')
    click('#up')
    await Bun.sleep(20)
    expect([read('#volume'), stored.volume]).toEqual(['6', 6])

    // THE CLAIM. A second run of the same arm over the same store — which is what the
    // frame's Reload does — restores rather than falling back.
    await mount('store-restore', 'volume.js')
    await Bun.sleep(20)
    expect(read('#volume')).toBe('6')
})

test('store-keyed: two args keys address two stores', async () => {
    const asked: string[] = []
    globalThis.fetch = Object.assign(
        async (input: string) => {
            const at =
                new URL(input, 'http://example.invalid').searchParams.get(
                    'at',
                ) ?? ''
            asked.push(at)
            return Response.json({
                theme: at === 'settings:ada' ? 'dark' : 'light',
            })
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('store-keyed', 'profiles.js')
    await Bun.sleep(20)

    // THE CLAIM. The address came off the key, so the two entries went to two places.
    // Closed over one address instead, both reads land on the same row and the second
    // profile quietly reads back the first — same shape on screen, wrong value.
    expect([read('#ada'), read('#grace')]).toEqual(['dark', 'light'])
    expect(asked.sort()).toEqual(['settings:ada', 'settings:grace'])
})

test('tail-window: the window is what the app trims to, whatever the reader shows', async () => {
    await mount('tail-window', 'console.js')
    const rows = () =>
        [...document.querySelectorAll('#console li')].map(
            (li) => li.querySelector('span')?.textContent,
        )
    expect(rows()).toEqual([])

    for (let press = 0; press < 3; press += 1) click('#emit')
    expect(rows()).toEqual(['1', '2', '3'])

    // THE CLAIM. The writer trims to four, so what is on screen is the VALUE's window —
    // a fifth token does not make a fifth row, it moves the window.
    click('#emit')
    click('#emit')
    expect(rows()).toEqual(['2', '3', '4', '5'])
})

test('tail-undo: a second step back does not read the first step back', async () => {
    await mount('tail-undo', 'draft.js')
    const field = document.querySelector('#draft') as HTMLInputElement

    for (const draft of [
        'How do I',
        'How do I rotate',
        'How do I rotate a key?',
    ]) {
        type('#draft', draft)
    }
    expect(field.value).toBe('How do I rotate a key?')

    click('#undo')
    expect(field.value).toBe('How do I rotate')

    // THE CLAIM. The undo appended to the same ring it is walking, so a position taken
    // off the LIVE ring would now hand back the step just taken and the stack would sit
    // there flipping between two values. The snapshot is what makes the second step go
    // back rather than nowhere.
    click('#undo')
    expect(field.value).toBe('How do I')

    click('#undo')
    expect(field.value).toBe('How do')
})

test('rpc-call: the page gets the row with no API written between them', async () => {
    const asked: string[] = []
    globalThis.fetch = Object.assign(
        async (input: string) => {
            asked.push(input)
            await Bun.sleep(20)
            return Response.json({
                number: 'INV-4021',
                dueOn: '2026-10-01',
                total: '$82.40',
            })
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('rpc-call', 'invoice.js')
    await Bun.sleep(60)
    expect([read('#number'), read('#due'), read('#total')]).toEqual([
        'INV-4021',
        '2026-10-01',
        '$82.40',
    ])
    // THE CLAIM, and what the arm pays for it: the address and the argument encoding
    // are written out here, checked against nothing, and a renamed export is a 404
    // rather than a compile error.
    expect(asked).toEqual(['/api/invoices/get?id=4021'])
})

// The homepage's card. Reverted — the route dropped from `server.ts` — the heading reads
// '' where 'Invoice INV-0042' was owed, and the line reads the arm's own error branch.
test('read-invoice: the row the handler returns is the row on the page', async () => {
    const routes = await routesOf('read-invoice', 'server.ts')
    const asked: string[] = []
    globalThis.fetch = Object.assign(
        async (input: string) => {
            asked.push(input)
            const url = new URL(input, 'http://example.invalid')
            return (
                routes[url.pathname]?.(new Request(url)) ??
                new Response('', { status: 404 })
            )
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('read-invoice', 'invoice.js')
    await Bun.sleep(30)
    // THE CLAIM: a row from the database on the page, through the one handler.
    expect([read('#number'), read('#line')]).toEqual([
        'Invoice INV-0042',
        '$1,240.00 due 2026-09-14',
    ])
    // What the arm pays for it: an address and an encoding written out by hand on both
    // sides, and a miss the handler has to turn into a status the page then branches on.
    expect(asked).toEqual(['/api/invoice?id=42'])
    const missing = await routes['/api/invoice']?.(
        new Request('http://example.invalid/api/invoice?id=7'),
    )
    expect(missing?.status).toBe(404)
})

test('rpc-reactive: the button reads the probes off the call itself', async () => {
    let loads = 0
    globalThis.fetch = Object.assign(
        async () => {
            loads += 1
            await Bun.sleep(30)
            return Response.json({ total: loads === 1 ? '$82.40' : '$91.00' })
        },
        { preconnect: () => {} },
    ) as typeof fetch

    const disabled = (id: string) =>
        (document.querySelector(id) as HTMLButtonElement).disabled

    await mount('rpc-reactive', 'invoice.js')
    // Nothing is held, so the reminder cannot be sent yet.
    expect([disabled('#remind'), read('#total')]).toEqual([true, ''])

    await Bun.sleep(80)
    expect([disabled('#remind'), read('#total')]).toEqual([false, '$82.40'])

    // THE CLAIM. A promise answers once; this keeps answering. The reload is
    // `refreshing` rather than `pending`, so the button stays live and the total stays
    // up — and the arm needed two variables it tracked itself to say the same thing.
    click('#reload')
    expect([disabled('#remind'), read('#status'), read('#total')]).toEqual([
        false,
        'reloading…',
        '$82.40',
    ])

    await Bun.sleep(80)
    expect([read('#status'), read('#total')]).toEqual(['', '$91.00'])
})

test('rpc-follow: a change on the server reaches the list without a second read', async () => {
    const reads: string[] = []
    globalThis.fetch = Object.assign(
        async (url: string) => {
            reads.push(String(url))
            return Response.json(
                [
                    { id: 'acme', name: 'Acme Corp', stage: 'lead' },
                    { id: 'globex', name: 'Globex', stage: 'proposal' },
                ],
                { headers: { 'x-version': '7' } },
            )
        },
        { preconnect: () => {} },
    ) as unknown as typeof fetch
    const opened: {
        sent: string[]
        onopen?: () => void
        onmessage?: (event: { data: string }) => void
    }[] = []
    const unstubbed = globalThis.WebSocket
    globalThis.WebSocket = class {
        sent: string[] = []
        onopen?: () => void
        onmessage?: (event: { data: string }) => void
        constructor() {
            opened.push(this)
            queueMicrotask(() => this.onopen?.())
        }
        send(text: string) {
            this.sent.push(text)
        }
    } as unknown as typeof WebSocket
    try {
        await mount('rpc-follow', 'deals.js')
        await Bun.sleep(10)
        const stages = () =>
            [...document.querySelectorAll('#deals li span')].map(
                (one) => one.textContent,
            )
        expect(stages()).toEqual(['lead', 'proposal'])
        // The feed names the version the first read answered with.
        expect(opened[0]?.sent).toEqual([JSON.stringify({ since: 7 })])

        // THE CLAIM: the server's change arrives on the feed and the list follows it, with no
        // second read — the arm needed a socket, a frame format and a version of its own for it.
        opened[0]?.onmessage?.({
            data: JSON.stringify({
                deals: [
                    { id: 'acme', name: 'Acme Corp', stage: 'qualified' },
                    { id: 'globex', name: 'Globex', stage: 'proposal' },
                ],
            }),
        })
        expect(stages()).toEqual(['qualified', 'proposal'])
        expect(reads).toEqual(['/api/deals'])
    } finally {
        globalThis.WebSocket = unstubbed
    }
})

test('bind-text: the field and the state are one copy', async () => {
    await mount('bind-text', 'contact.js')
    expect(read('#summary')).toBe('ada@example.com on monthly')

    type('#email', 'grace@example.com')
    expect(read('#summary')).toBe('grace@example.com on monthly')

    // THE CLAIM. There is no second form model to keep in step, so the summary is a
    // read of the same value the input writes — and the arm needs a listener AND a
    // seeding line per field to say it.
    const plan = document.querySelector('#plan') as HTMLSelectElement
    plan.value = 'yearly'
    plan.dispatchEvent(new Event('change'))
    expect(read('#summary')).toBe('grace@example.com on yearly')
})

test('bind-boolean: a disclosure is state the rest of the page can read', async () => {
    await mount('bind-boolean', 'advanced.js')
    expect([read('#reminders'), read('#state')]).toEqual(['on', 'shut'])

    const box = document.querySelector('#subscribed') as HTMLInputElement
    box.checked = false
    box.dispatchEvent(new Event('change'))
    expect(read('#reminders')).toBe('off')

    // THE CLAIM. A `<details>` keeps its open state in the DOM, so nothing else can
    // branch on it until somebody goes and fetches it. Bound, it is a value like any
    // other and the line below follows it.
    const details = document.querySelector('#advanced') as HTMLDetailsElement
    details.open = true
    details.dispatchEvent(new Event('toggle'))
    expect(read('#state')).toBe('open')
})

test('bind-group: a radio holds one value and a checkbox set holds an array', async () => {
    await mount('bind-group', 'assign.js')
    expect([read('#tier'), read('#regions')]).toEqual(['gold', 'north'])

    const check = (id: string, on: boolean) => {
        const box = document.querySelector(id) as HTMLInputElement
        box.checked = on
        box.dispatchEvent(new Event('change'))
    }

    check('#silver', true)
    expect(read('#tier')).toBe('silver')

    // THE CLAIM. Membership is not a DOM property: the checkbox set has to be added to
    // and removed from rather than assigned, which is why the two spellings are one
    // binding rather than the same one twice.
    check('#south', true)
    expect(read('#regions')).toBe('north, south')

    check('#north', false)
    expect(read('#regions')).toBe('south')
})

test('style-scoped: two components style one class name and neither reaches the other', async () => {
    await mount('style-scoped', 'badges.js')
    const colourOf = (id: string) =>
        getComputedStyle(document.querySelector(id) as Element).color

    // THE CLAIM. Both components wrote a rule for the same name, and the two rules
    // landed on their own element and nowhere else. In the arm that is a name per
    // component in the selector, which is a convention rather than a guarantee — a
    // third component reusing `badge` has to already know these two exist.
    expect([colourOf('#overdue'), colourOf('#paid')]).toEqual([
        'rgb(163, 58, 58)',
        'rgb(47, 107, 68)',
    ])
})

test('style-global: the escape reaches markup the component did not render', async () => {
    await mount('style-global', 'legend.js')
    const colourOf = (id: string) =>
        getComputedStyle(document.querySelector(id) as Element).color

    // THE CLAIM. The scoped rule stays on the component's own element and the
    // `:global` one lands on a paragraph the page rendered, so the escape is per
    // selector rather than per stylesheet.
    expect([colourOf('#badge'), colourOf('#legend')]).toEqual([
        'rgb(163, 58, 58)',
        'rgb(93, 108, 102)',
    ])
})

test('refuse-narrowed: each refusal is matched by name and gives back its own data', async () => {
    globalThis.fetch = Object.assign(
        async (input: string) => {
            const id = new URL(
                input,
                'http://example.invalid',
            ).searchParams.get('id')
            await Bun.sleep(20)
            if (id === '4311')
                return Response.json({
                    name: 'NotYours',
                    status: 403,
                    message: 'That invoice belongs to someone else.',
                    data: { owner: 'Grace Hopper' },
                })
            if (id === '4312')
                return Response.json({
                    name: 'Superseded',
                    status: 409,
                    message: 'That invoice was replaced.',
                    data: { replacedBy: '4408' },
                })
            return Response.json({ total: '$1,240.00' })
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('refuse-narrowed', 'invoice.js')
    await Bun.sleep(60)
    expect(read('#total')).toBe('$1,240.00')

    // THE CLAIM. Two refusals off one handler, and matching the name is what picks
    // between them — each branch reads a field the other refusal does not carry, so a
    // match that fell through would render `undefined` rather than the wrong sentence.
    click('#i4311')
    await Bun.sleep(60)
    expect([read('#message'), read('#total')]).toEqual([
        'Owned by Grace Hopper.',
        '—',
    ])

    click('#i4312')
    await Bun.sleep(60)
    expect([read('#message'), read('#total')]).toEqual([
        'Replaced by #4408.',
        '—',
    ])

    // And the answer that is not a refusal clears it.
    click('#i4310')
    await Bun.sleep(60)
    expect([
        (document.querySelector('#message') as HTMLElement).hidden,
        read('#total'),
    ]).toEqual([true, '$1,240.00'])
})

test('refuse-write: a refused write leaves the last good value standing', async () => {
    await mount('refuse-write', 'phone.js')
    expect(read('#stored')).toBe('(415) 555-0132')

    // THE CLAIM. The refusal fills the error and stores nothing, so the record keeps
    // what it had — the failure is beside the value rather than instead of it.
    type('#draft', '415 555 013')
    click('#save')
    expect([read('#message'), read('#stored')]).toEqual([
        '“415 555 013” is not ten digits.',
        '(415) 555-0132',
    ])

    // And the write that is accepted clears the standing failure.
    type('#draft', '415 555 0199')
    click('#save')
    expect([
        (document.querySelector('#message') as HTMLElement).hidden,
        read('#stored'),
    ]).toEqual([true, '(415) 555-0199'])
})

test('write-coalesced: two presses inside one flight are one write', async () => {
    let writes = 0
    globalThis.fetch = Object.assign(
        async () => {
            writes += 1
            const answered = writes
            await Bun.sleep(40)
            return Response.json(answered)
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('write-coalesced', 'pay.js')

    // THE CLAIM. The second press lands inside the first flight, so it is the same write
    // and gets that write's answer — the record carries one payment rather than two.
    click('#pay')
    click('#pay')
    expect(read('#status')).toBe('paying…')
    await Bun.sleep(90)
    expect([read('#payments'), String(writes)]).toEqual(['1', '1'])

    // And the window shuts with the response. A press after it is a second write, which is
    // what a `ttl` of 0 means and what a longer one would take away.
    click('#pay')
    await Bun.sleep(90)
    expect([read('#payments'), String(writes)]).toEqual(['2', '2'])
})

test('schema-browser: a refused write leaves the record and never reaches a server', async () => {
    let requests = 0
    globalThis.fetch = Object.assign(
        async () => {
            requests += 1
            return Response.json({})
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('schema-browser', 'email.js')
    expect(read('#stored')).toBe('ada@example.com')

    // THE CLAIM. The schema is declared where the value is, so the check is here — the
    // message is on screen with nothing having been sent.
    type('#email', 'ada@example')
    expect([read('#message'), read('#stored'), String(requests)]).toEqual([
        'That is not an email address.',
        'ada@example.com',
        '0',
    ])

    type('#email', 'ada@lovelace.org')
    expect([
        (document.querySelector('#message') as HTMLElement).hidden,
        read('#stored'),
        String(requests),
    ]).toEqual([true, 'ada@lovelace.org', '0'])
})

test('schema-issues: each message lands under the field its path names', async () => {
    const routes = await routesOf('schema-issues', 'server.ts')

    globalThis.fetch = Object.assign(
        async (input: string) => {
            const url = new URL(input, 'http://example.invalid')
            return (
                routes[url.pathname]?.(new Request(url)) ??
                new Response('', { status: 404 })
            )
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('schema-issues', 'search.js')
    await Bun.sleep(30)
    expect(read('#matches')).toBe('2')

    // THE CLAIM. Two fields refuse at once and each message is found by its own path, so
    // neither renders under the other — which a flat list of messages cannot promise.
    type('#query', 'i')
    type('#limit', '4')
    await Bun.sleep(30)
    expect([
        read('#query-issue'),
        read('#limit-issue'),
        read('#matches'),
    ]).toEqual(['Type at least two characters.', 'Between 1 and 3.', '—'])

    type('#query', 'inv')
    await Bun.sleep(30)
    expect([
        (document.querySelector('#query-issue') as HTMLElement).hidden,
        read('#limit-issue'),
    ]).toEqual([true, 'Between 1 and 3.'])
})

test('schema-key: two spellings of one key are two entries and two loads', async () => {
    const asked: string[] = []
    globalThis.fetch = Object.assign(
        async (input: string) => {
            const id = new URL(
                input,
                'http://example.invalid',
            ).searchParams.get('id')
            asked.push(id ?? '')
            await Bun.sleep(20)
            return Response.json({ ref: 'abc-123' })
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('schema-key', 'invoice.js')
    await Bun.sleep(50)
    expect([read('#ref'), asked.join(',')]).toEqual(['abc-123', 'ABC-123'])

    // THE CLAIM. The entry is filed under the arguments as sent, so the other spelling of
    // one invoice is a second entry and loads again.
    click('#lower')
    expect(read('#status')).toBe('loading…')
    await Bun.sleep(50)
    expect([read('#ref'), asked.join(',')]).toEqual([
        'abc-123',
        'ABC-123,abc-123',
    ])

    // And the first spelling is still held, so going back asks nothing.
    click('#upper')
    expect([read('#status'), asked.join(',')]).toEqual(['', 'ABC-123,abc-123'])
})

// Reverted — the parse hoisted above the sign-in check — a signed-out caller asking for nine reads
// `422 Unprocessable Content` where `401 Sign in first.` was owed.
test('rung-order: a signed-out caller is refused before the arguments are read', async () => {
    const routes = await routesOf('rung-order', 'server.ts')
    globalThis.fetch = Object.assign(
        async (input: string, init?: RequestInit) => {
            const url = new URL(input, 'http://example.invalid')
            return (
                routes[url.pathname]?.(new Request(url, init)) ??
                new Response('', { status: 404 })
            )
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('rung-order', 'recent.js')
    await Bun.sleep(20)
    expect([read('#status'), read('#count')]).toEqual([
        '401 Sign in first.',
        '—',
    ])

    // THE CLAIM. The argument is malformed either way, and which refusal comes back is
    // decided by the rung having run first — a signed-out caller never reads the schema
    // back out of a 422.
    type('#limit', '9')
    await Bun.sleep(20)
    expect(read('#status')).toBe('401 Sign in first.')

    click('#seal')
    await Bun.sleep(20)
    expect(read('#status')).toBe('422 Unprocessable Content')

    type('#limit', '2')
    await Bun.sleep(20)
    expect([read('#status'), read('#count')]).toEqual(['', '2'])
})

// A stream whose gap between rows the caller sets, so one spec can hold a report that takes
// LONGER than the bound and never goes quiet for it, against one that goes quiet at once.
function streamingFetch(
    rows: Record<string, string[]>,
    step: number,
): typeof fetch {
    return Object.assign(
        async (input: string, init?: RequestInit) => {
            const region =
                new URL(input, 'http://example.invalid').searchParams.get(
                    'region',
                ) ?? ''
            const lines = rows[region] ?? []
            const encoder = new TextEncoder()
            let at = 0
            return new Response(
                new ReadableStream({
                    // THE ABORT HAS TO REACH THE READER, and registering it per branch is
                    // how this stopped testing anything: the parked branch honoured the
                    // signal and the producing one did not, so a wall-clock timer passed.
                    start(controller) {
                        init?.signal?.addEventListener('abort', () => {
                            try {
                                controller.error(new Error('aborted'))
                            } catch {}
                        })
                    },
                    async pull(controller) {
                        if (at === lines.length) {
                            if (lines.length > 0) return controller.close()
                            // The upstream that has stopped: no row, and no close either.
                            return new Promise(() => {})
                        }
                        await Bun.sleep(step)
                        if (init?.signal?.aborted) return
                        controller.enqueue(encoder.encode(`${lines[at]}\n`))
                        at += 1
                    },
                }),
            )
        },
        { preconnect: () => {} },
    ) as typeof fetch
}

test('timeout-per-chunk: the bound is on progress, not on the whole report', async () => {
    globalThis.fetch = streamingFetch(
        { north: ['Oslo 412', 'Bergen 208', 'Tromsø 96'], south: [] },
        800,
    )

    // THE CLAIM. Three rows 800ms apart is 2.4s of report under a 2s bound, and none of
    // it is cut — a wall clock from the first byte would have taken the third row.
    await mount('timeout-per-chunk', 'report.js')
    await Bun.sleep(2900)
    expect([read('#rows'), read('#status')]).toEqual(['3', ''])

    // And the same number still catches a source that has stopped producing.
    click('#south')
    await Bun.sleep(2400)
    expect([read('#rows'), read('#status')]).toEqual([
        '—',
        '504 Gateway Timeout',
    ])
}, 20_000)

test('stream-rows: the rows paint as they land and the count waits for the close', async () => {
    const REGIONS = [
        '{ "code": "no", "name": "North", "total": "$412k" }',
        '{ "code": "so", "name": "South", "total": "$208k" }',
        '{ "code": "ea", "name": "East", "total": "$96k" }',
    ]
    // A wide step, because the assertions are about WHICH row has landed: at 60ms they were
    // inside the scheduling noise of a loaded run and this failed in the file and passed alone.
    globalThis.fetch = streamingFetch({ '': REGIONS }, 250)

    const landed = () => [
        document.querySelectorAll('#rows li').length,
        read('#count'),
    ]

    await mount('stream-rows', 'report.js')
    await Bun.sleep(350)

    // THE CLAIM. One call read two ways: the block has the row that landed, and the
    // accumulation has nothing to serve until the stream closes.
    expect(landed()).toEqual([1, '…'])

    await Bun.sleep(250)
    expect(landed()).toEqual([2, '…'])

    await Bun.sleep(500)
    expect(landed()).toEqual([3, '3'])
})

test('one-type: four producers, and the same question asked of each', async () => {
    globalThis.fetch = Object.assign(
        async () => {
            await Bun.sleep(40)
            return Response.json({ name: 'Ada Lovelace' })
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('one-type', 'contact.js')

    // THE CLAIM. Owned and derived have landed from the moment they exist; loaded and
    // pushed have not, and each says so in the same place rather than in its own way.
    expect([
        read('#owned'),
        read('#derived'),
        read('#loaded'),
        read('#pushed'),
    ]).toEqual(['—', '0', '…', '…'])

    type('#draft', 'call her back')
    expect([read('#owned'), read('#derived')]).toEqual(['call her back', '3'])

    await Bun.sleep(80)
    expect(read('#loaded')).toBe('Ada Lovelace')

    click('#add')
    expect([read('#pushed'), read('#owned'), read('#derived')]).toEqual([
        'call her back',
        '—',
        '0',
    ])
})

test('name-path-write: the copy down the path is what a reader downstream sees', async () => {
    await mount('name-path-write', 'contact.js')
    expect(read('#heading')).toBe('Ada Lovelace — London')

    // THE CLAIM. The write copies each level of the path before it lands, so the object a
    // reader holds is a different one and the identity check that guards the derived line
    // has something to notice.
    type('#city', 'Oslo')
    expect(read('#heading')).toBe('Ada Lovelace — Oslo')

    type('#city', 'Bergen')
    expect(read('#heading')).toBe('Ada Lovelace — Bergen')
})

test('markup-escaped: the same value is text in one hole and markup in the other', async () => {
    await mount('markup-escaped', 'note.js')

    // THE CLAIM. `{expr}` escapes, so a tag in the value is characters on the page; `raw`
    // is the one that does not, and it has to be asked for by name.
    expect(document.querySelector('#text')?.querySelector('b')).toBe(null)
    expect(read('#text')).toBe('Chased <b>twice</b> — no answer')
    expect(
        document.querySelector('#markup')?.querySelector('b')?.textContent,
    ).toBe('twice')

    type('#note', 'Left a <i>voicemail</i>')
    expect(read('#text')).toBe('Left a <i>voicemail</i>')
    expect(
        document.querySelector('#markup')?.querySelector('i')?.textContent,
    ).toBe('voicemail')
})

test('markup-class-style: one class and one property move, and nothing else does', async () => {
    await mount('markup-class-style', 'invoice.js')
    const badge = () => document.querySelector('#badge') as HTMLElement

    expect([badge().className, badge().style.opacity, read('#badge')]).toEqual([
        'badge',
        '0.45',
        'on time',
    ])

    // THE CLAIM. The condition adds a class beside the one already there rather than
    // replacing the attribute, and sets one property rather than rebuilding `style`.
    click('#later')
    expect([badge().className, badge().style.opacity, read('#badge')]).toEqual([
        'badge overdue',
        '1',
        '3 days late',
    ])

    click('#earlier')
    expect([badge().className, badge().style.opacity]).toEqual([
        'badge',
        '0.45',
    ])
})

test('element-ref: the button reaches the node and the listeners report it', async () => {
    await mount('element-ref', 'note.js')
    const field = document.querySelector('#note') as HTMLInputElement
    field.value = 'chased twice'
    expect(read('#state')).toBe('idle')

    // THE CLAIM. The press reaches the element itself, not a value standing in for it —
    // clearing is a write anything could do, and focusing is not.
    click('#new')
    expect([field.value, document.activeElement]).toEqual(['', field])
    expect(read('#state')).toBe('focused')

    field.blur()
    expect(read('#state')).toBe('idle')
})

test('try-region: the failure replaces the whole region, not the line that threw', async () => {
    await mount('try-region', 'total.js')
    expect(
        [...document.querySelectorAll('#region li strong')].map(
            (one) => one.textContent,
        ),
    ).toEqual(['#4310', '$1351.60'])

    // THE CLAIM. The invoice number never threw and goes anyway: the boundary is over the
    // region, so what a reader is left with is the message rather than half a table.
    type('#rate', '')
    expect(document.querySelectorAll('#region li').length).toBe(0)
    expect(read('#region')).toBe('Rate must be a positive number.')

    type('#rate', '2')
    expect(
        [...document.querySelectorAll('#region li strong')].map(
            (one) => one.textContent,
        ),
    ).toEqual(['#4310', '$2480.00'])
})

test('list-keyed: a reorder moves the nodes it already had', async () => {
    await mount('list-keyed', 'contacts.js')
    const shown = () =>
        [...document.querySelectorAll('#rows li span')].map(
            (one) => one.textContent,
        )
    const held = () => [...document.querySelectorAll('#rows li')]

    expect(shown()).toEqual(['ada', 'grace', 'katherine'])
    const before = held()

    // THE CLAIM, AND IT IS ABOUT THE WORK RATHER THAN THE OUTPUT: a rebuild renders the
    // same three names, so the assertion is that these are the SAME nodes in a new order.
    // A two-row swap is what tells a minimal reorder from a rebuild.
    // `-1` for a node that was not among them, so this is identity and order at once.
    const order = () => held().map((one) => before.indexOf(one))

    click('#swap')
    expect(shown()).toEqual(['grace', 'ada', 'katherine'])
    expect(order()).toEqual([1, 0, 2])

    // And a full reverse, which the swap alone cannot catch: a transposition that gets the
    // ends right and the middle wrong passes the swap and fails here.
    click('#reverse')
    expect(shown()).toEqual(['katherine', 'ada', 'grace'])
    expect(order()).toEqual([2, 0, 1])
})

test('list-by: one key keeps the nodes of both lists over the value', async () => {
    await mount('list-by', 'contacts.js')
    const shown = (list: string) =>
        [...document.querySelectorAll(`${list} li`)].map((one) =>
            one.textContent?.replace(/^(ada|grace|katherine)/, ''),
        )
    const held = (list: string) => [...document.querySelectorAll(`${list} li`)]
    const tableBefore = held('#rows')
    const queueBefore = held('#queue')

    click('#swap')
    const names = ['Grace Hopper', 'Ada Lovelace', 'Katherine Johnson']
    expect(shown('#rows')).toEqual(names)
    expect(shown('#queue')).toEqual(names)
    // THE CLAIM, IN BOTH LISTS: the same nodes in a new order, `-1` for a node that was not
    // among them. A rebuild shows the same names and fails here.
    expect(held('#rows').map((one) => tableBefore.indexOf(one))).toEqual([
        1, 0, 2,
    ])
    expect(held('#queue').map((one) => queueBefore.indexOf(one))).toEqual([
        1, 0, 2,
    ])
})

test('props-live: the child follows the parent without being re-created', async () => {
    await mount('props-live', 'invoice.js')
    const child = () => document.querySelector('#total strong')

    expect([read('#lines'), read('#total')]).toEqual(['2', 'USD 1240.00'])
    const before = child()

    // THE CLAIM. The prop is a read rather than a value handed over once, so the child's
    // own node stays where it is and its text follows.
    click('#more')
    expect([read('#lines'), read('#total')]).toEqual(['3', 'USD 1860.00'])
    expect(child()).toBe(before)

    click('#fewer')
    click('#fewer')
    expect([read('#lines'), read('#total')]).toEqual(['1', 'USD 620.00'])
    expect(child()).toBe(before)
})

test('script-scope: one counter is per instance and the other is per module', async () => {
    await mount('script-scope', 'contacts.js')
    const rows = () =>
        [...document.querySelectorAll('#rows li strong')].map(
            (one) => one.textContent,
        )

    // The module body ran once; the setup body ran per row, so the seats differ.
    expect(rows()).toEqual(['0 calls · row 1', '0 calls · row 2'])

    // THE CLAIM. A `<script>` variable belongs to the instance, so logging a call on the
    // first row leaves the second where it was.
    ;(document.querySelectorAll('#rows li button')[0] as HTMLElement).click()
    expect(rows()).toEqual(['1 calls · row 1', '0 calls · row 2'])
    ;(document.querySelectorAll('#rows li button')[1] as HTMLElement).click()
    expect(rows()).toEqual(['1 calls · row 1', '1 calls · row 2'])
})

// Reverted — the sign-out cleared in the page, with no request — `asked` reads only the sign-in,
// and the HttpOnly seal the next request carries is still the signed-in one.
test('principal-session: the seal and what it resolved to move together', async () => {
    const asked: string[] = []
    globalThis.fetch = Object.assign(
        async (input: string, init?: RequestInit) => {
            asked.push(`${init?.method ?? 'GET'} ${input}`)
            return Response.json({
                authenticated: true,
                id: 'u_1',
                name: 'Ada Lovelace',
            })
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('principal-session', 'session.js')
    expect([read('#state'), read('#who'), read('#seal')]).toEqual([
        'no',
        '—',
        'Sign in',
    ])

    // THE CLAIM. Whether the seal was accepted and what the app resolved from it are one
    // thing, so a page cannot read "signed in" beside nobody, or a name beside "no".
    click('#seal')
    await Bun.sleep(20)
    expect([read('#state'), read('#who'), read('#seal')]).toEqual([
        'yes',
        'Ada Lovelace',
        'Sign out',
    ])

    // And signing out is a request too: the page cannot clear an HttpOnly seal.
    click('#seal')
    await Bun.sleep(20)
    expect([read('#state'), read('#who'), read('#seal')]).toEqual([
        'no',
        '—',
        'Sign in',
    ])
    expect(asked).toEqual(['POST /api/signIn', 'POST /api/signOut'])
})

test('log-channels: a line on a channel nothing selected is never recorded', async () => {
    await mount('log-channels', 'console.js')
    const lines = () =>
        [...document.querySelectorAll('#records li')].map(
            (one) =>
                `${one.querySelector('span')?.textContent}: ${one.querySelector('strong')?.textContent}`,
        )

    expect(lines()).toEqual([])

    click('#send')
    expect(lines()).toEqual(['billing: invoice sent'])

    // THE CLAIM. `sync` is not in `DEBUG`, so the press produces no record at all — the
    // gate is at the call rather than at the render, so nothing was built to be filtered.
    click('#poll')
    click('#poll')
    expect(lines()).toEqual(['billing: invoice sent'])

    click('#send')
    expect(lines()).toEqual(['billing: invoice sent', 'billing: invoice sent'])
})

// THE ARM AND THE `.abide` SOURCE ARE CLAIMED TO BE EQUIVALENT, which is what makes a ratio
// between them a claim. This closes the checkable corner of it: a CONTROL is markup an author
// wrote, so a button the arm renders that the example's own source never names is the two arms
// having come apart, and it renders perfectly either way.
//
// Data is legitimately absent from source, coming from a database the example stubs, so only
// controls are compared — and against the TEXT NODES of the templates, never whole source:
// matching a label against a whole file lets any coincidence rescue it, and `Post` on a button
// was once covered by `type Post` in a sibling `.ts` with the button renamed.
// AN ARM'S OWN ROUTES BEHIND `fetch`, so a spec drives the page and the server it wrote as one
// thing. A route may be a function or a table by method, which is what `Bun.serve` takes.
type MethodRoutes = Record<
    string,
    | ((request: Request) => Response | Promise<Response>)
    | Record<string, (request: Request) => Response | Promise<Response>>
>

function servedBy(routes: MethodRoutes, asked: string[] = []): typeof fetch {
    return Object.assign(
        async (input: string, init?: RequestInit) => {
            const method = init?.method ?? 'GET'
            asked.push(`${method} ${input}`)
            const url = new URL(input, 'http://example.invalid')
            const route = routes[url.pathname]
            const handler =
                typeof route === 'function' ? route : route?.[method]
            return (
                (await handler?.(new Request(url, init))) ??
                new Response('', { status: 404 })
            )
        },
        { preconnect: () => {} },
    ) as typeof fetch
}

// Reverted — the route's content-type written as `application/jsonl` — the readout reads that
// where 'text/event-stream' was owed.
test('sse-wallboard: a caller that sent no Accept is answered events', async () => {
    const routes = await routesOf('sse-wallboard', 'server.ts')
    globalThis.fetch = servedBy(routes)

    await mount('sse-wallboard', 'feed.js')
    await Bun.sleep(1200)
    // THE CLAIM: the request asked for nothing, and the answer is framed as events.
    expect(read('#type')).toBe('text/event-stream')
    expect(read('#body').trim().split('\n\n')).toEqual([
        'data: {"page":"/pricing","at":"09:41:02"}',
        'data: {"page":"/signup","at":"09:41:05"}',
        'data: {"page":"/docs","at":"09:41:09"}',
    ])
})

// Reverted — the route answering `Response.json(rows)` — the body is one line holding an array,
// which reads as one row with no region where three regions were owed.
test('jsonl-export: a list goes out one value per line', async () => {
    const routes = await routesOf('jsonl-export', 'server.ts')
    globalThis.fetch = servedBy(routes)

    await mount('jsonl-export', 'export.js')
    await Bun.sleep(50)
    expect(read('#type')).toBe('application/jsonl')
    // THE CLAIM: every line parses on its own, and there is one per row.
    const lines = read('#body').trim().split('\n')
    expect(lines.map((line) => JSON.parse(line).region)).toEqual([
        'north',
        'south',
        'east',
    ])
})

// Reverted — the route writing the whole file as its first chunk — the first read takes 4 lines
// where the header line alone was owed.
test('bytes-csv: the file is written as the rows are read', async () => {
    const routes = await routesOf('bytes-csv', 'server.ts')
    const answer = await routes['/api/salesCsv']?.(
        new Request('http://example.invalid/api/salesCsv?year=2026'),
    )
    expect(answer?.headers.get('content-type')).toBe('application/octet-stream')
    // THE CLAIM: the first chunk is the header line alone, ahead of any row.
    const reader = (
        answer as Response
    ).body?.getReader() as ReadableStreamDefaultReader<Uint8Array>
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe('region,total\n')
    await reader.cancel()

    globalThis.fetch = servedBy(routes)
    await mount('bytes-csv', 'csv.js')
    await Bun.sleep(1200)
    expect(read('#body').trim().split('\n')).toEqual([
        'region,total',
        'north,12480.00',
        'south,9140.00',
        'east,7020.00',
    ])
})

// Reverted — the route answering `new Response(null, { status: 204 })` for nobody — the script's
// `json()` throws on the empty body and the readouts stay at Ada's '200' and 'Charles Babbage'.
test('json-null: nobody is `null` at 200, not an empty answer', async () => {
    const routes = await routesOf('json-null', 'server.ts')
    globalThis.fetch = servedBy(routes)

    await mount('json-null', 'manager.js')
    await Bun.sleep(30)
    expect([read('#status'), read('#manager')]).toEqual([
        '200',
        'Charles Babbage',
    ])
    // THE CLAIM: Grace has no manager, and the answer still reads as JSON.
    click('#grace')
    await Bun.sleep(30)
    expect([read('#status'), read('#manager')]).toEqual(['200', 'null'])
})

// Reverted — the avatar route answering a photo itself — 200 and no `location`, where 302 and
// the current version's address were owed.
test('redirect-avatar: the stable address sends the browser on to the version', async () => {
    const routes = await routesOf('redirect-avatar', 'server.ts')
    // THE CLAIM: the address the page asks for answers a redirect to the current version.
    const answer = await routes['/api/avatar']?.(
        new Request('http://example.invalid/api/avatar?id=4022'),
    )
    expect([answer?.status, answer?.headers.get('location')]).toEqual([
        302,
        '/api/photo?id=4022&version=7',
    ])
    const photo = await routes['/api/photo']?.(
        new Request(`http://example.invalid${answer?.headers.get('location')}`),
    )
    expect(photo?.headers.get('content-type')).toBe('image/svg+xml')

    await mount('redirect-avatar', 'avatar.js')
    click('#grace')
    expect(read('#asked')).toBe('/api/avatar?id=4022')
})

// Reverted — the route's `content-type` left off — the answer is typed `text/plain;charset=UTF-8`,
// which a browser under `nosniff` shows as text rather than painting the invoice.
test('page-issued: the stored invoice is answered as a document', async () => {
    const routes = await routesOf('page-issued', 'server.ts')
    const answer = await routes['/api/issuedInvoice']?.(
        new Request('http://example.invalid/api/issuedInvoice?id=4021'),
    )
    // THE CLAIM: the stored HTML goes out as HTML, unchanged.
    expect(answer?.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await answer?.text()).toContain('<h1>Invoice INV-4021</h1>')

    // The page is the frame pointed at that route. Read rather than mounted: happy-dom would load
    // the frame itself, against a server this spec never started.
    const page = await Bun.file(
        new URL('page-issued/invoice.js', ARMS_DIR),
    ).text()
    expect(page).toContain("'/api/issuedInvoice?id=4021'")
})

// Reverted — the route answering `Response.json(contact)` with no init — the readouts read '200'
// and '' where '201' and the new record's address were owed.
test("response-created: the status and the location are the handler's to write", async () => {
    const routes = await routesOf('response-created', 'server.ts')
    globalThis.fetch = servedBy(routes)

    await mount('response-created', 'contact.js')
    expect([read('#status'), read('#location')]).toEqual(['—', '—'])
    click('#add')
    await Bun.sleep(30)
    // THE CLAIM: a create answers 201 and says where the record now lives.
    expect([read('#status'), read('#location')]).toEqual([
        '201',
        '/contacts/4031',
    ])
})

// Reverted — `DELETE` sent with the tag in a JSON body, as the other writes send theirs — the
// route reads no `tag` off the URL, removes nothing, and three tags stand where two were owed.
test('write-methods: each write goes out on its own method', async () => {
    const routes = (await routesOf(
        'write-methods',
        'server.ts',
    )) as unknown as MethodRoutes
    const asked: string[] = []
    globalThis.fetch = servedBy(routes, asked)
    const tags = () =>
        [...document.querySelectorAll('#tags button')].map(
            (button) => button.textContent,
        )

    await mount('write-methods', 'contact.js')
    await Bun.sleep(30)
    expect([read('#phone'), tags()]).toEqual([
        '020 7946 0018',
        ['customer ✕', 'newsletter ✕', 'vip ✕'],
    ])

    click('#save')
    await Bun.sleep(30)
    ;(document.querySelectorAll('#tags button')[1] as HTMLElement).click()
    await Bun.sleep(30)
    expect([read('#phone'), tags()]).toEqual([
        '020 7946 0019',
        ['customer ✕', 'vip ✕'],
    ])
    click('#reset')
    await Bun.sleep(30)
    expect(tags()).toEqual(['customer ✕', 'newsletter ✕', 'vip ✕'])
    // THE CLAIM, and what the arm pays for it: four verbs, each a string here that the server's
    // route table has to agree with, and a query built by hand for the one carrying it in the URL.
    expect(asked).toEqual([
        'GET /api/contact?id=4021',
        'PATCH /api/contact',
        'DELETE /api/contact?id=4021&tag=newsletter',
        'PUT /api/contact',
    ])
})

test('every control the arm renders is one the page source names', async () => {
    const strays: string[] = []
    for (const path of new Bun.Glob('*/index.html').scanSync({
        cwd: ARMS_DIR.pathname,
    })) {
        const name = path.slice(0, path.indexOf('/'))
        let markup = ''
        for (const file of await abideSourcesOf(name)) {
            const template = await Bun.file(new URL(file, DOGFOOD)).text()
            markup += template.replaceAll(/<[^>]*>/g, '\n')
        }
        const arm = await Bun.file(new URL(path, ARMS_DIR)).text()
        for (const control of arm.matchAll(/<(?:button|a)\b[^>]*>([^<]+)</g)) {
            const label = (control[1] ?? '').trim()
            if (!label || markup.includes(label)) continue
            strays.push(`${path}: "${label}"`)
        }
    }
    expect(strays).toEqual([])
})

// THE SIBLING OF THE CONTROL CHECK, pointed at the thing a demo card is FOR. A card claims
// something about work — derivations re-run, requests made, entries held — and the claim is
// only ever visible as a readout, so an arm reporting a count the `.abide` source never names
// is the two arms having come apart on the one line the reader is there to read. It renders
// perfectly either way, and it is worse than a stray button: a stray button does nothing, and
// a stray counter is a figure the ratio is then taken against. RULEBOOK 40.19.
//
// A READOUT IS A `<strong>` and its label is the text in front of it, which is the shape both
// arms already wrote — the value is the part that legitimately differs, being live in one and
// an id in the other, so only the label is compared.
//
// WHITESPACE-COLLAPSED, because HTML collapses it: the `.abide` file wraps at the 76-column
// rule the panel renders in and the arm does not, so a label reading identically on screen was
// two strings apart. Comparing the source text would have made the gate a line-wrap check.
const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()

// TWO SHAPES, because a card has two kinds of readout: a stat TILE, where the label is the
// `<span>` that opens the item, and an INLINE one, where it is the run of text in front of the
// value. Both are compared; a label that lived only in the arm is the drift this is here for.
//
// A TILE IS MATCHED PER ITEM rather than by what sits between the label and the value, because
// a CONTROL can sit there: the quantity stepper puts two buttons inside the tile, and a pattern
// wanting the two adjacent went blind on exactly the tile that grew one. Tiles are removed as
// they are read, so the inline pass cannot report a tile's own text a second time.
function labelsIn(markup: string): string[] {
    const labels: string[] = []
    const rest = markup.replace(
        /<li\b[^>]*>([\s\S]*?)<\/li>/g,
        (whole, inner: string) => {
            if (!/<strong\b/.test(inner)) return whole
            labels.push(
                collapse(/<span[^>]*>([^<]*)<\/span>/.exec(inner)?.[1] ?? ''),
            )
            return ''
        },
    )
    for (const inline of rest.matchAll(/>([^<>]+)<strong\b/g)) {
        labels.push(collapse(inline[1] ?? ''))
    }
    return labels
}

test('every readout the arm renders is one the page source names', async () => {
    const strays: string[] = []
    for (const path of new Bun.Glob('*/index.html').scanSync({
        cwd: ARMS_DIR.pathname,
    })) {
        const name = path.slice(0, path.indexOf('/'))
        let markup = ''
        for (const file of await abideSourcesOf(name)) {
            const template = await Bun.file(new URL(file, DOGFOOD)).text()
            markup += template.replaceAll(/<[^>]*>/g, '\n')
        }
        const flat = collapse(markup)
        const arm = await Bun.file(new URL(path, ARMS_DIR)).text()
        for (const label of labelsIn(arm)) {
            if (!label || flat.includes(label)) continue
            strays.push(`${path}: "${label}"`)
        }
    }
    expect(strays).toEqual([])
})

// A SWITCHER IN AN ARM IS `.switch` with one link current, the markup the `.abide` side
// declares — an arm drawing two default links is doing less work than the component it is priced
// against. Both halves regressed separately: one arm carried the current link and not the class,
// another carried the class and never marked a link.
test('a switcher in an arm is a `.switch` with exactly one link current', async () => {
    const wrong: string[] = []
    for (const path of new Bun.Glob('*/index.html').scanSync({
        cwd: ARMS_DIR.pathname,
    })) {
        const arm = await Bun.file(new URL(path, ARMS_DIR)).text()
        for (const nav of arm.matchAll(/<nav\b([^>]*)>(.*?)<\/nav>/gs)) {
            const attributes = nav[1] ?? ''
            const body = nav[2] ?? ''
            if (!/\bclass="[^"]*\bswitch\b[^"]*"/.test(attributes))
                wrong.push(`${path}: nav is not a .switch`)
            const current = body.match(/aria-current=/g)?.length ?? 0
            if (current !== 1)
                wrong.push(`${path}: ${current} links are current, not 1`)
        }
    }
    expect(wrong).toEqual([])
})

// 44.19 — AN ARM IS PAIRED WITH A DOCS EXAMPLE, or it is a figure with nothing to be a ratio of: an
// arm the harness wrote for itself is the one written beside the implementation it flatters.
test('every arm is paired with a docs example', async () => {
    const unpaired: string[] = []
    for (const path of new Bun.Glob('*/index.html').scanSync({
        cwd: ARMS_DIR.pathname,
    })) {
        const name = path.slice(0, path.indexOf('/'))
        if (
            !(await Bun.file(
                new URL(`examples/${name}.json`, DOGFOOD),
            ).exists())
        )
            unpaired.push(name)
    }
    expect(unpaired).toEqual([])
})

// Reverted — the arm's `plan` rule dropped — the opening row reads one issue where two were owed.
test('validate-json: each issue sits under its own path and leaves when that field is fixed', async () => {
    await mount('validate-json', 'import.js')
    const issues = () => {
        const found: string[][] = []
        for (const item of document.querySelectorAll('#issues li'))
            found.push([
                item.querySelector('span')?.textContent ?? '',
                item.querySelector('strong')?.textContent ?? '',
            ])
        return found
    }
    expect(issues()).toEqual([
        ['plan', 'must be one of "starter", "team", "enterprise"'],
        ['seats', 'must be at most 50'],
    ])

    // THE CLAIM. Fixing one field takes its issue away and leaves the other's standing.
    type('#pasted', '{ "name": "Ada Lovelace", "plan": "team", "seats": 80 }')
    expect(issues()).toEqual([['seats', 'must be at most 50']])
    type('#pasted', '{ "name": "Ada Lovelace", "plan": "team", "seats": 12 }')
    expect(issues()).toEqual([['import', 'ready']])
    type('#pasted', '{ "name": ')
    expect(issues()).toEqual([['the row', 'must be object, was string']])
})

// Reverted — the arm's upper bound dropped — the third press reads 51 where the deal held 50.
test('json-schema: a write past the bound is refused and the deal keeps what it had', async () => {
    await mount('json-schema', 'seats.js')
    click('#more')
    click('#more')
    expect([read('#seats'), read('#message')]).toEqual(['50', ''])
    click('#more')
    expect([read('#seats'), read('#message')]).toEqual([
        '50',
        'must be at most 50',
    ])
    click('#fewer')
    expect([read('#seats'), read('#message')]).toEqual(['49', ''])
})

// A WEB SOCKET ARM SERVES ITSELF TOO. `Bun.serve` is stubbed to keep the arm's `websocket`
// handlers, and the page's `WebSocket` is a stand-in wired straight to them — so a second tab is a
// second stand-in on the one captured server, holding the room id its address carries. Reverted —
// the arm's `server.publish` swapped for the sending socket's own `send` — the other tab reads the
// opening turn where the sent one was owed; reverted — every socket subscribed and published under
// one fixed topic rather than its id — the stranger reads `Sent from this tab`.
test('socket-room: a turn one tab sends reaches every tab of that browser, and no other', async () => {
    type Peer = {
        data: { id: string }
        subscribe(topic: string): void
        send(text: string): void
    }
    type Handlers = {
        open(peer: Peer): void
        message(peer: Peer, text: string): void
    }
    const topics = new Map<string, Set<Peer>>()
    let handlers: Handlers | undefined
    const serve = Bun.serve
    ;(Bun as { serve: unknown }).serve = (options: { websocket: Handlers }) => {
        handlers = options.websocket
        return {
            publish(topic: string, text: string) {
                for (const peer of topics.get(topic) ?? []) peer.send(text)
            },
        }
    }
    try {
        await import(
            `${new URL('socket-room/server.ts', ARMS_DIR).pathname}?${Math.random()}`
        )
    } finally {
        Bun.serve = serve
    }

    class TabSocket extends EventTarget {
        static OPEN = 1
        readyState = 0
        peer: Peer
        constructor(address: string) {
            super()
            const tab = this
            this.peer = {
                data: { id: new URL(address).searchParams.get('id') ?? '' },
                subscribe(topic) {
                    const peers = topics.get(topic) ?? new Set<Peer>()
                    peers.add(tab.peer)
                    topics.set(topic, peers)
                },
                send(text) {
                    tab.dispatchEvent(
                        new MessageEvent('message', { data: text }),
                    )
                },
            }
            queueMicrotask(() => {
                this.readyState = TabSocket.OPEN
                this.dispatchEvent(new Event('open'))
                handlers?.open(this.peer)
            })
        }
        send(text: string): void {
            handlers?.message(this.peer, text)
        }
    }
    function said(tab: TabSocket): () => string {
        let latest = ''
        tab.addEventListener('message', (event) => {
            latest = JSON.parse(String((event as MessageEvent).data)).text
        })
        return () => latest
    }
    const standing = globalThis.WebSocket
    globalThis.WebSocket = TabSocket as unknown as typeof WebSocket
    // biome-ignore lint/suspicious/noDocumentCookie: the browser's id, as a second tab finds it.
    document.cookie = 'room=reader-1; Path=/'
    try {
        const otherTab = said(new TabSocket('ws://docs.test/room?id=reader-1'))
        const stranger = said(new TabSocket('ws://docs.test/room?id=reader-2'))

        await mount('socket-room', 'room.js')
        await Bun.sleep(5)
        const GREETING = 'Ask about any invoice here.'
        expect([read('#said'), otherTab(), stranger()]).toEqual([
            GREETING,
            GREETING,
            GREETING,
        ])

        // THE CLAIM. The sending tab paints the turn when its room sends it back, the other tab of
        // that browser is sent the same frame, and a browser with another id is sent nothing.
        type('#draft', 'Sent from this tab')
        click('#send')
        expect([
            read('#speaker'),
            read('#said'),
            otherTab(),
            stranger(),
        ]).toEqual([
            'you',
            'Sent from this tab',
            'Sent from this tab',
            GREETING,
        ])
    } finally {
        globalThis.WebSocket = standing
        // biome-ignore lint/suspicious/noDocumentCookie: clearing what this test set.
        document.cookie = 'room=; Path=/; Max-Age=0'
    }
})

test('bind-branch: the field exists only while the box is ticked', async () => {
    await mount('bind-branch', 'contact.js')
    const box = document.querySelector('#separately') as HTMLInputElement
    expect(document.querySelector('#address')).toBeNull()

    // THE CLAIM. The branch follows the bound value both ways: built on the tick, gone
    // on the clear — the arm's second render and its teardown are what carry that.
    box.checked = true
    box.dispatchEvent(new Event('change'))
    expect(document.querySelector('#address')).not.toBeNull()

    box.checked = false
    box.dispatchEvent(new Event('change'))
    expect(document.querySelector('#address')).toBeNull()
})

test('online-banner: the banner follows the connection both ways', async () => {
    const standing = Object.getOwnPropertyDescriptor(navigator, 'onLine')
    Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => true,
    })
    try {
        await mount('online-banner', 'order.js')
        const banner = document.querySelector('#banner') as HTMLElement
        expect([read('#connection'), banner.hidden]).toEqual(['online', true])

        window.dispatchEvent(new Event('offline'))
        expect([read('#connection'), banner.hidden]).toEqual(['offline', false])

        window.dispatchEvent(new Event('online'))
        expect([read('#connection'), banner.hidden]).toEqual(['online', true])
    } finally {
        if (standing) Object.defineProperty(navigator, 'onLine', standing)
        else delete (navigator as { onLine?: boolean }).onLine
    }
})

test('navigate-query: the address moves and the page stays', async () => {
    const standing = location.href
    try {
        await mount('navigate-query', 'invoice.js')
        expect(read('[aria-selected="true"]')).toBe('4310')
        type('#note', 'call back Tuesday')

        // THE CLAIM. The query is written without a document load, so what was typed is
        // still in the field and the readout follows the address it now names.
        click('#open-4311')
        expect([
            location.search,
            read('#address'),
            read('[aria-selected="true"]'),
            (document.querySelector('#note') as HTMLInputElement).value,
        ]).toEqual([
            '?invoice=4311',
            '?invoice=4311',
            '4311',
            'call back Tuesday',
        ])
    } finally {
        history.replaceState(null, '', standing)
    }
})

test('cookies-density: the pick lands in the cookie, and the server paints it', async () => {
    try {
        await mount('cookies-density', 'contacts.js')
        expect(read('#density')).toBe('comfortable')

        click('#compact')
        expect([read('#density'), document.cookie]).toEqual([
            'compact',
            expect.stringContaining('density=compact'),
        ])

        // THE CLAIM'S SECOND HALF. A reload is painted from the request's header, so the
        // page arrives on the density picked rather than flashing the default.
        const routes = await routesOf('cookies-density', 'server.ts')
        const page =
            await // A bare header rather than a `Request`: the DOM preload's `Request` drops
            // `cookie`, a header a browser's script may not set.
            (
                await (routes['/'] as Routes[string])({
                    headers: new Map([['cookie', 'density=compact']]),
                } as unknown as Request)
            ).text()
        expect(page).toContain('<strong id="density">compact</strong>')
        expect(page).toContain('data-density="compact" aria-selected="true"')
    } finally {
        // biome-ignore lint/suspicious/noDocumentCookie: the arm writes the jar this resets.
        document.cookie = 'density=; Path=/; Max-Age=0'
    }
})

test('flush-sync-scroll: the measurement after the write counts the new row', async () => {
    await mount('flush-sync-scroll', 'notes.js')
    expect([read('#count'), read('#measured')]).toEqual(['2', '0'])

    // THE CLAIM. The handler measures straight after the write, and reads the list the
    // write left — never one row short.
    click('#add')
    click('#add')
    click('#add')
    expect([read('#count'), read('#measured')]).toEqual(['5', '5'])
    expect(read('#notes li:last-child')).toBe('Follow-up 3')
})

test('reachable-host: one probe answers every send for the minute', async () => {
    let probes = 0
    let calls = 0
    const standing = globalThis.fetch
    globalThis.fetch = (async (_input: string, init?: RequestInit) => {
        if (init?.method === 'HEAD') probes += 1
        else calls += 1
        throw new TypeError('connection refused')
    }) as unknown as typeof fetch
    try {
        const routes = await routesOf('reachable-host', 'server.ts')
        const send = routes['/api/sync'] as Routes[string]
        const ask = () =>
            send(new Request('http://example.test/api/sync?id=4310'))

        const first = await ask()
        const second = await ask()

        // THE CLAIM. The second send is refused from the held answer — no second probe,
        // and no call to the host at all.
        expect([first.status, second.status, probes, calls]).toEqual([
            503, 503, 1, 0,
        ])
        expect(await second.text()).toStartWith('Billing is unreachable')
    } finally {
        globalThis.fetch = standing
    }
})

test('identity-structural: an equal reload does not redraw, a changed one does', async () => {
    const totals = { north: 1240, south: 980 }
    const standing = globalThis.fetch
    globalThis.fetch = (async (_input: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
            totals.north += 120
            return new Response(null, { status: 204 })
        }
        // A fresh record every load, as a query result is.
        return Response.json({ ...totals })
    }) as unknown as typeof fetch
    try {
        await mount('identity-structural', 'chart.js')
        await Bun.sleep(10)
        expect([read('#north'), read('#redraws')]).toEqual(['1240', '1'])

        // THE CLAIM. A refresh handing back the same numbers in a new object draws nothing.
        click('#refresh')
        await Bun.sleep(10)
        expect(read('#redraws')).toBe('1')

        // The positive case, so the count above is a count that can move.
        click('#sale')
        await Bun.sleep(10)
        expect([read('#north'), read('#redraws')]).toEqual(['1360', '2'])
    } finally {
        globalThis.fetch = standing
    }
})

test('aborted-signal: a cancelled load reads as cancelled, with nothing in flight', async () => {
    const standing = globalThis.fetch
    globalThis.fetch = ((_input: string, init?: RequestInit) =>
        new Promise((resolve, reject) => {
            const answer = setTimeout(
                () => resolve(Response.json({ total: '$1,240.00' })),
                200,
            )
            init?.signal?.addEventListener('abort', () => {
                clearTimeout(answer)
                reject(new DOMException('aborted', 'AbortError'))
            })
        })) as unknown as typeof fetch
    try {
        await mount('aborted-signal', 'statement.js')
        click('#load')
        const cancel = document.querySelector('#cancel') as HTMLButtonElement
        expect([read('#status'), cancel.disabled]).toEqual(['loading…', false])

        // THE CLAIM. The cancel is told apart from a failure, and every flag the load
        // set is down again.
        click('#cancel')
        await Bun.sleep(10)
        expect([read('#statement'), read('#status'), cancel.disabled]).toEqual([
            'cancelled',
            '',
            true,
        ])

        click('#load')
        await Bun.sleep(250)
        expect(read('#statement')).toBe('$1,240.00')
    } finally {
        globalThis.fetch = standing
    }
})

test('not-landed-copy: a copy before the contact lands says so', async () => {
    const standing = globalThis.fetch
    globalThis.fetch = (async (input: string) => {
        await Bun.sleep(40)
        const id = new URL(input, 'http://example.test').searchParams.get('id')
        return Response.json({ id, email: `${id}@example.com` })
    }) as unknown as typeof fetch
    try {
        await mount('not-landed-copy', 'contact.js')
        await Bun.sleep(60)
        click('#copy')
        expect(read('#copied')).toBe('ada@example.com')

        // THE CLAIM. Pressed before the next contact lands, the copy reports it rather
        // than handing over the previous contact's address.
        click('#grace')
        click('#copy')
        expect([read('#copied'), read('#status')]).toEqual([
            'still loading',
            'loading…',
        ])

        await Bun.sleep(60)
        click('#copy')
        expect([read('#copied'), read('#status')]).toEqual([
            'grace@example.com',
            '',
        ])
    } finally {
        globalThis.fetch = standing
    }
})

// THE ASSISTANT ARMS' ROUTES carry a method map rather than one function, and the relay keys a
// browser by a cookie it already holds. happy-dom strips `cookie` from a `Request` it builds, so the
// stub hands the route the headers it would have sent.
function serveArm(routes: Record<string, unknown>): string[] {
    const asked: string[] = []
    globalThis.fetch = Object.assign(
        async (input: string | URL, init?: RequestInit) => {
            const url = new URL(String(input), 'http://example.invalid')
            const method = init?.method ?? 'GET'
            asked.push(`${method} ${url.pathname}`)
            const route = routes[url.pathname] as
                | ((request: Request) => Response | Promise<Response>)
                | Record<
                      string,
                      (request: Request) => Response | Promise<Response>
                  >
                | undefined
            const handler =
                typeof route === 'function' ? route : route?.[method]
            if (handler === undefined) return new Response('', { status: 404 })
            const request = new Request(url, init)
            const headers = new Headers(init?.headers)
            headers.set('cookie', 'caller=reader-1')
            Object.defineProperty(request, 'headers', { value: headers })
            return handler(request)
        },
        { preconnect: () => {} },
    ) as typeof fetch
    return asked
}

function chatTurns(): string[][] {
    const turns: string[][] = []
    for (const item of document.querySelectorAll('.chat li'))
        if (!(item as HTMLElement).hidden)
            turns.push([
                item.querySelector('span')?.textContent ?? '',
                item.querySelector('p')?.textContent?.trim() ?? '',
            ])
    return turns
}

// Reverted — the arm's dispatch answering every name as a missing tool — the result line reads
// "No tool named invoiceStatus." where the handler's answer was owed.
test('assistant-tools: the call the model asks for runs the handler, and its answer is in the stream', async () => {
    serveArm(await routesOf('assistant-tools', 'server.ts'))
    await mount('assistant-tools', 'chat.js')
    click('#ask')
    await Bun.sleep(30)
    expect(chatTurns()).toEqual([
        ['you', 'Is invoice INV-4021 paid?'],
        ['tool call', 'invoiceStatus {"id":"INV-4021"}'],
        ['your handler answered', '{"id":"INV-4021","paid":true}'],
        ['assistant', 'Yes, INV-4021 is paid.'],
    ])
    expect(read('#status')).toBe('done')
})

// Reverted — `stream: true` dropped from the arm's hand-written body — the request the stand-in
// echoes no longer carries it, and nothing on the arm's side noticed.
test('claude-api: the request body is the fields written, with messages and stream beside them', async () => {
    const asked = serveArm(await routesOf('claude-api', 'server.ts'))
    await mount('claude-api', 'request.js')
    click('#ask')
    await Bun.sleep(30)
    expect(JSON.parse(read('#reply'))).toEqual({
        model: 'claude-opus-5',
        max_tokens: 1024,
        system: 'Answer questions about invoices.',
        thinking: { type: 'adaptive' },
        stream: true,
        messages: [{ role: 'user', content: 'Is invoice INV-4021 paid?' }],
    })
    expect(asked).toEqual(['POST /api/ask', 'POST /v1/messages'])
})

// Reverted — the 409 branch removed from the arm's `/api/ask` — the ask before pairing hangs on a
// turn no bridge will ever answer, and the status line stays empty.
test('claude-code: a turn is refused until a bridge pairs, then runs on that bridge', async () => {
    const routes = await routesOf('claude-code', 'server.ts')
    serveArm(routes)
    await mount('claude-code', 'bridge.js')

    click('#ask')
    await Bun.sleep(20)
    expect(read('#status')).toBe('No Claude Code is paired with this browser.')

    click('#connect')
    await Bun.sleep(20)
    const command = read('#command')
    expect(command).toMatch(/^bunx @abide\/bridge@0\.1\.0 \S+ \S+$/)
    expect((document.querySelector('#paired') as HTMLElement).hidden).toBe(true)

    // THE BRIDGE, as the reader's terminal would run it: it dials in with the code and reads turns.
    const code = command.split(' ').at(-1) ?? ''
    const relay = routes['/bridge'] as unknown as Record<
        string,
        (request: Request) => Promise<Response> | Response
    >
    const dialled = await relay.GET?.(
        new Request(`http://example.invalid/bridge?code=${code}`),
    )
    const frames = (
        dialled as Response
    ).body?.getReader() as ReadableStreamDefaultReader<Uint8Array>
    await Bun.sleep(20)
    expect([
        (document.querySelector('#paired') as HTMLElement).hidden,
        (document.querySelector('#command') as HTMLElement).hidden,
    ]).toEqual([false, true])

    click('#ask')
    await Bun.sleep(20)
    const sent = JSON.parse(
        new TextDecoder().decode((await frames.read()).value),
    ) as {
        caller: string
        turn: string
        prompt: string
    }
    expect(sent.prompt).toBe('What does an invoice record, in one sentence?')
    for (const event of [
        { type: 'text', text: 'Who owes what, ' },
        { type: 'text', text: 'and by when.' },
        { type: 'end' },
    ])
        await relay.POST?.(
            new Request('http://example.invalid/bridge', {
                method: 'POST',
                body: JSON.stringify({ ...sent, event }),
            }),
        )
    await Bun.sleep(20)
    expect([read('#status'), read('#answer')]).toEqual([
        '',
        'Who owes what, and by when.',
    ])
})

// THE `app.ts` ARMS. Each one's server half is the arm, so the page's fetch is routed into the
// routes its `Bun.serve` was handed.
function routedFetch(routes: Routes): typeof fetch {
    return Object.assign(
        async (input: string, init?: RequestInit) => {
            const url = new URL(input, 'http://example.invalid')
            return (
                (await routes[url.pathname]?.(new Request(url, init))) ??
                new Response('', { status: 404 })
            )
        },
        { preconnect: () => {} },
    ) as typeof fetch
}

test('start-hook: the pool connected before the app came up', async () => {
    globalThis.fetch = routedFetch(await routesOf('start-hook', 'server.ts'))
    await mount('start-hook', 'pool.js')
    await Bun.sleep(20)
    const [connected, up] = [read('#connected'), read('#up')]
    expect(connected).not.toBe('')
    // THE CLAIM. Revert-verified: the stamp moved above the connect -> up precedes connected.
    expect(connected <= up).toBe(true)
})

test('config-coerced: the environment overrides the default, and arrives a number', async () => {
    const was = process.env.RETRIES
    try {
        process.env.RETRIES = '5'
        globalThis.fetch = routedFetch(
            await routesOf('config-coerced', 'server.ts'),
        )
        await mount('config-coerced', 'retries.js')
        await Bun.sleep(20)
        // THE CLAIM. Revert-verified: `Number` dropped from the read -> attempts "51".
        expect([read('#retries'), read('#attempts')]).toEqual(['5', '6'])

        process.env.RETRIES = 'lots'
        await mount('config-coerced', 'retries.js')
        await Bun.sleep(20)
        expect([read('#retries'), read('#attempts')]).toEqual(['3', '4'])
    } finally {
        if (was === undefined) delete process.env.RETRIES
        else process.env.RETRIES = was
    }
})

test("health-merge: the app's own field sits beside the baseline", async () => {
    globalThis.fetch = routedFetch(await routesOf('health-merge', 'server.ts'))
    await mount('health-merge', 'health.js')
    await Bun.sleep(20)
    expect([read('#version'), read('#database')]).toEqual([
        '0.0.0',
        'connected',
    ])
    expect(read('#started')).not.toBe('')
})

test('principal-resolve: the sign-in answers with a user it was handed only the id of', async () => {
    globalThis.fetch = routedFetch(
        await routesOf('principal-resolve', 'server.ts'),
    )
    await mount('principal-resolve', 'badge.js')
    expect(read('#name')).toBe('—')

    click('#grace')
    await Bun.sleep(20)
    expect([read('#sealed'), read('#name'), read('#role')]).toEqual([
        'grace',
        'Grace Hopper',
        'sales',
    ])
})

test('csp-blocked: every document carries the whole policy, with a nonce of its own', async () => {
    const routes = await routesOf('csp-blocked', 'server.ts')
    const policies: string[] = []
    for (let turn = 0; turn < 2; turn += 1) {
        const answer = await routes['/']?.(
            new Request('http://example.invalid/'),
        )
        policies.push(answer?.headers.get('content-security-policy') ?? '')
    }
    for (const policy of policies) {
        expect(policy).toContain("script-src 'self' 'nonce-")
        expect(policy).toContain("frame-ancestors 'self'")
    }
    // THE CLAIM. A nonce is per response, or it is a password printed on every page.
    expect(policies[0]).not.toBe(policies[1])

    await mount('csp-blocked', 'widget.js')
    click('#add')
    const added = document.head.querySelector(
        'script[src="https://widget.example/chat.js"]',
    )
    expect(added).not.toBeNull()
    // A DOM emulator enforces no policy, so the refusal the browser would raise is handed in.
    document.dispatchEvent(
        Object.assign(new Event('securitypolicyviolation'), {
            blockedURI: 'https://widget.example/chat.js',
            violatedDirective: 'script-src-elem',
        }),
    )
    expect(read('#refused')).toBe(
        'https://widget.example/chat.js by script-src-elem',
    )
    added?.remove()
})

test('middleware-stamp: an answer carries the header its handler never wrote', async () => {
    globalThis.fetch = routedFetch(
        await routesOf('middleware-stamp', 'server.ts'),
    )
    await mount('middleware-stamp', 'instance.js')
    click('#ask')
    await Bun.sleep(20)
    expect(read('#served')).toMatch(/^[0-9a-f]{8}$/)
})

test('trace-lines: both lines of one request carry its trace, and the next request has another', async () => {
    globalThis.fetch = routedFetch(await routesOf('trace-lines', 'server.ts'))
    await mount('trace-lines', 'sync.js')
    click('#sync')
    await Bun.sleep(200)
    const first = read('#trace')
    expect(first).toMatch(/^[0-9a-f]{32}$/)
    expect(read('#lines')).toBe(
        'contact 4021 loaded · billing told about contact 4021',
    )

    // THE CLAIM. Lines are selected by trace, so a second sync shows its own two, not four.
    click('#sync')
    await Bun.sleep(200)
    expect(read('#trace')).not.toBe(first)
    expect(read('#lines')).toBe(
        'contact 4021 loaded · billing told about contact 4021',
    )
})

test('error-report: the caller is told 500 and the tracker is told why', async () => {
    globalThis.fetch = routedFetch(await routesOf('error-report', 'server.ts'))
    await mount('error-report', 'export.js')
    await Bun.sleep(20)
    expect([read('#told'), read('#captured')]).toEqual(['—', '—'])

    click('#export')
    await Bun.sleep(400)
    expect([read('#told'), read('#captured')]).toEqual([
        '500 Internal Server Error',
        'the export worker reset the connection',
    ])
})

test('app-fetch: the wire answers with a status and a trace header', async () => {
    globalThis.fetch = routedFetch(await routesOf('app-fetch', 'server.ts'))
    await mount('app-fetch', 'answer.js')
    click('#fetch')
    await Bun.sleep(20)
    expect(read('#status')).toBe('200')
    expect(read('#traced')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/)
})

// THE EXAMPLE'S OWN TEST, run as its reader runs it: `bun test` from the docs app's directory, where
// `createApp` finds the app. Revert-verified: `onStop` with its close removed -> the second case
// fails on `connected` still true.
test('app-fetch: the test the card shows passes from the docs app', async () => {
    const { spawned } = await import('../src/gate/index.ts')
    const run = await spawned(
        [process.execPath, 'test', './src/server/app.test.ts'],
        { cwd: DOGFOOD.pathname, deadline: 120_000 },
    )
    expect(`${run.exitCode} ${run.stderr.includes('2 pass')}`).toBe('0 true')
}, 130_000)

// Reverted — `escapeHtml` dropped from `documentOf` — the second invoice's customer reads
// `Hopper & Co` raw where `Hopper &amp; Co` was owed.
test('render-preview: each invoice is rendered into a document of its own', async () => {
    const routes = await routesOf('render-preview', 'server.ts')
    const answer = await routes['/api/previewInvoice']?.(
        new Request('http://example.invalid/api/previewInvoice?id=4022'),
    )
    // THE CLAIM: a whole document, built from that invoice's record, escaped.
    expect(answer?.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const html = (await answer?.text()) ?? ''
    expect(html).toStartWith('<!doctype html>')
    expect(html).toContain('<h1>Invoice INV-4022</h1>')
    expect(html).toContain('Hopper &amp; Co')

    // The page is a frame pointed at that route, and the tab moves it. Read off the attribute
    // rather than loaded: happy-dom would fetch the frame against a server this spec never started.
    await mount('render-preview', 'invoice.js')
    const frame = () => document.querySelector('#preview')?.getAttribute('src')
    expect(frame()).toBe('/api/previewInvoice?id=4021')
    click('#inv-4022')
    expect(frame()).toBe('/api/previewInvoice?id=4022')
})
