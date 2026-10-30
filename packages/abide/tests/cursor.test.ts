// THE ONE WALK. `placeTemplate` turns a template into the positions its nodes stand at, and the
// markup, the build and the mount are all rendered from those positions. Whether a position is
// the RIGHT node is gated where a document exists to check it against: `nesting.test.ts`'s
// build-versus-paint gates and `corpusRuns.test.ts`'s 83 apps.
//
// What is asserted HERE is the walk itself: its spelling, and that it accounts for every node the
// template has, once. WHAT WOULD FAIL IT: a run of adjacent text and expressions placed once per
// PIECE rather than once per node the parser makes (the defect row construction once shipped,
// found by reading emitted output rather than by any assertion); a region counted through rather
// than stepped over; an element's children addressed from its parent; a `<slot/>` or an
// invocation placed as an element; a region the walk never descends into.

import { expect, test } from 'bun:test'

import { parseAbide } from '#compiler'
import { Cursor, placeTemplate, REGION_ROOT } from '#compiler/Cursor.ts'
import type { TemplateNode } from '#compiler/TemplateNode.ts'

function walk(source: string): { cursor: Cursor; template: TemplateNode[] } {
    const file = parseAbide(source)
    const cursor = new Cursor('__head', '__parent')
    placeTemplate(file.template, cursor)
    return { cursor, template: file.template }
}

// How many times the walk accounted for each template node: a run's pieces, an element, or the
// block, invocation or `<slot/>` a region stands for — then everything inside a region's own sinks.
function placed(cursor: Cursor, into: Map<TemplateNode, number>): void {
    for (const at of cursor.positions) {
        const covered = at.kind === 'text' ? at.run : [at.holder]
        for (const node of covered) into.set(node, (into.get(node) ?? 0) + 1)
        for (const inner of at.inner) placed(inner, into)
    }
}

// Every node a document would hold, in the template: what the walk has to account for.
function nodesOf(nodes: TemplateNode[], into: TemplateNode[]): void {
    for (const node of nodes) {
        into.push(node)
        if (node.kind === 'element') nodesOf(node.children, into)
        else if (node.kind === 'block') {
            if (node.block === 'for') nodesOf(node.children, into)
            else
                for (const branch of node.branches)
                    nodesOf(branch.children, into)
        }
    }
}

// The seven arms `emitNode` has, and the shapes that put a region in the MIDDLE of a run of
// siblings — which is where the walk steps over a region from its closing anchor.
const SHAPES: Record<string, string> = {
    'a text run and an element': '<p>Hello {name}! <em>{count}</em></p>',
    'a run of expressions alone': '<p>{a}{b}<em>x</em><span>{c}</span></p>',
    'a void element between bindings':
        '<div>{a}<br><img src={u}><span>{b}</span></div>',
    'nested elements, several deep':
        '<div><section><h1>{title}</h1><p>{body}<a href={u} onclick={go}>{label}</a></p></section></div>',
    'a block, and siblings after it':
        '<div>{before}{#if on}<em>{yes}</em>{:else}<i>{no}</i>{/if}<span>{after}</span></div>',
    'two blocks in one parent':
        '<div>{#if a}<em>{x}</em>{/if}<b>{mid}</b>{#if c}<i>{y}</i>{/if}<span>{z}</span></div>',
    'a list, single-rooted rows':
        '<ul>{#for item of items}<li onclick={pick}>{item.label}</li>{/for}</ul><p>{n}</p>',
    'a list, multi-rooted rows':
        '<dl>{#for item of items}<dt>{item.k}</dt><dd>{item.v}</dd>{/for}</dl>',
    'a block inside a row':
        '<ul>{#for item of items}<li>{item.k}{#if item.on}<em>{item.v}</em>{/if}<span>{item.w}</span></li>{/for}</ul>',
    'a block inside a block':
        '<div>{#if a}<p>{x}{#if b}<em>{y}</em>{/if}<span>{z}</span></p>{/if}</div>',
    'a list inside a block':
        '<div>{#if a}<ul>{#for i of xs}<li>{i}</li>{/for}</ul><p>{after}</p>{/if}</div>',
    'a slot, and siblings after it':
        '<div>{before}<slot><em>{fallback}</em></slot><span>{after}</span></div>',
    'an invocation with children':
        '<div>{before}<Card title={t}><p>{body}</p></Card><span>{after}</span></div>',
    'an invocation with none':
        '<div><Card title={t}/><span>{after}</span></div>',
    'a region first in its parent':
        '<div>{#if a}<em>{x}</em>{/if}{after}</div>',
    'a blank run after a region':
        '<div>{#if a}<em>{x}</em>{/if}{after}<b>{tail}</b></div>',
    'several top-level nodes':
        '{lead}<p>{a}</p>{#if on}<em>{b}</em>{/if}{tail}',
}

