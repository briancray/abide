// THE ARMS BEHIND THE LOADING CARDS — caches, probes, reloads, stores, tails, and a load that
// is cancelled or has not landed. What an arm spec is for is said at the head of `arms.test.ts`.
import { expect, test } from 'bun:test'
import {
    click,
    mount,
    type Routes,
    read,
    routesOf,
    type,
} from './armDrivers.ts'

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
