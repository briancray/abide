import { describe, expect, test } from 'bun:test'
import { analyzeComponent } from '../src/lib/ui/compile/analyzeComponent.ts'
import { compileShadow } from '../src/lib/ui/compile/compileShadow.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { generateBuild } from '../src/lib/ui/compile/generateBuild.ts'
import { parseTemplate } from '../src/lib/ui/compile/parseTemplate.ts'
import { spreadExcludedNames } from '../src/lib/ui/compile/spreadExcludedNames.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { state } from '../src/lib/ui/state.ts'

/* Build code for a component template, with its scope analyzed (state/derived/computed). */
function buildOf(source: string): string {
    const { stateNames, derivedNames, computedNames, nodes } = analyzeComponent(source)
    return generateBuild(nodes, 'host', stateNames, derivedNames, computedNames)
}

/* Runs a compiled SSR body to its rendered HTML string (no DOM). */
function renderSSR(source: string): string {
    const body = compileSSR(source)
    return (
        new Function('doc', 'state', 'computed', 'effect', body)(doc, state, computed, effect) as {
            html: string
        }
    ).html
}

/* `name="literal {expr}"` interpolation: the quoted value splits into static/expression
   parts (the text-node model applied to an attribute), so a value can mix literal text
   with reactive expressions. A value with no `{expr}` stays a plain `static` attribute. */
describe('attribute interpolation — parser', () => {
    test('class="foo {bar}" → interpolated attr with static + expression parts', () => {
        const { nodes } = parseTemplate(`<div class="foo {bar}">x</div>`)
        const el = nodes[0]
        expect(el.kind).toBe('element')
        if (el.kind !== 'element') throw new Error('not element')
        const attr = el.attrs[0]
        expect(attr.kind).toBe('interpolated')
        if (attr.kind !== 'interpolated') throw new Error('not interpolated')
        expect(attr.name).toBe('class')
        expect(attr.parts).toEqual([
            { kind: 'static', value: 'foo ' },
            { kind: 'expression', code: 'bar', loc: expect.any(Number) },
        ])
    })

    test('a value with no {expr} stays a plain static attribute', () => {
        const { nodes } = parseTemplate(`<div class="foo bar">x</div>`)
        const el = nodes[0]
        if (el.kind !== 'element') throw new Error('not element')
        expect(el.attrs[0]).toMatchObject({ kind: 'static', name: 'class', value: 'foo bar' })
    })

    test('a brace entity is a literal brace, not an interpolation', () => {
        const { nodes } = parseTemplate(`<a data-json="&lbrace;&quot;x&quot;:1&rbrace;">x</a>`)
        const el = nodes[0]
        if (el.kind !== 'element') throw new Error('not element')
        expect(el.attrs[0]).toMatchObject({ kind: 'static', name: 'data-json', value: '{"x":1}' })
    })

    test('multiple expressions and surrounding literals split into ordered parts', () => {
        const { nodes } = parseTemplate(`<a href="/u/{id}/{tab}">x</a>`)
        const el = nodes[0]
        if (el.kind !== 'element') throw new Error('not element')
        const attr = el.attrs[0]
        if (attr.kind !== 'interpolated') throw new Error('not interpolated')
        expect(
            attr.parts.map((part) => (part.kind === 'static' ? part.value : `{${part.code}}`)),
        ).toEqual(['/u/', '{id}', '/', '{tab}'])
    })
})

describe('attribute interpolation — spread interaction', () => {
    test('an explicit interpolated attribute wins over a {...spread} key of the same name', () => {
        const { nodes } = parseTemplate(`<div {...rest} class="card {v}"></div>`)
        const el = nodes[0]
        if (el.kind !== 'element') throw new Error('not element')
        expect(spreadExcludedNames(el.attrs)).toContain('class')
    })
})

describe('attribute interpolation — component props', () => {
    test('an interpolated component attribute becomes a string-valued template-literal prop', () => {
        const { nodes } = parseTemplate(`<Greeting label="hi {name}!" />`)
        const comp = nodes[0]
        if (comp.kind !== 'component') throw new Error('not component')
        expect(comp.props[0]).toMatchObject({ name: 'label', code: '`hi ${name}!`' })
    })
})

describe('attribute interpolation — client merge with directives', () => {
    /* A reactive (interpolated) class base can't use the additive classList.toggle model:
       re-setting the base attribute would wipe the directive-toggled classes. So the base
       and its class: directives collapse into ONE effect computing the whole className,
       mirroring the SSR merge. */
    test('interpolated class + class: directive → one merged className effect, no clobbering attr', () => {
        const build = buildOf(
            `<script>import { state } from '@abide/abide/ui/state'
let v = state('big')\nlet on = state(true)</script><div class="card {v}" class:active={on}>x</div>`,
        )
        expect(build).toContain('setAttribute("class", [')
        expect(build).toContain(`? "active" : ""`)
        // not a separate class attribute write (which would clobber the toggle) nor a toggle
        expect(build).not.toContain('attr(el1, "class"')
        expect(build).not.toContain('classList.toggle("active"')
    })

    test('interpolated style + style: directive → one merged style-attribute effect', () => {
        const build = buildOf(
            `<script>import { state } from '@abide/abide/ui/state'
let w = state('10px')\nlet c = state('red')</script><div style="width: {w}" style:color={c}>x</div>`,
        )
        expect(build).toContain('setAttribute("style", [')
        expect(build).toContain(`"color:" + String(`)
        expect(build).not.toContain('setProperty("color"')
    })

    test('interpolated class with NO directive stays a plain reactive attr', () => {
        const build = buildOf(
            `<script>import { state } from '@abide/abide/ui/state'
let v = state('big')</script><div class="card {v}">x</div>`,
        )
        expect(build).toContain('attr(')
        expect(build).not.toContain('setAttribute("class", [')
    })
})

describe('attribute interpolation — type-check shadow', () => {
    test('each interpolated expression is emitted as a checkable statement', () => {
        const { code } = compileShadow(
            `<script>import { state } from '@abide/abide/ui/state'
let id = state(1)</script><a href="/u/{id}/{id.toFixed(0)}">x</a>`,
        )
        expect(code).toContain('(id)')
        expect(code).toContain('(id.toFixed(0))')
    })
})

describe('attribute interpolation — SSR', () => {
    test('renders the resolved interpolated value into the attribute', () => {
        const html = renderSSR(`
            <script>import { state } from '@abide/abide/ui/state'
let id = state(7)</script>
            <a href="/u/{id}/profile">x</a>
        `)
        expect(html).toBe('<a href="/u/7/profile">x</a>')
    })

    test('an interpolated class merges with class: directives into one attribute', () => {
        const html = renderSSR(`
            <script>import { state } from '@abide/abide/ui/state'

                let variant = state('big')
                let on = state(true)
            </script>
            <div class="card {variant}" class:active={on}>x</div>
        `)
        expect(html).toBe('<div class="card big active">x</div>')
    })

    test('an interpolated style merges with style: directives into one attribute', () => {
        const html = renderSSR(`
            <script>import { state } from '@abide/abide/ui/state'

                let w = state('10px')
                let c = state('red')
            </script>
            <div style="width: {w}" style:color={c}>x</div>
        `)
        expect(html).toBe('<div style="width: 10px;color:red">x</div>')
    })
})
