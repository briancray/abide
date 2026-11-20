// 50.36 — AN OUTLET SHOWS IN ONE HOST, the last of those standing, and a request no host stands to show
// warns once rather than being lost without a word. `Tooltips`, `Toasts` and `Prompts` each stand
// through one.

import { expect, test } from 'bun:test'

import { outlet } from '#shared/outlet.ts'
import { collectWatches } from '#shared/reactive/watch.ts'

// A host standing as a component's setup stands it: its watches collected, and stopped as it leaves.
function standing(through: ReturnType<typeof outlet>) {
    const stops: (() => void)[] = []
    const previous = collectWatches(stops)
    const shows = through.stand()
    collectWatches(previous)
    return {
        shows,
        leave: () => {
            for (const stop of stops) stop()
        },
    }
}

// THE REVERT: have `stand` answer whether ANY host stands, and the first shows beside the second — two
// copies of every notice, and a second modal over the first.
test('the last host standing shows, and the one before it once the last is removed', () => {
    const notices = outlet('<Toasts />', 'abide:toasts')
    const first = standing(notices)
    expect(first.shows()).toBe(true)
    const second = standing(notices)
    expect([first.shows(), second.shows()]).toEqual([false, true])
    second.leave()
    expect(first.shows()).toBe(true)
    first.leave()
    expect(first.shows()).toBe(false)
})

async function warnings(body: () => void): Promise<string[]> {
    const warned: string[] = []
    const warn = console.warn
    console.warn = (...args: unknown[]): void => {
        const line = args.join(' ')
        if (line.includes('abide:prompts')) warned.push(line)
    }
    try {
        body()
        await Promise.resolve()
    } finally {
        console.warn = warn
    }
    return warned
}

// THE REVERT: drop the warning from `asked`, and a `confirm` with no `Prompts` waits forever unsaid.
test('a request with no host standing warns once, and one with a host standing does not', async () => {
    const asking = outlet('<Prompts />', 'abide:prompts')
    const host = standing(asking)
    expect(await warnings(() => asking.asked())).toEqual([])
    host.leave()
    const first = await warnings(() => {
        asking.asked()
        asking.asked()
    })
    expect(first).toHaveLength(1)
    expect(first[0]).toContain('<Prompts />')
    expect(await warnings(() => asking.asked())).toEqual([])
})

// A host that stands later in the same mount than the request — a root layout's, after the page's
// `<slot />` — is standing by the time the request is looked at.
test('a host standing later in the same turn as the request is in time', async () => {
    const asking = outlet('<Prompts />', 'abide:prompts')
    let host: ReturnType<typeof standing> | undefined
    expect(
        await warnings(() => {
            asking.asked()
            host = standing(asking)
        }),
    ).toEqual([])
    host?.leave()
})
