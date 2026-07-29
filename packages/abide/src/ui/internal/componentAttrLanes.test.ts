// What each ATTRIBUTE KIND means on a COMPONENT tag — enumerated, and asserted across all three lanes.
//
// The three lanes (`emitCheck` types it, `emitClient` mounts it, `emitServer` renders it) each carry
// their own `switch` over attribute kind, and they had silently drifted apart on two of six kinds:
//
//   onclick={f}   check: prop   client: prop   server: DROPPED   ← isomorphism break
//   class:x={c}   check: prop   client: dropped  server: dropped ← typed as real, did nothing
//   style:p={v}   check: prop   client: dropped  server: dropped ← same
//
// `laneAgreement.test.ts` could not catch this: it asserts the lanes agree on what is LEGAL, and all
// three considered these legal. They disagreed about what the legal thing MEANT. So this file asserts
// the lowering, not the legality — and it asserts it by OBSERVING output (rendered HTML, hydrated HTML,
// the props object a component actually receives) rather than by reading the emitted source, because
// the emitted source is exactly what the three lanes are allowed to differ in.
//
// The enumeration is the point. A new attribute kind should fail here until it is given a row.

import { describe, expect, test } from 'bun:test'
import { type ComponentResolver, emitModuleSource, loadEmitted } from './emit.ts'
import { parse } from './parse.ts'
import { validateTemplate } from './validateTemplate.ts'

// The build lane's rejection message for a source, or undefined when it is legal.
function rejection(source: string): string | undefined {
    const verdict = validateTemplate(parse(source))
    return verdict.legal ? undefined : verdict.rejected
}

const strip = (html: string): string => html.replace(/<!--\[-->|<!--\]-->|<!---->/g, '')

// Reports the prop names it was handed, so a dropped prop is visible in the OUTPUT of both lanes.
const PROBE =
    `<script>import { props } from "abide/ui/props"; const p = props()</script>` +
    `<b>{Object.keys(p).sort().join(",")}</b>`

const resolve: ComponentResolver = (specifier) =>
    specifier === './Probe.abide' ? PROBE : undefined

// Render on the server, then hydrate the SAME markup, and return both. Divergence here is the bug
// class this file exists for: SSR and hydrate disagreeing about the props a component received.
async function bothLanes(page: string): Promise<{ server: string; client: string }> {
    const emitted = await loadEmitted(page, resolve)
    const host = document.createElement('div')
    host.innerHTML = await emitted.render({})
    const server = strip(host.innerHTML)
    emitted.hydrate(host, {})
    await Promise.resolve()
    await Promise.resolve()
    return { server, client: strip(host.innerHTML) }
}

describe('attribute kinds that REACH a component as props', () => {
    test.each([
        ['static', '<Probe title="hi"/>', 'title'],
        ['expression', '<Probe title={1}/>', 'title'],
        ['event', '<Probe onclick={go}/>', 'onclick'],
        ['bind', '<Probe bind:value={v}/>', 'value'],
        ['spread', '<Probe {...extra}/>', 'a,b'],
    ])('%s — both lanes pass it, and they agree', async (_kind, tag, expected) => {
        const page =
            `<script>import Probe from "./Probe.abide"; function go(){}; let v = 1; ` +
            `const extra = { a: 1, b: 2 }</script>` +
            tag
        const { server, client } = await bothLanes(page)
        expect(server).toBe(`<b>${expected}</b>`)
        // The assertion that actually guards the isomorphism. `onclick` used to be `<b></b>` on the
        // server and `<b>onclick</b>` on the client.
        expect(client).toBe(server)
    })
})

describe('attribute kinds that are REJECTED on a component', () => {
    const CARD = '{#component Card()}<b>x</b>{/component}'

    test.each([
        ['class:', `${CARD}<Card class:active={true}/>`],
        ['style:', `${CARD}<Card style:color={"red"}/>`],
    ])('%s is a compile error in the check lane AND the build lane', (_kind, source) => {
        // One gate, asked twice: `validateTemplate` runs `buildPlan` and reports what it throws, so
        // `abide check`/the LSP reject exactly what `abide build` rejects — by construction, not by
        // three switches agreeing.
        expect(rejection(source)).toContain('not valid on a component')
        expect(() => emitModuleSource(source)).toThrow(/not valid on a component/)
    })

    test('the message names the fix rather than only the rule', () => {
        const message = rejection(`${CARD}<Card class:active={true}/>`) ?? ''
        expect(message).toContain('targets one element')
        expect(message).toContain('<Card class={…}/>')
    })

    // The directives stay legal where they mean something. A gate that over-rejects would be a worse
    // bug than the silent drop it replaced.
    test.each([
        ['class:', '<b class:active={true}>x</b>'],
        ['style:', '<b style:color={"red"}>x</b>'],
    ])('%s on a real ELEMENT is untouched', (_kind, source) => {
        expect(rejection(source)).toBeUndefined()
    })
})