for (const [name, source] of Object.entries(SHAPES))
    test(`the walk accounts for every node, once: ${name}`, () => {
        const { cursor, template } = walk(source)
        const counts = new Map<TemplateNode, number>()
        placed(cursor, counts)
        const nodes: TemplateNode[] = []
        nodesOf(template, nodes)
        const wrong: string[] = []
        for (const node of nodes) {
            const seen = counts.get(node) ?? 0
            if (seen !== 1)
                wrong.push(
                    `${node.kind === 'element' ? `<${node.tag}>` : node.kind === 'text' ? JSON.stringify(node.text) : node.kind === 'expression' ? `{${node.source}}` : `{#${node.block}}`} placed ${seen} times`,
                )
        }
        expect(wrong).toEqual([])
    })

// The one nested sink the first region in a walk holds — an arm's, or a row's.
function firstNested(cursor: Cursor): Cursor {
    const region = cursor.positions.find((at) => at.kind === 'region')
    const sink = region?.inner[0]
    if (sink === undefined) throw new Error('no nested sink in this walk')
    return sink
}

// Each position as `name kind <- where it is found`, so a change to the walk shows in a diff as
// the addressing it is rather than as a path that moved.
function walked(cursor: Cursor): string[] {
    const out: string[] = []
    for (const at of cursor.positions)
        out.push(
            `${at.name} ${at.kind === 'element' ? at.tag : at.kind} <- ${at.from}`,
        )
    return out
}

test('the cursor is a linear walk', () => {
    const { cursor } = walk(
        '<div>{lead}<em>{a}</em>{#if on}<i>{b}</i>{/if}<span>{tail}</span></div>',
    )
    expect(walked(cursor)).toEqual([
        '__c0 div <- __head',
        '__c1 text <- __c0?.firstChild',
        '__c2 em <- __c1?.nextSibling',
        '__c3 text <- __c2?.firstChild',
        '__c4 region <- __c2?.nextSibling',
        // PAST THE REGION BY ITS CLOSING ANCHOR, never by counting: how many nodes stand between
        // the pair depends on a value, which is the whole reason the path scheme needs `-1 - n`
        // and a second step to reach the same sibling.
        '__c5 span <- __c4?.close?.nextSibling',
        '__c6 text <- __c5?.firstChild',
    ])
})

// AN ARM HANGS OFF THE REGION'S OWN ANCHOR PAIR, with no element over it — which is the second of
// the region-root shapes. A cursor takes the pair it already placed.
test('an arm addresses from the anchor pair it hangs in', () => {
    const { cursor } = walk('<div>{#if on}{lead}<em>{x}</em>{/if}</div>')
    const arm = firstNested(cursor)
    expect(walked(arm)).toEqual([
        // `__root`, NOT THE NAME THE OUTER SINK GAVE THE REGION. An arm's slots restart at `__c0`,
        // so borrowing `__c1` from the enclosing walk addresses this arm's own second slot — see
        // `REGION_ROOT`.
        `__c0 text <- ${REGION_ROOT}.open.nextSibling`,
        '__c1 em <- __c0?.nextSibling',
        '__c2 text <- __c1?.firstChild',
    ])
    expect(arm.positions[0]?.parent).toBe(`${REGION_ROOT}.close.parentNode`)
})

// A ROW IS ITS OWN REGION ROOT — its first node is on the record the reconcile hands its mount, so
// the walk starts there rather than inside anything. A multi-rooted row's first node is its own
// anchor, which is why its first top-level node stands one along.
test('a row addresses from the first node of the row the reconcile holds', () => {
    const single = firstNested(
        walk('<ul>{#for i of xs}<li>{i}</li>{/for}</ul>').cursor,
    )
    expect(walked(single)).toEqual([
        '__c0 li <- __row.node',
        '__c1 text <- __c0?.firstChild',
    ])
    expect(single.repeated).toBe(true)

    const many = firstNested(
        walk('<dl>{#for i of xs}<dt>{i.k}</dt><dd>{i.v}</dd>{/for}</dl>')
            .cursor,
    )
    expect(walked(many)).toEqual([
        '__c0 dt <- __row.node.nextSibling',
        '__c1 text <- __c0?.firstChild',
        '__c2 dd <- __c0?.nextSibling',
        '__c3 text <- __c2?.firstChild',
    ])
})

// 32.23 — a run every part of which is an expression can render NO node, and the position still
// has to exist because the walk continues through it. One static character anywhere in the run and
// it cannot happen, which is a property of the RUN and not of any binding in it.
test('a blank run is the run with no static text in it', () => {
    const { cursor } = walk('<p>{a}{b}</p><p>{a}: {b}</p><p>x{a}</p>')
    expect(
        cursor.positions
            .filter((at) => at.kind === 'text')
            .map((at) => at.blank),
    ).toEqual([true, false, false])
})
