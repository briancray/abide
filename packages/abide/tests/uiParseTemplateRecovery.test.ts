import { describe, expect, test } from 'bun:test'
import { analyzeComponent } from '../src/lib/ui/compile/analyzeComponent.ts'
import { parseTemplate } from '../src/lib/ui/compile/parseTemplate.ts'
import { parseTemplateRecovering } from '../src/lib/ui/compile/parseTemplateRecovering.ts'

/*
Locks in the error-RECOVERY contract of the template parser.

Two entry points, two contracts:
  - `parseTemplateRecovering` is the non-throwing CORE: every malformed construct is
    RECORDED as a diagnostic and the walk resyncs, returning best-effort `nodes`
    alongside EVERY diagnostic (the LSP multi-error unlock). It never throws.
  - `parseTemplate` is the fail-fast COMPILER SEAM: it re-throws the FIRST diagnostic
    as an `AbideCompileError` (message + offset preserved), so the build still aborts on
    the first source-order failure exactly as before. `analyzeComponent` sits on that seam.

The wording of most messages is NOT the point here (the block-grammar / error-location
suites already pin the exact strings); these tests fix wording only where a case is a
recovery concern the other suites don't cover, and otherwise assert the structural
recovery contract: no throw, an in-range diagnostic, and a partial `nodes` array.
*/

/* Malformed inputs the recovering core must DIAGNOSE (>= 1 diagnostic) while still
   returning a partial tree. `match`, when present, tightens the first message to the
   wording the existing suites fix. */
