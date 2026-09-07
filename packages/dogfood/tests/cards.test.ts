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
    const markup = await Bun.file(new URL(`${name}/vanilla/index.html`, EXAMPLES_DIR)).text()
    document.body.innerHTML = markup.replace(/<script[^>]*><\/script>/, '')
    await import(`${new URL(`${name}/vanilla/${script}`, EXAMPLES_DIR).pathname}?${Math.random()}`)
}

function read(id: string): string {
    return document.querySelector(id)?.textContent ?? ''
}

function click(id: string): void {
    ;(document.querySelector(id) as HTMLElement).click()
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
        const id = new URL(input, 'http://example.invalid').searchParams.get('id')
        opened[id ?? ''] = (opened[id ?? ''] ?? 0) + 1
        await Bun.sleep(20)
        return Response.json(
            id === '1'
                ? { name: 'Ada Lovelace', role: 'Engineer', opened: opened['1'] }
                : { name: 'Grace Hopper', role: 'Admiral', opened: opened['2'] },
        )
    }) as typeof fetch

    await mount('memo-adoption', 'profile.js')
    expect(read('#status')).toBe('loading…')
    await Bun.sleep(50)
    expect([read('#name'), read('#opened'), String(requests)]).toEqual(['Ada Lovelace', '1', '1'])

    click('#grace')
    await Bun.sleep(50)
    expect([read('#name'), read('#opened'), String(requests)]).toEqual(['Grace Hopper', '1', '2'])

    // Back to a tab already held: no request, no status, and the RECORD says so — its own
    // count is still 1. That count is domain data, so it survived the counters leaving.
    click('#ada')
    expect([read('#name'), read('#opened'), String(requests), read('#status')]).toEqual([
        'Ada Lovelace',
        '1',
        '2',
        '',
    ])
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
    expect([read('#status'), field.value]).toEqual(['refreshing…', 'Ada, mid-edit'])

    await Bun.sleep(60)
    // The record never changed, and the box was refilled anyway.
    expect([field.value, read('#status')]).toEqual(['Ada Lovelace', ''])
    expect(document.querySelector('#status')).not.toBeNull()
})

test('memo-keyed: a held query is answered with no request and no spinner', async () => {
    let requests = 0
    globalThis.fetch = (async (input: string) => {
        requests += 1
        const query = new URL(input, 'http://example.invalid').searchParams.get('query')
        await Bun.sleep(20)
        return Response.json(
            query === 'grace'
                ? ['Grace Hopper']
                : ['Ada Lovelace', 'Alan Turing', 'Grace Hopper'],
        )
    }) as typeof fetch

    await mount('memo-keyed', 'search.js')
    const field = document.querySelector('#typed') as HTMLInputElement
    const rows = () => document.querySelectorAll('#results li').length
    await Bun.sleep(50)
    expect([rows(), requests]).toEqual([3, 1])

    field.value = 'grace'
    click('#search')
    expect(read('#status')).toBe('searching…')
    await Bun.sleep(50)
    expect([rows(), requests]).toEqual([1, 2])

    // THE CLAIM, and now there is somewhere for it to be false: a word already searched is an
    // entry already held, so nothing is asked for and the spinner never gets a moment.
    field.value = 'a'
    click('#search')
    expect([rows(), requests, read('#status')]).toEqual([3, 2, ''])
})

// WHAT THIS FILE CANNOT REACH, said out loud. `memo-tracked` claims a body did NOT re-run over
// a SYNCHRONOUS local derivation, and that is unobservable by construction: no request, no
// probe, and a value identical either way. The arm holds the invariant and nothing checks it.
// `memo-keyed` had the same gap and lost it by moving behind a handler, which is the repair
// available wherever the work crosses a transport — and it is not available here.

test('memo-await: the early label follows the filter, and the late one froze', async () => {
    await mount('memo-await', 'counts.js')
    await Bun.sleep(300)
    expect([read('#label'), read('#stale')]).toEqual(['showing 12 of 12', 'showing 12 of 12'])

    const filter = document.querySelector('#filter') as HTMLSelectElement
    filter.value = 'leads'
    filter.dispatchEvent(new Event('change'))
    await Bun.sleep(300)
    expect(read('#label')).toBe('showing 1 of 12')
    // The label beside it is a count of a filter nobody is using.
    expect(read('#stale')).toBe('showing 12 of 12')
})
