// A LEVEL'S OWN BINDING SHADOWS THE LEVEL ABOVE IT (`bindPattern`).
//
// Every child scope is `Object.create($scope)`, and on the CLIENT a live binding one level up is a
// getter-ONLY accessor (`bindLazyPattern` — a `{#for}` item, a component param). Binding the same name
// at this level by ASSIGNMENT therefore wrote through to that accessor and threw
// `TypeError: Attempted to assign to readonly property` in strict mode.
//
// The shape with no author-side workaround is the last test here: a RECURSIVE component whose keyed
// `{#for}` reuses its own item name. Renaming the inner binding is the obvious fix and is unavailable —
// the outer and inner loop are the same source text, so there is no "inner one" to rename.
//
// The server lane never built accessors over a scope (its params are snapshots — `emitServer`), so it
// rendered these correctly all along; each case asserts BOTH lanes so the agreement is what's pinned,
// not just the client fix.

import { describe, expect, test } from 'bun:test'
import { state } from '../../shared/state.ts'
import { watch } from '../../shared/watch.ts'
import { loadEmitted, loadEmittedServer } from './emit.ts'

function scriptScope(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { state, watch, props: () => ({}), ...extra }
}

async function bothLanes(source: string, extra: Record<string, unknown>): Promise<string[]> {
    const client = await loadEmitted(source)
    const host = document.createElement('div')
    client.mount(host, scriptScope(extra))
    const server = await loadEmittedServer(source)
    const html = await server.render(scriptScope(extra))
    // Compare the two lanes as TEXT: strip the marker comments and tags the server paints, which the
    // client side is read past by `textContent`.
    return [host.textContent ?? '', html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '')]
}

describe('a nested binding shadows the same name above it', () => {
    test('keyed {#for} inside a keyed {#for} reusing item and index names', async () => {
        const source =
            `{#for entry, i of outer by entry[0]}` +
            `{#for entry, i of entry[1] by entry[0]}<span>{entry[0]}{entry[1]}{i}</span>{/for}` +
            `{/for}`
        const outer = [
            ['a', [['x', 1] as const] as const],
            ['b', [['y', 2] as const] as const],
        ]
        expect(await bothLanes(source, { outer })).toEqual(['x10y20', 'x10y20'])
    })

    test('a destructured item shadows an outer item of the same name', async () => {
        const source =
            `{#for { id, kids } of rows by id}` +
            `{#for { id, label } of kids by id}<b>{id}{label}</b>{/for}` +
            `{/for}`
        const rows = [{ id: 'r', kids: [{ id: 'k', label: 'L' }] }]
        expect(await bothLanes(source, { rows })).toEqual(['kL', 'kL'])
    })

    test('a {:then} / {:catch} param shadows an outer item of the same name', async () => {
        const source =
            `{#for value of values by value}` +
            `{#await Promise.resolve(value + 1)}<i>…</i>{:then value}<i>{value}</i>{/await}` +
            `{/for}`
        const client = await loadEmitted(source)
        const host = document.createElement('div')
        client.mount(host, scriptScope({ values: [1, 2] }))
        await Promise.resolve()
        await Promise.resolve()
        expect(host.textContent).toBe('23')
        const server = await loadEmittedServer(source)
        expect(await server.render(scriptScope({ values: [1, 2] }))).toContain('2')
    })

    test('a recursive component with a keyed {#for} over its own item name', async () => {
        // `Node` renders itself for every child, so the inner loop's `entry` binding is the SAME source
        // text as the outer's and inherits the outer instance's getter through the component scope
        // chain (`Object.create($parent)`).
        const source =
            `{#component Node({ entries })}` +
            `{#for entry, i of entries by entry[0]}` +
            `<span>{entry[0]}</span><Node entries={entry[1]}/>` +
            `{/for}` +
            `{/component}` +
            `<Node entries={tree}/>`
        const tree = [['a', [['b', [['c', []]]]]]]
        expect(await bothLanes(source, { tree })).toEqual(['abc', 'abc'])
    })
})
