// 50 — THE OVERLAYS' PLAIN MODULES: where `place` puts a floating element (50.19-50.22), the notice
// list `toasts.notify` and `toasts.dismiss` keep (50.12-50.15), the queue `prompts.confirm`,
// `prompts.alert` and `prompts.prompt` fill (50.5, 50.7, 50.34), and what a server does with both
// (50.11, 50.16, 11.32). What the components render is the CRM's tests', which mount them.

import { afterEach, expect, test } from 'bun:test'

import { installServer } from '#server/installServer.ts'
import { inScope } from '#server/requestScope.ts'
import { place } from '#shared'
import * as prompts from '#shared/prompts/index.ts'
import { queue } from '#shared/prompts/queue.ts'
import * as toasts from '#shared/toasts/index.ts'

installServer()

// A box at `left, top`, `width` by `height`, as layout would report it.
function box(left: number, top: number, width: number, height: number) {
    const element = document.createElement('div')
    element.getBoundingClientRect = () =>
        DOMRect.fromRect({ x: left, y: top, width, height })
    return element
}

// A 400 by 300 viewport.
for (const [name, value] of [
    ['clientWidth', 400],
    ['clientHeight', 300],
] as const)
    Object.defineProperty(document.documentElement, name, {
        configurable: true,
        get: () => value,
    })

afterEach(() => {
    toasts.list.set([])
    queue.set([])
})

test('a hint goes on the side asked for, centered on its anchor — 50.19', () => {
    const anchor = box(100, 100, 40, 20)
    expect(place(anchor, box(0, 0, 60, 30), { side: 'top' })).toEqual({
        x: 90,
        y: 62,
        side: 'top',
        arrow: 30,
    })
})

test('align lines the element up with the start or the end of its anchor — 50.19', () => {
    const anchor = box(100, 100, 80, 20)
    const floating = box(0, 0, 40, 20)
    expect(place(anchor, floating, { align: 'start' }).x).toBe(100)
    expect(place(anchor, floating, { align: 'end' }).x).toBe(140)
})

// THE REVERT: drop the flip, and the hint sits at y -32, off the top of the screen.
test('a side with no room flips to the opposite one — 50.20', () => {
    const anchor = box(100, 10, 40, 20)
    expect(place(anchor, box(0, 0, 60, 30), { side: 'top' })).toMatchObject({
        y: 38,
        side: 'bottom',
    })
})

// Neither side has room, and the one asked for has more: it stays.
test('a side keeps its place where the opposite one has less room — 50.20', () => {
    const anchor = box(100, 140, 40, 20)
    expect(place(anchor, box(0, 0, 60, 200), { side: 'top' }).side).toBe('top')
})

// THE REVERT: drop the clamp, and a menu by the right edge runs to x 410, past 400.
test('the floating element is kept inside the viewport — 50.21', () => {
    const anchor = box(370, 100, 20, 20)
    expect(
        place(anchor, box(0, 0, 100, 40), { side: 'bottom', align: 'start' }),
    ).toMatchObject({ x: 292, y: 128, arrow: 88 })
})

test('an element wider than the viewport keeps its start edge in — 50.21', () => {
    const anchor = box(100, 100, 20, 20)
    expect(place(anchor, box(0, 0, 500, 40)).x).toBe(8)
})

// THE REVERT: write the `inset` inside `place`, and the document records the write.
test('place reads layout and writes nothing — 50.22', () => {
    const anchor = box(100, 100, 40, 20)
    const floating = box(0, 0, 60, 30)
    document.body.append(anchor, floating)
    const records: MutationRecord[] = []
    const observer = new MutationObserver((found) => records.push(...found))
    observer.observe(document.body, {
        attributes: true,
        childList: true,
        subtree: true,
    })
    place(anchor, floating, { side: 'right' })
    records.push(...observer.takeRecords())
    observer.disconnect()
    anchor.remove()
    floating.remove()
    expect(records).toEqual([])
})

test('a notice lands at the end of the list and leaves it at its timeout — 50.12, 50.13', async () => {
    const first = toasts.notify('Saved', { timeout: Infinity })
    const id = toasts.notify('Phone saved', { tone: 'success', timeout: 5 })
    expect(id).not.toBe(first)
    expect(toasts.list().at(-1)).toEqual({
        id,
        text: 'Phone saved',
        tone: 'success',
        action: undefined,
        attributes: {},
    })
    await Bun.sleep(20)
    expect(toasts.list().map((toast) => toast.text)).toEqual(['Saved'])
})

