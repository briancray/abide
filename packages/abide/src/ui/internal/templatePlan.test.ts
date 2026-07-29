// What each construct LOWERS TO, asserted as data.
//
// `buildPlan(root, analysis) → TemplatePlan` has always been a pure function over plain values, so this
// seam existed the whole time and nothing used it: the plan's OUTPUT was reachable from tests only as a
// side effect of `emitModuleSource`, which evaluates the generated module. So "what does `{#for}` lower
// to" could only be answered by mounting a component into a DOM and reading back `<li>` order — which
// is a test of the runtime, the emitter and the plan at once, and names none of them when it fails.
//
// These assert the plan itself: the anchor path each slot targets, the rewritten expression, and the
// per-kind payload. They are the guard the `SlotMeta`-bag → discriminated-union change needed and did
// not have, and they are what makes a lowering change reviewable without reading emitted strings.

import { describe, expect, test } from 'bun:test'
import { analyzeBindings } from './analyzeBindings.ts'
import { parse } from './parse.ts'
import { buildPlan, type DynamicSlot, type SlotKind, type TemplatePlan } from './templatePlan.ts'

function plan(source: string): TemplatePlan {
    const root = parse(source, { filename: 'plan.abide' })
    return buildPlan(root, analyzeBindings(root))
}

// The single slot of a one-slot template, narrowed to its kind.
function only<K extends SlotKind>(source: string, kind: K): Extract<DynamicSlot, { kind: K }> {
    const slots = plan(source).slots
    expect(slots).toHaveLength(1)
    const slot = slots[0] as DynamicSlot
    expect(slot.kind).toBe(kind)
    return slot as Extract<DynamicSlot, { kind: K }>
}

// A sub-plan is asserted by its own slots, not re-serialized inline.
const kindsOf = (slots: DynamicSlot[]): SlotKind[] => slots.map((s) => s.kind)

// ---------------------------------------------------------------------------
// Leaves
// ---------------------------------------------------------------------------

describe('leaf slots', () => {
    test('an interpolation targets its anchor and carries the rewritten expression', () => {
        const slot = only('<p>{x}</p>', 'interpolation')
        expect(slot.path).toEqual([0, 0])
        expect(slot.expr).toBe('$scope.x')
    })

    test('prefixLen is the length of the static text the server MERGED into this node', () => {
        // The HTML parser coalesces `a` and the rendered value into one Text node, so hydration has to
        // split it at offset 1. This number is the whole reason `claimText` can adopt server text.
        expect(only('<p>a{x}b</p>', 'interpolation').prefixLen).toBe(1)
        expect(only('<p>{x}</p>', 'interpolation').prefixLen).toBe(0)
    })

    test('`{html(...)}` gets a PAIR of anchors and no prefixLen — raw markup has no split point', () => {
        const slot = only('<p>{html(raw)}</p>', 'html')
        expect(slot.path).toEqual([0, 1]) // the CLOSE anchor
        expect(slot.expr).toBe('$scope.raw')
        expect(plan('<p>{html(raw)}</p>').skeletonClient).toBe('<p><!--[h--><!--]h--></p>')
    })

    test('`{await ...}` is a leaf whose expr is the PROMISE — the runtime does the awaiting', () => {
        // The `await` keyword is consumed by the lowering, not carried: `$rt.awaitText` takes a thunk
        // returning the promise and fills the text node when it settles. Keeping the keyword would make
        // the thunk async and blank the SSR text.
        const slot = only('<p>{await load()}</p>', 'await')
        expect(slot.expr).toBe('$scope.load()')
    })
})

// ---------------------------------------------------------------------------
// Attributes and directives — all target the ELEMENT path, not an anchor
// ---------------------------------------------------------------------------

describe('attribute slots', () => {
    test('an expression attribute keeps its name', () => {
        const slot = only('<a href={u}>x</a>', 'attr')
        expect(slot).toEqual({ kind: 'attr', path: [0], expr: '$scope.u', name: 'href' })
    })

    test('a listener carries BOTH the authored name and the stripped event', () => {
        // `name` is what the author wrote (`onclick`), `event` is what `addEventListener` takes.
        const slot = only('<button onclick={go}>x</button>', 'event')
        expect(slot).toEqual({
            kind: 'event',
            path: [0],
            expr: '$scope.go',
            name: 'onclick',
            event: 'click',
        })
    })

    test.each([
        ['<b class:on={f}>x</b>', 'class'],
        ['<b style:color={c}>x</b>', 'style'],
        ['<input bind:value={v}/>', 'bind'],
    ] as const)('%s lowers to a %s slot on the element', (source, kind) => {
        const slot = only(source, kind)
        expect(slot.path).toEqual([0])
        expect(slot.name).not.toBe('')
    })

    test('a spread carries only its expression', () => {
        expect(only('<b {...rest}>x</b>', 'spread')).toEqual({
            kind: 'spread',
            path: [0],
            expr: '$scope.rest',
        })
    })

    test('several directives on one element all address the same path', () => {
        const slots = plan('<button onclick={go} class:on={f} disabled={d}>x</button>').slots
        expect(kindsOf(slots)).toEqual(['event', 'class', 'attr'])
        for (const slot of slots) expect(slot.path).toEqual([0])
    })
})

