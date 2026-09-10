// WHAT A CARD CLAIMS, ASSERTED AGAINST THE ARM THAT RUNS IT. The frame renders `vanilla/`
// (40.19), so the arm has to HOLD the invariant the prose states — a hand-written dependency
// list, a hand-written entry table.
//
// AND IT IS NOW THE ONLY PLACE SOME OF THOSE CLAIMS LIVE. The cards used to render their own
// counters; the bookkeeping that produced them was noise in the source a reader came to read,
// so it left (40.32). What is left on the page is what the app would show, and the work a card
// claims is asserted HERE rather than displayed — which is where a "does less work" contract
// belongs anyway, the output being identical either way.
//
// The `.abide` source is still a claim of equivalence rather than a run (D40) — this pins the
// half that executes.
import { expect, test } from 'bun:test'

const EXAMPLES_DIR = new URL('../examples/', import.meta.url)

// The `<script src>` is dropped rather than resolved: happy-dom declines to load one, and the
// module is imported below anyway. A cache-buster on the specifier so two tests over one arm
// each get a fresh module scope, the arms being top-level scripts rather than exports.
async function mount(name: string, script: string): Promise<void> {
    const markup = await Bun.file(
        new URL(`${name}/vanilla/index.html`, EXAMPLES_DIR),
    ).text()
    document.body.innerHTML = markup.replace(/<script[^>]*><\/script>/, '')
    await import(
        `${new URL(`${name}/vanilla/${script}`, EXAMPLES_DIR).pathname}?${Math.random()}`
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
            `${new URL(`${name}/vanilla/${file}`, EXAMPLES_DIR).pathname}?${Math.random()}`
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

test('channel-shared: a component the publisher never names follows the publish', async () => {
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

    // A room nothing has published to allocates no entry and reads as unlanded, which
    // is the readout's 'nothing here yet' rather than the other room's message.
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

test('channel-identity: a resend mints no production and keeps the cursor', async () => {
    await mount('channel-identity', 'chat.js')
    const draft = document.querySelector('#draft') as HTMLInputElement

    click('#send')
    expect([read('#cursor'), read('#last')]).toEqual([
        '1',
        'Resend me the key rotation steps.',
    ])

    // THE CLAIM. The second press is the same message as the one standing, so nothing
    // is minted and the standing sequence number is what comes back — which is the
    // half a reader cannot see, the screen being identical either way.
    click('#send')
    expect(read('#cursor')).toBe('1')

    // And identity is against the PREVIOUS message alone: a changed one is new.
    draft.value = 'Resend me the billing steps.'
    click('#send')
    expect([read('#cursor'), read('#last')]).toEqual([
        '2',
        'Resend me the billing steps.',
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

test('tail-window: the ring caps what is kept, and the reader asks for more', async () => {
    await mount('tail-window', 'console.js')
    const rows = () =>
        [...document.querySelectorAll('#console li')].map(
            (li) => li.querySelector('span')?.textContent,
        )
    expect(rows()).toEqual([])

    for (let press = 0; press < 3; press += 1) click('#emit')
    expect(rows()).toEqual(['1', '2', '3'])

    // THE CLAIM. The reader asked for fifty and the value keeps four, so what is on
    // screen is the VALUE's window — a fifth production does not make a fifth row, it
    // moves the window, and the reader's number never enters into it.
    click('#emit')
    click('#emit')
    expect(rows()).toEqual(['2', '3', '4', '5'])
})

test('tail-cursor: one reader replays the ring first and the other starts where it joined', async () => {
    await mount('tail-cursor', 'panes.js')

    // THE CLAIM. Both cursors are over one value and both see every arrival after they
    // opened. The only difference is what each was handed to start with — `tail(3)`
    // replays the ring, a bare cursor replays nothing.
    expect([read('#replay'), read('#live')]).toEqual(['1 2 3', ''])

    click('#emit')
    expect([read('#replay'), read('#live')]).toEqual(['1 2 3 4', '4'])

    click('#emit')
    expect([read('#replay'), read('#live')]).toEqual(['1 2 3 4 5', '4 5'])
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
            return Response.json({ payments: answered })
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
    expect(read('#status')).toBe('422 Those arguments were refused.')

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

test('branch-switch: exactly one branch is in the document at a time', async () => {
    await mount('branch-switch', 'invoice.js')
    const lines = () =>
        [...document.querySelectorAll('#branch p')].map(
            (one) => one.textContent,
        )

    expect(lines()).toEqual(['Not sent yet.'])

    // THE CLAIM. Moving to another case replaces the branch rather than adding one, so the
    // document never holds two answers to a question with one.
    click('#overdue')
    expect(lines()).toEqual(['Chase this one.'])

    click('#sent')
    expect(lines()).toEqual(['Waiting on the customer.'])

    click('#paid')
    expect(lines()).toEqual(['Settled — nothing to chase.'])
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

test('principal-session: the seal and what it resolved to move together', async () => {
    globalThis.fetch = Object.assign(
        async () =>
            Response.json({
                authenticated: true,
                id: 'u_1',
                name: 'Ada Lovelace',
            }),
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

    click('#seal')
    expect([read('#state'), read('#who'), read('#seal')]).toEqual([
        'no',
        '—',
        'Sign in',
    ])
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
