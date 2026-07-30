// The child-list table, per node type. Before it had an owner this knowledge was three `switch`
// traversals — in `analyzeBindings`, `templatePlan` and `templateSemanticTokens` — reachable only by
// compiling a template three different ways, so "a new construct was added to two of the three walks"
// was a silent wrong render in one lane and nothing at all in the others.

import { describe, expect, test } from 'bun:test'
import type { TemplateNode } from './ast.ts'
import { parse } from './parse.ts'
import { childListsOf } from './templateChildren.ts'

// The node each case is about: the first non-whitespace one, so a source whose whole body IS text
// (the `Text` leaf case) still resolves to itself.
function firstNode(source: string): TemplateNode {
    const node = parse(source).children.find(
        (child) => child.type !== 'Text' || child.value.trim() !== '',
    )
    if (node === undefined) throw new Error(`no node in ${source}`)
    return node
}

// A readable shape for the assertion: one entry per child list, in source order.
function shape(source: string): Array<{ site: string; texts: string[] }> {
    return childListsOf(firstNode(source)).map((list) => ({
        site: list.site,
        texts: list.nodes.filter((n) => n.type === 'Text').map((n) => n.value.trim()),
    }))
}

describe('childListsOf', () => {
    // LEAVES. `Script`/`Style` bodies are raw text rather than template nodes, which is why they belong
    // here and not with the containers — the walk that highlights a script body reads `contentStart`.
    test.each([
        ['plain text', 'hello'],
        ['comment', '<!--c-->'],
        ['interpolation', '{x}'],
        ['html', '{html(x)}'],
        ['await interpolation', '{await x()}'],
        ['script', '<script>let a = 1</script>'],
        ['style', '<style>p{color:red}</style>'],
    ])('%s has no children', (_label, source) => {
        expect(childListsOf(firstNode(source))).toEqual([])
    })

    // CONTAINERS whose children fold into the parent level, so they cannot host a branch-local
    // `<script>` (`analyzeBindings` is the only caller that cares, and this is the field it reads).
    test('an element inlines its children', () => {
        expect(shape('<div>a</div>')).toEqual([{ site: 'inline', texts: ['a'] }])
    })

    test('a component inlines its children', () => {
        expect(shape('<Card>a</Card>')).toEqual([{ site: 'inline', texts: ['a'] }])
    })

    // BLOCKS. Every clause is its own list, and an ABSENT clause contributes none — which is the part
    // the three hand-written walks each restated as `if (node.catch !== null)`.
    test('an if chain lists every branch as a block', () => {
        expect(shape('{#if a}x{:else if b}y{:else}z{/if}')).toEqual([
            { site: 'block', texts: ['x'] },
            { site: 'block', texts: ['y'] },
            { site: 'block', texts: ['z'] },
        ])
    })

    test('a for block lists its body, and its catch only when present', () => {
        expect(shape('{#for a of b}x{/for}')).toEqual([{ site: 'block', texts: ['x'] }])
        expect(shape('{#for await a of b}x{:catch e}y{/for}')).toEqual([
            { site: 'block', texts: ['x'] },
            { site: 'block', texts: ['y'] },
        ])
    })

    test('an await block lists pending, then, catch and finally', () => {
        expect(shape('{#await p}w{:then v}x{:catch e}y{:finally}z{/await}')).toEqual([
            { site: 'block', texts: ['w'] },
            { site: 'block', texts: ['x'] },
            { site: 'block', texts: ['y'] },
            { site: 'block', texts: ['z'] },
        ])
        expect(shape('{#await p}w{/await}')).toEqual([{ site: 'block', texts: ['w'] }])
    })

    // The one place the two sites appear on ONE node: `leading` is the whitespace gap between the
    // `{#switch}` header and the first `{:case}`, not a body.
    test('a switch inlines its leading gap and blocks each case', () => {
        expect(shape('{#switch s} {:case 1}x{:default}y{/switch}')).toEqual([
            { site: 'inline', texts: [''] },
            { site: 'block', texts: ['x'] },
            { site: 'block', texts: ['y'] },
        ])
    })

    test('a try block lists its body, catch and finally', () => {
        expect(shape('{#try}x{:catch e}y{:finally}z{/try}')).toEqual([
            { site: 'block', texts: ['x'] },
            { site: 'block', texts: ['y'] },
            { site: 'block', texts: ['z'] },
        ])
    })

    test('an inline component definition blocks its body', () => {
        expect(shape('{#component Row(p)}x{/component}')).toEqual([{ site: 'block', texts: ['x'] }])
    })

    // The property the table exists for, asserted structurally: every node type reachable from a
    // template is answered. A `Record` over `TemplateNode['type']` is what makes a 16th member a
    // COMPILE error rather than a construct three walks silently skip — this is the runtime half, that
    // nothing in a real template falls through to an empty answer by accident.
    test('every node in a template carrying every construct is answered by the table', () => {
        const source = [
            '<script>let a = 1</script>',
            '<style>p{color:red}</style>',
            '<div>{x}{html(y)}{await z()}<!--c--></div>',
            '<Card><span>s</span></Card>',
            '{#if a}x{:else}y{/if}',
            '{#for i of list}<b>{i}</b>{/for}',
            '{#await p}w{:then v}x{/await}',
            '{#switch s}{:case 1}c{/switch}',
            '{#try}t{:catch e}u{/try}',
            '{#component Row(p)}r{/component}',
        ].join('\n')

        const seen = new Set<string>()
        const visit = (nodes: readonly TemplateNode[]): void => {
            for (const node of nodes) {
                seen.add(node.type)
                for (const list of childListsOf(node)) visit(list.nodes)
            }
        }
        visit(parse(source).children)

        // All 15 members of the union appear in the corpus above, so the walk reaching all of them is
        // also the proof that no arm returns nothing where children exist.
        expect([...seen].sort()).toEqual([
            'AwaitBlock',
            'AwaitInterpolation',
            'Comment',
            'Component',
            'ComponentBlock',
            'Element',
            'ForBlock',
            'Html',
            'IfBlock',
            'Interpolation',
            'Script',
            'Style',
            'SwitchBlock',
            'Text',
            'TryBlock',
        ])
    })
})