const DIAGNOSING_CASES: { label: string; source: string; match?: RegExp }[] = [
    { label: 'unterminated {#if}', source: `{#if a}<p>x</p>`, match: /unterminated \{#if\}/ },
    {
        label: 'unterminated {#for}',
        source: `{#for item of items}<li>{item}</li>`,
        match: /unterminated/,
    },
    { label: 'unterminated {#await}', source: `{#await load()}<p>l</p>`, match: /unterminated/ },
    {
        label: 'unterminated {#switch}',
        source: `{#switch s}{:case 1}<p>x</p>`,
        match: /unterminated/,
    },
    { label: 'unterminated {#try}', source: `{#try}<p>x</p>`, match: /unterminated/ },
    {
        label: 'unknown {#block}',
        source: `{#foo}<p>x</p>{/foo}`,
        match: /unknown control block \{#foo\}/,
    },
    {
        label: 'mismatched close {#if}…{/for}',
        source: `{#if a}<p>x</p>{/for}`,
        match: /does not close/,
    },
    {
        label: 'crossed nesting {#if}{#for}…{/if}{/for}',
        source: `{#if a}{#for x of xs}<li>{x}</li>{/if}{/for}`,
        match: /does not close/,
    },
    {
        label: 'stray {:else} with no opener',
        source: `<p>x</p>{:else}<p>y</p>`,
        match: /has no open/,
    },
    { label: 'stray {/if} with no opener', source: `<p>x</p>{/if}`, match: /has no open/ },
    { label: 'empty {#if} condition', source: `{#if}<p>x</p>{/if}`, match: /requires a condition/ },
    {
        label: 'empty {:else if} condition',
        source: `{#if a}<p>x</p>{:else if}<p>y</p>{/if}`,
        match: /requires a condition/,
    },
    {
        label: '{#for} without `of`',
        source: `{#for item items}<li>{item}</li>{/for}`,
        match: /<binding> of <iterable>/,
    },
    {
        label: 'malformed {#snippet} (no name)',
        source: `{#snippet}<td>x</td>{/snippet}`,
        match: /\{#snippet/,
    },
    {
        label: 'bare {expr} attribute',
        source: `<div {foo}></div>`,
        match: /not a valid attribute/,
    },
    { label: 'removed <slot>', source: `<slot></slot>`, match: /<slot> element was removed/ },
    {
        label: 'removed <template if>',
        source: `<template if={on}><b>x</b></template>`,
        match: /control flow was removed/,
    },
    {
        label: 'removed <template each>',
        source: `<template each={xs} as="x"><li>{x}</li></template>`,
        match: /control flow was removed/,
    },
]

describe('parseTemplateRecovering — diagnosing family', () => {
    for (const { label, source, match } of DIAGNOSING_CASES) {
        test(`${label}: recovers with a diagnostic + partial nodes`, () => {
            let result: ReturnType<typeof parseTemplateRecovering> | undefined
            /* (1) the recovering core NEVER throws — it records instead. */
            expect(() => {
                result = parseTemplateRecovering(source, 0)
            }).not.toThrow()
            if (result === undefined) {
                throw new Error('unreachable — parse did not run')
            }
            /* (3) still returns a (partial) nodes array. */
            expect(Array.isArray(result.nodes)).toBe(true)
            /* (2) at least one diagnostic, each with a plausible in-range span. */
            expect(result.diagnostics.length).toBeGreaterThanOrEqual(1)
            for (const diagnostic of result.diagnostics) {
                expect(diagnostic.start).toBeGreaterThanOrEqual(0)
                expect(diagnostic.start).toBeLessThanOrEqual(source.length)
                expect(diagnostic.length).toBeGreaterThanOrEqual(0)
                expect(diagnostic.start + diagnostic.length).toBeLessThanOrEqual(source.length)
                expect(typeof diagnostic.message).toBe('string')
                expect(diagnostic.message.length).toBeGreaterThan(0)
            }
            /* Tighten the FIRST message only where the wording is the recovery concern. */
            if (match !== undefined) {
                expect(result.diagnostics[0].message).toMatch(match)
            }
        })
    }
})

/* Malformed inputs the parser TOLERATES by reading to end-of-source (no diagnostic) —
   byte-identical to the legacy fail-fast parser, which also never threw on these. The
   recovery contract for them is purely "no throw, still returns nodes"; asserting a
   diagnostic here would be a false expectation. */
const TOLERATED_CASES: { label: string; source: string }[] = [
    { label: 'unclosed element', source: `<div><p>x</p>` },
    { label: 'unterminated {expr}', source: `<p>{name` },
    { label: 'unterminated attribute quote', source: `<input value="abc>` },
]

describe('parseTemplateRecovering — recovery-tolerant family (read-to-EOF)', () => {
    for (const { label, source } of TOLERATED_CASES) {
        test(`${label}: no throw, returns nodes`, () => {
            let result: ReturnType<typeof parseTemplateRecovering> | undefined
            expect(() => {
                result = parseTemplateRecovering(source, 0)
            }).not.toThrow()
            if (result === undefined) {
                throw new Error('unreachable — parse did not run')
            }
            expect(Array.isArray(result.nodes)).toBe(true)
        })
    }
})

describe('parseTemplateRecovering — multi-error unlock', () => {
    /* Two INDEPENDENT, well-nested errors in one source must surface as TWO distinct
       diagnostics from a SINGLE pass — the property the old fail-fast parser could never
       give (it aborted at the first). */
    test('two independent errors yield two distinct diagnostics', () => {
        const source = `{#if}<p>x</p>{/if}{#for item items}<li>x</li>{/for}`
        const { nodes, diagnostics } = parseTemplateRecovering(source, 0)
        expect(diagnostics.length).toBe(2)
        expect(diagnostics[0].message).toMatch(/requires a condition/)
        expect(diagnostics[1].message).toMatch(/<binding> of <iterable>/)
        /* The two diagnostics are distinct and ordered by source position. */
        expect(diagnostics[0].message).not.toBe(diagnostics[1].message)
        expect(diagnostics[0].start).toBeLessThan(diagnostics[1].start)
        /* Both malformed blocks still produced a node — recovery kept walking. */
        expect(nodes.length).toBe(2)
    })

    test('diagnostic offsets ride the parse baseOffset', () => {
        const base = 100
        const { diagnostics } = parseTemplateRecovering(`{#if a}<p>x</p>`, base)
        expect(diagnostics.length).toBeGreaterThanOrEqual(1)
        /* An unterminated block reports at EOF, offset by the base. */
        expect(diagnostics[0].start).toBeGreaterThanOrEqual(base)
    })
})

describe('compiler seam still fails fast', () => {
    /* The throwing facade re-throws the FIRST diagnostic verbatim (message + offset), so
       the build aborts exactly as before recovery existed. */
    test('parseTemplate throws AbideCompileError carrying the first diagnostic', () => {
        const source = `{#if}<p>x</p>{/if}{#for item items}<li>x</li>{/for}`
        const first = parseTemplateRecovering(source, 0).diagnostics[0]
        let thrown: unknown
        try {
            parseTemplate(source, 0)
        } catch (error) {
            thrown = error
        }
        expect(thrown).toBeInstanceOf(Error)
        expect((thrown as Error).name).toBe('AbideCompileError')
        expect((thrown as Error).message).toBe(first.message)
        expect((thrown as { offset?: number }).offset).toBe(first.start)
    })

    test('analyzeComponent (the compile path) still throws on malformed input', () => {
        expect(() => analyzeComponent(`{#if a}<p>x</p>`)).toThrow(/unterminated/)
    })

    test('analyzeComponent does NOT throw on well-formed input', () => {
        expect(() => analyzeComponent(`<p>{x}</p>`)).not.toThrow()
    })
})
