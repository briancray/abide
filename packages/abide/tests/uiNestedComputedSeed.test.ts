import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { linked } from '../src/lib/ui/linked.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'
import { text } from './support/reactiveText.ts'

beforeAll(() => {
    installMiniDom()
})

const RUNTIME = {
    doc,
    state,
    computed,
    linked,
    effect,
    appendText,
    appendStatic,
    text,
    attr,
    on,
    each,
    when,
    mount,
}

function clientHtml(source: string): string {
    const body = compileComponent(source)
    const names = Object.keys(RUNTIME)
    const values = names.map((name) => RUNTIME[name as keyof typeof RUNTIME])
    const host = document.createElement('div')
    new Function('host', '$props', ...names, body)(host, undefined, ...values)
    return (globalThis as unknown as { serializeMiniDom: (h: unknown) => string }).serializeMiniDom(
        host,
    )
}

async function serverHtml(source: string): Promise<string> {
    const body = compileSSR(source)
    const names = Object.keys(RUNTIME)
    const values = names.map((name) => RUNTIME[name as keyof typeof RUNTIME])
    const render = (await new Function('$props', '$ctx', ...names, body)(
        undefined,
        undefined,
        ...values,
    )) as SsrRender
    return render.html
}

/*
A nested branch `<script>` keeps its `state.computed`/`state.linked` calls literal (it is not
desugared to the doc), so a BARE-VALUE seed must be auto-wrapped into a thunk the same way the
top-level script is. Before the fix the bare value reached the runtime primitive as its compute
function and was called on read (`... is not a function`), a hard crash on both sides. These
render end-to-end, proving the wrapped seed actually computes.
*/
describe('nested-script bare-value reactive seeds render (auto-wrapped like top-level)', () => {
    test('a bare-value state.computed in a nested branch script computes its value', async () => {
        const source = `<script>import { state } from '@abide/abide/ui/state'
let n = state(3)</script>
{#if n > 0}
<script>let doubled = state.computed(n * 2)</script>
<p>{doubled}</p>
{/if}`
        expect(clientHtml(source)).toContain('6')
        expect(await serverHtml(source)).toContain('6')
    })

    test('a bare-value state.linked in a nested branch script mirrors its source', async () => {
        const source = `<script>import { state } from '@abide/abide/ui/state'
let n = state(7)</script>
{#if n > 0}
<script>let mirror = state.linked(n)</script>
<p>{mirror}</p>
{/if}`
        expect(clientHtml(source)).toContain('7')
        expect(await serverHtml(source)).toContain('7')
    })
})
