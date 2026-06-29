import { describe, expect, test } from 'bun:test'
import { awaitPlan } from '../src/lib/ui/compile/awaitPlan.ts'
import { destructureBindingNames } from '../src/lib/ui/compile/destructureBindingNames.ts'
import { eachPlan } from '../src/lib/ui/compile/eachPlan.ts'
import { ifPlan } from '../src/lib/ui/compile/ifPlan.ts'
import { parseTemplate } from '../src/lib/ui/compile/parseTemplate.ts'
import { snippetPlan } from '../src/lib/ui/compile/snippetPlan.ts'
import { switchPlan } from '../src/lib/ui/compile/switchPlan.ts'
import { tryPlan } from '../src/lib/ui/compile/tryPlan.ts'
import type { Binding } from '../src/lib/ui/compile/types/Binding.ts'
import type { TemplateNode } from '../src/lib/ui/compile/types/TemplateNode.ts'

/*
Per-plan binding unit tests (ADR-0013, phase 4 test hardening). Each *Plan carries
its block's binding set + classification as DATA — the single source both back-ends
register through `withBindings`. The prior spikes could not write this assertion
because the name set was generated string output, computed inside each back-end. With
bindings on the plan, the assertion is direct: parse a representative node, call its
plan, read `bindings`/`resolvedBindings`/`catchBindings` straight off. This pins the
classification ('reactive' vs 'plain') at its single source, so a wrong-kind or
dropped binding fails HERE rather than mis-lowering to the component signal downstream.
*/

/* The single block node a control-flow template parses to (`nodes[0]`); narrowed to
   the requested kind so the plan callee type-checks against the parsed node. */
function block<K extends TemplateNode['kind']>(
    kind: K,
    source: string,
): Extract<TemplateNode, { kind: K }> {
    const node = parseTemplate(source).nodes[0]
    if (node.kind !== kind) {
        throw new Error(`expected a '${kind}' node, parsed '${node.kind}'`)
    }
    return node as Extract<TemplateNode, { kind: K }>
}

/* A binding list flattened to `name@classification` pairs — the data the table asserts. */
const tags = (bindings: Binding[]): string[] =>
    bindings.map((binding) => `${binding.name}@${binding.classification}`)

describe('per-plan bindings — the single source both back-ends register through', () => {
    /* await: the resolved (`then`) value is reactive, the `catch` error plain, `finally`
       binds nothing. Covered streaming and blocking, since both resolve a reactive value. */
    describe('awaitPlan', () => {
        test('streaming then value is reactive, catch error plain, finally none', () => {
            const plan = awaitPlan(
                block(
                    'await',
                    `{#await load()}<p>w</p>{:then v}<span>{v}</span>{:catch e}<b>{e}</b>{:finally}<i>d</i>{/await}`,
                ),
            )
            expect(tags(plan.resolvedBindings)).toEqual(['v@reactive'])
            expect(tags(plan.catchBindings)).toEqual(['e@plain'])
            // finally binds nothing — it surfaces only as resolved/catch bindings, never a third list.
            expect(plan.finallyChildren.length).toBeGreaterThan(0)
        })

        test('blocking then value is reactive; no catch → empty catch bindings', () => {
            const plan = awaitPlan(block('await', `{#await user() then u}<span>{u}</span>{/await}`))
            expect(tags(plan.resolvedBindings)).toEqual(['u@reactive'])
            expect(plan.catchBindings).toEqual([])
        })
    })

    /* each: item + index are reactive; an async-each `catch` error is plain. */
    describe('eachPlan', () => {
        test('item and index are both reactive', () => {
            const plan = eachPlan(block('each', `{#for item, i of items}<li>{item}{i}</li>{/for}`))
            expect(tags(plan.bindings)).toEqual(['item@reactive', 'i@reactive'])
            expect(plan.catchBindings).toEqual([])
        })

        test('item only (no index) yields a single reactive binding', () => {
            const plan = eachPlan(block('each', `{#for item of items}<li>{item}</li>{/for}`))
            expect(tags(plan.bindings)).toEqual(['item@reactive'])
        })

        test('destructuring `as` carries the pattern; leaf names derive from it', () => {
            const plan = eachPlan(
                block('each', `{#for {id, title} of posts by id}<li>{title}</li>{/for}`),
            )
            // the binding `name` is the pattern as written, classified reactive once;
            // its leaves are derived where it is registered (`destructureBindingNames`),
            // never re-derived in a back-end.
            expect(tags(plan.bindings)).toEqual(['{id, title}@reactive'])
            expect(destructureBindingNames(plan.bindings[0].name)).toEqual(['id', 'title'])
            // an explicit `by` key is structural, not a binding — it introduces no name.
            expect(plan.key).toBe('id')
        })

        test('async-each catch error is plain', () => {
            const plan = eachPlan(
                block('each', `{#for await row of stream}<li>{row}</li>{:catch e}<b>{e}</b>{/for}`),
            )
            expect(plan.async).toBe(true)
            expect(tags(plan.bindings)).toEqual(['row@reactive'])
            expect(tags(plan.catchBindings)).toEqual(['e@plain'])
        })
    })

    /* try: the catch error is plain; guarded + finally bind nothing. */
    describe('tryPlan', () => {
        test('catch error is plain', () => {
            const plan = tryPlan(
                block('try', `{#try}<x>a</x>{:catch e}<b>{e}</b>{:finally}<i>f</i>{/try}`),
            )
            expect(tags(plan.catchBindings)).toEqual(['e@plain'])
        })

        test('no catch → empty catch bindings', () => {
            const plan = tryPlan(block('try', `{#try}<x>a</x>{:finally}<i>f</i>{/try}`))
            expect(plan.catchBindings).toEqual([])
        })
    })

    /* snippet: args are plain (real call parameters, not cells). */
    describe('snippetPlan', () => {
        test('args are plain', () => {
            const plan = snippetPlan(
                block('snippet', `{#snippet row(item)}<td>{item}</td>{/snippet}`),
            )
            expect(tags(plan.bindings)).toEqual(['item@plain'])
        })

        test('no args → empty bindings', () => {
            const plan = snippetPlan(block('snippet', `{#snippet bar()}<td>x</td>{/snippet}`))
            expect(plan.bindings).toEqual([])
        })
    })

    /* if/elseif/else and switch introduce no names — empty bindings, present so every
       block plan answers the single binding source uniformly. */
    describe('binding-less blocks', () => {
        test('if/elseif/else binds nothing', () => {
            const plan = ifPlan(
                block(
                    'if',
                    `{#if a}<span>A</span>{:else if b}<span>B</span>{:else}<span>C</span>{/if}`,
                ),
            )
            expect(plan.bindings).toEqual([])
        })

        test('switch binds nothing', () => {
            const plan = switchPlan(
                block(
                    'switch',
                    `{#switch s}{:case "p"}<span>P</span>{:default}<span>?</span>{/switch}`,
                ),
            )
            expect(plan.bindings).toEqual([])
        })
    })
})
