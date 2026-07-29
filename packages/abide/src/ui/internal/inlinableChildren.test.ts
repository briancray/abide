// WHICH SUBTREES MAY COLLAPSE THEIR RENDER FRAME — the streaming-SSR participation rule, as a table.
//
// `emitServer` wraps each template level in an awaited IIFE, which costs a promise and a microtask tick
// per element per render — per ROW inside a list. `inlinableChildren` is what lets a level skip it. A
// blanket inline was tried and reverted: a `{#for await}`/`{#await}` reached through a collapsed frame
// stops seeing the per-render stream scope and silently falls back to a fully buffered drain.
//
// "Silently" is the whole problem. The HTML is byte-identical either way; only the TIMING differs. So
// no snapshot, no oracle and no DOM assertion can see a regression here — which is exactly the shape
// `CLAUDE.md` describes as needing the WORK asserted rather than the output, and why this predicate
// being unreachable from any test mattered. `emitServer` exported only `emitServerModule`, so the rule
// could previously be exercised only by compiling a template, rendering it, and watching for the
// absence of progressive output.
//
// The chunks below are hand-built `ServerChunk` values rather than compiled templates, so each case
// names one rule.

import { describe, expect, test } from 'bun:test'
import { inlinableChildren } from './emitServer.ts'
import type { ServerChunk } from './templatePlan.ts'

const staticChunk: ServerChunk = { kind: 'static', text: 'x' }
const interp: ServerChunk = { kind: 'interp', expr: 'a' }

const element = (children: ServerChunk[]): ServerChunk => ({
    kind: 'element',
    name: 'div',
    void: false,
    attrs: [],
    children,
    scopeAttrs: [],
})

const component = (children: ServerChunk[]): ServerChunk => ({
    kind: 'component',
    name: 'Card',
    ref: 'Card',
    attrs: [],
    children,
    hasChildren: children.length > 0,
    siteId: 0,
})

const forBlock = (isAwait: boolean, children: ServerChunk[]): ServerChunk => ({
    kind: 'for',
    await: isAwait,
    item: 'n',
    index: null,
    iterable: 'xs',
    children,
    catch: null,
    hasComponent: false,
    hasScript: false,
})

const awaitBlock: ServerChunk = {
    kind: 'awaitBlock',
    expr: 'p',
    pending: [],
    // `then`/`catch`/`finally` are the `{#await}` block's own BRANCH NAMES (the template grammar's
    // `{:then}`/`{:catch}`/`{:finally}`), so this is the plan node's real shape and renaming the field
    // would rename the grammar. Nothing awaits a plan node — it is data read by the emitters.
    // biome-ignore lint/suspicious/noThenProperty: a branch name from the template grammar, not a thenable.
    then: null,
    catch: null,
    finally: null,
    inline: false,
}

const ifBlock = (children: ServerChunk[]): ServerChunk => ({
    kind: 'if',
    branches: [{ expr: 'c', children }],
})

// ---------------------------------------------------------------------------
// Inlinable — nothing here participates in streaming
// ---------------------------------------------------------------------------

describe('a level with no streaming participant may collapse its frame', () => {
    test('an empty list is inlinable', () => {
        expect(inlinableChildren([])).toBe(true)
    })

    test.each([
        ['static text', [staticChunk]],
        ['an interpolation', [interp]],
        ['a raw html slot', [{ kind: 'html', expr: 'h' } as ServerChunk]],
        ['a leaf await', [{ kind: 'await', expr: 'p' } as ServerChunk]],
        ['a style', [{ kind: 'style', css: 'a{}' } as ServerChunk]],
    ])('%s is inlinable', (_label, chunks) => {
        expect(inlinableChildren(chunks as ServerChunk[])).toBe(true)
    })

    test('nesting through elements stays inlinable', () => {
        expect(inlinableChildren([element([element([interp])])])).toBe(true)
    })

    test('a SYNC {#for} is transparent — it owns its own frame', () => {
        expect(inlinableChildren([forBlock(false, [interp])])).toBe(true)
    })

    test.each([
        ['if', ifBlock([interp])],
        [
            'switch',
            { kind: 'switch', discriminant: 'k', cases: [{ expr: '1', children: [interp] }] },
        ],
        ['try', { kind: 'try', children: [interp], catch: null, finally: null }],
    ])('a %s block is transparent', (_label, chunk) => {
        expect(inlinableChildren([chunk as ServerChunk])).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// The correction: a component INVOCATION is transparent
// ---------------------------------------------------------------------------

describe('a component invocation is transparent to streaming', () => {
    test('a childless component does not by itself keep the frame', () => {
        // Whatever the component renders — including a streaming block — runs inside the BUILDER's own
        // async frame, not the caller's, so collapsing the caller's frame cannot take a stream scope
        // away from it. The trailing comment in `emitServer` claimed the opposite ("`component` … keeps
        // the frame") while the case ten lines above it recursed; the case was right.
        expect(inlinableChildren([component([])])).toBe(true)
    })

    test('but its SLOT children render in the CALLER frame and still have to qualify', () => {
        expect(inlinableChildren([component([interp])])).toBe(true)
        expect(inlinableChildren([component([awaitBlock])])).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// Not inlinable — the streaming participants
// ---------------------------------------------------------------------------

describe('a streaming participant anywhere in the subtree keeps the frame', () => {
    test('{#for await} is the streaming participant', () => {
        expect(inlinableChildren([forBlock(true, [interp])])).toBe(false)
    })

    test('an {#await} block streams', () => {
        expect(inlinableChildren([awaitBlock])).toBe(false)
    })

    test('a hoisted componentDef must be owned by the parent frame', () => {
        expect(
            inlinableChildren([{ kind: 'componentDef', name: 'Row', params: '', children: [] }]),
        ).toBe(false)
    })

    test('a branch-local <script> keeps the frame that declares its effect scope', () => {
        expect(inlinableChildren([{ kind: 'script', setup: 'let m = 1' }])).toBe(false)
    })

    test('a participant nested THREE levels deep still keeps the frame', () => {
        // The recursion is the point: the reverted blanket inline broke exactly this, and a shallow
        // check would pass every case above while still collapsing the frame around a deep stream.
        expect(inlinableChildren([element([element([element([awaitBlock])])])])).toBe(false)
    })

    test.each([
        ['inside an {#if} branch', ifBlock([forBlock(true, [])])],
        [
            'inside a {#switch} case',
            { kind: 'switch', discriminant: 'k', cases: [{ expr: '1', children: [awaitBlock] }] },
        ],
        [
            'inside a {#try} catch clause',
            {
                kind: 'try',
                children: [],
                catch: { param: 'e', children: [awaitBlock] },
                finally: null,
            },
        ],
        [
            'inside a {#try} finally clause',
            { kind: 'try', children: [], catch: null, finally: [awaitBlock] },
        ],
        ['inside a sync {#for} body', forBlock(false, [awaitBlock])],
        [
            'inside a {#for} catch clause',
            {
                kind: 'for',
                await: false,
                item: 'n',
                index: null,
                iterable: 'xs',
                children: [],
                catch: { param: 'e', children: [awaitBlock] },
                hasComponent: false,
                hasScript: false,
            },
        ],
    ])(
        'a stream %s is found — every transparent block recurses into EVERY arm',
        (_label, chunk) => {
            expect(inlinableChildren([chunk as ServerChunk])).toBe(false)
        },
    )

    test('one participant among many siblings is enough', () => {
        expect(inlinableChildren([staticChunk, interp, awaitBlock, staticChunk])).toBe(false)
    })
})
