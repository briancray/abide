import { afterAll, expect, test } from 'bun:test'
import { parseAbide } from '#compiler'
import { classifyAttributes, isBound } from '#compiler/classifyTemplate.ts'
import type { TemplateNode } from '#compiler/TemplateNode.ts'
import { renderDocument } from '#server/render.ts'
import { setClass } from '#ui/setClass.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'
import { closeTyped, serverOf } from './typed.ts'

afterAll(async () => {
    removeTemporaryModules()
    await closeTyped()
})

// THE ONE CLASSIFICATION, read by the markup, the build and the mount alike: an element in, one
// entry per attribute out, in the author's order. Each row is what the three readers act on —
// whether the tag carries it, what it is, and whether the mount binds it.
//
// THE REVERTS, each failing one row: drop the `node.lowerTag !== 'input'` guard on `reflects` and the
// `<textarea>`'s `bind:value` reads `'value'` where `undefined` is due (the server would write a
// `value=` a textarea has no use for); make `isBound` answer `true` for every `dynamic` and
// `data-k` reads bound though proven static; drop the `safeUrl` check from `staticBytes` and the
// `javascript:` `HREF` is written.
const element = (source: string) =>
    parseAbide(source).template[0] as TemplateNode & { kind: 'element' }

// `data-k` and `class:off` are the two expressions the checker "proved" static.
const PROVEN = new Set(['data-k', 'class:off'])
const lowering = (node: TemplateNode & { kind: 'element' }) => ({
    isLive: (holder: object) => {
        for (const attribute of node.attributes)
            if (attribute === holder) return !PROVEN.has(attribute.lowerName)
        throw new Error('asked of something that is not an attribute')
    },
    readsAnItem: () => false,
})

const rows = (source: string) => {
    const node = element(source)
    return classifyAttributes(node, lowering(node)).map((one) => {
        const row: Record<string, unknown> = {
            name: one.attribute.name,
            kind: one.kind,
            live: one.live,
            bound: isBound(one),
        }
        if (one.kind === 'static') row.bytes = one.bytes
        if (one.kind === 'bound') row.reflects = one.reflects
        if (one.kind === 'handler') row.event = one.event
        if (one.kind === 'merged') {
            row.group = one.group?.name
            row.toggles = one.toggles
        }
        return row
    })
}

test('every attribute of an element is one entry, classified once', () => {
    expect(
        rows(
            '<a HREF="javascript:alert(1)" title="AT&amp;T" onClick={go} {...rest} data-k={k} data-v={v} bind:element={el}>x</a>',
        ),
    ).toEqual([
        // 32.20 — a static URL refused where the value is known: the tag carries nothing.
        {
            name: 'HREF',
            kind: 'static',
            live: false,
            bound: false,
            bytes: undefined,
        },
        // 32.27 — the author's own bytes, the `"` the only rewrite.
        {
            name: 'title',
            kind: 'static',
            live: false,
            bound: false,
            bytes: 'AT&amp;T',
        },
        {
            name: 'onClick',
            kind: 'handler',
            live: true,
            bound: true,
            event: 'click',
        },
        { name: '...', kind: 'spread', live: true, bound: true },
        // 32.3 — moves only where live.
        { name: 'data-k', kind: 'dynamic', live: false, bound: false },
        { name: 'data-v', kind: 'dynamic', live: true, bound: true },
        { name: 'bind:element', kind: 'element', live: true, bound: true },
    ])
})

test('a URL attribute keeps the whole rewrite, and a safe one is written', () => {
    expect(rows('<a href="/a?b=1&amp;c=2">x</a>')).toEqual([
        {
            name: 'href',
            kind: 'static',
            live: false,
            bound: false,
            bytes: '/a?b=1&amp;amp;c=2',
        },
    ])
})

test('a value bind reflects only where the property is an attribute', () => {
    expect(
        rows('<input type="radio" value="s" bind:group={size}>'),
    ).toContainEqual({
        name: 'bind:group',
        kind: 'bound',
        live: true,
        bound: true,
        reflects: 'checked',
    })
    expect(rows('<textarea bind:value={text}></textarea>')).toEqual([
        {
            name: 'bind:value',
            kind: 'bound',
            live: true,
            bound: true,
            reflects: undefined,
        },
    ])
})

