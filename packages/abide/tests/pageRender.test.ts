// 41.13, 41.20, 41.29 — ONE PAGE'S RENDER, without a router: begun over the request a page is asked
// with, recorded into by the calls made in it, read for the document's early-call script, and taken
// back by the browser's own call. What is counted is how many times the handler RAN, because a seeded
// answer and a second run are the same value.

import { expect, test } from 'bun:test'

import { installServer } from '#server/installServer.ts'
import {
    beginPageRender,
    callsInRender,
    takeSeeded,
} from '#server/PageRender.ts'
import { inScope } from '#server/requestScope.ts'
import { GET, type Rpc } from '#shared/rpc.ts'

installServer()

/** A mounted `GET` counting its runs. */
function counted(address: string): {
    rpc: Rpc<{ id: number }, { id: number }>
    runs: () => number
} {
    let runs = 0
    const rpc = GET(({ id }: { id: number }) => {
        runs += 1
        return { id }
    })
    rpc.address = address
    return { rpc, runs: () => runs }
}

/** A page's request from the browser `caller` names, with `headers` beside its cookie. */
function pageRequest(
    caller: string,
    headers: Record<string, string> = {},
): Request {
    return new Request('http://app.test/', {
        headers: { cookie: `abide-caller=${caller}`, ...headers },
    })
}

test("a page's render records each call once, paints it settled, and the browser's call takes it back", async () => {
    const { rpc, runs } = counted('/page-render/item')
    const before = callsInRender()
    const script = await inScope(pageRequest('page-a'), async () => {
        const page = beginPageRender(pageRequest('page-a'))
        // 1.8 — two components reaching one item are one call in the browser too.
        await rpc({ id: 1 })
        await rpc({ id: 1 })
        expect(page.calls).toHaveLength(1)
        return page.earlyCallScript()
    })
    expect(callsInRender() - before).toBe(2)
    // 41.25 — settled where the markup was built, so its row ends in `1`.
    expect(script).toContain('"/page-render/item?id=1",{"method":"GET"')
    expect(script).toMatch(/,1\]\]<\/script>/)
    const taken = await inScope(pageRequest('page-a'), () =>
        takeSeeded(rpc, { id: 1 }),
    )
    expect(await taken).toMatchObject({ settled: true, value: { id: 1 } })
    expect(runs()).toBe(1)
    // 41.16 — one call per entry.
    expect(
        inScope(pageRequest('page-a'), () => takeSeeded(rpc, { id: 1 })),
    ).toBeUndefined()
})

test('a page a script fetched records nothing and seeds nothing — 41.29', async () => {
    const { rpc } = counted('/page-render/fetched')
    const fetched = pageRequest('page-b', { 'sec-fetch-dest': 'empty' })
    const script = await inScope(fetched, async () => {
        const page = beginPageRender(fetched)
        await rpc({ id: 2 })
        return page.earlyCallScript()
    })
    expect(script).toBe('')
    expect(
        inScope(pageRequest('page-b'), () => takeSeeded(rpc, { id: 2 })),
    ).toBeUndefined()
})

// 41.29 — A NAVIGATION THE WORKER FORWARDS IS THE PAGE THAT HYDRATES: chromium sends it `navigate` with
// its destination `empty`, the destination a script's fetch carries. THE REVERT: read the destination
// alone; the script reads `''` and the seed is gone, and a page reopened from its kept copy hydrates
// ahead of its data (`offline.spec.ts`, 45.23).
test('a navigation a worker forwards seeds and writes its early calls — 41.29, 45.25', async () => {
    const { rpc } = counted('/page-render/forwarded')
    const forwarded = pageRequest('page-d', {
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'navigate',
    })
    const script = await inScope(forwarded, async () => {
        const page = beginPageRender(forwarded)
        await rpc({ id: 4 })
        return page.earlyCallScript()
    })
    expect(script).toContain('/page-render/forwarded?id=4')
    expect(
        inScope(pageRequest('page-d'), () => takeSeeded(rpc, { id: 4 })),
    ).toBeDefined()
})

test('a page the worker keeps records its calls for the early-call script and seeds nothing — 41.30', async () => {
    const { rpc } = counted('/page-render/kept')
    const kept = pageRequest('page-c', {
        'sec-fetch-dest': 'empty',
        'abide-keep': 'stored',
    })
    const script = await inScope(kept, async () => {
        const page = beginPageRender(kept)
        await rpc({ id: 3 })
        return page.earlyCallScript()
    })
    expect(script).toContain('/page-render/kept?id=3')
    expect(
        inScope(pageRequest('page-c'), () => takeSeeded(rpc, { id: 3 })),
    ).toBeUndefined()
})
