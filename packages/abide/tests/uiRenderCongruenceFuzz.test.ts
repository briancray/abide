import { beforeAll, describe, expect, test } from 'bun:test'
import { snippet } from '../src/lib/shared/snippet.ts'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendSnippet } from '../src/lib/ui/dom/appendSnippet.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { text } from '../src/lib/ui/dom/text.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

const RUNTIME = {
    doc,
    state,
    computed,
    effect,
    appendText,
    appendSnippet,
    appendStatic,
    text,
    attr,
    on,
    each,
    when,
    mount,
    snippet,
}

function component(
    source: string,
    extra: Record<string, unknown> = {},
): ((host: Element, props?: unknown) => void) & { render: (props?: unknown) => SsrRender } {
    const clientBody = compileComponent(source)
    const ssrBody = compileSSR(source)
    const runtime = { ...RUNTIME, ...extra }
    const names = Object.keys(runtime)
    const values = names.map((name) => runtime[name as keyof typeof runtime])
    const fn = (host: Element, props?: unknown) => {
        new Function('host', '$props', ...names, clientBody)(host, props, ...values)
    }
    fn.render = (props?: unknown): SsrRender =>
        new Function('$props', ...names, ssrBody)(props, ...values) as SsrRender
    return Object.assign(fn, { render: fn.render })
}

const Box = `<div class="box"><slot></slot></div>`

const serialize = (host: unknown): string =>
    (globalThis as unknown as { serializeMiniDom: (h: unknown) => string }).serializeMiniDom(host)

/* Snippet invocation wraps its output in server-only `<!--abide:snippet-->` markers the
   client never re-emits (see uiSnippets) — normalize that ONE documented asymmetry away so
   raw-markup comparison still polices the skeleton anchors (`<!--a-->`) and ranges (`[`/`]`)
   that actually drift. */
const stripSnippetMarkers = (html: string): string =>
    html.replaceAll('<!--abide:snippet-->', '').replaceAll('<!--/abide:snippet-->', '')

/* The visible text a browser would show: drop every comment marker and tag. The generator
   computes the SAME string by construction (the `text` field) — that independently-known
   value is the reference the emitters are checked against, so a wrong-but-congruent pair
   can't pass. */
const visibleText = (html: string): string =>
    html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '')

/*
A render fragment paired with the visible text it must produce, given the fixed model
(`active=true`, `inactive=false`, `label='hi'`, `items` length 2). Composing fragments
keeps the expected text known by construction.
*/
type Fragment = { html: string; text: string }

/* Leaf content — the innermost shape placed inside a boundary. Covers each way reactive
   content lands: a static element, marker-free text-leaf text, interleaved text (anchored),
   a nested control-flow block, and a component whose slot itself holds a block (the exact
   shape that first desynced). */
const leaves: Array<{ name: string; make: () => Fragment }> = [
    { name: 'static-element', make: () => ({ html: `<span>s</span>`, text: 's' }) },
    { name: 'text-leaf', make: () => ({ html: `<p>{label}</p>`, text: 'hi' }) },
    { name: 'interleaved-text', make: () => ({ html: `<b>x</b>{label}<b>y</b>`, text: 'xhiy' }) },
    {
        name: 'nested-block',
        make: () => ({ html: `<template if={active}><span>z</span></template>`, text: 'z' }),
    },
    {
        name: 'component-block-slot',
        make: () => ({
            html: `<Box><template if={active}><span>q</span></template></Box>`,
            text: 'q',
        }),
    },
]

/* Fresh-context boundaries — each builds its inner content in its own context, the place an
   enclosing skeleton must NOT stamp markers. `bare` is the control (no boundary). */