// 32.10, 32.19, 32.71 — the group is written at its FIRST member. A `class={expr}` beside a
// directive SHARES the group: the whole class list is one binding there, live where any member
// is, owning the directives' classes.
test('a merge group is written once and bound per directive', () => {
    expect(
        rows(
            '<p class:on={x} class={c} title={t} class:off={y} style:width={w}>x</p>',
        ),
    ).toEqual([
        {
            name: 'class:on',
            kind: 'merged',
            live: true,
            bound: true,
            group: 'class',
            toggles: { write: 'classGroup', name: 'on off' },
        },
        {
            name: 'class',
            kind: 'merged',
            live: true,
            bound: false,
            group: undefined,
            toggles: undefined,
        },
        { name: 'title', kind: 'dynamic', live: true, bound: true },
        {
            name: 'class:off',
            kind: 'merged',
            live: false,
            bound: false,
            group: undefined,
            toggles: undefined,
        },
        {
            name: 'style:width',
            kind: 'merged',
            live: true,
            bound: true,
            group: 'style',
            toggles: { write: 'style', name: 'width' },
        },
    ])
})

// 32.71 — A STATIC `class` OR `style` NEVER SHARES. It is written once by the server and never
// again, a directive naming one of a static `class`'s classes is always on, and every other
// directive stays `setClass` or `setStyleProperty`; a `style={expr}` shares as a `class={expr}`
// does.
test('a static plain attribute never shares its group', () => {
    const plain = (source: string) =>
        rows(source).map(({ name, bound, toggles }) => ({
            name,
            bound,
            toggles,
        }))
    expect(plain('<p class="badge" class:on={x}>x</p>')).toEqual([
        { name: 'class', bound: false, toggles: undefined },
        {
            name: 'class:on',
            bound: true,
            toggles: { write: 'class', name: 'on' },
        },
    ])
    // A DIRECTIVE NAMING ONE OF THE STATIC CLASSES IS ALWAYS ON, so it is never bound. THE
    // REVERT: drop `heldClasses`, and `class:on` reads bound.
    expect(plain('<p class="badge on" class:on={x}>x</p>')).toEqual([
        { name: 'class', bound: false, toggles: undefined },
        { name: 'class:on', bound: false, toggles: undefined },
    ])
    // A `class={expr}` WHERE NOTHING IN THE GROUP MOVES does not share either: the server's
    // value stands and nothing is bound. THE REVERT: count every `class={expr}` group as moving
    // in `sharedGroupOf`, and both read bound.
    const still = element('<p class={c} class:on={x}>x</p>')
    expect(
        classifyAttributes(still, {
            isLive: () => false,
            readsAnItem: () => false,
        }).map(isBound),
    ).toEqual([false, false])
    // A `style={expr}` SHARES ITS GROUP as a `class={expr}` does.
    expect(plain('<p style={s} style:width={w}>x</p>')).toEqual([
        {
            name: 'style',
            bound: true,
            toggles: { write: 'styleGroup', name: 'width' },
        },
        { name: 'style:width', bound: false, toggles: undefined },
    ])
    // A STATIC `style` NEVER SHARES: written once by the server, and the directive is a property.
    expect(plain('<p style="color: red" style:width={w}>x</p>')).toEqual([
        { name: 'style', bound: false, toggles: undefined },
        {
            name: 'style:width',
            bound: true,
            toggles: { write: 'style', name: 'width' },
        },
    ])
})

// 32.10 — A `class:name` VALUE IS A CONDITION, decided on two sides: the server's markup writes the
// name under a JS `?:` (`classValue`) and the client's binding toggles it with `Boolean(on)`
// (`setClass`). Both are ECMAScript's one ToBoolean; this pins that they read every value alike,
// so a hydrated page never flips a class it was served with. THE REVERT: give `setClass`
// `on === true` in place of `Boolean(on)`; every truthy value other than `true` disagrees.
const CONDITIONS =
    "[0, -0, NaN, '', null, undefined, false, 0n, '0', 'false', ' ', [], {}, () => 0, Symbol('s'), true, 1]"

test('the served class: condition and the bound one agree on every value — 32.10', async () => {
    const dir = temporaryModule({
        'Page.ts': await serverOf(
            `<script>const values = ${CONDITIONS}</script>{#for v of values}<i class:on={v}>t</i>{/for}`,
        ),
    })
    const { default: Component } = await import(`${dir}/Page.ts`)
    const html = new TextDecoder().decode(
        await renderDocument(
            Component,
            '<!doctype html><html><body></body></html>',
        ),
    )
    document.body.innerHTML = html.slice(
        html.indexOf('<body>') + '<body>'.length,
        html.indexOf('</body>'),
    )
    const served = [...document.body.querySelectorAll('i')].map((one) =>
        one.classList.contains('on'),
    )
    const bound = (new Function(`return ${CONDITIONS}`)() as unknown[]).map(
        (value) => {
            const one = document.createElement('i')
            setClass(one, 'on', value)
            return one.classList.contains('on')
        },
    )
    expect(served).toHaveLength(17)
    expect(served).toEqual(bound)
})