// ---------------------------------------------------------------------------
// Blocks — each targets its CLOSE anchor; the open anchor is derived as path-1
// ---------------------------------------------------------------------------

describe('{#if}', () => {
    test('branches are ordered, and `{:else}` is the null-condition branch', () => {
        const slot = only('{#if a}<b>y</b>{:else if c}<u>m</u>{:else}<i>n</i>{/if}', 'if')
        expect(slot.path).toEqual([1])
        expect(slot.branches.map((b) => b.expr)).toEqual(['$scope.a', '$scope.c', null])
    })
})

describe('{#for}', () => {
    test('a keyed loop records the item, the rewritten iterable, and the rewritten key', () => {
        const slot = only(
            '<script>let xs = [1]</script><ul>{#for n of xs by n}<li>{n}</li>{/for}</ul>',
            'for',
        )
        expect(slot.path).toEqual([0, 1])
        expect(slot.item).toBe('n')
        expect(slot.index).toBeNull()
        expect(slot.iterable).toBe('xs')
        // The key resolves off the ITEM scope, so it rewrites to `$scope.n` even though `n` is the
        // loop binding — this is what `genFor` re-binds `$scope` for.
        expect(slot.key).toBe('$scope.n')
        expect(slot.await).toBe(false)
        expect(kindsOf(slot.body.slots)).toEqual(['interpolation'])
    })

    test('a KEYLESS loop plans a null key — positional reconcile', () => {
        expect(only('{#for n of xs}<li>{n}</li>{/for}', 'for').key).toBeNull()
    })

    test('an index binding is recorded by name', () => {
        expect(only('{#for n, i of xs}<li>{i}</li>{/for}', 'for').index).toBe('i')
    })

    test('`{#for await}` sets the await flag and keeps a `{:catch}` clause', () => {
        const slot = only('{#for await c of s}<li>{c}</li>{:catch e}<b>{e}</b>{/for}', 'for')
        expect(slot.await).toBe(true)
        expect(slot.catch?.param).toBe('e')
    })

    test('hasComponent / hasScript flag a body that needs a per-ITEM seed bucket', () => {
        // Either one means each iteration's cells need their own hydration bucket, so `genFor` emits a
        // `$scope.state.forItem($index)` call. A plain body must NOT pay for that.
        const plain = only('{#for n of xs}<li>{n}</li>{/for}', 'for')
        expect([plain.hasComponent, plain.hasScript]).toEqual([false, false])

        const withComponent = only('{#for n of xs}<Row n={n}/>{/for}', 'for')
        expect(withComponent.hasComponent).toBe(true)

        const withScript = only(
            '{#for n of xs}{#if n}<script>let m = 1</script><b>{m}</b>{/if}{/for}',
            'for',
        )
        expect(withScript.hasScript).toBe(true)
    })
})

describe('{#await}', () => {
    test('every branch is planned separately and binds its own param', () => {
        const slot = only(
            '{#await p}<b>w</b>{:then v}<i>{v}</i>{:catch e}<u>{e}</u>{/await}',
            'awaitBlock',
        )
        expect(slot.expr).toBe('$scope.p')
        expect(kindsOf(slot.pending.slots)).toEqual([])
        expect(slot.then?.param).toBe('v')
        expect(slot.catch?.param).toBe('e')
        expect(slot.finally).toBeNull()
    })

    test('the inline shorthand has a `then` and an EMPTY pending branch', () => {
        const slot = only('{#await p then v}<i>{v}</i>{/await}', 'awaitBlock')
        expect(slot.then?.param).toBe('v')
        expect(slot.pending.slots).toEqual([])
    })
})

describe('{#switch}', () => {
    test('the discriminant is rewritten once and cases keep source order', () => {
        const slot = only(
            '{#switch k}{:case 1}<b>a</b>{:case 2}<b>b</b>{:default}<i>d</i>{/switch}',
            'switch',
        )
        expect(slot.discriminant).toBe('$scope.k')
        expect(slot.branches.map((b) => b.expr)).toEqual(['1', '2', null])
    })
})

describe('{#try}', () => {
    test('body / catch / finally are three independent sub-plans', () => {
        const slot = only('{#try}<b>a</b>{:catch e}<i>{e}</i>{:finally}<u>f</u>{/try}', 'try')
        expect(slot.catch?.param).toBe('e')
        expect(slot.finally).not.toBeNull()
    })
})

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