const boundaries: Array<{ name: string; wrap: (inner: Fragment) => Fragment }> = [
    { name: 'bare', wrap: (inner) => inner },
    {
        name: 'if-true',
        wrap: (inner) => ({
            html: `<template if={active}>${inner.html}</template>`,
            text: inner.text,
        }),
    },
    {
        name: 'if-else',
        wrap: (inner) => ({
            html: `<template if={inactive}><i>D</i><template else>${inner.html}</template></template>`,
            text: inner.text,
        }),
    },
    {
        name: 'component-slot',
        wrap: (inner) => ({ html: `<Box>${inner.html}</Box>`, text: inner.text }),
    },
    {
        name: 'each-row',
        wrap: (inner) => ({
            html: `<template each={items} as="it" key="it">${inner.html}</template>`,
            text: inner.text.repeat(2),
        }),
    },
    {
        name: 'snippet-body',
        wrap: (inner) => ({
            html: `<template name="frag">${inner.html}</template>{frag()}`,
            text: inner.text,
        }),
    },
]

/* The outer context: top level (not in a skeleton) vs inside a skeletonable element (a
   reactive-attr parent) — the only place the leak shows. */
const contexts: Array<{ name: string; wrap: (inner: Fragment) => Fragment }> = [
    { name: 'top-level', wrap: (inner) => inner },
    {
        name: 'skeletonable-parent',
        wrap: (inner) => ({
            html: `<section class={active ? 'on' : 'off'}>${inner.html}</section>`,
            text: inner.text,
        }),
    },
]

const SCRIPT = `
    <script>
        let active = scope().state(true)
        let inactive = scope().state(false)
        let label = scope().state('hi')
        let items = scope().state(['m', 'n'])
    </script>
`

/* The full combinatorial corpus: every context × boundary × leaf. Each carries its
   by-construction expected visible text — the reference. */
const corpus = contexts.flatMap((context) =>
    boundaries.flatMap((boundary) =>
        leaves.map((leaf) => {
            const fragment = context.wrap(boundary.wrap(leaf.make()))
            return {
                name: `${context.name} › ${boundary.name} › ${leaf.name}`,
                source: `${SCRIPT}${fragment.html}`,
                expected: fragment.text,
            }
        }),
    ),
)

/*
The hydration-congruence invariant, checked generatively against a reference. For every
generated template the harness asserts, four ways:
  1. marker congruence — serialized client DOM equals SSR markup (the `<!--a-->`/`[`-`]`
     placement that drifts), modulo the one documented server-only snippet marker;
  2. client content equals the reference text;
  3. server content equals the reference text — so the pair can't be wrong-but-congruent;
  4. end-to-end — the client adopts the server DOM with NO desync throw and yields the
     reference text, the third independent path (the claimer) agreeing too.
The corpus combinatorially nests fresh-context boundaries inside skeletonable parents — the
shapes hand-written examples missed and that shipped two real desyncs.
*/
describe('render congruence (generative, reference-checked)', () => {
    const componentExtra = { Box: component(Box) }

    for (const { name, source, expected } of corpus) {
        test(name, () => {
            const built = component(source, componentExtra)

            const host = document.createElement('div')
            built(host)
            const clientMarkup = serialize(host)
            const serverMarkup = built.render().html

            // 1. marker congruence (client DOM === SSR markup)
            expect(clientMarkup).toBe(stripSnippetMarkers(serverMarkup))

            // 2 + 3. both sides render the reference content
            expect(visibleText(clientMarkup)).toBe(expected)
            expect(visibleText(serverMarkup)).toBe(expected)

            // 4. the client adopts the server DOM without desync, yielding the reference
            const hydrateHost = document.createElement('div')
            hydrateHost.innerHTML = serverMarkup
            let threw: unknown
            try {
                hydrate(hydrateHost, (target) => built(target))
            } catch (error) {
                threw = error
            }
            expect(threw).toBeUndefined()
            expect(visibleText(serialize(hydrateHost))).toBe(expected)
        })
    }

    test('corpus is non-trivial', () => {
        expect(corpus.length).toBe(60) // 2 contexts × 6 boundaries × 5 leaves
    })
})
