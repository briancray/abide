/* `class:<name>` / `style:<prop>` directives: surgical reactive class/style writes
   (no element re-render), with SSR collapsing them into a single merged attribute so
   the server markup already matches the post-hydrate DOM. */
import { expect, test } from 'bun:test'
import { generateBuild } from '../src/lib/ui/compile/generateBuild.ts'
import { generateSSR } from '../src/lib/ui/compile/generateSSR.ts'
import { parseTemplate } from '../src/lib/ui/compile/parseTemplate.ts'

const STATE = new Set(['open', 'ratio', 'hue'])
const EMPTY = new Set<string>()

test('parses into dedicated class/style attr kinds (incl. custom property)', () => {
    const { nodes } = parseTemplate(
        `<div class:active={open} style:--pct={ratio} style:color={hue}></div>`,
    )
    const element = nodes.find((node) => node.kind === 'element')
    const shape = element?.attrs.map((attr) =>
        attr.kind === 'class'
            ? `class:${attr.name}`
            : attr.kind === 'style'
              ? `style:${attr.property}`
              : attr.kind,
    )
    expect(shape).toEqual(['class:active', 'style:--pct', 'style:color'])
})

test('build emits surgical classList.toggle / setProperty inside a watch (no re-render)', () => {
    const { nodes } = parseTemplate(`<div class:active={open} style:--pct={ratio}></div>`)
    const build = generateBuild(nodes, 'host', STATE, EMPTY, EMPTY)
    expect(build).toContain('classList.toggle("active"')
    expect(build).toContain('.style.setProperty("--pct", String(')
    expect(build).toContain('$$watch(')
    // not an attribute re-render path
    expect(build).not.toContain('attr(host, "class:active"')
})

test('SSR merges static class + class: directives into ONE class attribute', () => {
    const { nodes } = parseTemplate(`<div class="card" class:active={open}></div>`)
    const ssr = generateSSR(nodes, STATE, EMPTY, EMPTY)
    // the static "card" and the truthy-gated "active" join into one class=""
    expect(ssr).toContain(`["card", ((`)
    expect(ssr).toContain(`].filter(Boolean).join(' ')`)
    expect(ssr).toContain(`' class="'`)
    // and NOT a separate static class attribute (which would duplicate)
    expect(ssr).not.toContain('staticAttr')
})

test('SSR merges static style + style: directives into ONE style attribute', () => {
    const { nodes } = parseTemplate(`<div style="margin:0" style:--pct={ratio}></div>`)
    const ssr = generateSSR(nodes, STATE, EMPTY, EMPTY)
    expect(ssr).toContain(`["margin:0", ("--pct:" + String(`)
    expect(ssr).toContain(`].filter(Boolean).join(';')`)
    expect(ssr).toContain(`' style="'`)
})

test('class:/style: with no static counterpart still merge from scratch', () => {
    const { nodes } = parseTemplate(`<div class:on={open}></div>`)
    const ssr = generateSSR(nodes, STATE, EMPTY, EMPTY)
    expect(ssr).toContain(`[((`)
    expect(ssr).toContain(`? "on" : "")].filter(Boolean).join(' ')`)
})