describe('component slots', () => {
    test('an imported tag resolves to a lexical ref and is NOT reactive', () => {
        const slot = only(
            "<script>import Card from './Card.abide'</script><Card n={1}/>",
            'component',
        )
        expect(slot.name).toBe('Card')
        expect(slot.ref).toBe('Card')
        expect(slot.reactive).toBe(false)
        expect(slot.hasChildren).toBe(false)
        expect(slot.attrs).toEqual([{ kind: 'expr', name: 'n', expr: '1' }])
    })

    test('a MEMBER tag is reactive — it is an expression over bindings, not an import', () => {
        const slot = only('{#for it of xs}<it.Icon/>{/for}', 'for')
        const inner = slot.body.slots[0] as Extract<DynamicSlot, { kind: 'component' }>
        expect(inner.kind).toBe('component')
        expect(inner.reactive).toBe(true)
    })

    test('an `onclick` on a COMPONENT is an ordinary prop, not a listener slot', () => {
        // There is no element to attach to, so the component places it itself. The two emitters used to
        // disagree here — the server dropped it and the client passed it.
        const slot = only(
            "<script>import B from './B.abide'</script><B onclick={go}/>",
            'component',
        )
        expect(slot.attrs).toEqual([
            { kind: 'event', name: 'onclick', event: 'click', expr: '$scope.go' },
        ])
    })

    test('children are planned into the body and flagged', () => {
        const slot = only(
            "<script>import B from './B.abide'</script><B><i>{x}</i></B>",
            'component',
        )
        expect(slot.hasChildren).toBe(true)
        expect(kindsOf(slot.body.slots)).toEqual(['interpolation'])
    })

    test('`<slot/>` lowers to a `children` component reading off the scope', () => {
        const slot = only('<div><slot/></div>', 'component')
        expect(slot.name).toBe('children')
        expect(slot.ref).toBe('$scope.children')
        // The layout-composition outlet records into the ROOT seed bucket, not a per-site one.
        expect(slot.siteId).toBe(-1)
    })

    test('each component invocation gets a distinct stable site id', () => {
        const slots = plan("<script>import B from './B.abide'</script><B/><B/>").slots as Extract<
            DynamicSlot,
            { kind: 'component' }
        >[]
        expect(slots.map((s) => s.siteId)).toEqual([0, 1])
    })
})

describe('zero-DOM registrations', () => {
    test('a `{#component}` definition is hoisted to the head of the level with an empty path', () => {
        const slots = plan('{#component Row(x)}<li>{x}</li>{/component}<Row x={1}/>').slots
        expect(kindsOf(slots)).toEqual(['componentDef', 'component'])
        const def = slots[0] as Extract<DynamicSlot, { kind: 'componentDef' }>
        expect(def.path).toEqual([])
        expect(def.name).toBe('Row')
        expect(def.params).toBe('x')
    })

    test('a branch-local `<script>` is hoisted the same way and carries its setup', () => {
        const slots = plan('{#if a}<script>let m = 1</script><b>{m}</b>{/if}').slots
        const branch = (slots[0] as Extract<DynamicSlot, { kind: 'if' }>).branches[0]
        const inner = branch?.plan.slots ?? []
        expect(kindsOf(inner)).toEqual(['script', 'interpolation'])
        const script = inner[0] as Extract<DynamicSlot, { kind: 'script' }>
        expect(script.path).toEqual([])
        expect(script.setup).toContain('let m = 1')
    })
})

// ---------------------------------------------------------------------------
// The two-representation invariant
// ---------------------------------------------------------------------------

describe('client slots and server chunks describe the SAME tree', () => {
    test.each([
        ['{#if a}<b>y</b>{/if}', 'if'],
        ['{#for n of xs}<li>{n}</li>{/for}', 'for'],
        ['{#await p}<b>w</b>{/await}', 'awaitBlock'],
        ['{#switch k}{:case 1}<b>a</b>{/switch}', 'switch'],
        ['{#try}<b>a</b>{/try}', 'try'],
    ] as const)('%s appears in both representations', (source, kind) => {
        const built = plan(source)
        expect(built.slots[0]?.kind).toBe(kind)
        expect(built.serverChunks[0]?.kind).toBe(kind)
    })

    test('a block reserves TWO child positions in the skeleton — open and close anchors', () => {
        // The skeleton and the server DOM must stay structurally identical or the hydrate cursor's
        // index accounting drifts from the real parse.
        expect(plan('{#if a}<b>y</b>{/if}').skeletonClient).toBe('<!--[--><!--]-->')
        expect(plan('{#if a}<b>y</b>{/if}').slots[0]?.path).toEqual([1])
    })
})
