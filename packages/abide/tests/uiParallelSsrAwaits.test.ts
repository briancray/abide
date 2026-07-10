import { beforeAll, expect, test } from 'bun:test'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { hoistableAwaits } from '../src/lib/ui/compile/hoistableAwaits.ts'
import { parseTemplate } from '../src/lib/ui/compile/parseTemplate.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { renderToStream } from '../src/lib/ui/renderToStream.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

/*
ADR-0034 — server-only flight hoisting parallelizes independent SSR awaits. Two guards:
the pure `hoistableAwaits` classifier (which awaits may start their promise in the prefix),
and the end-to-end overlap (two independent blocking awaits render in ~max, not ~sum, of
their latencies) plus the rejection path (a hoisted flight's `{:catch}` still renders).
*/

beforeAll(() => {
    installMiniDom()
})

const NO_CELLS = new Set<string>()

/* Which awaits the classifier hoists, by their promise text — the stable identity for the test. */
function hoistedPromises(source: string, cellReadNames = NO_CELLS): string[] {
    const { nodes } = parseTemplate(source)
    return hoistableAwaits(nodes, cellReadNames).map((flight) => flight.node.promise.trim())
}

test('hoists a top-level await whose promise is component-scope', () => {
    expect(
        hoistedPromises(`<main>{#await load()}<p>…</p>{:then v}<b>{v}</b>{/await}</main>`),
    ).toEqual(['load()'])
})

test('hoists inside a single-element-literal {#for … by k} (renders once)', () => {
    const promises = hoistedPromises(
        `<main>{#for k of [key] by k}{#await load(attempt)}<p>…</p>{:then v}<b>{v}</b>{/await}{/for}</main>`,
    )
    expect(promises).toEqual(['load(attempt)'])
})

test('does NOT hoist a row-dependent await in a real multi-row {#for}', () => {
    expect(
        hoistedPromises(
            `<main>{#for row of rows}{#await load(row)}<p>…</p>{:then v}<b>{v}</b>{/await}{/for}</main>`,
        ),
    ).toEqual([])
})

test('does NOT hoist a component-scope await nested in a multi-row {#for} (multi-row body)', () => {
    /* Even though `load(attempt)` is component-scope, a real {#for} renders its body per row —
       hoisting one shared flight would be wrong, so a non-single-element source disqualifies. */
    expect(
        hoistedPromises(
            `<main>{#for row of rows}{#await load(attempt)}<p>…</p>{:then v}<b>{v}</b>{/await}{/for}</main>`,
        ),
    ).toEqual([])
})

test('does NOT hoist an await inside a conditional branch', () => {
    expect(
        hoistedPromises(
            `<main>{#if flag}{#await load()}<p>…</p>{:then v}<b>{v}</b>{/await}{/if}</main>`,
        ),
    ).toEqual([])
})

test('does NOT hoist an await whose promise reads a {:then} binding', () => {
    /* The inner promise depends on the outer resolved value, which does not exist at prefix. */
    expect(
        hoistedPromises(
            `<main>{#await outer()}<p>…</p>{:then v}{#await load(v)}<p>…</p>{:then w}<b>{w}</b>{/await}{/await}</main>`,
        ),
    ).toEqual(['outer()'])
})

test('does NOT hoist an await whose promise reads an async cell', () => {
    /* An async-cell name is still pending at prefix time, so a flight reading it would fetch undefined. */
    expect(
        hoistedPromises(
            `<main>{#await load(userCell)}<p>…</p>{:then v}<b>{v}</b>{/await}</main>`,
            new Set(['userCell']),
        ),
    ).toEqual([])
})

/* --- end-to-end: two independent blocking awaits overlap on the server --- */

const RUNTIME = { doc, state, computed, effect, appendText, appendStatic, awaitBlock, each, when }

function ssrRender(source: string, extra: Record<string, unknown> = {}): () => Promise<SsrRender> {
    const body = compileSSR(source)
    const runtime = { ...RUNTIME, ...extra }
    const names = Object.keys(runtime)
    const values = names.map((name) => runtime[name as keyof typeof runtime])
    return () => new Function(...names, body)(...values) as Promise<SsrRender>
}

async function drain(render: () => Promise<SsrRender>): Promise<string> {
    let html = ''
    for await (const chunk of renderToStream(render)) {
        html += chunk
    }
    return html
}

test('two independent blocking awaits render in ~max, not ~sum, of their latencies', async () => {
    const DELAY = 60
    const slow = (n: number): Promise<number> =>
        new Promise((resolve) => setTimeout(() => resolve(n), DELAY))
    const source = `<main><p>{await slow(1)}</p><p>{await slow(2)}</p></main>`
    const started = performance.now()
    const html = await drain(ssrRender(source, { slow }))
    const elapsed = performance.now() - started
    /* Serial would be ~2×DELAY (120ms); overlapped is ~DELAY. Generous CI bound below 2×DELAY. */
    expect(elapsed).toBeLessThan(DELAY * 1.7)
    expect(html).toContain('1')
    expect(html).toContain('2')
})

test('a hoisted streaming-only page stays a SYNCHRONOUS render (no first-byte regression)', () => {
    /* The flight decls carry no `await`, and a streaming block never awaits inline, so a
       pure-streaming page must not gain an async IIFE wrapper — its shell still flushes early. */
    const streaming = compileSSR(`<main>{#await load()}<p>loading</p>{:then v}<b>{v}</b>{/await}</main>`)
    expect(streaming).toContain('$$flight') // the flight IS hoisted (starts early)
    expect(streaming).not.toContain('(async () =>') // but the render stays synchronous
    /* A blocking await still forces the async wrapper (it awaits the flight inline). */
    expect(compileSSR(`<main>{#await load() then v}<b>{v}</b>{/await}</main>`)).toContain('(async () =>')
})

test('a rejecting hoisted flight renders its {:catch}, no unhandled rejection', async () => {
    const rejections: unknown[] = []
    const onRejection = (reason: unknown): void => {
        rejections.push(reason)
    }
    process.on('unhandledRejection', onRejection)
    try {
        const boom = (): Promise<number> => Promise.reject(new Error('boom'))
        const source = `<main>{#await boom()}<p>loading</p>{:then v}<b>{v}</b>{:catch e}<i>{e.message}</i>{/await}</main>`
        const html = await drain(ssrRender(source, { boom }))
        /* Let the keeper's microtask + any stray settle flush before asserting no unhandled rejection. */
        await new Promise((resolve) => setTimeout(resolve, 10))
        expect(html).toContain('boom')
        expect(rejections).toHaveLength(0)
    } finally {
        process.off('unhandledRejection', onRejection)
    }
})
