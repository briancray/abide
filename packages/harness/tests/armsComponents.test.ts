// THE ARMS BEHIND THE COMPONENT CARDS — memos, state, channels, shares, patches, watches and caps,
// and the template: bindings, scoped style, markup, lists, props. What an arm spec is for is said
// at the head of `arms.test.ts`.
import { expect, test } from 'bun:test'
import { click, mount, read, type } from './armDrivers.ts'

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