// THE REVERT: give an error the 3 s every other tone has, and its notice is gone at 3.5 s.
test("an error's notice outlasts every other tone's — 50.14", async () => {
    toasts.notify('Saved')
    toasts.notify('Not saved', { tone: 'error' })
    const started = Date.now()
    while (toasts.list().length === 2 && Date.now() - started < 4000)
        await Bun.sleep(100)
    await Bun.sleep(500)
    expect(toasts.list().map((toast) => toast.text)).toEqual(['Not saved'])
}, 6000)

// THE REVERT: drop the `at === -1` return, and the second dismiss writes a fresh list.
test('dismiss takes one notice down, and leaves the list alone for one already gone — 50.15', () => {
    const first = toasts.notify('one', { timeout: Infinity })
    toasts.notify('two', { timeout: Infinity })
    toasts.dismiss(first)
    const held = toasts.list()
    toasts.dismiss(first)
    expect(toasts.list()).toBe(held)
    expect(held.map((toast) => toast.text)).toEqual(['two'])
})

// 50.36 — TOLD ONCE, AND WHY. THE REVERT: call `onclose` from `notify`'s timer alone — the dismissed
// notice's reason is never told, `[timeout]` where `[timeout, dismissed]` is due.
test('a notice tells its onclose once, why it left — 50.36', async () => {
    const reasons: string[] = []
    toasts.notify('Saved', {
        timeout: 5,
        onclose: (reason) => reasons.push(reason),
    })
    const kept = toasts.notify('Phone saved', {
        timeout: Infinity,
        onclose: (reason) => reasons.push(reason),
    })
    await Bun.sleep(20)
    toasts.dismiss(kept)
    toasts.dismiss(kept)
    expect(reasons).toEqual(['timeout', 'dismissed'])
})

test('a string is the body of the prompt confirm queues, behind the one before it — 50.5, 50.7', () => {
    void prompts.alert({ title: 'Saved' })
    void prompts.confirm('Delete Engine renewal?')
    expect(queue().map((prompt) => prompt.title ?? prompt.body)).toEqual([
        'Saved',
        'Delete Engine renewal?',
    ])
    expect(queue()[1]).toMatchObject({
        title: undefined,
        body: 'Delete Engine renewal?',
        confirm: 'OK',
        cancel: 'Cancel',
        danger: false,
        kind: 'confirm',
    })
})

test('a prompt starts from its value, and an empty one from nothing — 50.34', () => {
    void prompts.prompt({ title: 'Rename deal', value: 'Engine renewal' })
    void prompts.prompt('Name the pipeline')
    expect(queue().map((prompt) => [prompt.kind, prompt.value])).toEqual([
        ['prompt', 'Engine renewal'],
        ['prompt', ''],
    ])
})

// THE REVERT: drop the `isServer` check from `queued`, and the request never settles: it holds a
// prompt nobody can answer, which is the hang a server's `confirm` would be.
test('confirm, alert, prompt and notify throw inside a request — 50.11, 50.16', async () => {
    await inScope(new Request('http://app/'), async () => {
        expect(() => prompts.confirm('Sure?')).toThrow('RULEBOOK 50.11')
        expect(() => prompts.alert('Done')).toThrow('RULEBOOK 50.11')
        expect(() => prompts.prompt('Name?')).toThrow('RULEBOOK 50.11')
        expect(() => toasts.notify('Saved')).toThrow('RULEBOOK 50.16')
    })
})

// ONE VISITOR'S NOTICES NEVER REACH ANOTHER'S PAGE. THE REVERT: build the list with `global: true`,
// and the second request reads the first one's notice.
test('the notices and the prompts are one list per request — 11.32', async () => {
    await inScope(new Request('http://app/a'), async () => {
        toasts.list.set([
            {
                id: 1,
                text: 'Ada saved',
                tone: 'info',
                action: undefined,
                attributes: {},
            },
        ])
        queue.set([
            {
                title: undefined,
                body: 'Delete Ada?',
                confirm: 'OK',
                cancel: 'Cancel',
                danger: false,
                mustType: undefined,
                value: '',
                placeholder: undefined,
                kind: 'confirm',
                resolve: () => {},
            },
        ])
        await Bun.sleep(0)
        expect(toasts.list()).toHaveLength(1)
    })
    await inScope(new Request('http://app/b'), async () => {
        expect(toasts.list()).toEqual([])
        expect(queue()).toEqual([])
    })
})
